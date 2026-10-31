import type { EvenementAgent } from './types.js';

// Un item garde son identité du premier fragment jusqu'au résultat final.
// Les instantanés sont bornés à 8/s, y compris quand une commande écrit très vite.
export function creerFluxCodex(publier: (e: EvenementAgent) => void) {
    const items = new Map<string, EvenementAgent>();
    const debut = new Map<string, number>();
    const attente = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resultat = '';
    const envoyer = (id: string) => { const e = items.get(id); if (e) publier({ ...e }); attente.delete(id); };
    const planifier = (id: string) => {
        attente.add(id);
        timer ??= setTimeout(() => { timer = undefined; for (const cle of attente) envoyer(cle); }, 120);
    };
    const initialiser = (item: any, fini: boolean) => {
        if (!item.id) return;
        const ancien = items.get(item.id);
        const etat = fini ? (['failed', 'declined'].includes(item.status) || typeof item.exitCode === 'number' && item.exitCode !== 0 ? 'erreur' : 'termine') : 'en_cours';
        let e: EvenementAgent | undefined;
        if (item.type === 'agentMessage') e = { role: 'assistant', texte: item.text || ancien?.texte || '' };
        if (item.type === 'commandExecution') e = { role: 'outil', texte: 'Commande', commande: item.command || ancien?.commande,
            sortie: item.aggregatedOutput || ancien?.sortie,
            codeSortie: item.exitCode ?? ancien?.codeSortie };
        if (item.type === 'fileChange') e = { role: 'outil', texte: 'Modification de fichiers',
            fichier: item.changes?.[0]?.path, fichiers: (item.changes || []).map((f: any) => f.path), sortie: (item.changes || []).map((f: any) => `${f.path}\n${f.diff || ''}`).join('\n') };
        if (item.type === 'webSearch') e = { role: 'outil', texte: `Recherche web · ${item.query || item.action?.query || ''}` };
        if (item.type === 'mcpToolCall') e = { role: 'outil', texte: `${item.server || 'MCP'} · ${item.tool || 'Outil'}`,
            sortie: fini ? JSON.stringify(item.result ?? item.error ?? '') : ancien?.sortie };
        if (item.type === 'plan') e = { role: 'outil', texte: 'Plan de travail', sortie: item.text || ancien?.sortie || '' };
        if (!e) return;
        debut.set(item.id, debut.get(item.id) ?? Date.now());
        e = { ...ancien, ...e, id: item.id, etat, dureeMs: fini ? item.durationMs ?? Date.now() - debut.get(item.id)! : undefined };
        limiter(e); items.set(item.id, e);
        if (fini && item.type === 'agentMessage' && e.texte) resultat = e.texte;
        envoyer(item.id);
    };
    function limiter(e: EvenementAgent) {
        if (e.sortie && e.sortie.length > 128_000) { e.sortie = e.sortie.slice(-128_000); e.sortieTronquee = true; }
    }
    return {
        recevoir(method: string, p: any) {
            if (method === 'item/started' || method === 'item/completed') initialiser(p.item || {}, method === 'item/completed');
            if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
                const e = items.get(p.itemId) ?? { id: p.itemId, role: 'assistant' as const, texte: '', etat: 'en_cours' as const };
                e.texte += p.delta; items.set(p.itemId, e); planifier(p.itemId);
            }
            if (method === 'item/commandExecution/outputDelta' && typeof p.delta === 'string') {
                const e: EvenementAgent = items.get(p.itemId) ?? { id: p.itemId, role: 'outil', texte: 'Commande', etat: 'en_cours' };
                e.sortie = (e.sortie || '') + p.delta; limiter(e); items.set(p.itemId, e); planifier(p.itemId);
            }
            if (method === 'turn/plan/updated') {
                const id = `plan:${p.turnId || 'tour'}`;
                items.set(id, { id, role: 'outil', texte: 'Plan de travail', etat: 'en_cours',
                    sortie: [p.explanation, ...(p.plan || []).map((x: any) => `${x.status === 'completed' ? '✓' : x.status === 'inProgress' ? '→' : '·'} ${x.step}`)].filter(Boolean).join('\n') });
                envoyer(id);
            }
        },
        resultat: () => resultat,
        fermer(succes = false) {
            clearTimeout(timer); timer = undefined;
            for (const [id, e] of items) {
                if (e.etat === 'en_cours') { e.etat = succes ? 'termine' : 'interrompu'; envoyer(id); }
                else if (attente.has(id)) envoyer(id);
            }
        },
    };
}

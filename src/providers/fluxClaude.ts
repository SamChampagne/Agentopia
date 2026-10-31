import type { EvenementAgent } from './types.js';

/** Les deltas publics et résultats d'outils du SDK ; aucune pensée privée déduite. */
export function creerFluxClaude(emettre: (e: EvenementAgent) => void) {
    const items = new Map<string, EvenementAgent>(), messages = new Map<string, string>();
    const debuts = new Map<string, number>(), enAttente = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const envoyer = (id: string) => { const e = items.get(id); if (e) emettre({ ...e }); enAttente.delete(id); };
    const planifier = (id: string) => { enAttente.add(id); timer ??= setTimeout(() => { timer = undefined; for (const i of [...enAttente]) envoyer(i); }, 120); };
    const outil = (bloc: any) => {
        if (typeof bloc.id !== 'string') return;
        const id = `outil:${bloc.id}`; debuts.set(id, debuts.get(id) || Date.now());
        items.set(id, { ...items.get(id), id, role: 'outil', texte: String(bloc.name || 'Outil'), etat: 'en_cours',
            fichier: typeof bloc.input?.file_path === 'string' ? bloc.input.file_path : undefined,
            commande: typeof bloc.input?.command === 'string' ? bloc.input.command : undefined }); envoyer(id);
    };
    return {
        recevoir(m: any) {
            const parent = m.parent_tool_use_id || 'principal';
            if (m.type === 'stream_event') {
                const e = m.event;
                if (e?.type === 'message_start' && e.message?.id) messages.set(parent, e.message.id);
                const message = messages.get(parent);
                if (!message) return;
                const id = `${message}:${e.index}`;
                if (e.type === 'content_block_start' && e.content_block?.type === 'text') {
                    items.set(id, { id, role: 'assistant', texte: e.content_block.text || '', etat: 'en_cours' });
                }
                if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') outil(e.content_block);
                if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
                    const item = items.get(id) || { id, role: 'assistant' as const, texte: '', etat: 'en_cours' as const };
                    item.texte = (item.texte + e.delta.text).slice(-500_000); items.set(id, item); planifier(id);
                }
                if (e.type === 'content_block_stop' && items.has(id)) { items.get(id)!.etat = 'termine'; envoyer(id); }
            }
            if (m.type === 'assistant') for (const [i, b] of (m.message?.content || []).entries()) {
                if (b.type === 'text') { const id = `${m.message.id || m.uuid}:${i}`; items.set(id, { id, role: 'assistant', texte: b.text, etat: 'termine' }); envoyer(id); }
                if (b.type === 'tool_use') outil(b);
            }
            if (m.type === 'user' && Array.isArray(m.message?.content)) for (const b of m.message.content) {
                if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
                const id = `outil:${b.tool_use_id}`, precedent = items.get(id);
                const sortie = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n') : '';
                items.set(id, { ...precedent, id, role: 'outil', texte: precedent?.texte || 'Résultat d’outil',
                    etat: b.is_error ? 'erreur' : 'termine', sortie: sortie.slice(-128_000), sortieTronquee: sortie.length > 128_000,
                    dureeMs: debuts.has(id) ? Date.now() - debuts.get(id)! : undefined }); envoyer(id);
            }
        },
        fermer(succes: boolean) {
            clearTimeout(timer); timer = undefined;
            for (const [id, e] of items) {
                if (e.etat === 'en_cours') { e.etat = succes ? 'termine' : 'interrompu'; envoyer(id); }
                else if (enAttente.has(id)) envoyer(id);
            }
        },
    };
}

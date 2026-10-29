import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { CodexRpc } from './providers/codexRpc.js';
import { binaireCodex } from './providers/config.js';
import { listerProjets } from './projets.js';
import { chargerConfig } from './config.js';
import { listerSessions } from './sessions.js';
import { dossierIntegre, lireIntegree, ecrireAtomique, ajouterMessage, restaurerIntegree } from './sessionsIntegrees.js';
import type { SessionIntegree } from './providers/types.js';

export interface ConversationNative { fournisseur: 'codex' | 'claude-cli'; id: string; titre: string; cwd: string; maj: number }
export interface Inventaire { conversations: ConversationNative[]; date: number; erreur?: string }
export function lireHistoriqueNatif(): Inventaire {
    try { return JSON.parse(fs.readFileSync(CHEMINS.historiqueNatif, 'utf8')); }
    catch { return { conversations: [], date: 0 }; }
}
export async function listerCodex(rpc: Pick<CodexRpc, 'demander'>): Promise<ConversationNative[]> {
    const resultat: ConversationNative[] = [];
    const cursors = new Set<string>(); let cursor: string | undefined;
    do {
        const r = await rpc.demander('thread/list', { limit: 100, cursor, sortKey: 'updated_at', sourceKinds: ['cli', 'vscode', 'appServer', 'exec'] });
        for (const t of r.data ?? []) {
            if (typeof t.id !== 'string' || typeof t.cwd !== 'string' || !path.isAbsolute(t.cwd)) continue;
            resultat.push({ fournisseur: 'codex', id: t.id, titre: String(t.name || t.preview || 'Conversation Codex').replace(/\s+/g, ' ').slice(0, 180), cwd: t.cwd, maj: Number(t.updatedAt || t.createdAt) * 1000 });
        }
        cursor = r.nextCursor || undefined;
        if (cursor && cursors.has(cursor)) throw new Error('Pagination Codex interrompue : curseur répété');
        if (cursor) cursors.add(cursor);
        if (cursors.size >= 100) throw new Error('Historique Codex trop volumineux pour ce scan. Réessaie depuis un projet.');
    } while (cursor);
    return resultat;
}
export async function actualiserHistoriqueNatif(): Promise<Inventaire> {
    const conversations: ConversationNative[] = [];
    const projets = listerProjets(chargerConfig());
    const chemins = new Set(projets.map((p) => path.resolve(p.chemin).toLowerCase()));
    for (const p of projets) for (const s of listerSessions(p.chemin, 100)) conversations.push({ fournisseur: 'claude-cli', id: s.id, titre: s.titre, cwd: p.chemin, maj: s.date.getTime() });
    let erreur: string | undefined;
    if (binaireCodex()) {
        const rpc = new CodexRpc();
        try { await rpc.initialiser(); conversations.push(...(await listerCodex(rpc)).filter((s) => chemins.has(path.resolve(s.cwd).toLowerCase()))); }
        catch { erreur = 'Codex : inventaire indisponible. Les conversations précédemment détectées sont conservées.';
            conversations.push(...lireHistoriqueNatif().conversations.filter((s) => s.fournisseur === 'codex' && chemins.has(path.resolve(s.cwd).toLowerCase()))); }
        finally { rpc.fermer(); }
    }
    const resultat = { conversations: conversations.sort((a, b) => b.maj - a.maj), date: Date.now(), erreur };
    ecrireAtomique(CHEMINS.historiqueNatif, resultat); return resultat;
}

export async function messagesCodex(id: string, rpc: Pick<CodexRpc, 'demander'>): Promise<{ role: 'user' | 'assistant'; texte: string }[]> {
    // Lire sans reprendre : la conversation ouverte dans l'autre application ne change pas.
    const meta = await rpc.demander('thread/read', { threadId: id, includeTurns: true });
    let tours: any[] = meta.thread?.turns ?? [];
    if (!tours.length) {
        try {
            let cursor: string | undefined; const vus = new Set<string>();
            do {
                const r = await rpc.demander('thread/turns/list', { threadId: id, limit: 100, cursor, sortDirection: 'asc', itemsView: 'full' });
                tours.push(...(r.data ?? [])); cursor = r.nextCursor || undefined;
                if (cursor && vus.has(cursor)) throw new Error('Curseur répété');
                if (cursor) vus.add(cursor);
                if (vus.size >= 30) throw new Error('Historique trop volumineux');
            } while (cursor);
        } catch (e) {
            // Ne pas ouvrir une conversation vide en prétendant avoir importé son historique.
            throw new Error('L’historique Codex n’a pas pu être chargé. Mets à jour son CLI et réessaie.');
        }
    }
    return tours.flatMap((t) => (t.items ?? []).flatMap((i: any) => {
        if (i.type === 'agentMessage' && typeof i.text === 'string') return [{ role: 'assistant' as const, texte: i.text }];
        if (i.type === 'userMessage') {
            const texte = (i.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
            if (texte) return [{ role: 'user' as const, texte }];
        }
        return [];
    }));
}

export async function importerCodex(c: ConversationNative, rpcFourni?: Pick<CodexRpc, 'demander'>): Promise<SessionIntegree> {
    if (c.fournisseur !== 'codex' || !fs.statSync(c.cwd).isDirectory()) throw new Error('Le dossier de cette conversation n’est plus accessible');
    const hash = createHash('sha256').update(`${process.env.CODEX_HOME || ''}\n${c.id}`).digest('hex').slice(0, 32);
    const id = `ct-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
    const existante = lireIntegree(id);
    if (existante) { restaurerIntegree(id); return existante; }
    const rpc = rpcFourni ?? new CodexRpc();
    try {
        if (!rpcFourni) await (rpc as CodexRpc).initialiser();
        const messages = await messagesCodex(c.id, rpc);
        const dossier = dossierIntegre(id); fs.mkdirSync(dossier, { recursive: true });
        // Verrou de création partagé entre fenêtres ; jamais de deuxième transcript identique.
        const verrou = path.join(dossier, 'importation');
        const fd = fs.openSync(verrou, 'wx'); fs.closeSync(fd);
        try {
            if (lireIntegree(id)) return lireIntegree(id)!;
            fs.writeFileSync(path.join(dossier, 'conversation.jsonl'), '');
            for (const m of messages) ajouterMessage(id, m.role, m.texte);
            const s: SessionIntegree = { id, fournisseur: 'codex', cwd: c.cwd, titre: `${c.titre} · reprise`,
                creee: Date.now(), maj: c.maj, tour: '', etat: 'attend', threadId: c.id,
                origine: { threadId: c.id, fournisseur: 'codex', copieAuProchainMessage: true } };
            ecrireAtomique(path.join(dossier, 'etat.json'), s); return s;
        } finally { fs.rmSync(verrou, { force: true }); }
    } finally { if (!rpcFourni) (rpc as CodexRpc).fermer(); }
}

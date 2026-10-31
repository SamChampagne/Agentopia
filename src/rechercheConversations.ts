import * as path from 'node:path';
import type { Message } from './agents.js';
import { listerIntegrees, fichierIntegre } from './sessionsIntegrees.js';
import { lireHistoriqueNatif } from './historiqueAgents.js';
import { dossierSessions } from './sessions.js';
import { rechercherHistoriqueConversation } from './historiqueConversation.js';

export interface ConversationRecherchable {
    id: string; titre: string; fournisseur: string; cwd: string; fichier: string; integree: boolean; maj: number;
}
export interface ResultatConversations {
    resultats: { conversation: ConversationRecherchable; messages: Message[]; total: number }[];
    conversations: number; correspondances: number; consultees: number;
    erreurs: { titre: string; message: string }[]; erreursTotal: number;
}
export async function conversationsRecherchables(): Promise<ConversationRecherchable[]> {
    const { getProjets } = await import('./commandes.js');
    const normaliser = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    const projets = new Set(getProjets().map(p => normaliser(p.chemin)));
    const liste: ConversationRecherchable[] = listerIntegrees(true).map(s => ({ id: s.id, titre: s.titre, fournisseur: s.fournisseur,
        cwd: s.cwd, fichier: fichierIntegre(s.id, 'conversation.jsonl'), integree: true, maj: s.maj }));
    // Aucun scan de compte ni démarrage de CLI : seulement l’inventaire natif déjà
    // indexé des projets suivis. Le Codex externe devient cherchable après import.
    const inventaire = lireHistoriqueNatif();
    for (const s of Array.isArray(inventaire.conversations) ? inventaire.conversations : []) {
        if (s.fournisseur !== 'claude-cli' || typeof s.cwd !== 'string' || !path.isAbsolute(s.cwd)
            || !projets.has(normaliser(s.cwd)) || typeof s.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(s.id)) continue;
        liste.push({ ...s, titre: String(s.titre || 'Claude CLI'), fichier: path.join(dossierSessions(s.cwd), `${s.id}.jsonl`), integree: false });
    }
    const uniques = new Map(liste.map(s => [normaliser(s.fichier), s]));
    return [...uniques.values()].sort((a, b) => b.maj - a.maj);
}

export async function rechercherConversations(liste: ConversationRecherchable[], terme: string, options: {
    signal?: AbortSignal; limite?: number; progression?: (consultees: number, total: number) => void;
} = {}): Promise<ResultatConversations> {
    if (terme.trim().length < 2) throw new Error('Tape au moins deux caractères pour rechercher une conversation.');
    const r: ResultatConversations = { resultats: [], conversations: 0, correspondances: 0, consultees: 0, erreurs: [], erreursTotal: 0 };
    const limite = Math.max(1, Math.min(200, options.limite ?? 100));
    for (const conversation of liste) {
        options.signal?.throwIfAborted();
        try {
            const trouve = await rechercherHistoriqueConversation(conversation.fichier, terme, { signal: options.signal, limite: 3 });
            if (trouve.total) {
                r.conversations++; r.correspondances += trouve.total;
                if (r.resultats.length < limite) r.resultats.push({ conversation, ...trouve });
            }
        } catch (e) {
            options.signal?.throwIfAborted();
            r.erreursTotal++;
            if (r.erreurs.length < 20) r.erreurs.push({ titre: conversation.titre, message: (e as Error).message });
        }
        r.consultees++; options.progression?.(r.consultees, liste.length);
    }
    return r;
}

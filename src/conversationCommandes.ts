import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Commande } from './commandes.js';
import { listerAgents } from './agents.js';
import { exporterConversation } from './historiqueConversation.js';
import { conversationsRecherchables, rechercherConversations } from './rechercheConversations.js';
import { restaurerIntegree } from './sessionsIntegrees.js';
import { choisir, saisir, confirmer, tache, bus, Annule, type Demande } from './ui/bus.js';

const perimetre = 'Conversations intégrées, y compris archivées, et Claude CLI déjà indexé dans les projets suivis. Codex externe : importe sa conversation depuis Historique des agents avant de la rechercher ici. Aucun appel à un modèle.';

async function chercher(terme: string): Promise<void> {
    const liste = await conversationsRecherchables();
    const controle = new AbortController();
    let attente: Extract<Demande, { type: 'choix' }> | undefined;
    const capturer = (d?: Demande) => { if (d?.type === 'choix') attente = d; };
    bus.once('demande', capturer);
    const fermeture = choisir('Recherche dans les conversations…', [{ label: 'Annuler la recherche', valeur: 'annuler' }], false, perimetre)
        .then(v => { if (v === 'annuler') controle.abort(new Annule()); }, () => controle.abort(new Annule()));
    let resultat: Awaited<ReturnType<typeof rechercherConversations>>;
    try {
        resultat = await rechercherConversations(liste, terme, { signal: controle.signal,
            progression: (n, total) => bus.emit('tache', `Recherche locale · ${n}/${total} conversations`) });
    } finally {
        attente?.resoudre('termine'); bus.off('demande', capturer); await fermeture; bus.emit('tache', undefined);
    }
    controle.signal.throwIfAborted();
    const erreurs = resultat.erreursTotal ? `\n${resultat.erreursTotal} historique(s) non consultable(s) :\n${resultat.erreurs.map(e => `${e.titre} : ${e.message}`).join('\n')}` : '';
    if (!resultat.resultats.length) { bus.emit('notice', `Aucune correspondance dans ${resultat.consultees} conversations.${erreurs}`); return; }
    const detail = `${perimetre}\n${resultat.correspondances} message(s) dans ${resultat.conversations} conversation(s).${resultat.conversations > resultat.resultats.length ? ` Les ${resultat.resultats.length} conversations les plus récentes sont affichées ; affine la recherche pour les autres.` : ''}${erreurs}`;
    while (true) {
        const choix = await choisir(`Résultats pour « ${terme} »`, resultat.resultats.map(r => ({
            label: `${r.conversation.fournisseur} · ${r.conversation.titre} · ${r.total} message(s)`, valeur: r,
            description: `${path.basename(r.conversation.cwd)} · ${(r.messages.at(-1)?.texte || r.messages.at(-1)?.commande || '').replace(/\s+/g, ' ').slice(0, 200)}`,
        })), true, detail);
        const s = choix.conversation;
        const apercu = choix.messages.map(m => `${m.role} : ${m.texte}\n${m.commande || ''}\n${m.sortie || ''}`.trim()).join('\n\n');
        const action = await choisir(s.titre, [{ label: s.integree ? 'Ouvrir cette conversation' : 'Reprendre dans une copie Claude CLI…', valeur: 'ouvrir' },
            { label: 'Retour aux résultats', valeur: 'retour' }], false, apercu.slice(0, 12000) + (apercu.length > 12000 ? '\n… Aperçu limité ; ouvre la conversation pour la suite.' : ''));
        if (action === 'retour') continue;
        if (s.integree) { restaurerIntegree(s.id); bus.emit('selectionner', s.id); return; }
        if (!await confirmer('Démarrer Claude CLI dans une copie indépendante de cette conversation ? L’original sera conservé.')) continue;
        const { lancerArrierePlan } = await import('./agents.js');
        const r = await tache('Reprise Claude CLI dans une copie', () => lancerArrierePlan(s.cwd, s.titre, undefined, s.id));
        if (!r.id) throw new Error('Claude CLI n’a pas confirmé la reprise. Vérifie sa connexion.');
        bus.emit('selectionner', r.id); return;
    }
}

export function commandesConversation(): Commande[] {
    return [{ nom: 'chercher-conversations', args: '[mots]', groupe: 'Agents', description: 'Rechercher dans les conversations complètes, actives et archivées', executer: async ({ reste }) => {
        const terme = (reste || await saisir('Mots à chercher dans toutes les conversations')).trim();
        if (terme.length < 2) throw new Error('Tape au moins deux caractères.');
        await chercher(terme);
    } }, { nom: 'export-conversation', args: '[session]', groupe: 'Agents', description: 'Exporter toute une conversation en Markdown ou JSONL', executer: async ({ args }) => {
        const sessions = await listerAgents();
        const session = sessions.find((s) => s.sessionId === args[0] || s.id === args[0]) ?? await choisir('Conversation à exporter', sessions.map((s) => ({ label: `${s.nom} · ${s.titre}`, valeur: s })), true);
        const format = await choisir('Format local', [{ label: 'Markdown · lisible, événements et outils', valeur: 'markdown' as const }, { label: 'JSONL · historique original complet', valeur: 'jsonl' as const }]);
        const nom = `Agentopia-${session.sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}.${format === 'markdown' ? 'md' : 'jsonl'}`;
        const destination = await saisir('Fichier local à créer (peut contenir les messages et sorties des outils)', path.join(os.homedir(), nom));
        const existe = fs.existsSync(destination);
        if (existe && !await confirmer(`Remplacer ${destination} ?`)) return;
        await tache('Export de la conversation', () => exporterConversation(session.fichier, destination, format, { ecraser: existe }));
        bus.emit('notice', `Conversation exportée : ${destination}`);
    } }];
}

import type { Commande } from './commandes.js';
import type { SessionIntegree } from './providers/types.js';
import { choisirAgent } from './choixAgent.js';
import { creerIntegree, envoyerIntegree, lireIntegree, sauverIntegree } from './sessionsIntegrees.js';
import { choisir, saisir, bus } from './ui/bus.js';
import { guiderConnexion } from './providers/assistantConnexion.js';
import { chargerConfig, sauverConfig, type Config } from './config.js';
import { bilanUsage, lireUsage } from './utilisation.js';
import { etatMoteur, assurerMoteur, pauseGlobale, reprendreMoteur } from './moteurClient.js';

export const MISSIONS = {
    corriger: { nom: 'Corriger un bug', question: 'Qu’est-ce qui ne fonctionne pas ? Si possible, décris le résultat attendu.', consigne: 'Reproduis le problème, corrige sa cause et exécute les vérifications pertinentes.' },
    fonction: { nom: 'Ajouter une fonction', question: 'Qu’est-ce que tu veux pouvoir faire ?', consigne: 'Réalise la fonction en respectant l’architecture et l’interface existantes. Vérifie le comportement obtenu.' },
    analyser: { nom: 'Analyser le projet', question: 'Quel point veux-tu comprendre ou faire vérifier ?', consigne: 'Analyse le projet en lecture seule. Ne modifie aucun fichier. Rapporte les constats avec les chemins pertinents et tes recommandations.' },
} as const;
export function consigneMission(type: keyof typeof MISSIONS, demande: string): string {
    return `${MISSIONS[type].consigne}\n\nDEMANDE : ${demande}\n\nTermine par trois parties : Résultat (changements ou constats), Vérifications (commandes réellement exécutées et résultat ; sinon non exécutées), Reste à vérifier. Ne présente pas une hypothèse comme un test réussi. Ne pousse rien.`;
}
export function bilanSession(s: SessionIntegree): string {
    const b = s.bilan;
    return [`${s.titre} · ${s.fournisseur} · ${s.issue ?? s.etat}`, s.erreur ? `Blocage : ${s.erreur}` : '',
        'Résumé de l’agent :', b?.resume || s.resultat || 'Aucun résultat final disponible.',
        'Commandes observées :', ...(b?.commandes.length ? b.commandes.map((c) => `${c.codeSortie === undefined ? 'Résultat non renseigné' : `Code de sortie ${c.codeSortie}`} · ${c.commande}`) : ['Aucune preuve d’exécution de commande disponible.']),
        b?.fichiers ? `État Git en fin de tour :\n${b.fichiers}` : '',
        `Utilisation du dernier tour : ${s.utilisation?.coutUSD === undefined ? 'coût indisponible' : s.utilisation.coutUSD.toFixed(4) + ' $ US estimés par le fournisseur'}`,
    ].filter(Boolean).join('\n\n');
}
export function commandesMissions(config?: Config): Commande[] {
    return [
        ...(['mission', ...Object.keys(MISSIONS)] as const).map((nom): Commande => ({ nom, projet: true, args: '[projet] [demande]', groupe: 'Agents',
            description: nom === 'mission' ? 'Corriger, développer ou analyser avec ton agent' : MISSIONS[nom as keyof typeof MISSIONS].nom,
            executer: async ({ projet, apresProjet }) => {
                const type = nom === 'mission' ? await choisir('Que veux-tu faire ?', Object.entries(MISSIONS).map(([valeur, m]) => ({ label: m.nom, valeur: valeur as keyof typeof MISSIONS })), false) : nom as keyof typeof MISSIONS;
                const demande = apresProjet.trim() || (await saisir(MISSIONS[type].question)).trim(); if (!demande) return;
                const f = await choisirAgent(true);
                const s = creerIntegree(f, projet!.chemin, `${MISSIONS[type].nom} · ${projet!.nom}`);
                if (type === 'analyser') { s.lectureSeule = true; sauverIntegree(s); }
                bus.emit('selectionner', s.id); await envoyerIntegree(s.id, consigneMission(type, demande));
            } })),
        { nom: 'reprendre-agent', args: '<session>', groupe: 'Agents', cache: true, description: 'Reprendre la dernière demande après un arrêt ou une erreur', executer: async ({ args }) => {
            const s = lireIntegree(args[0]); if (!s) throw new Error('Session introuvable');
            if (['travaille', 'bloquee'].includes(s.etat)) throw new Error('Ce tour est encore actif ; réponds à la permission ou interromps-le d’abord');
            await guiderConnexion(s.fournisseur, true);
            const message = s.dernierPrompt || (await saisir('Quelle demande reprendre ?')).trim(); if (!message) return;
            await envoyerIntegree(s.id, message); bus.emit('selectionner', s.id);
        } },
        { nom: 'bilan', args: '<session>', groupe: 'Agents', cache: true, description: 'Résultat, vérifications observées et utilisation du dernier tour', executer: async ({ args }) => {
            const s = lireIntegree(args[0]); if (!s) throw new Error('Session introuvable');
            await choisir('Bilan du dernier tour', [{ label: 'Retour', valeur: 'retour' }], false, bilanSession(s));
        } },
        { nom: 'utilisation', groupe: 'Agents', description: 'Tours, jetons et coûts rapportés par les fournisseurs', executer: () => {
            console.log(bilanUsage());
            for (const f of ['claude', 'codex', 'perplexity']) { const recus = lireUsage().filter((r) => r.fournisseur === f); if (recus.length) console.log(`\n${f}\n${bilanUsage(recus)}`); }
            console.log('Estimations communiquées par les fournisseurs, pas une facture. Le coût Claude CLI est disponible séparément dans /cout.');
        } },
        { nom: 'limites-agents', groupe: 'Config', description: 'Limiter le nombre de tours du jour et la durée d’un tour', executer: async () => {
            const c = chargerConfig();
            const tours = Number(await saisir('Maximum de tours par jour, tous agents intégrés et conseils confondus (0 = sans limite)', String(c.limitesAgents?.toursJour ?? 0)));
            const minutes = Number(await saisir('Durée maximale d’un tour en minutes (1 à 180)', String(c.limitesAgents?.dureeMinutes ?? 60)));
            if (!Number.isInteger(tours) || tours < 0 || !Number.isFinite(minutes) || minutes < 1 || minutes > 180) throw new Error('Limites invalides ; aucun réglage modifié');
            c.limitesAgents = { toursJour: tours, dureeMinutes: minutes }; sauverConfig(c);
            if (config) config.limitesAgents = c.limitesAgents;
            bus.emit('notice', 'Limites enregistrées pour les prochains tours. Les appels déjà démarrés conservent leur limite.');
        } },
        { nom: 'moteur', groupe: 'Config', description: 'État et commandes du moteur en arrière-plan', executer: async () => {
            const e = etatMoteur();
            const action = await choisir(`Moteur : ${e.pause ? 'en pause' : e.actif ? 'actif' : 'arrêté'}${e.erreur ? ` · ${e.erreur}` : ''}`, [
                { label: e.pause ? 'Reprendre le moteur' : 'Démarrer / vérifier le moteur', valeur: 'reprendre' },
                { label: 'Tout mettre en pause', valeur: 'pause' }, { label: 'Retour', valeur: 'retour' },
            ], false, 'Les équipes continuent quand tu fermes la fenêtre. Après un redémarrage du PC, ouvrir Agentopia redémarre le moteur. Les permissions attendent toujours ta réponse.');
            if (action === 'reprendre') { await reprendreMoteur(); await assurerMoteur(); bus.emit('notice', 'Moteur actif · les équipes arrêtées restent à relancer depuis leur carte'); }
            if (action === 'pause') { await pauseGlobale(); bus.emit('notice', 'Pause globale enregistrée · interruption demandée aux agents'); }
        } },
        { nom: 'tout-arreter', groupe: 'Agents', description: 'Pause persistante du moteur et interruption des agents', executer: pauseGlobale },
    ];
}

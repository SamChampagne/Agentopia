import type { Commande } from './commandes.js';
import { Config, sauverConfig } from './config.js';
import { Projet } from './projets.js';
import { lancerArrierePlan } from './agents.js';
import { bus, choisir, confirmer, saisir, tache } from './ui/bus.js';
import { c } from './theme.js';

// Modèles de session : une consigne type, un mode de permissions et éventuellement un projet fixe.
// « {sujet} » dans la consigne est remplacé par ce que tu précises au lancement.

export interface ModeleSession {
    nom: string;
    consigne: string;
    permissions: 'default' | 'acceptEdits' | 'plan' | 'auto';
    projet?: string;              // nom du projet ; sinon demandé au lancement
}

export const MODELES_DEFAUT: ModeleSession[] = [
    {
        nom: 'Corriger un bug', permissions: 'acceptEdits',
        consigne: 'Corrige ce bug : {sujet}\nTrouve la cause, explique-la en deux lignes, corrige-la sans changer le comportement ailleurs, ajoute un test qui l\'aurait attrapé, et lance les tests.',
    },
    {
        nom: 'Nouvelle fonctionnalité', permissions: 'plan',
        consigne: 'Prépare cette nouvelle fonctionnalité : {sujet}\nPropose d\'abord un plan (fichiers touchés, étapes, risques), attends ma validation, puis implémente et teste.',
    },
    {
        nom: 'Revue avant prod', permissions: 'plan',
        consigne: 'Fais une revue complète des changements avant la mise en prod (git diff avec la branche principale). Points d\'attention : {sujet}\nClasse par sévérité : bugs, régressions possibles, sécurité, ce qui manque (tests, doc). Ne modifie rien.',
    },
];

const PERMISSIONS: { valeur: ModeleSession['permissions']; label: string }[] = [
    { valeur: 'acceptEdits', label: 'Accepte les modifications de fichiers' },
    { valeur: 'plan', label: 'Plan d\'abord (ne modifie rien avant ta validation)' },
    { valeur: 'default', label: 'Demande pour tout' },
    { valeur: 'auto', label: 'Automatique' },
];

const modeles = (config: Config) => config.modelesSession ?? MODELES_DEFAUT;

async function creer(config: Config, projets: Projet[]): Promise<void> {
    const nom = (await saisir('Nom du modèle (ex. Ajout d\'un champ MI)')).trim();
    if (!nom) return;
    const consigne = (await saisir('Consigne pour Claude ({sujet} = ce que tu préciseras au lancement)')).trim();
    if (!consigne) return;
    const permissions = await choisir('Permissions', PERMISSIONS.map((p) => ({ label: p.label, valeur: p.valeur })), false);
    const projet = await choisir('Projet', [{ label: 'Demander à chaque fois', valeur: '' }, ...projets.map((p) => ({ label: p.nom, valeur: p.nom }))], false);
    config.modelesSession = [...modeles(config).filter((m) => m.nom !== nom), { nom, consigne, permissions, projet: projet || undefined }];
    sauverConfig(config);
    console.log(c.succes(`Modèle « ${nom} » enregistré · /modele pour le lancer`));
}

export function commandesModeles(config: Config, getProjets: () => Projet[]): Commande[] {
    return [{
        nom: 'modele', alias: ['modeles', 'recette'], args: '[nom]', groupe: 'Claude',
        description: 'Lancer une session à partir d\'un modèle (consigne, permissions, projet), ou en créer un',
        executer: async ({ reste }) => {
            const projets = getProjets();
            const liste = modeles(config);
            const trouve = reste && liste.find((m) => m.nom.toLowerCase().startsWith(reste.toLowerCase()));
            const choix: ModeleSession | 'nouveau' | 'supprimer' = trouve || await choisir('Modèle de session', [
                ...liste.map((m) => ({ label: `▸ ${m.nom}`, valeur: m as ModeleSession | 'nouveau' | 'supprimer', description: `${m.projet ?? 'projet au choix'} · ${m.permissions}` })),
                { label: '+ Nouveau modèle', valeur: 'nouveau' },
                ...(liste.length ? [{ label: '− Supprimer un modèle', valeur: 'supprimer' as const }] : []),
            ]);
            if (choix === 'nouveau') return creer(config, projets);
            if (choix === 'supprimer') {
                const m = await choisir('Modèle à supprimer', liste.map((x) => ({ label: x.nom, valeur: x })));
                if (!await confirmer(`Supprimer le modèle « ${m.nom} » ?`)) return;
                config.modelesSession = liste.filter((x) => x !== m);
                sauverConfig(config);
                return void console.log(c.succes(`Modèle « ${m.nom} » supprimé`));
            }
            const projet = projets.find((p) => p.nom === choix.projet)
                ?? await choisir(`${choix.nom} · dans quel projet ?`, projets.map((p) => ({ label: p.nom, valeur: p, description: p.chemin })));
            const sujet = choix.consigne.includes('{sujet}') ? (await saisir(`${choix.nom} : précise (laisser vide si rien à ajouter)`)).trim() : '';
            const prompt = choix.consigne.replaceAll('{sujet}', sujet || '(aucune précision)');
            const { id, sortie } = await tache(`Démarrage · ${choix.nom}`, () => lancerArrierePlan(projet.chemin, `${choix.nom} · ${projet.nom}`.slice(0, 60), prompt, undefined, { permissions: choix.permissions }));
            if (!id) return void console.log(c.erreur(sortie.split('\n')[0] || 'Échec du lancement'));
            console.log(c.succes(`Session ${id} lancée · ${choix.nom} dans ${projet.nom}`));
            bus.emit('selectionner', id);
        },
    }];
}

import { choisir, choisirPlusieurs, saisir } from './ui/bus.js';
import { chargerConfig } from './config.js';
import { FOURNISSEURS, type Fournisseur } from './providers/types.js';
import { disponibilite } from './providers/config.js';
import { creerEquipeMixte } from './equipe.js';
import { lireModelesEquipes, validerDefinitions, type DefinitionTache } from './modelesEquipes.js';

const servicesDefaut = { choisir, choisirPlusieurs, saisir, disponible: disponibilite, modeles: lireModelesEquipes, creer: creerEquipeMixte };
export function decrirePlan(taches: DefinitionTache[]): string {
    return taches.map((t, i) => `t${i + 1} · ${t.titre} · ${FOURNISSEURS[t.fournisseur].nom}${t.modele ? ` · ${t.modele}` : ''}${t.lectureSeule ? ' · lecture seule' : ''}\n${t.consigne}\nAprès : ${t.dependances.join(', ') || 'aucune dépendance'}`).join('\n\n');
}
export function recetteCollaboration(type: 'comparaison' | 'croisee', premier: Fournisseur, second: Fournisseur): DefinitionTache[] {
    if (!FOURNISSEURS[premier].code || !FOURNISSEURS[second].code) throw new Error('Cette collaboration exige deux agents capables de lire le projet');
    const analyser = 'Travaille en lecture seule. Analyse l’objectif indépendamment, cite fichiers et preuves, propose une solution et ses limites. Distingue faits, hypothèses et désaccords possibles. Ne modifie aucun fichier.';
    if (type === 'comparaison') return [
        { titre: 'Avis indépendant A', fournisseur: premier, consigne: analyser, lectureSeule: true, dependances: [] },
        { titre: 'Avis indépendant B', fournisseur: second, consigne: analyser, lectureSeule: true, dependances: [] },
        { titre: 'Comparer les avis et expliquer les désaccords', fournisseur: premier, lectureSeule: true, dependances: ['t1', 't2'],
            consigne: 'Compare les deux avis transmis. Vérifie les preuves dans le projet, présente accords et désaccords avec leurs sources, puis propose une décision et les points à trancher par l’utilisateur. Aucun changement, aucune nouvelle délégation : cette synthèse termine la comparaison.' },
    ];
    const revue = 'Relis indépendamment les changements de développement, en lecture seule. Rapporte seulement les défauts démontrés avec fichier, conséquence et correction proposée. N’applique aucune modification. Le résultat est un avis, pas une autorisation supplémentaire.';
    return [
        { titre: 'Développement', fournisseur: premier, consigne: 'Réalise l’objectif, exécute les vérifications pertinentes et commite les changements.', dependances: [] },
        { titre: 'Revue indépendante A', fournisseur: premier, consigne: revue, lectureSeule: true, dependances: ['t1'] },
        { titre: 'Revue indépendante B', fournisseur: second, consigne: revue, lectureSeule: true, dependances: ['t1'] },
        { titre: 'Résoudre les désaccords et vérifier', fournisseur: premier, dependances: ['t1', 't2', 't3'],
            consigne: 'Compare les deux revues, vérifie leurs preuves et corrige les défauts confirmés. Explique chaque désaccord non résolu sans inventer un consensus. Exécute les vérifications puis commite. Ne lance pas un nouveau cycle de revue : termine par accords, corrections et décisions restant à l’utilisateur.' },
    ];
}
export function recetteEquipe(recette: 'duo' | 'bug' | 'trio', developpeur: Fournisseur, relecteur: Fournisseur): DefinitionTache[] {
    if (!FOURNISSEURS[developpeur].code || !FOURNISSEURS[relecteur].code) throw new Error('Le développement et la revue demandent des agents capables de travailler dans les fichiers');
    const recherche: DefinitionTache = { titre: 'Recherche et sources', fournisseur: 'perplexity', consigne: 'Recherche les éléments techniques utiles à l’objectif. Cite les sources primaires et indique les limites ; tu n’as pas accès aux fichiers locaux.', dependances: [] };
    const code: DefinitionTache = { titre: recette === 'bug' ? 'Reproduction et correction' : 'Développement', fournisseur: developpeur,
        consigne: recette === 'bug' ? 'Reproduis le problème décrit dans l’objectif, corrige sa cause et ajoute un test de régression pertinent. Respecte l’interface existante.' : 'Réalise l’objectif en respectant les conventions et l’interface du projet. Ajoute les tests utiles et vérifie le comportement.', dependances: recette === 'trio' ? ['t1'] : [] };
    const revue: DefinitionTache = { titre: 'Revue et vérification', fournisseur: relecteur, consigne: 'Relis les changements de la tâche précédente. Exécute les vérifications pertinentes et corrige les problèmes démontrés. Distingue tests exécutés, hypothèses et points restant à vérifier.', dependances: recette === 'trio' ? ['t1', 't2'] : ['t1'] };
    return recette === 'trio' ? [recherche, code, revue] : [code, revue];
}
export async function preparerEquipeGuidee(projet: { nom: string; chemin: string }, objectif = '', services = servicesDefaut) {
    objectif = objectif.trim() || (await services.saisir(`Qu’est-ce que l’équipe doit accomplir sur ${projet.nom} ?`)).trim();
    if (!objectif) return;
    const modeles = services.modeles();
    const format = await services.choisir('Comment travailler ?', [
        { label: 'Développer → faire relire', valeur: 'duo', description: 'Un agent réalise la demande ; une autre session vérifie le résultat.' },
        { label: 'Corriger un bug → vérifier', valeur: 'bug', description: 'Reproduction, correction et vérification de la régression.' },
        { label: 'Rechercher → développer → relire', valeur: 'trio', description: 'Perplexity cherche les sources, puis deux sessions travaillent dans le code.' },
        { label: 'Comparer deux avis indépendants', valeur: 'comparaison', description: 'Deux analyses en lecture seule, puis une synthèse des accords et désaccords ; 3 tâches maximum.' },
        { label: 'Développer → revue croisée → corriger', valeur: 'croisee', description: 'Deux revues indépendantes, puis une résolution bornée des désaccords ; 4 tâches maximum.' },
        ...modeles.map((m) => ({ label: `★ ${m.nom}`, valeur: `modele:${m.id}`, description: `${m.taches.length} tâches · ${m.taches.map((t) => FOURNISSEURS[t.fournisseur].nom).join(' → ')}` })),
        { label: 'Composer les tâches moi-même', valeur: 'libre', description: 'Choisir chaque mission, fournisseur et dépendance.' },
    ], modeles.length > 4);
    const candidats = (code: boolean) => (Object.keys(FOURNISSEURS) as Fournisseur[]).filter((f) => !code || FOURNISSEURS[f].code);
    const agent = async (message: string, code = true, prefere?: Fournisseur | 'choisir', automatique = true): Promise<Fournisseur> => {
        const choix = candidats(code), prets = choix.filter((f) => services.disponible(f).pret);
        if (automatique && prefere && prefere !== 'choisir' && choix.includes(prefere)) return prefere;
        if (automatique && prets.length === 1) return prets[0];
        return services.choisir(message, choix.map((f) => ({ label: FOURNISSEURS[f].nom, valeur: f, description: services.disponible(f).texte })), false);
    };
    let definitions: DefinitionTache[];
    if (format.startsWith('modele:')) {
        const modele = modeles.find((m) => m.id === format.slice(7)); if (!modele) throw new Error('Modèle introuvable');
        definitions = validerDefinitions(modele.taches);
    } else if (format === 'libre') {
        definitions = [];
        do {
            const fournisseur = await agent(`Agent de t${definitions.length + 1}`, false, undefined, false);
            const titre = (await services.saisir('Titre de la tâche')).trim();
            const consigne = (await services.saisir('Mission et critères de réussite')).trim();
            const dependances = definitions.length ? await services.choisirPlusieurs('Attend quelles tâches ? (aucune = parallèle)', definitions.map((t, i) => ({ label: `t${i + 1} · ${t.titre}`, valeur: `t${i + 1}` }))) : [];
            definitions.push({ titre, fournisseur, consigne, dependances });
            validerDefinitions(definitions);
        } while (definitions.length < 8 && await services.choisir('Plan', [{ label: 'Terminer', valeur: false }, { label: 'Ajouter une tâche', valeur: true }], false));
    } else {
        if (!['duo', 'bug', 'trio', 'comparaison', 'croisee'].includes(format)) throw new Error('Parcours inconnu');
        const dev = await agent('Qui réalise la demande ?', true, chargerConfig().fournisseurDefaut);
        const autre = candidats(true).find((f) => f !== dev && services.disponible(f).pret);
        definitions = format === 'comparaison' || format === 'croisee' ? recetteCollaboration(format, dev, autre ?? dev) : recetteEquipe(format as 'duo' | 'bug' | 'trio', dev, autre ?? dev);
    }
    for (;;) {
        const action = await services.choisir('Ton équipe est prête à être créée', [
            { label: 'Créer le plan et ouvrir l’équipe', valeur: 'creer', description: 'Aucun agent ne démarre avant ton clic sur Lancer.' },
            { label: 'Changer les agents', valeur: 'agents' }, { label: 'Annuler', valeur: 'annuler' },
        ], false, `${objectif}\n\n${decrirePlan(definitions)}\n\n${[...new Set(definitions.map((t) => t.fournisseur))].map((f) => `${FOURNISSEURS[f].nom} : ${services.disponible(f).texte}`).join('\n')}\nLes consignes du modèle sont reprises telles quelles : vérifie les références propres au projet.`);
        if (action === 'annuler') return;
        if (action === 'creer') return services.creer(projet, objectif, validerDefinitions(definitions));
        for (const t of definitions) t.fournisseur = await agent(`Qui réalise « ${t.titre} » ?`, FOURNISSEURS[t.fournisseur].code, undefined, false);
    }
}

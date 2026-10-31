import { choisir, choisirPlusieurs, saisir } from './ui/bus.js';
import { FOURNISSEURS, capacitesFournisseur, type Fournisseur } from './providers/types.js';
import { disponibilite } from './providers/config.js';
import { empreintePlan, modifierPlan, peutModifierPlan, type Equipe } from './equipe.js';
import { validerDefinitions } from './modelesEquipes.js';
import { decrirePlan } from './equipesGuidees.js';

const servicesDefaut = { choisir, choisirPlusieurs, saisir, sauver: modifierPlan };
// Le brouillon reste local au dialogue. Seul Enregistrer transmet le plan au moteur.
export async function editerPlan(e: Equipe, services = servicesDefaut): Promise<boolean> {
    if (!peutModifierPlan(e)) throw new Error('Ce plan a déjà démarré. Crée une nouvelle équipe depuis son modèle pour le modifier');
    const attendu = empreintePlan(e), ids = new Map(e.taches.map((t, i) => [t.id, `t${i + 1}`]));
    let objectif = e.objectif;
    let taches = validerDefinitions(e.taches.map((t) => ({ ...t, dependances: t.dependances.map((d) => ids.get(d) ?? d) })));
    for (;;) {
        const action = await services.choisir('Modifier le plan', [
            { label: 'Modifier l’objectif', valeur: 'objectif' },
            ...taches.map((t, i) => ({ label: `t${i + 1} · ${t.titre}`, valeur: `tache:${i}`, description: FOURNISSEURS[t.fournisseur].nom })),
            { label: 'Enregistrer les modifications', valeur: 'sauver', description: 'Le plan reste arrêté jusqu’au clic sur Lancer.' },
            { label: 'Annuler les modifications', valeur: 'annuler' },
        ], false, `${objectif}\n\n${decrirePlan(taches)}`);
        if (action === 'annuler') return false;
        if (action === 'sauver') {
            if (!objectif.trim() || objectif.length > 32_000) {
                await services.choisir('L’objectif doit contenir de 1 à 32 000 caractères', [{ label: 'Revenir au plan', valeur: 'retour' }], false); continue;
            }
            const erreur = await services.sauver(e.id, { attendu, objectif, taches });
            if (erreur) throw new Error(erreur); return true;
        }
        if (action === 'objectif') { objectif = await services.saisir('Objectif de l’équipe', objectif); continue; }
        const i = Number(action.slice(6)), t = taches[i]; if (!t) throw new Error('Tâche introuvable');
        const champ = await services.choisir(`Modifier t${i + 1} · ${t.titre}`, [
            { label: 'Mission et critères de réussite', valeur: 'consigne' }, { label: 'Fournisseur', valeur: 'fournisseur' },
            { label: 'Titre', valeur: 'titre' }, { label: 'Dépendances', valeur: 'dependances' }, { label: 'Retour au plan', valeur: 'retour' },
            ...(capacitesFournisseur(t.fournisseur).modele ? [{ label: 'Modèle (vide = choix du fournisseur)', valeur: 'modele' }] : []),
            { label: t.lectureSeule ? 'Autoriser le travail dans les fichiers' : 'Passer cette tâche en lecture seule', valeur: 'lecture' },
        ], false, t.consigne);
        const suivante = taches.map((t) => ({ ...t, dependances: [...t.dependances] }));
        if (champ === 'consigne' || champ === 'titre') suivante[i][champ] = await services.saisir(champ === 'titre' ? 'Titre de la tâche' : 'Mission et critères de réussite', t[champ]);
        if (champ === 'modele') suivante[i].modele = (await services.saisir('Identifiant du modèle · vide pour le choix du fournisseur', t.modele || '')).trim() || undefined;
        if (champ === 'lecture') suivante[i].lectureSeule = !t.lectureSeule;
        if (champ === 'fournisseur') suivante[i].fournisseur = await services.choisir('Quel agent pour cette tâche ?', (Object.keys(FOURNISSEURS) as Fournisseur[]).map((f) => ({
            label: FOURNISSEURS[f].nom, valeur: f, description: `${FOURNISSEURS[f].capacite} · ${disponibilite(f).texte}`,
        })), false, 'Perplexity fait de la recherche web ; choisis Claude ou Codex pour modifier les fichiers.');
        if (champ === 'dependances') suivante[i].dependances = await services.choisirPlusieurs('Attendre quelles tâches ? Espace pour cocher, Entrée pour valider', taches.flatMap((autre, j) => j === i ? [] : [{
            label: `t${j + 1} · ${autre.titre}`, valeur: `t${j + 1}`, coche: t.dependances.includes(`t${j + 1}`),
        }]));
        if (!capacitesFournisseur(suivante[i].fournisseur).modele) suivante[i].modele = undefined;
        try { taches = validerDefinitions(suivante); }
        catch (err) { await services.choisir('Modification refusée · le brouillon précédent est conservé', [{ label: 'Revenir au plan', valeur: 'retour' }], false, (err as Error).message); }
    }
}

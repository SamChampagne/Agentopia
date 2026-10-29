import type { Commande } from './commandes.js';
import { equipeDe, lancerEquipe, lireEquipes, reprendreTache, rechargerEquipes, peutModifierPlan, recupererEquipes } from './equipe.js';
import { sauvegardeEquipes } from './stockageEquipes.js';
import { editerPlan } from './editionEquipe.js';
import { choisir, saisir, bus, confirmer } from './ui/bus.js';
import { guiderConnexion } from './providers/assistantConnexion.js';
import { bilanEquipe } from './equipeBilan.js';
import { enregistrerModeleEquipe, lireModelesEquipes, retirerModeleEquipe } from './modelesEquipes.js';
import { decrirePlan } from './equipesGuidees.js';
import { copier } from './lanceurs.js';

const retrouver = (id: string) => {
    rechargerEquipes(); const e = equipeDe(id); if (!e || e.archivee) throw new Error('Équipe introuvable'); return e;
};
const ensuite = (commande: string) => setTimeout(() => bus.emit('lancer', commande), 50);
const ouvrir = (id: string) => ensuite(`/equipe ${id}`);
async function lancer(id: string) {
    const e = retrouver(id);
    for (const f of new Set(e.taches.flatMap((t) => t.fournisseur ? [t.fournisseur] : []))) await guiderConnexion(f, true);
    const erreur = await lancerEquipe(id); if (erreur) throw new Error(erreur); ouvrir(id);
}
export function commandesEquipes(): Commande[] {
    return [
        { nom: 'equipes-recuperer', groupe: 'Agents', description: 'Récupérer les équipes depuis leur sauvegarde sans effacer le fichier abîmé', executer: async () => {
            try { rechargerEquipes(); bus.emit('notice', 'Le fichier des équipes est lisible · aucune restauration nécessaire'); ensuite('/equipe'); return; }
            catch { /* Présenter les choix de récupération. */ }
            let sauvegarde: ReturnType<typeof sauvegardeEquipes> | undefined, detail = '';
            try {
                sauvegarde = sauvegardeEquipes();
                detail = `Sauvegarde du ${new Date(sauvegarde.date).toLocaleString()} · ${sauvegarde.equipes.length} équipe(s). Le fichier abîmé sera conservé à côté de l’original. Le moteur sera mis en pause et les sessions intégrées seront interrompues. Vérifie les conversations avant de reprendre les équipes.`;
            } catch (e) { detail = (e as Error).message; }
            const action = await choisir('Récupération des équipes', [
                { label: 'Réessayer la lecture', valeur: 'relire' },
                ...(sauvegarde ? [{ label: 'Restaurer la sauvegarde et mettre en pause', valeur: 'restaurer' }] : []),
                { label: 'Retour', valeur: 'retour' },
            ], false, detail);
            if (action === 'relire') rechargerEquipes();
            if (action === 'restaurer' && sauvegarde) {
                const copie = await recupererEquipes(sauvegarde.empreinte);
                bus.emit('notice', `Équipes restaurées · moteur en pause. Vérifie les tâches avant de reprendre.${copie ? ` Original conservé : ${copie}` : ''}`);
            }
            ensuite('/equipe');
        } },
        { nom: 'equipe-lancer', args: '<équipe>', groupe: 'Agents', cache: true, description: 'Vérifier les connexions et lancer le plan', executer: ({ args }) => lancer(args[0]) },
        { nom: 'equipe-bilan', args: '<équipe>', groupe: 'Agents', description: 'Résultats, blocages, vérifications et utilisation d’une équipe', executer: async ({ args }) => {
            if (!args[0] && !lireEquipes().length) { bus.emit('notice', 'Aucune équipe · Équipes → Nouvelle équipe pour créer ton premier plan'); return; }
            const id = args[0] || await choisir('Quelle équipe ?', lireEquipes().map((e) => ({ label: e.nomProjet, valeur: e.id, description: e.objectif })), true);
            const e = retrouver(id), bilan = bilanEquipe(e);
            const action = await choisir('Bilan de l’équipe', [{ label: 'Retour à l’équipe', valeur: 'retour' }, { label: 'Copier le bilan complet', valeur: 'copier' }], false, bilan);
            if (action === 'copier') { copier(bilan); bus.emit('notice', 'Bilan copié'); } ouvrir(id);
        } },
        { nom: 'equipe-actions', args: '<équipe>', groupe: 'Agents', cache: true, description: 'Reprendre le travail, voir le bilan et réutiliser le plan', executer: async ({ args }) => {
            const e = retrouver(args[0]);
            const taches = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])];
            const action = await choisir(`Actions · ${e.nomProjet}`, [
                { label: '≡ Voir le bilan de l’équipe', valeur: 'bilan' },
                ...(peutModifierPlan(e) ? [{ label: '✎ Modifier le plan', valeur: 'modifier', description: 'Objectif, missions, agents et dépendances avant le premier lancement.' }] : []),
                ...taches.filter((t) => t.fournisseur && t.agentId && ['erreur', 'arretee'].includes(t.etat)).map((t) => ({
                    label: `↻ Reprendre ${t.id} · ${t.titre}`, valeur: `reprendre:${t.id}`, description: 'Conserve les fichiers, la branche et la conversation existants.' })),
                ...taches.filter((t) => t.agentId && t.etat === 'bloquee').map((t) => ({ label: `! Répondre à ${t.id} · ${t.titre}`, valeur: `permission:${t.agentId}` })),
                ...(e.mixte ? [{ label: '★ Enregistrer ce plan comme modèle', valeur: 'modele', description: 'Réutiliser les missions, fournisseurs et dépendances dans un autre projet.' }] : []),
                ...(['plan', 'erreur'].includes(e.etat) ? [{ label: 'Recommencer les tâches inachevées dans de nouvelles branches', valeur: 'recommencer', description: 'Les anciens fichiers restent disponibles, mais ne seront pas repris dans les nouvelles tentatives.' }] : []),
                { label: 'Retour à l’équipe', valeur: 'retour' },
            ], false, e.message || 'Choisis la suite ; aucune reprise n’efface les fichiers déjà produits.');
            if (action === 'bilan') { ensuite(`/equipe-bilan ${e.id}`); return; }
            if (action === 'modifier') { if (await editerPlan(e)) bus.emit('notice', 'Plan enregistré · aucun agent lancé'); ouvrir(e.id); return; }
            if (action.startsWith('permission:')) { ensuite(`/autorisation ${action.slice(11)}`); return; }
            if (action.startsWith('reprendre:')) {
                const id = action.slice(10), t = taches.find((t) => t.id === id)!;
                await guiderConnexion(t.fournisseur!, true);
                const erreur = await reprendreTache(e.id, id); if (erreur) throw new Error(erreur);
                bus.emit('notice', 'Tâche reprise dans sa conversation et son dossier existants');
            }
            if (action === 'modele') {
                const nom = await saisir('Nom du modèle réutilisable', e.objectif.slice(0, 60));
                enregistrerModeleEquipe(e, nom); bus.emit('notice', 'Modèle enregistré · disponible à la création de la prochaine équipe');
            }
            if (action === 'recommencer') {
                if (await confirmer('Repartir dans de nouvelles branches pour les tâches arrêtées ou en erreur ? Les anciennes conversations et branches sont conservées.')) return lancer(e.id);
            }
            ouvrir(e.id);
        } },
        { nom: 'modeles-equipes', groupe: 'Agents', description: 'Voir et retirer les plans d’équipe réutilisables', executer: async () => {
            const modeles = lireModelesEquipes();
            if (!modeles.length) { bus.emit('notice', 'Aucun modèle · ouvre une équipe, Actions → Enregistrer ce plan comme modèle'); return; }
            const id = await choisir('Modèles d’équipe', modeles.map((m) => ({ label: m.nom, valeur: m.id, description: `${m.taches.length} tâches` })), true);
            const m = modeles.find((m) => m.id === id)!;
            const action = await choisir(m.nom, [{ label: 'Retour', valeur: 'retour' }, { label: 'Retirer ce modèle', valeur: 'retirer' }], false, decrirePlan(m.taches));
            if (action === 'retirer' && await confirmer(`Retirer « ${m.nom} » des modèles ? Les équipes existantes sont conservées.`)) retirerModeleEquipe(id);
        } },
    ];
}

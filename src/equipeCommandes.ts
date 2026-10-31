import type { Commande } from './commandes.js';
import { equipeDe, lancerEquipe, lireEquipes, reprendreTache, rechargerEquipes, peutModifierPlan, recupererEquipes, annulerAttenteTache } from './equipe.js';
import { sauvegardeEquipes } from './stockageEquipes.js';
import { editerPlan } from './editionEquipe.js';
import { choisir, saisir, bus, confirmer } from './ui/bus.js';
import { guiderConnexion } from './providers/assistantConnexion.js';
import { relireEquipe } from './finEquipe.js';
import { enregistrerModeleEquipe, lireModelesEquipes, retirerModeleEquipe } from './modelesEquipes.js';
import { decrirePlan } from './equipesGuidees.js';
import { decrireFile } from './fileAgents.js';
import { chargerConfig, sauverConfig } from './config.js';
import { diagnosticPlanifications, recupererRecusPlanifications } from './stockagePlanifications.js';
import { reglerPreparationProjet, lireJournalPreparation } from './preparationWorktrees.js';
import { FOURNISSEURS } from './providers/types.js';

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
        { nom: 'planifications-recuperer', groupe: 'Agents', description: 'Récupérer les reçus abîmés sans rejouer les tâches aujourd’hui', executer: async () => {
            const d = diagnosticPlanifications(); if (!d.erreur) { bus.emit('notice', 'Historique des planifications lisible ; aucune récupération nécessaire.'); return; }
            if (!await confirmer(`${d.erreur}\n${d.sauvegarde ? `Sauvegarde du ${new Date(d.sauvegarde).toLocaleString()}.` : 'Aucune sauvegarde valide.'}\nConserver le fichier original, mettre le moteur en pause et marquer toutes les planifications comme déjà tentées aujourd’hui ? Vérifie les sessions avant un nouvel essai manuel.`)) return;
            const copie = recupererRecusPlanifications((chargerConfig().planifications || []).map((p) => p.id));
            bus.emit('notice', `Historique récupéré ; moteur en pause, aucun rejeu automatique aujourd’hui.${copie ? ` Original : ${copie}` : ''}`);
        } },
        { nom: 'preparation-projet', projet: true, groupe: 'Agents', description: 'Choisir la préparation explicite des nouveaux worktrees', executer: ({ projet }) => reglerPreparationProjet(projet!.chemin) },
        { nom: 'limites-equipes', groupe: 'Config', description: 'Plafonds distincts : par équipe, global et par fournisseur', executer: async () => {
            const c = chargerConfig();
            const equipe = Number(await saisir('Maximum par équipe (1 à 32)', String(c.equipe.parallele)));
            const global = Number(await saisir('Maximum global d’agents (0 = illimité, maximum 32)', String(c.equipe.paralleleGlobal ?? 0)));
            if (!Number.isInteger(equipe) || equipe < 1 || equipe > 32 || !Number.isInteger(global) || global < 0 || global > 32) throw new Error('Plafonds invalides ; aucun réglage modifié');
            const fournisseur = await choisir('Limiter aussi un fournisseur ?', [{ label: 'Aucun changement', valeur: '' }, ...Object.entries(FOURNISSEURS).map(([f, v]) => ({ label: v.nom, valeur: f }))], false);
            const limites = { ...c.equipe.parFournisseur };
            if (fournisseur) { const limite = Number(await saisir('Maximum pour ce fournisseur (0 = illimité, maximum 32)', String(limites[fournisseur as keyof typeof limites] ?? 0))); if (!Number.isInteger(limite) || limite < 0 || limite > 32) throw new Error('Plafond invalide'); limites[fournisseur as keyof typeof limites] = limite; }
            c.equipe = { ...c.equipe, parallele: equipe, paralleleGlobal: global, parFournisseur: limites }; sauverConfig(c);
            bus.emit('notice', 'Plafonds enregistrés. Les agents déjà actifs continuent ; les prochains départs attendront une place.');
        } },
        { nom: 'file-agents', groupe: 'Agents', description: 'Voir les attentes et annuler une tâche avant son départ', executer: async () => {
            rechargerEquipes(); const es = lireEquipes();
            const choix = es.flatMap((e) => e.taches.filter((t) => e.etat === 'en cours' && t.etat === 'attente').map((t) => ({ label: `${e.nomProjet} · ${t.titre}`, valeur: `${e.id}/${t.id}`, description: t.attenteFile || 'Attend une place' })));
            const selection = await choisir('File des agents', [{ label: 'Retour', valeur: '' }, ...choix], true, decrireFile(es));
            if (selection && await confirmer('Annuler uniquement cette attente ? Les agents déjà démarrés continuent.')) { const [id, tache] = selection.split('/'); await annulerAttenteTache(id, tache); bus.emit('notice', 'Attente annulée. La tâche pourra être relancée explicitement.'); }
        } },
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
            await relireEquipe(id);
        } },
        { nom: 'equipe-actions', args: '<équipe>', groupe: 'Agents', cache: true, description: 'Reprendre le travail, voir le bilan et réutiliser le plan', executer: async ({ args }) => {
            const e = retrouver(args[0]);
            const taches = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])];
            const action = await choisir(`Actions · ${e.nomProjet}`, [
                { label: '≡ Voir le bilan de l’équipe', valeur: 'bilan' },
                { label: 'Préparation des prochains worktrees du projet', valeur: 'preparation' },
                { label: 'Voir la file globale des agents', valeur: 'file' },
                ...taches.filter((t) => t.preparation?.journal).map((t) => ({ label: `Journal de préparation · ${t.titre}`, valeur: `preparation-journal:${t.id}` })),
                ...taches.flatMap((t) => (t.tentatives || []).filter((a) => a.agentId).map((a, i) => ({ label: `Ancienne tentative ${i + 1} · ${t.titre}`, valeur: `tentative:${a.agentId}`, description: `${a.etat} · ${a.branche || 'sans branche'}` }))),
                ...(peutModifierPlan(e) ? [{ label: '✎ Modifier le plan', valeur: 'modifier', description: 'Objectif, missions, agents et dépendances avant le premier lancement.' }] : []),
                ...taches.filter((t) => t.fournisseur && t.agentId && ['erreur', 'arretee'].includes(t.etat)).map((t) => ({
                    label: `↻ Reprendre ${t.id} · ${t.titre}`, valeur: `reprendre:${t.id}`, description: 'Conserve les fichiers, la branche et la conversation existants.' })),
                ...taches.filter((t) => t.agentId && t.etat === 'bloquee').map((t) => ({ label: `! Répondre à ${t.id} · ${t.titre}`, valeur: `permission:${t.agentId}` })),
                ...(e.mixte ? [{ label: '★ Enregistrer ce plan comme modèle', valeur: 'modele', description: 'Réutiliser les missions, fournisseurs et dépendances dans un autre projet.' }] : []),
                ...(['plan', 'erreur'].includes(e.etat) ? [{ label: 'Recommencer les tâches inachevées dans de nouvelles branches', valeur: 'recommencer', description: 'Les anciens fichiers restent disponibles, mais ne seront pas repris dans les nouvelles tentatives.' }] : []),
                { label: 'Retour à l’équipe', valeur: 'retour' },
            ], false, e.message || 'Choisis la suite ; aucune reprise n’efface les fichiers déjà produits.');
            if (action === 'bilan') { ensuite(`/equipe-bilan ${e.id}`); return; }
            if (action === 'preparation') { await reglerPreparationProjet(e.projet); ouvrir(e.id); return; }
            if (action === 'file') { ensuite('/file-agents'); return; }
            if (action.startsWith('preparation-journal:')) { const t = taches.find((t) => t.id === action.slice(20)); if (t?.preparation?.journal) await choisir('Journal de préparation', [{ label: 'Retour', valeur: '' }], false, lireJournalPreparation(t.preparation.journal)); ouvrir(e.id); return; }
            if (action.startsWith('tentative:')) { bus.emit('selectionner', action.slice(10)); return; }
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

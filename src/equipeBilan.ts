import type { Equipe, Tache } from './equipe.js';
import { lireIntegree } from './sessionsIntegrees.js';
import { bilanUsage, lireUsage } from './utilisation.js';
import { FOURNISSEURS } from './providers/types.js';

export function prochaineAction(e: Equipe, t: Tache): string {
    if (t.etat === 'bloquee') return 'Ouvrir l’agent et répondre à sa demande';
    if (t.etat === 'erreur' || t.etat === 'arretee') return t.fournisseur && t.agentId ? 'Actions → Reprendre cette tâche (fichiers et conversation conservés)' : 'Vérifier le blocage puis relancer';
    if (t.etat === 'attente') {
        const deps = t.dependances.map((id) => e.taches.find((d) => d.id === id)).filter((d) => d?.etat !== 'faite');
        return deps.length ? `Attend : ${deps.map((d) => `${d?.id} (${d?.etat})`).join(', ')}` : 'Prête à démarrer quand l’équipe est lancée';
    }
    return t.etat === 'faite' ? e.etat === 'finie' ? 'Intégration terminée · consulter le bilan et ranger l’équipe' : 'Vérifier le résultat et le diff avant intégration' : 'Travail en cours';
}
export function bilanEquipe(e: Equipe): string {
    const taches = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])];
    const ids = new Set(taches.flatMap((t) => [t.agentId, ...(t.tentatives || []).map((a) => a.agentId)]).filter(Boolean));
    const recus = lireUsage(null).filter((r) => ids.has(r.session));
    const parties = [`ÉQUIPE · ${e.nomProjet}\n${e.objectif}\nÉtat : ${e.etat}${e.message ? `\n${e.message}` : ''}`];
    for (const t of taches) {
        const s = t.agentId && t.fournisseur ? lireIntegree(t.agentId) : undefined;
        parties.push(`${t.id} · ${t.titre} · ${t.fournisseur ? FOURNISSEURS[t.fournisseur].nom : 'Claude CLI'} · ${t.etat}${t.ecartee ? ' · écartée de la fusion' : ''}\n`
            + `${prochaineAction(e, t)}\n${t.branche ? `Branche : ${t.branche}\n` : ''}${t.cwd ? `Dossier : ${t.cwd}\n` : ''}`
            + (t.attenteFile ? `File : ${t.attenteFile}\n` : '')
            + (t.preparation && t.preparation.etat !== 'prete' ? `Préparation : ${t.preparation.etat} · ${t.preparation.message || ''}\n` : '')
            + `Résultat ou blocage rapporté :\n${t.resultat || s?.erreur || s?.resultat || 'Aucun résultat final disponible.'}\n`
            + (s?.bilan?.durees ? `Durée : ${Math.ceil(s.bilan.durees.travailMs / 1000)} s de travail · ${Math.ceil(s.bilan.durees.attenteMs / 1000)} s d’attente utilisateur\n` : '')
            + 'Commandes observées au dernier tour :\n'
            + (s?.bilan?.commandes.length ? s.bilan.commandes.map((c) => `${c.codeSortie === undefined ? 'Résultat non renseigné' : `Code de sortie ${c.codeSortie}`} · ${c.commande}`).join('\n') : 'Aucune preuve d’exécution de commande disponible.'));
    }
    const anciennes = taches.flatMap((t) => (t.tentatives || []).map((a, i) => `${t.id} · tentative ${i + 1} · ${a.etat}\nSession : ${a.agentId || 'non créée'}\nBranche : ${a.branche || 'aucune'}\nDossier : ${a.cwd || 'non créé'}\n${a.resultat || ''}`));
    if (anciennes.length) parties.push(`TENTATIVES PRÉCÉDENTES CONSERVÉES\n${anciennes.join('\n\n')}`);
    parties.push(`Utilisation de toutes les tentatives enregistrées de l’équipe, tous jours confondus :\n${recus.length ? bilanUsage(recus) : 'Aucun reçu disponible ; coût inconnu.'}`);
    parties.push('Les résumés sont ceux des agents. Une tâche terminée ou un code de sortie nul ne prouvent pas que tous les tests nécessaires ont été exécutés. Les tentatives antérieures à la conservation de cet historique peuvent être absentes ; leurs reçus restent dans Utilisation.');
    return parties.join('\n\n');
}

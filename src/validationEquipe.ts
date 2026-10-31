import { gitVerifieAsync as git, gitExecution } from './gitExecution.js';
import type { Equipe, Tache } from './equipe.js';

/** Une dépendance est aussi héritée par les tâches qui dépendent d'elle. */
export function dependDe(taches: Tache[], tache: Tache, cible: string, vus = new Set<string>()): boolean {
    if (vus.has(tache.id)) return false;
    vus.add(tache.id);
    return (tache.dependances ?? []).some((id) => id === cible
        || taches.some((t) => t.id === id && dependDe(taches, t, cible, vus)));
}

export function dependanteDemarree(e: Equipe, relancees: Tache[]): Tache | undefined {
    const ids = new Set(relancees.map((t) => t.id));
    return e.taches.find((t) => !ids.has(t.id)
        && (t.etat !== 'attente' || !!t.agentId || t.debut !== undefined)
        && relancees.some((r) => dependDe(e.taches, t, r.id)));
}

/** Tester la sélection avant de l'enregistrer, y compris pour les anciens états persistés. */
export function erreurSelectionIntegration(e: Equipe, basculer?: string): string | undefined {
    const ecartee = (t: Tache) => t.id === basculer ? !t.ecartee : !!t.ecartee;
    const exclues = e.taches.filter((t) => t.branche && ecartee(t));
    for (const retenue of e.taches.filter((t) => t.branche && !ecartee(t))) {
        // Une ancienne sélection peut comporter plusieurs erreurs : permettre leur correction
        // une à une, tout en refusant chaque incohérence que ce changement introduirait.
        const exclue = exclues.find((t) => (!basculer || t.id === basculer || retenue.id === basculer)
            && dependDe(e.taches, retenue, t.id));
        if (exclue) return `« ${retenue.titre} » contient le travail de « ${exclue.titre} » par ses dépendances. Écarte aussi « ${retenue.titre} » ou garde « ${exclue.titre} » avant d’intégrer.`;
    }
    return undefined;
}

/** Le résumé d'un agent ne prouve pas que les branches ont réellement été intégrées. */
export async function verifierIntegration(e: Equipe): Promise<void> {
    const selection = erreurSelectionIntegration(e);
    if (selection) throw new Error(selection);
    const destination = e.integrateur?.branche;
    if (!destination) throw new Error('La branche de destination de cette ancienne intégration n’a pas été enregistrée. Vérifie manuellement la fusion dans le projet.');
    if (await git(['branch', '--show-current'], e.projet) !== destination)
        throw new Error(`La branche du projet a changé. Rétablis ${destination}, puis reprends l’intégration.`);
    if (await git(['status', '--porcelain'], e.projet)) throw new Error('Le projet contient encore des modifications non commitées. Reprends l’intégration pour les vérifier.');
    const sommet = await git(['rev-parse', '--verify', 'HEAD'], e.projet);
    const branches = e.taches.filter((t) => t.branche && !t.ecartee);
    if (!branches.length) throw new Error('Aucune branche retenue à vérifier.');
    for (const t of branches) {
        const commit = await git(['rev-parse', '--verify', '--end-of-options', `refs/heads/${t.branche}^{commit}`], e.projet);
        const r = await gitExecution(['merge-base', '--is-ancestor', commit, sommet], e.projet);
        if (r.code === 1) throw new Error(`La branche « ${t.titre} » (${t.branche}) n’est pas intégrée dans ${destination}. Reprends l’intégration pour terminer sa fusion.`);
        if (!r.ok) throw new Error(r.sortie || `Impossible de vérifier la fusion de ${t.branche}`);
    }
    if (await git(['branch', '--show-current'], e.projet) !== destination || await git(['rev-parse', '--verify', 'HEAD'], e.projet) !== sommet)
        throw new Error('Le projet a changé pendant la vérification Git. Reprends l’intégration pour vérifier son nouvel état.');
}

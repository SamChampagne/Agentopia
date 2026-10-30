import { spawnSync } from 'node:child_process';
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

function git(args: string[], cwd: string): string {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    if (r.status !== 0) throw new Error(r.stderr?.trim() || r.error?.message || 'Git a échoué');
    return r.stdout.trim();
}

/** Le résumé d'un agent ne prouve pas que les branches ont réellement été intégrées. */
export function verifierIntegration(e: Equipe): void {
    const selection = erreurSelectionIntegration(e);
    if (selection) throw new Error(selection);
    const destination = e.integrateur?.branche;
    if (!destination) throw new Error('La branche de destination de cette ancienne intégration n’a pas été enregistrée. Vérifie manuellement la fusion dans le projet.');
    if (git(['branch', '--show-current'], e.projet) !== destination)
        throw new Error(`La branche du projet a changé. Rétablis ${destination}, puis reprends l’intégration.`);
    if (git(['status', '--porcelain'], e.projet)) throw new Error('Le projet contient encore des modifications non commitées. Reprends l’intégration pour les vérifier.');
    const sommet = git(['rev-parse', '--verify', 'HEAD'], e.projet);
    const branches = e.taches.filter((t) => t.branche && !t.ecartee);
    if (!branches.length) throw new Error('Aucune branche retenue à vérifier.');
    for (const t of branches) {
        const commit = git(['rev-parse', '--verify', '--end-of-options', `refs/heads/${t.branche}^{commit}`], e.projet);
        const r = spawnSync('git', ['merge-base', '--is-ancestor', commit, sommet], {
            cwd: e.projet, encoding: 'utf8', windowsHide: true, timeout: 15_000,
        });
        if (r.status === 1) throw new Error(`La branche « ${t.titre} » (${t.branche}) n’est pas intégrée dans ${destination}. Reprends l’intégration pour terminer sa fusion.`);
        if (r.status !== 0) throw new Error(r.stderr?.trim() || r.error?.message || `Impossible de vérifier la fusion de ${t.branche}`);
    }
    if (git(['branch', '--show-current'], e.projet) !== destination || git(['rev-parse', '--verify', 'HEAD'], e.projet) !== sommet)
        throw new Error('Le projet a changé pendant la vérification Git. Reprends l’intégration pour vérifier son nouvel état.');
}

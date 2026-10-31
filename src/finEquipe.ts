import { equipeDe, rechargerEquipes, integrer, terminerEquipe, diffTache, basculerEcart, type Equipe } from './equipe.js';
import { choisir, confirmer, bus } from './ui/bus.js';
import { copier } from './lanceurs.js';
import { bilanEquipe } from './equipeBilan.js';
import { erreurSelectionIntegration } from './validationEquipe.js';
import { consulterVerificationsEquipe, resumeVerificationEquipe, verifierEquipe } from './verificationEquipe.js';

/** Les mêmes étapes servent au bilan et aux deux interfaces terminal. */
export function suiteEquipe(e: Equipe) {
    const branches = e.taches.filter((t) => t.branche && t.etat === 'faite');
    const reprise = !!e.integrateur?.agentId && ['erreur', 'arretee'].includes(e.integrateur.etat);
    const selection = erreurSelectionIntegration(e);
    const peutIntegrer = ['prete', 'erreur'].includes(e.etat) && !e.integrateur && branches.some((t) => !t.ecartee)
        && !selection && (!e.mixte || e.taches.every((t) => t.ecartee || t.etat === 'faite'));
    const peutRanger = ['prete', 'finie'].includes(e.etat)
        && [...e.taches, ...(e.integrateur ? [e.integrateur] : [])].every((t) => !['en cours', 'bloquee'].includes(t.etat));
    const instruction = e.etat === 'finie' ? 'Relire les vérifications, puis Ranger pour archiver l’équipe.'
        : reprise ? 'L’intégration est interrompue : Actions → Reprendre l’intégration.'
        : selection ? selection
        : peutIntegrer ? 'Relire le résultat et les diffs → Intégrer → Ranger.'
        : peutRanger && !branches.length ? 'Relire le résultat, puis Ranger : aucune branche à intégrer.'
        : 'Consulter les résultats et répondre aux blocages depuis Actions.';
    return { branches, peutIntegrer, peutRanger, reprise, instruction };
}
function retrouver(id: string) {
    rechargerEquipes(); const e = equipeDe(id);
    if (!e || e.archivee) throw new Error('Équipe introuvable');
    return e;
}
export async function relireEquipe(id: string) {
    let avis = '';
    while (true) {
        const e = retrouver(id), suite = suiteEquipe(e), bilan = `${bilanEquipe(e)}\n\n${await resumeVerificationEquipe(id)}`;
        const action = await choisir('Bilan de l’équipe', [
            { label: 'Retour à l’équipe', valeur: 'retour' },
            { label: 'Copier le bilan complet', valeur: 'copier' },
            { label: 'Vérifier le projet · scripts existants', valeur: 'verifier' },
            { label: 'Journaux des vérifications', valeur: 'verifications' },
            ...suite.branches.map((t) => ({ label: `Relire le diff · ${t.titre}${t.ecartee ? ' (écartée)' : ''}`, valeur: `diff:${t.id}` })),
            ...(suite.peutIntegrer ? [{ label: 'Intégrer les branches retenues', valeur: 'integrer' }] : []),
            ...(suite.reprise ? [{ label: 'Reprendre l’intégration · Actions', valeur: 'reprendre' }] : []),
            ...(suite.peutRanger ? [{ label: 'Ranger l’équipe', valeur: 'ranger' }] : []),
        ], false, `${avis ? `${avis}\n\n` : ''}${suite.instruction}\n\n${bilan}`);
        if (action === 'copier') { copier(bilan); bus.emit('notice', 'Bilan copié'); continue; }
        if (action === 'verifier' || action === 'verifications') {
            try { await (action === 'verifier' ? verifierEquipe(id) : consulterVerificationsEquipe(id)); avis = ''; }
            catch (err) { avis = (err as Error).name === 'Annule' ? 'Vérification annulée.' : (err as Error).message; }
            continue;
        }
        if (action.startsWith('diff:')) {
            const t = retrouver(id).taches.find((t) => t.id === action.slice(5));
            const d = t && diffTache(id, t.id);
            const decision = await choisir('Changements de la branche', [
                { label: 'Retour au bilan', valeur: 'retour' },
                ...(t && !e.integrateur && ['prete', 'erreur'].includes(e.etat) ? [{ label: t.ecartee ? 'Garder cette branche pour l’intégration' : 'Écarter cette branche de l’intégration', valeur: 'ecarter' }] : []),
            ], false,
                d ? `${t!.titre} · ${t!.branche}\n${d.resume}\n${d.diff || 'Aucune différence avec le projet actuel.'}` : 'Diff indisponible. Vérifie que le dépôt et la branche existent encore.');
            if (decision === 'ecarter' && t) {
                try { const ecartee = await basculerEcart(id, t.id); avis = `« ${t.titre} » ${ecartee ? 'écartée' : 'retenue'} pour l’intégration.`; }
                catch (err) { avis = (err as Error).message; }
            }
            continue;
        }
        if (action === 'integrer') {
            if (!suiteEquipe(retrouver(id)).peutIntegrer) continue;
            if (!await confirmer('Intégrer les branches retenues dans le projet ? L’agent pourra demander des permissions et devra vérifier le résultat.')) continue;
            const erreur = await integrer(id); if (erreur) throw new Error(erreur);
        }
        if (action === 'ranger') {
            if (!await confirmer('Ranger cette équipe ? Les conversations sont archivées et les branches Git restent disponibles. Les branches non intégrées ne seront pas fusionnées.')) continue;
            if (!suiteEquipe(retrouver(id)).peutRanger) continue;
            await terminerEquipe(id);
            setTimeout(() => bus.emit('lancer', '/equipe'), 50); return;
        }
        setTimeout(() => bus.emit('lancer', action === 'reprendre' ? `/equipe-actions ${id}` : `/equipe ${id}`), 50); return;
    }
}

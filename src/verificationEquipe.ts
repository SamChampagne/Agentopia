import { choisir, bus, type Demande } from './ui/bus.js';
import { equipeDe, rechargerEquipes } from './equipe.js';
import { copier } from './lanceurs.js';
import {
    capturerProjet, ciblesVerification, detecterVerifications, etatVerification, executerVerification,
    indisponibiliteVerification, lireJournalVerification, lirePreuvesVerification,
    type CibleVerification, type CommandeVerification, type EtatVerification, type PreuveVerification,
} from './verificationProjet.js';

const ETATS: Record<EtatVerification, string> = { 'non verifie': 'Non vérifié', 'en cours': 'En cours', reussi: 'Réussi', echoue: 'Échoué', interrompu: 'Interrompu', perime: 'Périmé · projet modifié', inconnu: 'Inconnu · résultat non confirmé' };
const LIMITE = 'Limites : 5 min · journal 512 Ko · mode CI=1 · gestionnaire déjà installé.';
const PORTEE = 'Un code 0 confirme la fin de cette commande, pas la qualité du logiciel ni la couverture de tous les tests. L’empreinte couvre les fichiers Git suivis et non ignorés ; pas les dépendances installées, services externes ou variables d’environnement.';
function description(p: PreuveVerification, etat: EtatVerification): string {
    return `${ETATS[etat]} · ${p.commande.commande}\n${p.cible.titre}\nDossier : ${p.cible.dossier}\n`
        + `Début : ${new Date(p.debut).toLocaleString('fr-CA')}${p.fin ? ` · fin : ${new Date(p.fin).toLocaleString('fr-CA')}` : ''}\n`
        + `Code de sortie : ${p.codeSortie ?? 'non disponible'}${p.signal ? ` · signal : ${p.signal}` : ''}\n`
        + `HEAD : ${p.avant.head || 'inconnu'} · branche : ${p.avant.branche || 'détachée/inconnue'}\n`
        + (p.raison ? `Motif : ${p.raison}\n` : '') + (p.avant.erreur || p.apres?.erreur ? `Empreinte : ${p.avant.erreur || p.apres?.erreur}\n` : '')
        + `Journal : ${p.journal}\n${PORTEE}`;
}
export async function resumeVerificationEquipe(equipe: string): Promise<string> {
    const derniere = lirePreuvesVerification(equipe)[0];
    if (!derniere) return 'Vérifications lancées depuis Relire : non vérifié. Choisis « Vérifier le projet » pour exécuter un script existant.';
    const actuelle = await capturerProjet(derniere.cible.dossier);
    return `DERNIÈRE VÉRIFICATION LANCÉE DEPUIS RELIRE\n${description(derniere, etatVerification(derniere, actuelle))}`;
}

/** Même dialogue dans les deux interfaces, avec sortie courante et annulation explicite. */
export async function executionVisible(cible: CibleVerification, commande: CommandeVerification): Promise<PreuveVerification> {
    const abort = new AbortController(); let dialogue: Extract<Demande, { type: 'choix' }> | undefined;
    let visible = true, texte = '', secondes = 0;
    const observer = (d?: Demande) => { if (d?.type === 'choix' && d.message === 'Vérification en cours') dialogue = d; };
    bus.on('demande', observer);
    const fermeture = choisir('Vérification en cours', [{ label: 'Interrompre la vérification', valeur: 'interrompre' }], false,
        `${commande.commande}\n${cible.dossier}\n${LIMITE}\nPréparation de l’empreinte du projet…`);
    bus.off('demande', observer);
    const arreter = fermeture.then((r) => { visible = false; if (r === 'interrompre') abort.abort(); }, () => { visible = false; abort.abort(); });
    const timer = setInterval(() => {
        secondes++;
        if (!visible || !dialogue) return;
        dialogue = { ...dialogue, detail: `${commande.commande}\n${cible.dossier}\n${LIMITE}\n${secondes} s écoulées · Échap ou Interrompre pour arrêter\n\n${texte || 'Préparation ou commande sans sortie pour le moment…'}` };
        bus.emit('demande', dialogue);
    }, 1000);
    try {
        return await executerVerification(cible, commande, { signal: abort.signal, progression: (s) => {
            texte = (texte + s).replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(-4000);
        } });
    } finally {
        clearInterval(timer); if (visible) dialogue?.resoudre('termine'); await arreter;
    }
}

async function montrerPreuve(p: PreuveVerification): Promise<void> {
    const actuelle = await capturerProjet(p.cible.dossier);
    let journal: string;
    try { journal = lireJournalVerification(p); } catch (err) { journal = (err as Error).message; }
    const texte = description(p, etatVerification(p, actuelle));
    const action = await choisir('Résultat de la vérification', [
        { label: 'Retour', valeur: 'retour' }, { label: 'Copier la preuve et le journal complet', valeur: 'copier' },
    ], false, `${texte}\n\n${journal.length > 12_000 ? 'Fin du journal (copie complète disponible) :\n' : 'Journal :\n'}${journal.slice(-12_000) || '(aucune sortie)'}`);
    if (action === 'copier') { copier(`${texte}\n\n${journal}`); bus.emit('notice', 'Preuve et journal copiés'); }
}

export async function consulterVerificationsEquipe(equipe: string): Promise<void> {
    while (true) {
        const preuves = lirePreuvesVerification(equipe);
        const id = await choisir('Journaux des vérifications', [{ label: 'Retour au bilan', valeur: '' },
            ...preuves.map((p) => ({ label: `${new Date(p.debut).toLocaleString('fr-CA')} · ${p.commande.commande} · ${p.cible.titre}`, valeur: p.id }))],
            preuves.length > 8, preuves.length ? '50 dernières exécutions au maximum. Ouvre une preuve pour actualiser son état par rapport au projet actuel.' : 'Aucune vérification lancée depuis Relire. Les commandes rapportées par les agents restent dans le bilan séparément.');
        if (!id) return;
        const p = preuves.find((p) => p.id === id); if (p) await montrerPreuve(p);
    }
}

export async function verifierEquipe(equipe: string): Promise<void> {
    rechargerEquipes(); const e = equipeDe(equipe); if (!e || e.archivee) throw new Error('Équipe introuvable');
    const cibles = ciblesVerification(e);
    const index = await choisir('Dossier à vérifier', [{ label: 'Retour au bilan', valeur: -1 },
        ...cibles.map((c, i) => ({ label: c.titre, valeur: i, description: c.dossier }))], false,
        'Le projet et chaque worktree sont vérifiés séparément. Vérifier une tâche avant fusion ne vérifie pas le projet après intégration.');
    if (index < 0) return;
    const cible = cibles[index], indisponible = indisponibiliteVerification(cible);
    if (indisponible) throw new Error(indisponible);
    const detection = detecterVerifications(cible.dossier);
    const script = await choisir('Script existant à exécuter', [{ label: 'Retour au bilan', valeur: '' },
        ...detection.commandes.map((c) => ({ label: c.commande, valeur: c.script, description: c.contenu }))], detection.commandes.length > 8,
        `${cible.dossier}\n${detection.explication || 'Scripts test/check/typecheck/lint détectés dans package.json.'}\n${LIMITE}`);
    const commande = detection.commandes.find((c) => c.script === script); if (!commande) return;
    const accord = await choisir('Exécuter cette vérification ?', [{ label: 'Exécuter', valeur: true }, { label: 'Retour sans exécuter', valeur: false }], false,
        `Commande : ${commande.commande}\nDossier : ${cible.dossier}\nExécutable : ${commande.executable}\n\n`
        + (commande.avant ? `Script préalable : ${commande.avant}\n` : '') + `Script : ${commande.contenu}\n`
        + (commande.apres ? `Script suivant : ${commande.apres}\n` : '')
        + `\n${LIMITE}\nLes scripts du projet s’exécutent sur tes fichiers. Les scripts et la configuration du gestionnaire peuvent déclencher des téléchargements. Une sortie 0 ne change jamais l’état de l’équipe. Les fichiers modifiés pendant la commande rendent la preuve périmée.`);
    if (!accord) return;
    await montrerPreuve(await executionVisible(cible, commande));
}

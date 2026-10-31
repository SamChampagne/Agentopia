import * as path from 'path';
import { Projet, depuis } from './projets.js';
import { listerSessions } from './sessions.js';
import { creerWorktree, analyserWorktrees, depotPrincipal, supprimerWorktree } from './worktrees.js';
import { ouvrirOnglet, quotePS } from './lanceurs.js';
import { lancerArrierePlan } from './agents.js';
import { bus, choisir, choisirPlusieurs, saisir, confirmer, tache } from './ui/bus.js';
import { c } from './theme.js';
import { tableau } from './affichage.js';

// "fond" : session d'arrière-plan (carte à gauche, joignable avec claude attach) ; "onglet" : Windows Terminal
export async function lancerClaude(projet: Projet, promptInitial?: string, mode: 'fond' | 'onglet' = 'onglet'): Promise<void> {
    const extrait = promptInitial ? c.discret(` · « ${promptInitial.replace(/\s+/g, ' ').slice(0, 60)}… »`) : '';
    if (mode === 'onglet') {
        ouvrirOnglet(projet.chemin, `🤖 ${projet.nom}`, promptInitial ? `claude ${quotePS(promptInitial)}` : 'claude');
        console.log(c.succes(`Claude lancé dans un onglet · ${projet.nom}`) + extrait);
        return;
    }
    const { id, sortie } = await tache(`Démarrage de la session ${projet.nom}`, () => lancerArrierePlan(projet.chemin, projet.nom, promptInitial));
    if (!id) {
        console.log(c.erreur(sortie.split('\n')[0] || 'Échec du lancement'));
        return;
    }
    console.log(c.succes(`Session ${id} démarrée en arrière-plan · ${projet.nom}`) + extrait);
    if (promptInitial) {
        console.log(c.discret('Sa conversation s\'ouvre à droite dès qu\'elle démarre · écris dans la barre du bas pour lui répondre'));
        bus.emit('selectionner', id);
    } else {
        const { rejoindre } = await import('./commandes.js');
        await rejoindre(id);
    }
}

export function reprendreDerniere(projet: Projet): void {
    ouvrirOnglet(projet.chemin, `🤖 ${projet.nom}`, 'claude --continue');
    console.log(c.succes(`Reprise de la dernière session dans ${projet.nom}`));
}

// Liste les sessions Claude du projet et reprend celle choisie
export async function choisirSession(projet: Projet): Promise<void> {
    const sessions = listerSessions(projet.chemin);
    if (!sessions.length) {
        console.log(c.alerte(`Aucune session Claude pour ${projet.nom}.`));
        return;
    }
    const session = await choisir(`Session à reprendre · ${projet.nom}`, sessions.map((s) => ({
        label: s.titre, valeur: s, description: depuis(s.date),
    })));
    ouvrirOnglet(projet.chemin, `🤖 ${projet.nom}`, `claude --resume ${session.id}`);
    console.log(c.succes(`Reprise de « ${session.titre.slice(0, 70)} »`));
}

// Lance Claude avec un prompt favori de la config
export async function lancerAvecPrompt(projet: Projet, prompts: Record<string, string>): Promise<void> {
    const nom = await choisir('Prompt favori', Object.entries(prompts).map(([n, texte]) => ({
        label: `@${n}`, valeur: n, description: texte,
    })));
    lancerClaude(projet, prompts[nom]);
}

// Crée un worktree préparé selon le profil explicite du projet et y ouvre Claude.
export async function nouvelleBranche(projet: Projet, branche?: string, base?: string): Promise<void> {
    const nom = branche || await saisir('Nom de la branche (ex. fix/mon-bug)');
    const { dossier, erreur } = await tache('Création du worktree', () => creerWorktree(projet.chemin, nom.trim(), base));
    if (!dossier) {
        console.log(c.erreur(erreur ?? 'Erreur inconnue'));
        return;
    }
    console.log(c.succes(`Worktree créé : ${dossier}`));
    ouvrirOnglet(dossier, `🤖 ${path.basename(dossier)}`, 'claude');
}

// Propose de supprimer les worktrees dont la branche est mergée et sans modifs
export async function nettoyerWorktrees(projet: Projet): Promise<void> {
    const depot = depotPrincipal(projet.chemin);
    const worktrees = await tache('Analyse des worktrees (git fetch)', () => analyserWorktrees(projet.chemin));
    if (!depot || !worktrees.length) {
        console.log(c.alerte('Aucun worktree secondaire pour ce projet.'));
        return;
    }
    console.log(tableau(worktrees.map((wt) => [
        path.basename(wt.chemin),
        c.secondaire(wt.branche ?? '(détaché)'),
        wt.merge ? c.succes('mergée') : c.alerte('pas mergée'),
        wt.modifs ? c.erreur(`✎ ${wt.modifs} modif(s)`) : '',
    ]), { entetes: ['Worktree', 'Branche', 'État', ''], retrait: 0 }));
    const supprimables = worktrees.filter((wt) => wt.merge && !wt.modifs);
    if (!supprimables.length) {
        console.log(c.discret('Rien à nettoyer : aucun worktree n\'est à la fois mergé et sans modifs.'));
        return;
    }
    const choix = await choisirPlusieurs('Worktrees à supprimer (mergés, sans modifs)', supprimables.map((wt) => ({
        label: path.basename(wt.chemin), valeur: wt, description: wt.branche, coche: true,
    })));
    if (!choix.length || !await confirmer(`Supprimer ${choix.length} worktree(s) et leur branche locale ?`)) return;
    for (const wt of choix) {
        const res = await supprimerWorktree(depot, wt);
        console.log(res.ok ? c.succes(`✓ ${path.basename(wt.chemin)} supprimé`) : c.erreur(res.sortie));
    }
}

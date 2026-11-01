import type { Projet } from './projets.js';
import { demanderAgentTexte } from './choixAgent.js';
import { choisir, confirmer, saisir, tache } from './ui/bus.js';
import { c } from './theme.js';
import { boite, ligneMarkdown } from './affichage.js';
import { gitExecution, type OptionsExecution } from './gitExecution.js';
import { etatCommit, verifierEtatCommit, committerEtatValide } from './gitCommit.js';
import { operationGitVisible } from './gitOperationVisible.js';

const MAX_DIFF = 60_000;
const tronquer = (s: string) => s.length > MAX_DIFF ? s.slice(0, MAX_DIFF) + '\n\n[... diff tronqué ...]' : s;
async function lireGit(args: string[], cwd: string, options: OptionsExecution = {}): Promise<string> {
    const r = await gitExecution(args, cwd, { timeoutMs: 15_000, maxOctets: 4 * 1024 * 1024, ...options });
    if (!r.ok) throw new Error(r.sortie || 'Lecture Git impossible.');
    return r.stdout ?? r.sortie;
}
async function estDepot(chemin: string): Promise<boolean> {
    const r = await gitExecution(['rev-parse', '--is-inside-work-tree'], chemin, { timeoutMs: 15_000 });
    if (r.ok) return true;
    console.log(c.erreur(r.sortie || `${chemin} n'est pas un dépôt git.`));
    return false;
}

export async function revue(projet: Projet): Promise<void> {
    if (!await estDepot(projet.chemin)) return;
    const { diff, nouveaux, branche } = await tache('Lecture des changements', async () => {
        const head = await gitExecution(['rev-parse', '--verify', '--quiet', 'HEAD'], projet.chemin);
        if (!head.ok && head.code !== 1) throw new Error(head.sortie || 'Lecture de HEAD impossible.');
        return {
            diff: await lireGit(['diff', '--no-ext-diff', '--no-color', ...(head.ok ? ['HEAD'] : ['--cached']), '--'], projet.chemin),
            nouveaux: await lireGit(['ls-files', '--others', '--exclude-standard'], projet.chemin),
            branche: (await lireGit(['branch', '--show-current'], projet.chemin)).trim() || 'HEAD détachée',
        };
    });
    if (!diff && !nouveaux) return void console.log(c.discret('Aucun changement à relire.'));
    const prompt = `Tu es un relecteur de code senior. Relis ce diff du projet ${projet.nom} (branche ${branche}).
Liste les problèmes par sévérité avec fichier:ligne :
- 🔴 bloquant (bug, faille, perte de données)
- 🟠 à corriger
- 🟡 suggestion
Termine par une ligne "Verdict :" (prêt à committer ou non). Sois concis, en français.
${nouveaux ? `\nNouveaux fichiers non suivis (contenu non fourni, à vérifier séparément) :\n${nouveaux}\n` : ''}
\`\`\`diff
${tronquer(diff)}
\`\`\``;
    const resultat = await demanderAgentTexte(prompt, projet.chemin);
    for (const ligne of resultat.split('\n')) console.log(ligneMarkdown(ligne));
}

async function genererMessage(projet: Projet, diff: string, stat: string, proposer: typeof demanderAgentTexte): Promise<string> {
    const brut = await proposer(`Écris un message de commit pour ce diff.
Format Conventional Commits (feat:, fix:, refactor:, chore:, docs:, test:, style:), en français.
Première ligne : 72 caractères max. Si utile : une ligne vide puis 2 à 5 puces courtes.
Réponds UNIQUEMENT avec le message, sans balises ni explication.

${stat}
\`\`\`diff
${tronquer(diff)}
\`\`\``, projet.chemin);
    return brut.replace(/^```\w*\n?|```$/g, '').trim();
}

/** Un message manuel ne déclenche aucune connexion à un fournisseur IA. */
export async function commit(projet: Projet, services = { proposer: demanderAgentTexte }): Promise<void> {
    const cwd = projet.chemin;
    if (!await estDepot(cwd)) return;
    if (!(await lireGit(['status', '--porcelain'], cwd)).trim()) return void console.log(c.discret('Rien à committer, le dossier est propre.'));
    if (!(await lireGit(['diff', '--cached', '--name-only', '--'], cwd)).trim()) {
        if (!await confirmer('Rien n’est indexé. Tout ajouter (git add -A) ?')) return;
        await operationGitVisible('Indexation des changements', projet.nom, () => lireGit(['add', '-A'], cwd, { timeoutMs: 120_000 }));
    }
    const apercu = await tache('Préparation de l’aperçu du commit', async () => {
        const etat = await etatCommit(cwd);
        const diff = await lireGit(['diff', '--cached', '--no-ext-diff', '--no-color', '--'], cwd);
        const stat = await lireGit(['diff', '--cached', '--stat', '--no-ext-diff', '--no-color', '--'], cwd);
        await verifierEtatCommit(cwd, etat);
        return { etat, diff, stat };
    });
    if (!apercu.diff.trim()) return void console.log(c.discret('Aucun changement indexé.'));
    const detail = `${projet.nom} · ${apercu.etat.branche.replace('refs/heads/', '') || 'HEAD détachée'}\n${apercu.stat}\nSeuls les changements indexés sont concernés.`;
    const mode = await choisir('Message du commit', [
        { label: 'Écrire mon message', valeur: 'manuel', description: 'Aucun agent nécessaire' },
        { label: 'Proposer un message avec un agent', valeur: 'agent', description: 'Choisir le fournisseur' },
    ], false, detail);
    let message = mode === 'manuel' ? await saisir('Message du commit') : await genererMessage(projet, apercu.diff, apercu.stat, services.proposer);
    for (;;) {
        if (!message.trim()) { message = await saisir('Le message est vide. Écris le message du commit'); continue; }
        console.log(boite(message.split('\n').map((l, i) => (i === 0 ? c.secondaire.bold(l) : l)), c.discret));
        const action = await choisir(`Valider le commit · ${projet.nom}`, [
            { label: '✓ Committer', valeur: 'commit' },
            { label: '✓ Committer et pousser', valeur: 'push' },
            { label: '✎ Modifier le message', valeur: 'modifier' },
            { label: '↻ Proposer un message avec un agent', valeur: 'regenerer' },
            { label: '✕ Annuler', valeur: 'annuler' },
        ], false, `${detail}\n\n${message}`);
        if (action === 'annuler') return;
        if (action === 'regenerer') { message = await genererMessage(projet, apercu.diff, apercu.stat, services.proposer); continue; }
        if (action === 'modifier') { message = await saisir('Message du commit', message); continue; }
        const res = await operationGitVisible('Création du commit', detail, () => committerEtatValide(cwd, apercu.etat, message));
        console.log(res.ok ? c.succes(res.sortie.split('\n')[0]) : c.erreur(res.sortie));
        if (res.ok && action === 'push') {
            try {
                const push = await operationGitVisible('Envoi du commit', projet.nom, async () => {
                    const r = await gitExecution(['push'], cwd, { timeoutMs: 120_000 });
                    return r.ok || !/no upstream|has no upstream/i.test(r.sortie) ? r : gitExecution(['push', '-u', 'origin', 'HEAD'], cwd, { timeoutMs: 120_000 });
                });
                console.log(push.ok ? c.succes('Poussé ✓') : c.erreur(`Commit conservé. Envoi non confirmé : ${push.sortie}`));
            } catch (e) { throw new Error(`Commit conservé. Envoi non confirmé : ${(e as Error).message}`); }
        }
        return;
    }
}

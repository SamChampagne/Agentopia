import { spawnSync } from 'child_process';
import { argumentsGitCompte } from './authGitReseau.js';
import { Projet, brancheGit } from './projets.js';
import { demanderAgentTexte } from './choixAgent.js';
import { choisir, confirmer, saisir, tache } from './ui/bus.js';
import { c } from './theme.js';
import { boite, ligneMarkdown } from './affichage.js';

const MAX_DIFF = 60_000;   // au-delà on tronque pour ne pas exploser le prompt

function git(args: string[], cwd: string, entree?: string): { ok: boolean; sortie: string } {
    const res = spawnSync('git', argumentsGitCompte(args), { cwd, encoding: 'utf-8', input: entree, maxBuffer: 50 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return { ok: res.status === 0, sortie: ((res.stdout || '') + (res.status !== 0 ? res.stderr || '' : '')).trim() };
}

function estDepot(chemin: string): boolean {
    if (git(['rev-parse', '--is-inside-work-tree'], chemin).ok) return true;
    console.log(c.erreur(`${chemin} n'est pas un dépôt git.`));
    return false;
}

function tronquer(diff: string): string {
    return diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) + '\n\n[... diff tronqué ...]' : diff;
}

// Relecture par le fournisseur choisi, avec un contexte limité au diff fourni.
export async function revue(projet: Projet): Promise<void> {
    if (!estDepot(projet.chemin)) return;
    const aHead = git(['rev-parse', '--verify', 'HEAD'], projet.chemin).ok;
    const diff = git(aHead ? ['diff', 'HEAD'] : ['diff', '--cached'], projet.chemin).sortie;
    const nouveaux = git(['ls-files', '--others', '--exclude-standard'], projet.chemin).sortie;
    if (!diff && !nouveaux) {
        console.log(c.discret('Aucun changement à relire.'));
        return;
    }
    const prompt = `Tu es un relecteur de code senior. Relis ce diff du projet ${projet.nom} (branche ${brancheGit(projet.chemin) ?? '?'}).
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

async function genererMessage(projet: Projet, diff: string, stat: string): Promise<string> {
    const prompt = `Écris un message de commit pour ce diff.
Format Conventional Commits (feat:, fix:, refactor:, chore:, docs:, test:, style:), en français.
Première ligne : 72 caractères max. Si utile : une ligne vide puis 2 à 5 puces courtes.
Réponds UNIQUEMENT avec le message, sans balises ni explication.

${stat}

\`\`\`diff
${tronquer(diff)}
\`\`\``;
    const brut = await demanderAgentTexte(prompt, projet.chemin);
    return brut.replace(/^```\w*\n?|```$/g, '').trim();
}

// Message généré par l’agent choisi, à valider / modifier / régénérer.
export async function commit(projet: Projet): Promise<void> {
    if (!estDepot(projet.chemin)) return;
    if (!git(['status', '--porcelain'], projet.chemin).sortie) {
        console.log(c.discret('Rien à committer, le dossier est propre.'));
        return;
    }
    if (!git(['diff', '--cached', '--name-only'], projet.chemin).sortie) {
        if (!await confirmer('Rien n\'est indexé. Tout ajouter (git add -A) ?')) return;
        git(['add', '-A'], projet.chemin);
    }
    const diff = git(['diff', '--cached'], projet.chemin).sortie;
    const stat = git(['diff', '--cached', '--stat'], projet.chemin).sortie;
    if (!diff) {
        console.log(c.discret('Aucun changement indexé.'));
        return;
    }
    console.log(c.discret(stat));

    let message = await genererMessage(projet, diff, stat);
    for (;;) {
        console.log(boite(message.split('\n').map((l, i) => (i === 0 ? c.secondaire.bold(l) : l)), c.discret));
        const action = await choisir('Que faire ?', [
            { label: '✓ Committer', valeur: 'commit' },
            { label: '✓ Committer et pousser', valeur: 'push' },
            { label: '✎ Modifier le titre', valeur: 'modifier' },
            { label: '↻ Régénérer', valeur: 'regenerer' },
            { label: '✕ Annuler', valeur: 'annuler' },
        ], false);
        if (action === 'annuler') return;
        if (action === 'regenerer') {
            message = await genererMessage(projet, diff, stat);
            continue;
        }
        if (action === 'modifier') {
            const [premiere, ...reste] = message.split('\n');
            message = [await saisir('Titre du commit', premiere), ...reste].join('\n');
            continue;
        }
        const res = git(['commit', '-F', '-'], projet.chemin, message);
        console.log(res.ok ? c.succes(res.sortie.split('\n')[0]) : c.erreur(res.sortie));
        if (res.ok && action === 'push') {
            const push = await tache('git push', () => {
                const r = git(['push'], projet.chemin);
                return r.ok || !/no upstream|has no upstream/i.test(r.sortie) ? r : git(['push', '-u', 'origin', 'HEAD'], projet.chemin);
            });
            console.log(push.ok ? c.succes('Poussé ✓') : c.erreur(push.sortie));
        }
        return;
    }
}

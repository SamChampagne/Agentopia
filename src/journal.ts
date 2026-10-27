import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { Projet } from './projets.js';
import { sessionsDeLaPeriode } from './sessions.js';
import { demanderClaude, parLignes } from './claude.js';
import { choisir, tache } from './ui/bus.js';
import { copier } from './lanceurs.js';
import { c } from './theme.js';
import { titre, ligneMarkdown } from './affichage.js';
import { puce } from './dashboard.js';

interface Activite {
    projet: string;
    commits: { hash: string; date: string; sujet: string }[];
    sessions: string[];
}

function bornes(periode: string): { debut: Date; fin: Date; libelle: string } {
    const auj = new Date();
    auj.setHours(0, 0, 0, 0);
    const fin = new Date(Date.now() + 60_000);
    if (periode === 'hier') {
        const debut = new Date(auj);
        debut.setDate(debut.getDate() - 1);
        return { debut, fin: auj, libelle: 'hier' };
    }
    if (periode === 'semaine') {
        const debut = new Date(auj);
        debut.setDate(debut.getDate() - 6);
        return { debut, fin, libelle: 'les 7 derniers jours' };
    }
    return { debut: auj, fin, libelle: "aujourd'hui" };
}

function auteurs(): string[] {
    return ['user.email', 'user.name']
        .map((cle) => spawnSync('git', ['config', '--global', cle], { encoding: 'utf-8' }).stdout?.trim())
        .filter((v): v is string => !!v);
}

function gitLog(args: string[], cwd: string): Promise<string> {
    return new Promise((ok) => {
        if (!fs.existsSync(path.join(cwd, '.git'))) return ok('');
        const proc = spawn('git', args, { cwd });
        let sortie = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.on('error', () => ok(''));
        proc.on('close', (code) => ok(code === 0 ? sortie : ''));
    });
}

// "mar 14 h 32"
function dateCourte(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString('fr-CA', { weekday: 'short' }).replace('.', '')} ${d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`;
}

// En parallèle et sans bloquer l'interface : git log de tous les dépôts + sessions Claude de la période
async function collecter(projets: Projet[], debut: Date, fin: Date): Promise<Activite[]> {
    const moi = auteurs().flatMap((a) => ['--author', a]);
    const logs = await Promise.all(projets.map((p) => gitLog(['log', '--all', '--no-merges', `--since=${debut.toISOString()}`,
        `--until=${fin.toISOString()}`, ...moi, '--date=iso-strict', '--format=%H%x09%ad%x09%s'], p.chemin)));
    const vus = new Set<string>();   // les worktrees partagent les commits : on ne les compte qu'une fois
    const activites: Activite[] = [];
    projets.forEach((p, i) => {
        const commits = logs[i].split('\n').filter(Boolean)
            .map((l) => {
                const [hash, iso, sujet] = l.split('\t');
                return { hash, date: dateCourte(iso), sujet };
            })
            .filter((co) => !vus.has(co.hash) && vus.add(co.hash));
        // Seules les conversations touchées pendant la période sont lues (c'était le plus lent)
        const sessions = sessionsDeLaPeriode(p.chemin, debut, fin).map((s) => s.titre);
        if (commits.length || sessions.length) activites.push({ projet: p.nom, commits, sessions });
    });
    return activites.sort((a, b) => b.commits.length + b.sessions.length - a.commits.length - a.sessions.length);
}

function texteBrut(activites: Activite[], libelle: string): string {
    const lignes = [`Journal — ${libelle}`, ''];
    for (const a of activites) {
        lignes.push(`## ${a.projet}`);
        a.commits.forEach((co) => lignes.push(`- ${co.date} ${co.sujet}`));
        a.sessions.forEach((s) => lignes.push(`- (session Claude) ${s}`));
        lignes.push('');
    }
    return lignes.join('\n');
}

// Ce que j'ai fait : commits + sessions Claude, dans tous les projets
export async function journal(projets: Projet[], periode = 'jour'): Promise<void> {
    const { debut, fin, libelle } = bornes(periode);
    const activites = await tache(`Lecture des commits et sessions (${libelle})`, () => collecter(projets, debut, fin));
    if (!activites.length) {
        console.log(c.discret(`Aucune activité trouvée ${libelle}.`));
        return;
    }
    const nbCommits = activites.reduce((n, a) => n + a.commits.length, 0);
    const nbSessions = activites.reduce((n, a) => n + a.sessions.length, 0);
    console.log(titre(`Journal · ${libelle}`) + c.discret(`  ${nbCommits} commits · ${nbSessions} sessions Claude · ${activites.length} projets`));
    for (const a of activites) {
        console.log(`\n  ${puce(a.projet)} ${a.projet}`);
        a.commits.slice(0, 12).forEach((co) => console.log(`    ${c.discret(co.date.padEnd(14))}${co.sujet}`));
        if (a.commits.length > 12) console.log(c.discret(`    … et ${a.commits.length - 12} autres commits`));
        a.sessions.forEach((s) => console.log(`    ${c.discret('session'.padEnd(14))}${c.secondaire(s)}`));
    }
    console.log();

    const brut = texteBrut(activites, libelle);
    const action = await choisir('Et ensuite ?', [
        { label: '✻ Résumer avec Claude (stand-up)', valeur: 'resume' },
        { label: '⧉ Copier le journal brut', valeur: 'copier' },
        { label: '✕ Rien', valeur: 'rien' },
    ], false);
    if (action === 'copier') {
        copier(brut);
        console.log(c.succes('Copié dans le presse-papiers'));
    }
    if (action !== 'resume') return;

    const prompt = `Voici mon activité de développeur (${libelle}) : commits git et titres de sessions Claude Code, par projet.
Rédige un résumé pour un stand-up / feuille de temps, en français :
- une section par projet, 1 à 3 puces orientées résultat (pas la liste brute des commits)
- regroupe ce qui va ensemble, ignore les commits triviaux
- termine par une ligne "Prochaines étapes probables :" si c'est déductible.
Pas de titre général, pas d'introduction.

${brut}`;
    console.log();
    const flux = parLignes((l) => console.log(ligneMarkdown(l)));
    const resume = await tache('Claude rédige le résumé', () => demanderClaude(prompt, { cwd: process.cwd(), modele: 'haiku', surTexte: flux.pousser }));
    flux.finir();
    if (await choisir('Copier le résumé ?', [{ label: 'Oui', valeur: true }, { label: 'Non', valeur: false }], false)) {
        copier(resume);
        console.log(c.succes('Résumé copié dans le presse-papiers'));
    }
}

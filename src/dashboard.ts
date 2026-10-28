import chalk from 'chalk';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { Projet, derniereSessionClaude, derniereActiviteGit, etatGit, depuis } from './projets.js';
import { c, couleurProjet, banniere } from './theme.js';
import { tableau, titre, largeurVisible } from './affichage.js';
import { chargerConfig } from './config.js';
import { surPath } from './chemins.js';

const GH_DISPO = !!surPath('gh');

// Projets triés par dernière activité (session Claude ou action git)
export function projetsRecents(projets: Projet[], max: number): { projet: Projet; date: Date }[] {
    return projets
        .map((projet) => {
            const dates = [derniereSessionClaude(projet.chemin), derniereActiviteGit(projet.chemin)]
                .filter((d): d is Date => !!d);
            return { projet, date: new Date(Math.max(0, ...dates.map((d) => d.getTime()))) };
        })
        .filter((r) => r.date.getTime() > 0)
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, max);
}

export const puce = (nom: string) => chalk.hex(couleurProjet(nom))('●');

function blocPRs(): string {
    if (!GH_DISPO) return c.discret('  Installe GitHub CLI pour voir tes PR : winget install GitHub.cli');
    const res = spawnSync('gh', ['search', 'prs', '--author', '@me', '--state', 'open',
        '--json', 'repository,number,title,isDraft', '--limit', '10'], { encoding: 'utf-8', timeout: 8000 });
    if (res.status !== 0) return c.discret('  PR indisponibles : lance "gh auth login"');
    const prs = JSON.parse(res.stdout) as { repository: { name: string }; number: number; title: string; isDraft: boolean }[];
    if (!prs.length) return c.discret('  Aucune PR ouverte');
    return tableau(prs.map((pr) => [
        pr.isDraft ? c.discret('brouillon') : c.succes('ouverte'), c.secondaire(pr.repository.name), `#${pr.number}`, pr.title,
    ]));
}

function prenom(): string {
    const perso = chargerConfig().prenom;
    if (perso) return perso;
    const lire = (cle: string) => spawnSync('git', ['config', '--global', cle], { encoding: 'utf-8' }).stdout?.trim() ?? '';
    const nom = lire('user.name');
    if (nom.includes(' ')) return nom.split(' ')[0];
    // "Sam.Champagne@..." → "Sam"
    const local = lire('user.email').split('@')[0].split(/[._-]/)[0];
    return (local || nom || os.userInfo().username).replace(/^./, (x) => x.toUpperCase());
}

const centrer = (ligne: string, marge: number) => ' '.repeat(marge) + ligne;

// En-tête affiché une fois au démarrage : bannière + une ligne, centrés
export function entete(marge: number, largeur: number): string {
    const ban = banniere().split('\n');
    const largeurBan = largeurVisible(ban[0]);
    const decalage = marge + Math.max(0, Math.floor((largeur - largeurBan) / 2));
    const date = new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
    const salut = `${c.accent('✻')} Bonjour ${chalk.bold(prenom())} ${c.discret(`· ${date}`)}`;
    const aide = c.discret('/ commandes · Entrée menu · ! shell · texte libre = Claude');
    return ['', ...ban.map((l) => centrer(l, decalage)), '',
        centrer(salut, marge + Math.max(0, Math.floor((largeur - largeurVisible(salut)) / 2))),
        centrer(aide, marge + Math.max(0, Math.floor((largeur - largeurVisible(aide)) / 2)))].join('\n');
}

// Projets récents + PR (ce qui était sur l'ancien accueil), via /recents
export function recents(projets: Projet[]): string {
    const lignes: string[] = [];
    lignes.push(titre('Projets récents'));
    lignes.push(tableau(projetsRecents(projets, 8).map(({ projet, date }) => {
        const etat = etatGit(projet.chemin);
        return [
            c.discret(String(projets.indexOf(projet) + 1).padStart(2)),
            `${puce(projet.nom)} ${projet.nom}`,
            c.discret(depuis(date)),
            etat ? c.secondaire(`⎇ ${etat.branche}`) : '',
            !etat ? '' : [
                etat.modifs ? c.alerte(`✎ ${etat.modifs}`) : c.succes('✓'),
                etat.enAvance ? c.succes(`↑${etat.enAvance}`) : '',
                etat.enRetard ? c.erreur(`↓${etat.enRetard}`) : '',
            ].filter(Boolean).join(' '),
        ];
    }), { max: [2, 28, 14, 36] }));
    lignes.push(titre('Mes PR ouvertes'));
    lignes.push(blocPRs());
    return lignes.join('\n');
}

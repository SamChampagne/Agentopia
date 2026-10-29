import * as os from 'os';
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { config } from '../commandes.js';
import { Donnees } from './donnees.js';
import { ilYa } from './Panneau.js';
import { etatEquipe, enPause } from './Laterale.js';
import { avancement } from '../equipe.js';
import { dollars } from '../cout.js';
import { formatTokens } from '../usage.js';
import { formatRam } from '../systeme.js';
import { theme, couleurProjet, fond, degrade } from '../theme.js';
import { lignesJournal } from './journal.js';
import { panneauVisible } from './disposition.js';

// Clic sur le panneau des sorties (à la place d'une session)
export const JOURNAL = '@journal';
const H_SORTIES = 6;   // bordures comprises : 4 lignes de sortie

// Cockpit : ce que montre la zone principale quand rien n'est ouvert.
// Tuiles de chiffres en haut, puis « À faire » (ce qui t'attend, cliquable) et l'activité en direct.
// Tout est dessiné ligne par ligne : la position de chaque ligne cliquable est connue exactement.

const ANIM = ['✻', '✼', '✽', '✾', '✿', '❀'];
const une = (s: string) => s.replace(/\s+/g, ' ').trim();
const hex = (h: string) => (h.startsWith('#') ? chalk.hex(h) : h === 'gray' ? chalk.gray : chalk.white);

// Coupe un texte simple (sans couleurs) à n colonnes
const couper = (s: string, n: number) => (n <= 0 ? '' : stringWidth(s) > n ? [...s].slice(0, Math.max(0, n - 1)).join('') + '…' : s);
// Coupe puis complète une ligne colorée à n colonnes exactement
const completer = (s: string, n: number) => {
    const l = stringWidth(s) > n ? wrapAnsi(s, n, { hard: true, trim: false }).split('\n')[0] : s;
    return l + ' '.repeat(Math.max(0, n - stringWidth(l)));
};
// Historique CPU / RAM de la machine (gardé entre deux ouvertures du cockpit)
const HISTORIQUE = 120;
const cpu: number[] = [];
const ram: number[] = [];
let precedent = os.cpus();
function relever(): void {
    const actuel = os.cpus();
    let total = 0, repos = 0;
    actuel.forEach((c, i) => {
        const p = precedent[i] ?? c;
        const t = (o: os.CpuInfo) => o.times.user + o.times.nice + o.times.sys + o.times.irq + o.times.idle;
        total += t(c) - t(p);
        repos += c.times.idle - p.times.idle;
    });
    precedent = actuel;
    cpu.push(total > 0 ? ((total - repos) / total) * 100 : 0);
    ram.push(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
    if (cpu.length > HISTORIQUE) cpu.shift();
    if (ram.length > HISTORIQUE) ram.shift();
}

// Relevé dès le lancement : le graphique est déjà rempli à la première ouverture
relever();
setInterval(relever, 1000).unref();

const couleurNiveau = (p: number) => (p > 85 ? '#f87171' : p > 60 ? '#facc15' : '#4ade80');

// Jauge ━━━━━━──── colorée selon le niveau
function jauge(p: number, n: number, couleur = couleurNiveau(p)): string {
    const plein = Math.round((Math.max(0, Math.min(100, p)) / 100) * n);
    return chalk.hex(couleur)('━'.repeat(plein)) + chalk.hex(fond.bordure)('─'.repeat(n - plein));
}

// Graphique en barres sur plusieurs lignes : les valeurs les plus récentes à droite
function graphique(valeurs: number[], largeur: number, hauteur: number): string[] {
    const v = valeurs.slice(-largeur);
    const vide = largeur - v.length;
    const lignes: string[] = [];
    for (let r = 0; r < hauteur; r++) {
        const bas = (hauteur - 1 - r) / hauteur * 100;
        let l = chalk.hex(fond.bordure)((r === hauteur - 1 ? '▁' : ' ').repeat(Math.max(0, vide)));
        for (const x of v) {
            const niveau = Math.max(0, Math.min(8, Math.round(((x - bas) / (100 / hauteur)) * 8)));
            l += niveau ? chalk.hex(couleurNiveau(bas + 100 / hauteur / 2))(' ▁▂▃▄▅▆▇█'[niveau]) : r === hauteur - 1 ? chalk.hex(fond.bordure)('▁') : ' ';
        }
        lignes.push(l);
    }
    return lignes;
}

const bord = (s: string) => chalk.hex(fond.bordure)(s);
function haut(titre: string, n: number, droite = ''): string {
    const t = ` ${titre} `;
    const d = droite ? ` ${droite} ` : '';
    const reste = Math.max(0, n - 3 - stringWidth(t) - stringWidth(d));
    return bord('╭─') + chalk.hex(theme.primaire).bold(t) + bord('─'.repeat(reste)) + chalk.gray(d) + bord('╮');
}
const bas = (n: number) => bord('╰' + '─'.repeat(Math.max(0, n - 2)) + '╯');
const milieu = (contenu: string, n: number) => bord('│') + ' ' + completer(contenu, n - 4) + ' ' + bord('│');

// Une tuile : titre, une ligne principale en gras, deux lignes de détail (5 lignes en tout)
function tuile(titre: string, principal: string, d1: string, d2: string, n: number): string[] {
    return [haut(titre, n), milieu(principal, n), milieu(d1, n), milieu(d2, n), bas(n)];
}
const gros = (valeur: string, unite: string) => chalk.hex(theme.accent).bold(valeur) + ' ' + chalk.bold(unite);

// Côte à côte : les blocs ont tous la même hauteur
const coteACote = (blocs: string[][], ecart = 1) => blocs[0].map((_, i) => blocs.map((b) => b[i] ?? '').join(' '.repeat(ecart)));

interface AFaire { lignes: string[]; session?: string }

// Redessiné par l'horloge de l'App (une seule image par battement pour tout l'écran)
export function Cockpit({ d, largeur, hauteur }: { d: Donnees; largeur: number; hauteur: number }) {
    const { lignes, cible } = lignesCockpit(d, largeur, hauteur);
    useCockpitCibles(cible);
    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            {lignes.slice(0, hauteur - 1).map((l, i) => <Text key={i} wrap="truncate-end">{l}</Text>)}
            <Text wrap="truncate-end" color={fond.discret}>{'  clic sur « À faire » pour ouvrir la session · sur « Dernières sorties » pour le journal complet'}</Text>
        </Box>
    );
}

// Le contenu du cockpit en lignes colorées (chalk), et la cible d'un clic (x, y) : indépendant du moteur d'affichage
export function lignesCockpit(d: Donnees, largeur: number, hauteur: number): { lignes: string[]; cible: (x: number, y: number) => string | undefined } {
    const tic = Math.floor(Date.now() / 800);
    const L = largeur - 2;   // marge à gauche et à droite

    // ─── Tuiles ───
    // Une session qui attend depuis plus de 12 h est oubliée, pas urgente : elle ne compte pas dans « À faire »
    const derniere = (s: Donnees['agents'][number]) => d.activites.get(s.sessionId)?.date ?? s.debut;
    const enAttente = d.agents.filter((a) => a.statut === 'bloquee' || a.statut === 'attend');
    const recentes = enAttente.filter((a) => !enPause(a, d.activites.get(a.sessionId)));
    const anciennes = enAttente.filter((a) => !recentes.includes(a));
    const actifs = d.agents.filter((a) => a.statut === 'travaille').length;
    const cpuNow = cpu.at(-1) ?? 0, ramNow = ram.at(-1) ?? 0;
    const budget = config.budgetJour ?? 0;
    const enMarche = d.docker.reduce((n, h) => n + h.conteneurs.filter((c) => c.enMarche).length, 0);
    const joignables = [...d.joignables.values()].filter(Boolean).length;
    // Panneaux cachés dans /ecran : les autres prennent la place
    const clesTuiles = ['sessions', 'poste', 'cout', 'infra'].filter(panneauVisible);
    const parLigne = Math.max(1, Math.min(L >= 4 * 30 + 3 ? 4 : 2, clesTuiles.length));   // une tuile a besoin d'environ 30 colonnes
    const nT = Math.floor((L - (parLigne - 1)) / parLigne);
    const nJ = Math.max(4, nT - 15);
    const pluriel = (n: number, mot: string) => `${mot}${n > 1 ? 's' : ''}`;
    const fabriques: Record<string, () => string[]> = {
        sessions: () => tuile('SESSIONS', gros(String(d.agents.length), pluriel(d.agents.length, 'ouverte')),
            actifs ? chalk.hex('#4ade80')(`${ANIM[tic % ANIM.length]} ${actifs} au travail`) : chalk.gray('○ aucune au travail'),
            recentes.length ? chalk.hex('#fb923c')(`! ${recentes.length} ${recentes.length > 1 ? 't’attendent' : 't’attend'}`) : chalk.gray('✓ rien ne t’attend'), nT),
        poste: () => tuile('CE POSTE', `${chalk.gray('CPU')} ${jauge(cpuNow, nJ)} ${chalk.bold(`${String(Math.round(cpuNow)).padStart(3)} %`)}`,
            `${chalk.gray('RAM')} ${jauge(ramNow, nJ)} ${chalk.bold(`${String(Math.round(ramNow)).padStart(3)} %`)}`,
            chalk.gray(`${formatRam(os.totalmem() - os.freemem())} sur ${formatRam(os.totalmem())}`), nT),
        cout: () => tuile('COÛT DU JOUR', gros(d.cout.total ? dollars(d.cout.total) : '0 $', ''),
            chalk.gray(`${formatTokens(d.cout.jetons)} jetons (équiv. API)`),
            budget ? `${jauge((d.cout.total / budget) * 100, Math.max(4, nT - 14))} ${chalk.gray(`/ ${dollars(budget)}`)}` : chalk.gray('aucun budget fixé'), nT),
        infra: () => tuile('INFRA', gros(String(enMarche), pluriel(enMarche, 'conteneur')),
            chalk.gray('Docker en marche'),
            d.serveurs.length ? `${chalk.hex(joignables === d.serveurs.length ? '#4ade80' : '#facc15')('●')} ${chalk.gray(`${joignables}/${d.serveurs.length} serveurs SSH joignables`)}` : chalk.gray('aucun serveur SSH'), nT),
    };
    const tuiles = clesTuiles.map((k) => fabriques[k]());
    const lignes: string[] = [];
    for (let i = 0; i < tuiles.length; i += parLigne) lignes.push(...coteACote(tuiles.slice(i, i + parLigne)));
    const hauteurTuiles = lignes.length;

    // ─── Panneaux du bas ───
    const reste = Math.max(6, hauteur - hauteurTuiles - 1);
    const vA = panneauVisible('afaire'), vS = panneauVisible('sorties'), vR = panneauVisible('raccourcis'), vD = panneauVisible('direct');
    const vGauche = vA || vS || vR;
    // Une seule colonne si l'écran est étroit ou si un des deux côtés est entièrement caché
    const deux = L >= 70 && vGauche && vD;
    const nG = deux ? Math.floor((L - 1) * 0.5) : L;
    const nD = deux ? L - 1 - nG : L;
    const int = (n: number) => n - 4;

    // À faire : sessions qui attendent une réponse, puis équipes
    const items: AFaire[] = [];
    for (const s of recentes) {
        const cle = s.id ?? s.sessionId;
        const q = s.question ? une(s.question) : s.statut === 'bloquee' ? 'attend une permission' : 'attend ta réponse';
        items.push({ session: cle, lignes: [
            `${chalk.hex('#fb923c')('!')} ${chalk.hex(couleurProjet(s.nom))('●')} ${chalk.bold(couper(s.nom, 20))}${chalk.gray(` · il y a ${ilYa(derniere(s))}`)}`,
            `    ${chalk.hex('#fdba74')(couper(q, int(nG) - 4))}`,
        ] });
    }
    for (const e of d.equipes.filter((x) => x.etat !== 'finie')) {
        const av = avancement(e);
        const et = etatEquipe(e, tic);
        items.push({ lignes: [
            `${chalk.hex('#c084fc')('◆')} ${chalk.bold(couper(e.nomProjet, int(nG) - 20))} ${hex(et.couleur)(et.texte)}`,
            `    ${jauge(av.total ? (av.faites / av.total) * 100 : 0, Math.max(4, int(nG) - 12), theme.secondaire)} ${chalk.gray(`${av.faites}/${av.total}`)}`,
        ] });
    }

    // Activité : sessions au travail, puis le graphique de la machine
    const activite: string[] = [];
    for (const s of d.agents.filter((a) => a.statut === 'travaille')) {
        const a = d.activites.get(s.sessionId);
        const quoi = a?.outil ? `▸ ${une(a.outil)}` : une(a?.dernierTexte ?? s.titre ?? '');
        activite.push(`${chalk.hex('#4ade80')(ANIM[(tic + s.nom.length) % ANIM.length])} ${chalk.hex(couleurProjet(s.nom))('●')} ${chalk.bold(couper(s.nom, 18))}${a?.date ? chalk.gray(`  il y a ${ilYa(a.date)}`) : ''}`);
        activite.push(`    ${chalk.gray(couper(quoi, int(nD) - 4))}`);
    }
    const hGraph = Math.max(2, Math.min(6, Math.floor((reste - 2 - Math.max(2, activite.length) - 3) / 2)));

    const panneau = (titre: string, droite: string, contenu: string[], n: number, h: number) => [
        haut(titre, n, droite),
        ...Array.from({ length: h - 2 }, (_, i) => milieu(contenu[i] ?? '', n)),
        bas(n),
    ];

    const lignesAFaire: string[] = [];
    const cibles: (string | undefined)[] = [];
    for (const it of items) {
        if (lignesAFaire.length + it.lignes.length > reste - 2 - (vS ? H_SORTIES : 0) - (vR ? 3 : 0) - 1) break;
        lignesAFaire.push(...it.lignes);
        cibles.push(...it.lignes.map(() => it.session));
    }
    if (!items.length) lignesAFaire.push(chalk.hex('#4ade80')('✓ Rien ne t\'attend'), chalk.gray('  les questions arriveront ici'));
    else if (lignesAFaire.length < items.reduce((n, i) => n + i.lignes.length, 0)) lignesAFaire.push(chalk.gray(`  … et d'autres (Live pour tout voir)`));
    // Les vieilles attentes : une seule ligne discrète (les fermer depuis la colonne de gauche, ou demander au maître)
    if (anciennes.length) {
        const plusVieille = anciennes.reduce((a, b) => (derniere(a) < derniere(b) ? a : b));
        lignesAFaire.push('',
            chalk.hex(fond.discret)(`◌ ${anciennes.length} ${anciennes.length > 1 ? 'vieilles sessions' : 'vieille session'} en pause (${ilYa(derniere(plusVieille))})`),
            chalk.hex(fond.discret)('  pour ranger : Alt+M, « ferme-les »'));
    }

    const contenuActivite = [
        ...(activite.length ? activite : [chalk.gray('aucune session au travail')]),
    ];
    // Deux graphiques l'un sous l'autre : CPU puis RAM, chacun avec son titre et sa valeur du moment
    const dispo = reste - 2 - 2 * hGraph - 3;
    const visibles = contenuActivite.slice(0, Math.max(0, dispo));
    const duree = cpu.length >= 60 ? `${Math.round(cpu.length / 60)} min` : `${cpu.length} s`;
    const blocActivite = [
        ...visibles, ...Array(Math.max(0, dispo - visibles.length)).fill(''), '',
        `${chalk.bold('CPU')} ${chalk.hex(couleurNiveau(cpuNow)).bold(`${Math.round(cpuNow)} %`)}${chalk.gray(` · ${duree}`)}`, ...graphique(cpu, int(nD), hGraph),
        `${chalk.bold('RAM')} ${chalk.hex(couleurNiveau(ramNow)).bold(`${Math.round(ramNow)} %`)}${chalk.gray(` · ${formatRam(os.totalmem() - os.freemem())} sur ${formatRam(os.totalmem())}`)}`, ...graphique(ram, int(nD), hGraph),
    ];

    // À faire prend la place qu'il lui faut, puis les dernières sorties ; les raccourcis remplissent le reste.
    // Ce qui est caché (/ecran) laisse sa place au dernier panneau visible de la colonne
    let hSorties = vS ? H_SORTIES : 0;
    let hAFaire = vA ? Math.max(4, Math.min(reste - hSorties - (vR ? 3 : 0), lignesAFaire.length + 2)) : 0;
    let hRaccourcis = vR ? reste - hAFaire - hSorties : 0;
    if (hRaccourcis < 3) hRaccourcis = 0;
    const surplus = reste - hAFaire - hSorties - hRaccourcis;
    if (hRaccourcis) hRaccourcis += surplus;
    else if (vS) hSorties += surplus;
    else hAFaire += surplus;
    // Les dernières lignes écrites par les commandes (le journal complet : clic ici, /sorties)
    const journal = lignesJournal();
    const sorties = journal.filter((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).slice(-(hSorties - 2));
    const touches: [string, string][] = [['Ctrl+K', 'tout chercher'], ['/', 'commandes'], ['Alt+M', 'maître'], ['Espace', 'actions'],
        ['/equipe', 'équipe d\'agents'], ['/connexions', 'tout connecter'], ['Live', 'vue globale'], ['?', 'aide']];
    const larg = Math.max(...touches.map(([t]) => t.length));
    const deuxCol = int(nG) >= 2 * (larg + 18);
    const lignesTouches: string[] = [];
    for (let i = 0; i < touches.length; i += deuxCol ? 2 : 1) {
        lignesTouches.push(touches.slice(i, i + (deuxCol ? 2 : 1)).map(([t, q]) => completer(`${chalk.hex(theme.secondaire).bold(t.padEnd(larg))} ${chalk.gray(q)}`, Math.floor(int(nG) / (deuxCol ? 2 : 1)))).join(''));
    }
    const gauche = [
        ...(hAFaire ? panneau('À FAIRE', items.length ? `${items.length}` : '', lignesAFaire, nG, hAFaire) : []),
        ...(hSorties ? panneau('DERNIÈRES SORTIES', journal.length ? 'clic : tout voir' : '', sorties.length ? sorties : [chalk.gray('le résultat des commandes s’affiche ici')], nG, hSorties) : []),
        ...(hRaccourcis ? panneau('RACCOURCIS', '', lignesTouches, nG, hRaccourcis) : []),
    ];
    const droite = vD ? panneau('EN DIRECT', `${actifs} au travail`, blocActivite, nD, reste) : [];
    if (deux) lignes.push(...coteACote([gauche, droite]));
    else if (vGauche) lignes.push(...gauche);
    else lignes.push(...droite);
    if (!lignes.length) lignes.push('', chalk.gray('  Tous les panneaux du cockpit sont cachés · Config → Disposition de l’écran pour en remettre'));

    // Clics : une ligne de « À faire » ouvre sa session, le panneau des sorties ouvre le journal
    const debutAFaire = hauteurTuiles + 1;
    const debutSorties = hauteurTuiles + hAFaire;
    const cible = (x: number, y: number) => {
        if (!vGauche || x > nG + 1) return;
        if (y >= debutSorties && y < debutSorties + hSorties) return JOURNAL;
        return cibles[y - debutAFaire];
    };
    return { lignes, cible };
}

// Le dernier cockpit dessiné dit à quelle session correspond un clic (App.tsx le consulte)
let cibleCockpit: ((x: number, y: number) => string | undefined) | undefined;
function useCockpitCibles(f: (x: number, y: number) => string | undefined): void {
    cibleCockpit = f;
    useEffect(() => () => {
        cibleCockpit = undefined;
    }, []);
}
export const sessionAuClic = (x: number, y: number) => cibleCockpit?.(x, y);

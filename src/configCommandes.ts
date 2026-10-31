import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { Commande } from './commandes.js';
import { Config, sauverConfig, CHEMIN_CONFIG, etatRecuperationConfig } from './config.js';
import { diagnostiquerAgents } from './diagnosticAgents.js';
import { CLAUDE } from './claude.js';
import { passerLaMain } from './ui/ecran.js';
import { choisir, saisir, confirmer, tache } from './ui/bus.js';
import { choisirLargeurLaterale } from './ui/mise.js';
import { definirTitre } from './ui/Zones.js';
import { jetonsConfigures } from './jetons.js';
import { PALETTES, appliquerTheme, nomPalette, c } from './theme.js';
import { tableau, titre } from './affichage.js';
import { surPath } from './chemins.js';
import { maintenirInstallation, versionInstallation } from './miseAJour.js';
import { cheminProfilTerminal, migrerProfilTerminal, GUID_PROFIL } from './profilTerminal.js';
import { estDistribution } from './distribution.js';
import { scriptRaccourciWindows } from './lancementsWindows.js';

// Dossier du CLI (dist/ est un niveau sous la racine du projet)
export const RACINE_CLI =path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sortieDe(programme: string, args: string[], delai = 15_000): Promise<{ ok: boolean; sortie: string }> {
    return new Promise((ok) => {
        const proc = spawn(programme, args, { shell: programme === 'claude' });
        let sortie = '';
        proc.stdout?.on('data', (d) => (sortie += d));
        proc.stderr?.on('data', (d) => (sortie += d));
        const minuterie = setTimeout(() => proc.kill(), delai);
        proc.on('error', (e) => ok({ ok: false, sortie: e.message }));
        proc.on('close', (code) => {
            clearTimeout(minuterie);
            ok({ ok: code === 0, sortie: sortie.trim() });
        });
    });
}

export interface CompteClaude {
    connecte: boolean;
    email?: string;
    methode?: string;
}

export async function compteClaude(): Promise<CompteClaude> {
    const res = await sortieDe(CLAUDE, ['auth', 'status']);
    try {
        const j = JSON.parse(res.sortie);
        return { connecte: !!j.loggedIn, email: j.email, methode: j.authMethod };
    } catch {
        return { connecte: false };
    }
}

// Lue dans ~/.gitconfig (deux « git config » synchrones figeaient l'interface ~250 ms) ; git seulement si rien n'y est
export function identiteGit(): { nom: string; email: string } {
    const dans = (texte: string, cle: string) => {
        const section = /^\s*\[user\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/im.exec(texte)?.[1] ?? '';
        return new RegExp(`^\\s*${cle}\\s*=\\s*"?(.*?)"?\\s*$`, 'im').exec(section)?.[1] ?? '';
    };
    const maison = process.env.HOME || os.homedir();
    const texte = [path.join(maison, '.gitconfig'), path.join(process.env.XDG_CONFIG_HOME || path.join(maison, '.config'), 'git', 'config')]
        .map((f) => {
            try {
                return fs.readFileSync(f, 'utf-8');
            } catch {
                return '';
            }
        }).join('\n');
    const id = { nom: dans(texte, 'name'), email: dans(texte, 'email') };
    if (id.nom || id.email) return id;
    const lire = (cle: string) => spawnSync('git', ['config', '--global', cle], { encoding: 'utf-8' }).stdout?.trim() ?? '';
    return { nom: lire('user.name'), email: lire('user.email') };
}

const present = (cmd: string) => !!surPath(cmd);

// ─── Raccourci sur le bureau ─────────────────────────────────────────────────

// Gardé en mémoire : PowerShell met une seconde à démarrer (lu en fond au lancement par prechargerBureau)
let bureauConnu: string | undefined;
const COMMANDE_BUREAU = ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('Desktop')"];

export function bureau(): string {
    if (bureauConnu) return bureauConnu;
    const res = spawnSync('powershell', COMMANDE_BUREAU, { encoding: 'utf-8' });
    return (bureauConnu = res.stdout?.trim() || path.join(os.homedir(), 'Desktop'));
}

export function prechargerBureau(): void {
    let sortie = '';
    const p = spawn('powershell', COMMANDE_BUREAU, { windowsHide: true });
    p.stdout.on('data', (b) => (sortie += b));
    p.on('close', () => (bureauConnu ??= sortie.trim() || undefined));
    p.on('error', () => {});
}

export function cheminRaccourci(): string {
    return path.join(bureau(), 'Agentopia.lnk');
}

// Les anciens lanceurs restent utilisables ; proposer le raccourci au nouveau nom.
const ANCIENS_RACCOURCIS = ['CLI Perso.lnk', 'Claudetopia.lnk'];
// Vérifié à chaque démarrage, sans lancer PowerShell : on regarde les bureaux habituels (local, OneDrive)
export function remplacerAncienRaccourci(): void {
    migrerProfilTerminal();
    const maison = os.homedir();
    let bureaux = [path.join(maison, 'Desktop'), path.join(maison, 'Bureau')];
    try {
        for (const d of fs.readdirSync(maison)) if (d.startsWith('OneDrive')) bureaux.push(path.join(maison, d, 'Desktop'), path.join(maison, d, 'Bureau'));
    } catch {
        // dossier utilisateur illisible
    }
    bureaux = bureaux.filter((b) => ANCIENS_RACCOURCIS.some((nom) => fs.existsSync(path.join(b, nom))) && !fs.existsSync(path.join(b, 'Agentopia.lnk')));
    if (!bureaux.length || !creerRaccourci().ok) return;
}

// Ouvre le CLI dans Windows Terminal si présent (souris, couleurs), sinon dans cmd
export function creerRaccourci(): { ok: boolean; message: string } {
    migrerProfilTerminal();
    const distribution = estDistribution(RACINE_CLI);
    const lanceur = distribution ? path.join(process.env.AGENTOPIA_DISTRIBUTION_ROOT || RACINE_CLI, 'Agentopia.cmd') : path.join(RACINE_CLI, 'Agentopia.bat');
    const wt = surPath('wt');
    // Avec le profil Windows Terminal « Agentopia » (/apparence) : ses couleurs, sa police, sa transparence
    const profil = !distribution && fs.existsSync(cheminProfilTerminal());
    const [cible, args] = wt
        ? [wt, profil ? `-p "${GUID_PROFIL}"` : `-d "${RACINE_CLI}" --title "Agentopia" cmd /k "${lanceur}"`]
        : [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), `/k "${lanceur}"`];
    const script = scriptRaccourciWindows(cheminRaccourci(), cible, args, RACINE_CLI, wt || cible);
    const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8' });
    return res.status === 0 && fs.existsSync(cheminRaccourci())
        ? { ok: true, message: `Raccourci créé : ${cheminRaccourci()}${wt ? ' (ouvre Windows Terminal)' : ''}` }
        : { ok: false, message: (res.stderr || 'échec de la création du raccourci').trim().split('\n')[0] };
}

// ─── Diagnostic ──────────────────────────────────────────────────────────────

type Niveau = 'ok' | 'avert' | 'erreur';
interface Verification {
    niveau: Niveau;
    quoi: string;
    detail: string;
    solution?: string;
}

export async function diagnostic(config: Config): Promise<Verification[]> {
    const v: Verification[] = [];
    const ajouter = (niveau: Niveau, quoi: string, detail: string, solution?: string) => v.push({ niveau, quoi, detail, solution });
    const recuperation = etatRecuperationConfig();
    if (recuperation) ajouter('avert', 'Réglages récupérés', recuperation.message,
        recuperation.copie ? `original conservé : ${recuperation.copie}` : recuperation.sauvegarde ? `sauvegarde : ${recuperation.sauvegarde}` : `vérifie l’accès à ${CHEMIN_CONFIG}`);
    v.push(...await diagnostiquerAgents(config));

    const majeure = Number(process.versions.node.split('.')[0]);
    ajouter(majeure >= 24 ? 'ok' : 'avert', 'Node.js', `${process.version}${majeure >= 24 ? ' (souris active)' : ''}`,
        majeure >= 24 ? undefined : 'la souris demande Node 24 : relance via LancerPrompt.bat (il le télécharge tout seul)');
    ajouter(process.env.WT_SESSION ? 'ok' : 'avert', 'Terminal', process.env.WT_SESSION ? 'Windows Terminal' : 'autre terminal',
        process.env.WT_SESSION ? undefined : 'utilise Windows Terminal (raccourci du bureau) pour la souris et les couleurs');

    const versionClaude = await sortieDe(CLAUDE, ['--version']);
    if (!versionClaude.ok) {
        ajouter('avert', 'Claude CLI (optionnel)', 'absent · utile aux fonctions natives Claude', '/connexions pour l’installer ; /fournisseurs pour les agents intégrés');
    } else {
        const compte = await compteClaude();
        ajouter(compte.connecte ? 'ok' : 'avert', 'Claude CLI (optionnel)', `${versionClaude.sortie.split(' ')[0]} · ${compte.connecte ? `connecté (${compte.email ?? compte.methode})` : 'non connecté'}`,
            compte.connecte ? undefined : 'Configuration › Compte Claude, ou /compte claude');
    }

    if (!present('git')) {
        ajouter('erreur', 'Git', 'introuvable', 'winget install Git.Git');
    } else {
        const id = identiteGit();
        ajouter(id.nom && id.email ? 'ok' : 'avert', 'Git', id.nom && id.email ? `${id.nom} <${id.email}>` : 'identité des commits non configurée',
            id.nom && id.email ? undefined : '/compte git');
    }
    ajouter(present('wt') ? 'ok' : 'avert', 'Windows Terminal', present('wt') ? 'installé' : 'absent', 'winget install Microsoft.WindowsTerminal');
    ajouter(present('code') ? 'ok' : 'avert', 'VS Code', present('code') ? 'installé' : 'absent (boutons VS Code inactifs)', 'winget install Microsoft.VisualStudioCode');
    ajouter(present('rg') ? 'ok' : 'avert', 'ripgrep', present('rg') ? 'installé' : 'absent (/cherche et l\'usage SSH ne marchent pas)', 'winget install BurntSushi.ripgrep.MSVC');
    if (present('docker')) {
        const info = await sortieDe('docker', ['info', '--format', '{{.ServerVersion}}'], 8000);
        ajouter(info.ok ? 'ok' : 'avert', 'Docker', info.ok ? `moteur ${info.sortie}` : 'installé mais pas démarré', info.ok ? undefined : 'démarre Docker Desktop');
    } else {
        ajouter('avert', 'Docker', 'absent (section Docker vide)', 'optionnel : Docker Desktop');
    }
    ajouter(present('ssh') ? 'ok' : 'avert', 'OpenSSH', present('ssh') ? 'installé' : 'absent', 'Paramètres › Fonctionnalités facultatives › Client OpenSSH');

    const manquantes = [...config.racines, ...config.extras].filter((r) => !fs.existsSync(r));
    ajouter(manquantes.length ? 'avert' : 'ok', 'Projets', manquantes.length ? `${manquantes.length} dossier(s) introuvable(s) : ${manquantes.slice(0, 2).join(', ')}` : `${config.racines.length} dossier(s) + ${config.extras.length} projet(s) suivis`,
        manquantes.length ? '/scan pour refaire la liste' : undefined);
    const jetons = jetonsConfigures();
    ajouter('ok', 'Pull requests', jetons.length ? `jetons : ${jetons.join(', ')}` : 'aucun jeton (pages web seulement)');
    ajouter(fs.existsSync(cheminRaccourci()) ? 'ok' : 'avert', 'Raccourci bureau', fs.existsSync(cheminRaccourci()) ? 'présent' : 'absent', '/raccourci');
    return v;
}

export function afficherDiagnostic(v: Verification[]): void {
    const symbole = { ok: c.succes('✓'), avert: c.alerte('!'), erreur: c.erreur('✗') };
    console.log(titre('Diagnostic'));
    console.log(tableau(v.map((x) => [symbole[x.niveau], x.quoi, x.niveau === 'ok' ? c.discret(x.detail) : x.detail, x.solution && x.niveau !== 'ok' ? c.accent(`→ ${x.solution}`) : '']), { max: [1, 18, 52] }));
    const erreurs = v.filter((x) => x.niveau === 'erreur').length;
    const avert = v.filter((x) => x.niveau === 'avert').length;
    console.log('\n' + (erreurs ? c.erreur(`✗ ${erreurs} problème(s) bloquant(s) à corriger`) : avert ? c.alerte(`! ${avert} point(s) à améliorer, rien de bloquant`) : c.succes('✓ Tout est en ordre')));
}

// ─── Commandes ───────────────────────────────────────────────────────────────

export function commandesConfig(config: Config): Commande[] {
    return [
        {
            nom: 'compte', args: 'github|claude|git', groupe: 'Config',
            description: 'Choisir un compte GitHub local, Claude CLI ou l’identité des commits',
            executer: async ({ args }) => {
                const quoi = args[0] ?? await choisir('Quel compte ?', [{ label: 'GitHub', valeur: 'github' }, { label: 'Claude', valeur: 'claude' }, { label: 'Git (identité des commits)', valeur: 'git' }], false);
                if (quoi === 'github') {
                    const { choisirCompteGitHub } = await import('./compteGitHubCommande.js');
                    if (await choisirCompteGitHub(config) === 'jeton') {
                        const { commandesConnexions } = await import('./connexionsCommandes.js');
                        await commandesConnexions(config).find(c => c.nom === 'connecter')!.executer({ args: ['github', '--jeton'], reste: '', apresProjet: '' });
                    }
                    return;
                }
                if (quoi === 'git') {
                    const id = identiteGit();
                    const nom = await saisir('Nom pour les commits', id.nom);
                    const email = await saisir('Courriel pour les commits', id.email);
                    spawnSync('git', ['config', '--global', 'user.name', nom]);
                    spawnSync('git', ['config', '--global', 'user.email', email]);
                    return console.log(c.succes(`Identité git : ${nom} <${email}>`));
                }
                const compte = await tache('Lecture du compte Claude', compteClaude);
                const action = await choisir(compte.connecte ? `Claude : ${compte.email ?? compte.methode}` : 'Claude : non connecté', [
                    { label: compte.connecte ? '⇄ Se connecter avec un autre compte' : '⚿ Se connecter', valeur: 'login' },
                    ...(compte.connecte ? [{ label: '✕ Se déconnecter', valeur: 'logout' }] : []),
                ], false);
                if (action === 'logout') {
                    if (!await confirmer('Se déconnecter de Claude ? Les sessions ne pourront plus démarrer.')) return;
                    await sortieDe(CLAUDE, ['auth', 'logout']);
                } else {
                    // La connexion ouvre le navigateur et attend dans le terminal : on lui passe la main
                    await passerLaMain(CLAUDE, ['auth', 'login']);
                }
                const apres = await compteClaude();
                console.log(apres.connecte ? c.succes(`Claude : connecté (${apres.email ?? apres.methode})`) : c.alerte('Claude : non connecté'));
            },
        },
        {
            nom: 'theme', args: '[nom]', groupe: 'Config',
            description: 'Couleurs de l\'interface',
            executer: async ({ reste }) => {
                const nom = PALETTES[reste] ? reste : await choisir(`Thème (actuel : ${nomPalette()})`, Object.entries(PALETTES).map(([n, p]) => ({
                    label: n, valeur: n, description: `${p.primaire} · ${p.secondaire} · ${p.accent}`,
                })), false);
                appliquerTheme(PALETTES[nom]);
                config.theme = { ...PALETTES[nom] };
                sauverConfig(config);
                console.log(c.succes(`Thème ${nom} appliqué`));
            },
        },
        {
            nom: 'prenom', args: '[prénom]', groupe: 'Config',
            description: 'Prénom affiché en haut à droite',
            executer: async ({ reste }) => {
                config.prenom = reste || await saisir('Ton prénom', config.prenom);
                sauverConfig(config);
                console.log(c.succes(`Bonjour ${config.prenom}`));
            },
        },
        {
            nom: 'nom', args: '[texte]', groupe: 'Config',
            description: 'Nom affiché en haut à gauche (ex. MON ÉQUIPE)',
            executer: async ({ reste }) => {
                config.banniere = reste || await saisir('Nom affiché en haut à gauche', config.banniere);
                sauverConfig(config);
                definirTitre(config.banniere);
                console.log(c.succes(`Titre : ${config.banniere.toUpperCase()}`));
            },
        },
        {
            nom: 'largeur', args: '[auto|nombre]', groupe: 'Config',
            description: 'Largeur de la colonne de gauche (ou glisse la ligne, ou Alt+←/→)',
            executer: async ({ args }) => {
                const valeur = args[0] ?? await choisir('Largeur de la colonne de gauche', [
                    { label: 'Automatique (un tiers de l\'écran)', valeur: 'auto' },
                    { label: 'Étroite (32)', valeur: '32' }, { label: 'Moyenne (42)', valeur: '42' },
                    { label: 'Large (54)', valeur: '54' }, { label: 'Très large (66)', valeur: '66' },
                ], false);
                config.largeurLaterale = valeur === 'auto' ? 0 : Math.max(28, Number(valeur) || 0);
                sauverConfig(config);
                choisirLargeurLaterale(config.largeurLaterale);
                console.log(c.succes(`Colonne de gauche : ${config.largeurLaterale || 'automatique'}`));
            },
        },
        {
            nom: 'diagnostic', alias: ['doctor', 'verifier'], groupe: 'Config',
            description: 'Vérifie que tout est en place et dit quoi corriger',
            executer: async () => afficherDiagnostic(await tache('Vérification du poste', () => diagnostic(config))),
        },
        {
            nom: 'raccourci', groupe: 'Config',
            description: 'Créer le raccourci « Agentopia » sur le bureau',
            executer: () => {
                const res = creerRaccourci();
                console.log(res.ok ? c.succes(res.message) : c.erreur(`✗ ${res.message}`));
            },
        },
        {
            nom: 'installation', groupe: 'Config',
            description: 'La ligne à copier pour installer Agentopia sur un autre poste',
            executer: () => {
                console.log('Téléchargement Windows : https://github.com/SamChampagne/ClaudeTopia/releases');
                if (estDistribution(RACINE_CLI)) {
                    console.log('Partager Agentopia-Setup.exe : il contient les moteurs et ouvre la préparation guidée. Les réglages et clés personnelles ne font pas partie du paquet.');
                    console.log('Versions publiées : https://github.com/SamChampagne/ClaudeTopia/releases');
                    return;
                }
                const depot = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: RACINE_CLI, encoding: 'utf-8' }).stdout?.trim();
                if (!depot) {
                    console.log(c.alerte('Agentopia n\'est pas encore sur un dépôt git distant (git remote origin).'));
                    console.log(c.discret('Une fois poussé, cette commande affiche la ligne exacte à partager.'));
                    return;
                }
                const branche = spawnSync('git', ['branch', '--show-current'], { cwd: RACINE_CLI, encoding: 'utf-8' }).stdout?.trim();
                const optionBranche = branche && /^[\w./-]+$/.test(branche) ? ` --branch ${branche}` : '';
                const ligne = `git clone${optionBranche} ${depot} "$HOME\\Agentopia"; & "$HOME\\Agentopia\\Installer.bat"`;
                console.log(titre('Installer Agentopia sur un autre poste'));
                console.log('Dans PowerShell, une seule ligne :\n');
                console.log(c.accent(ligne));
                console.log(c.discret('\nL’installateur prépare le logiciel et son raccourci. Agentopia scanne ensuite les projets et guide la connexion des agents que tu choisis.'));
            },
        },
        {
            nom: 'maj', alias: ['mise-a-jour'], groupe: 'Config',
            description: 'Mettre à jour et vérifier le logiciel et son interface',
            executer: async () => {
                await maintenirInstallation(RACINE_CLI, false, { etape: tache });
                console.log(c.succes('✓ Vérification terminée · si une version a été installée, ferme et relance Agentopia.'));
            },
        },
        {
            nom: 'reparer', groupe: 'Config', description: 'Restaurer la version installée en conservant les données ; recompiler en mode sources',
            executer: async () => {
                await maintenirInstallation(RACINE_CLI, true, { etape: tache });
                console.log(c.succes('✓ Réparation terminée · ferme et relance le logiciel.'));
            },
        },
        { nom: 'version', groupe: 'Config', description: 'Version, branche, révision et dernière vérification de cette installation',
            executer: async () => console.log(await versionInstallation(RACINE_CLI)) },
        { nom: 'retour-version', groupe: 'Config', description: 'Revenir à la version Windows précédente, en conservant les données',
            executer: async () => { const { revenirVersion } = await import('./distribution.js'); await revenirVersion(RACINE_CLI); } },
        {
            nom: 'fichier-config', groupe: 'Config', cache: true,
            description: 'Ouvrir le fichier de configuration',
            executer: () => {
                spawn('code', [CHEMIN_CONFIG], { shell: true, detached: true, stdio: 'ignore' }).unref();
            },
        },
    ];
}

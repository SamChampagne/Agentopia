import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Fichiers d’Agentopia dans le dossier utilisateur. Les chemins historiques
// .claudetopia* restent stables pour conserver réglages, clés et conversations.
// L'ancien nom (CLI Perso) utilisait ~/.cli-perso* : ils sont renommés au premier lancement.

export const NOM = 'Agentopia';
export function nomBanniere(valeur?: string): string {
    return !valeur || /^(claudetopia|cli perso)$/i.test(valeur.trim()) ? NOM.toUpperCase() : valeur;
}

const fichier = (suffixe: string) => process.env.CLAUDETOPIA_DATA_DIR
    ? path.join(process.env.CLAUDETOPIA_DATA_DIR, `claudetopia${suffixe}`)
    : path.join(os.homedir(), `.claudetopia${suffixe}`);

export const CHEMINS = {
    config: fichier('.json'),
    historique: fichier('-historique'),
    jetons: fichier('-jetons.json'),
    node24: fichier('-node24'),
    ssh: fichier('-ssh.json'),
    trace: fichier('-trace'),
    equipes: fichier('-equipes.json'),
    maitre: fichier('-maitre'),
    sftpEmpreintes: fichier('-sftp-empreintes.json'),
    etat: fichier('-etat.json'),
    brouillons: fichier('-brouillons'),
    preparation: fichier('-preparation.json'),
    historiqueNatif: fichier('-historique-natif.json'),
    planifications: fichier('-planifications.json'),   // dernier lancement de chaque tâche planifiée   // où on en était : conversation ouverte, vue affichée (reprise au lancement)   // empreintes des serveurs SFTP déjà vus          // dossier de travail du maître (ses sessions n'ont pas de carte)
};

const ANCIENS: [string, string][] = [
    ['.cli-perso.json', CHEMINS.config],
    ['.cli-perso-historique', CHEMINS.historique],
    ['.cli-perso-jetons.json', CHEMINS.jetons],
    ['.cli-perso-node24', CHEMINS.node24],
    ['.cli-perso-ssh.json', CHEMINS.ssh],
    ['.cli-perso-trace', CHEMINS.trace],
];

// Renvoie vrai si des fichiers de l'ancien nom ont été repris
export function migrerAnciensFichiers(): boolean {
    if (process.env.CLAUDETOPIA_DATA_DIR) return false;
    let migre = false;
    for (const [ancien, nouveau] of ANCIENS) {
        const source = path.join(os.homedir(), ancien);
        if (!fs.existsSync(source) || fs.existsSync(nouveau)) continue;
        try {
            fs.renameSync(source, nouveau);
            migre = true;
        } catch {
            // fichier verrouillé : on le reprendra au prochain lancement
        }
    }
    if (migre) {
        // Le nom en haut à gauche suivait l'ancien nom du logiciel
        try {
            const config = JSON.parse(fs.readFileSync(CHEMINS.config, 'utf-8'));
            if (/^cli perso$/i.test(config.banniere ?? '')) {
                config.banniere = NOM.toUpperCase();
                fs.writeFileSync(CHEMINS.config, JSON.stringify(config, null, 2), 'utf-8');
            }
        } catch {
            // pas de config : elle sera créée avec le nouveau nom
        }
    }
    return migre;
}

// Fait dès le chargement de ce module : avant toute lecture de la config
export const ANCIENS_REPRIS = migrerAnciensFichiers();

// Programme trouvé dans le PATH, sans lancer « where » (chaque processus fige l'interface quelques ms sous Windows).
// Chaque dossier du PATH est listé une fois (relisté après 30 s : un outil installé entre-temps est vu).
let contenus: { date: number; dossiers: [string, Set<string>][] } | undefined;
export function oublierPath(): void { contenus = undefined; }
const norme = (f: string) => (process.platform === 'win32' ? f.toLowerCase() : f);   // Windows ignore la casse
export function surPath(cmd: string): string | undefined {
    if (!contenus || Date.now() - contenus.date > 30_000) {
        contenus = {
            date: Date.now(),
            dossiers: [...new Set([...(process.env.PATH ?? '').split(path.delimiter),
                ...(process.platform === 'win32' ? [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.bun', 'bin'),
                    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin'),
                    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'),
                    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'),
                    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Git', 'cmd')] : []),
            ])].filter(Boolean).map((d): [string, Set<string>] => {
                try {
                    return [d, new Set(fs.readdirSync(d).map(norme))];
                } catch {
                    return [d, new Set()];
                }
            }),
        };
    }
    // Sous Windows, les extensions exécutables d'abord (« claude » sans extension est un script pour bash)
    const extensions = process.platform === 'win32' ? [...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter(Boolean), ''] : [''];
    for (const [dossier, fichiers] of contenus.dossiers) {
        const e = extensions.find((x) => fichiers.has(norme(cmd + x)));
        if (e !== undefined) {
            // Un outil installé pendant cette session doit aussi être visible des
            // sous-processus qui utilisent son nom (Git notamment), sans redémarrage.
            const actuels = (process.env.PATH ?? '').split(path.delimiter);
            if (!actuels.some((d) => norme(d) === norme(dossier))) process.env.PATH = [...actuels, dossier].filter(Boolean).join(path.delimiter);
            return path.join(dossier, cmd + e);
        }
    }
    return undefined;
}

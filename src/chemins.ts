import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Fichiers de Claudetopia dans le dossier utilisateur.
// L'ancien nom (CLI Perso) utilisait ~/.cli-perso* : ils sont renommés au premier lancement.

export const NOM = 'Claudetopia';

const fichier = (suffixe: string) => path.join(os.homedir(), `.claudetopia${suffixe}`);

export const CHEMINS = {
    config: fichier('.json'),
    historique: fichier('-historique'),
    jetons: fichier('-jetons.json'),
    node24: fichier('-node24'),
    ssh: fichier('-ssh.json'),
    trace: fichier('-trace'),
    equipes: fichier('-equipes.json'),
    maitre: fichier('-maitre'),
    sftpEmpreintes: fichier('-sftp-empreintes.json'),   // empreintes des serveurs SFTP déjà vus          // dossier de travail du maître (ses sessions n'ont pas de carte)
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

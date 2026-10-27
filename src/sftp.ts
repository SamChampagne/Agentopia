import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { Client, SFTPWrapper, ConnectConfig } from 'ssh2';
import { CHEMINS } from './chemins.js';
import { chargerConfig } from './config.js';
import { lireHotes, DOSSIER_SSH } from './sshConfig.js';
import { secret } from './jetons.js';

// Parcourir les fichiers d'un serveur (SFTP) : les serveurs de ~/.ssh/config, et les connexions SFTP
// configurées dans Claudetopia (avec clé ou mot de passe, chiffré par Windows). Bibliothèque ssh2 :
// pas de programme externe, et le mot de passe n'apparaît jamais dans une ligne de commande.

export interface ConnexionSftp {
    nom: string;
    hote: string;
    port: number;
    utilisateur: string;
    auth: 'cle' | 'motdepasse';
    cle?: string;
    dossier?: string;         // dossier ouvert au départ
}

export interface Entree {
    nom: string;
    dossier: boolean;
    lien: boolean;
    taille: number;
    date: Date;
}

export const cleSecret = (nom: string) => `sftp:${nom}`;

// Les connexions SFTP de la config + les serveurs SSH (par clé)
export function ciblesSftp(): ConnexionSftp[] {
    const config = chargerConfig().sftp ?? [];
    const ssh = lireHotes().filter((h) => !config.some((c) => c.nom === h.alias)).map((h): ConnexionSftp => ({
        nom: h.alias, hote: h.hote, port: h.port ?? 22, utilisateur: h.utilisateur ?? os.userInfo().username, auth: 'cle', cle: h.cle,
    }));
    return [...config, ...ssh];
}

// ─── Empreintes des serveurs : enregistrées à la 1re connexion, refus si elles changent ───

const FICHIER_EMPREINTES = CHEMINS.sftpEmpreintes;
function empreintes(): Record<string, string> {
    try {
        return JSON.parse(fs.readFileSync(FICHIER_EMPREINTES, 'utf-8'));
    } catch {
        return {};
    }
}

// ─── Connexion ───────────────────────────────────────────────────────────────

function clePrivee(c: ConnexionSftp): Buffer | undefined {
    const candidates = c.cle ? [c.cle.replace(/^~/, os.homedir())] : ['id_ed25519', 'id_ecdsa', 'id_rsa'].map((f) => path.join(DOSSIER_SSH, f));
    const f = candidates.find((x) => fs.existsSync(x));
    return f ? fs.readFileSync(f) : undefined;
}

const AGENT_WINDOWS = '\\\\.\\pipe\\openssh-ssh-agent';

export class Sftp {
    private client = new Client();
    private sftp?: SFTPWrapper;
    nouvelleEmpreinte?: string;     // renseignée si c'est la première connexion à ce serveur

    constructor(readonly cible: ConnexionSftp) {}

    connecter(): Promise<void> {
        const c = this.cible;
        const config: ConnectConfig = { host: c.hote, port: c.port, username: c.utilisateur, readyTimeout: 15_000, keepaliveInterval: 20_000 };
        if (c.auth === 'motdepasse') {
            const mdp = secret(cleSecret(c.nom));
            if (!mdp) return Promise.reject(new Error('mot de passe introuvable : modifie la connexion pour le saisir de nouveau'));
            config.password = mdp;
        } else {
            const cle = clePrivee(c);
            if (cle) config.privateKey = cle;
            if (process.env.SSH_AUTH_SOCK) config.agent = process.env.SSH_AUTH_SOCK;
            else if (process.platform === 'win32' && fs.existsSync(AGENT_WINDOWS)) config.agent = AGENT_WINDOWS;
            if (!cle && !config.agent) return Promise.reject(new Error('aucune clé SSH trouvée : « ⚿ Installer ma clé » dans la vue SSH, ou une connexion par mot de passe'));
        }
        const id = `${c.hote}:${c.port}`;
        const connues = empreintes();
        let refusee = '';
        config.hostVerifier = (cle: Buffer) => {
            const empreinte = 'SHA256:' + createHash('sha256').update(cle).digest('base64').replace(/=+$/, '');
            if (!connues[id]) {
                this.nouvelleEmpreinte = empreinte;
                connues[id] = empreinte;
                fs.writeFileSync(FICHIER_EMPREINTES, JSON.stringify(connues, null, 2), 'utf-8');
                return true;
            }
            if (connues[id] === empreinte) return true;
            refusee = `l'empreinte de ${id} a changé (${empreinte} au lieu de ${connues[id]}) : connexion refusée par sécurité. `
                + `Si le serveur a été réinstallé, retire-le de ${FICHIER_EMPREINTES}.`;
            return false;
        };
        return new Promise((ok, ko) => {
            this.client
                .on('ready', () => this.client.sftp((err, sftp) => (err ? ko(err) : ((this.sftp = sftp), ok()))))
                .on('error', (e) => ko(refusee ? new Error(refusee) : traduire(e)))
                .connect(config);
        });
    }

    private get s(): SFTPWrapper {
        if (!this.sftp) throw new Error('pas connecté');
        return this.sftp;
    }

    reel(chemin: string): Promise<string> {
        return new Promise((ok, ko) => this.s.realpath(chemin, (e, p) => (e ? ko(e) : ok(p))));
    }

    lister(dossier: string): Promise<Entree[]> {
        return new Promise((ok, ko) => this.s.readdir(dossier, (e, liste) => {
            if (e) return ko(traduire(e));
            ok(liste.map((f) => ({
                nom: f.filename,
                dossier: f.attrs.isDirectory(),
                lien: f.attrs.isSymbolicLink(),
                taille: f.attrs.size,
                date: new Date(f.attrs.mtime * 1000),
            })).sort((a, b) => Number(b.dossier) - Number(a.dossier) || a.nom.localeCompare(b.nom)));
        }));
    }

    estDossier(chemin: string): Promise<boolean> {
        return new Promise((ok) => this.s.stat(chemin, (e, st) => ok(!e && st.isDirectory())));
    }

    telecharger(distant: string, local: string): Promise<void> {
        fs.mkdirSync(path.dirname(local), { recursive: true });
        return new Promise((ok, ko) => this.s.fastGet(distant, local, (e) => (e ? ko(traduire(e)) : ok())));
    }

    envoyer(local: string, distant: string): Promise<void> {
        return new Promise((ok, ko) => this.s.fastPut(local, distant, (e) => (e ? ko(traduire(e)) : ok())));
    }

    creerDossier(chemin: string): Promise<void> {
        return new Promise((ok, ko) => this.s.mkdir(chemin, (e) => (e ? ko(traduire(e)) : ok())));
    }

    supprimer(chemin: string, dossier: boolean): Promise<void> {
        return new Promise((ok, ko) => (dossier ? this.s.rmdir(chemin, (e) => (e ? ko(traduire(e)) : ok())) : this.s.unlink(chemin, (e) => (e ? ko(traduire(e)) : ok()))));
    }

    fermer(): void {
        this.client.end();
    }
}

// Messages d'erreur ssh2 en français clair
function traduire(e: Error & { code?: string | number; level?: string }): Error {
    const m = e.message || String(e);
    if (e.level === 'client-authentication' || /authentication/i.test(m)) return new Error('identifiant, mot de passe ou clé refusé par le serveur');
    if (e.code === 'ENOTFOUND') return new Error('adresse du serveur introuvable');
    if (e.code === 'ECONNREFUSED') return new Error('le serveur refuse la connexion (port fermé ?)');
    if (e.code === 'ETIMEDOUT' || /timed out/i.test(m)) return new Error('le serveur ne répond pas (réseau, VPN ?)');
    if (e.code === 2 || /no such file/i.test(m)) return new Error('fichier ou dossier introuvable');
    if (e.code === 3 || /permission denied/i.test(m)) return new Error('permission refusée');
    if (/encrypted|passphrase/i.test(m)) return new Error('la clé est protégée par une phrase secrète : ajoute-la à l\'agent SSH (ssh-add) puis réessaie');
    return new Error(m);
}

export const dossierTemporaire = (nom: string) => path.join(os.tmpdir(), 'claudetopia-sftp', nom.replace(/[^\w.-]/g, '_'));

export function tailleLisible(n: number): string {
    if (n < 1024) return `${n} o`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
    return `${(n / 1024 ** 3).toFixed(1)} Go`;
}

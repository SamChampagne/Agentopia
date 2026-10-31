import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { pipeline } from 'node:stream/promises';
import { Client, SFTPWrapper, ConnectConfig } from 'ssh2';
import { CHEMINS } from './chemins.js';
import { chargerConfig } from './config.js';
import { lireHotes, DOSSIER_SSH } from './sshConfig.js';
import { secret } from './jetons.js';
import { empreinteSftp, verifierEmpreinteSftp, nomFichierSftp } from './confianceSftp.js';

// Parcourir les fichiers d'un serveur (SFTP) : les serveurs de ~/.ssh/config, et les connexions SFTP
// configurées dans Agentopia (avec clé ou mot de passe, chiffré par Windows). Bibliothèque ssh2 :
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

// ─── Empreintes des serveurs : accord explicite à la première connexion, refus si elles changent ───

const FICHIER_EMPREINTES = CHEMINS.sftpEmpreintes;
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

    constructor(readonly cible: ConnexionSftp, private services = { lireSecret: secret, fichierEmpreintes: FICHIER_EMPREINTES }) {}

    connecter(options: { empreinteAcceptee?: string } = {}): Promise<void> {
        const c = this.cible;
        const config: ConnectConfig = { host: c.hote, port: c.port, username: c.utilisateur, readyTimeout: 15_000, keepaliveInterval: 20_000 };
        if (c.auth === 'motdepasse') {
            const mdp = this.services.lireSecret(cleSecret(c.nom));
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
        let refusee: Error | undefined;
        config.hostVerifier = (cle: Buffer) => {
            try {
                const empreinte = empreinteSftp(cle);
                if (verifierEmpreinteSftp(this.services.fichierEmpreintes, id, empreinte, options.empreinteAcceptee)) this.nouvelleEmpreinte = empreinte;
                return true;
            } catch (e) { refusee = e as Error; return false; }
        };
        return new Promise((ok, ko) => {
            this.client
                .on('ready', () => this.client.sftp((err, sftp) => { if (err) { this.fermer(); ko(err); } else { this.sftp = sftp; ok(); } }))
                .on('error', (e) => { this.fermer(); ko(refusee ?? traduire(e)); })
                .once('close', () => ko(new Error('Connexion SFTP fermée avant sa préparation.')))
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
            try { ok(liste.filter((f) => f.filename !== '.' && f.filename !== '..').map((f) => ({
                nom: nomFichierSftp(f.filename),
                dossier: f.attrs.isDirectory(),
                lien: f.attrs.isSymbolicLink(),
                taille: f.attrs.size,
                date: new Date(f.attrs.mtime * 1000),
            })).sort((a, b) => Number(b.dossier) - Number(a.dossier) || a.nom.localeCompare(b.nom))); }
            catch (e) { ko(e); }
        }));
    }

    estDossier(chemin: string): Promise<boolean> {
        return new Promise((ok) => this.s.stat(chemin, (e, st) => ok(!e && st.isDirectory())));
    }

    async telecharger(distant: string, local: string): Promise<void> {
        const sftp = this.s;
        nomFichierSftp(path.basename(local));
        fs.mkdirSync(path.dirname(local), { recursive: true });
        let fd: number;
        try { fd = fs.openSync(local, 'wx', 0o600); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Un fichier existe déjà à cet emplacement. Il est conservé ; renomme-le ou déplace-le avant de télécharger.'); throw e; }
        const identite = fs.fstatSync(fd);
        const sortie = fs.createWriteStream(local, { fd, autoClose: true });
        try { await pipeline(sftp.createReadStream(distant), sortie); }
        catch (e) {
            sortie.destroy();
            // Ne retirer que le fichier créé par ce transfert, jamais un remplacement tiers.
            try { const st = fs.lstatSync(local); if (!st.isSymbolicLink() && st.ino === identite.ino && st.dev === identite.dev) fs.unlinkSync(local); } catch { /* Une erreur de nettoyage ne masque pas celle du transfert. */ }
            throw traduire(e as Error);
        }
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

export const dossierTemporaire = (nom: string) => path.join(os.tmpdir(), 'claudetopia-sftp', createHash('sha256').update(nom).digest('hex'));
export function cheminCopieSftp(nom: string, distant: string): string {
    // Une copie propre par ouverture : un chemin distant ne devient jamais un chemin local.
    return path.join(dossierTemporaire(nom), randomUUID(), nomFichierSftp(path.posix.basename(distant)));
}

export function tailleLisible(n: number): string {
    if (n < 1024) return `${n} o`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
    return `${(n / 1024 ** 3).toFixed(1)} Go`;
}

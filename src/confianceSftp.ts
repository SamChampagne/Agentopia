import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ecrireAtomique } from './stockageAtomique.js';
import { sousVerrou } from './verrou.js';

export class EmpreinteSftpInconnue extends Error {
    readonly name = 'EmpreinteSftpInconnue';
    constructor(readonly serveur: string, readonly empreinte: string) {
        super(`Serveur inconnu : ${serveur}. Vérifie son empreinte auprès de son administrateur avant de te connecter.`);
    }
}
export const empreinteSftp = (cle: Buffer) => 'SHA256:' + createHash('sha256').update(cle).digest('base64').replace(/=+$/, '');

function lire(fichier: string): Record<string, string> {
    try {
        const st = fs.lstatSync(fichier);
        if (!st.isFile() || st.isSymbolicLink() || st.size > 256 * 1024) throw new Error('format ou taille refusé');
        const p: unknown = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        if (!p || typeof p !== 'object' || Array.isArray(p)
            || Object.entries(p).some(([k, v]) => !k || k.length > 1024 || typeof v !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(v))) throw new Error('format invalide');
        return p as Record<string, string>;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw new Error(`Le fichier des empreintes SFTP est illisible ou invalide : ${fichier}. Il est conservé ; répare-le avant de te connecter.`);
    }
}

/** Une clé inconnue est refusée avant authentification ; l'accord porte sur la clé exacte. */
export function verifierEmpreinteSftp(fichier: string, serveur: string, empreinte: string, acceptee?: string): boolean {
    const verifier = (connues: Record<string, string>) => {
        const connue = Object.hasOwn(connues, serveur) ? connues[serveur] : undefined;
        if (connue && connue !== empreinte) throw new Error(`L’empreinte de ${serveur} a changé (${empreinte} au lieu de ${connue}). Connexion refusée ; vérifie le serveur avant toute modification du fichier ${fichier}.`);
        if (connue) return true;
        if (acceptee === undefined) throw new EmpreinteSftpInconnue(serveur, empreinte);
        if (acceptee !== empreinte) throw new Error(`L’empreinte de ${serveur} a changé depuis ta confirmation. Connexion refusée.`);
        return false;
    };
    if (verifier(lire(fichier))) return false;
    fs.mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
    return sousVerrou(`${fichier}.verrou`, () => {
        const connues = lire(fichier);
        if (verifier(connues)) return false;
        ecrireAtomique(fichier, { ...connues, [serveur]: empreinte });
        return true;
    });
}

export function nomFichierSftp(nom: string): string {
    const base = nom.split('.')[0].replace(/[ .]+$/, '');
    if (!nom || nom === '.' || nom === '..' || /[\\/:\x00-\x1f\x7f<>"|?*]/.test(nom)
        || /[. ]$/.test(nom) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(base))
        throw new Error('Nom de fichier distant incompatible ou dangereux sur ce poste. Aucun fichier local créé.');
    return nom;
}

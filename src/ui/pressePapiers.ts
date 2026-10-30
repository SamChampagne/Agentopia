import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { randomUUID } from 'node:crypto';

const DOSSIER = path.join(os.tmpdir(), 'claudetopia-images');

// Alt+V : enregistre l'image du presse-papiers (capture d'écran, ou fichier image copié) en PNG
// et renvoie son chemin. Windows.Forms exige un thread STA, d'où powershell -STA.
export async function imageDuPressePapiers(options: {
    signal?: AbortSignal;
    dossier?: string;
    executer?: (args: string[], signal?: AbortSignal) => Promise<string>;
} = {}): Promise<string | undefined> {
    const dossier = options.dossier ?? DOSSIER;
    await fs.promises.mkdir(dossier, { recursive: true });
    const cible = path.join(dossier, `image-${randomUUID()}.png`);
    const script = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$img = [Windows.Forms.Clipboard]::GetImage()
if ($img) { $img.Save('${cible.replace(/'/g, "''")}', [Drawing.Imaging.ImageFormat]::Png); 'ok'; exit }
$f = [Windows.Forms.Clipboard]::GetFileDropList() | Where-Object { $_ -match '\\.(png|jpe?g|gif|webp|bmp)$' } | Select-Object -First 1
if ($f) { "fichier:$f" }`;
    const executer = options.executer ?? ((args: string[], signal?: AbortSignal) => new Promise<string>((ok, ko) => {
        execFile('powershell', args, { encoding: 'utf-8', timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024, signal }, (erreur, stdout) => {
            if (erreur) ko(new Error(erreur.killed ? 'Le presse-papiers ne répond pas. Réessaie Alt+V.' : 'Impossible de lire le presse-papiers Windows. Réessaie Alt+V.'));
            else ok(stdout);
        });
    }));
    const sortie = (await executer(['-STA', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], options.signal)).trim();
    if (sortie === 'ok') return cible;
    if (sortie.startsWith('fichier:')) return sortie.slice(8);
    return undefined;
}

// Remplace les jetons [image N] d'un texte par une consigne que Claude sait suivre (outil Read)
export const EST_IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;

// Pièces jointes (images collées avec Alt+V, fichiers glissés dans la fenêtre) : listées à la fin du message
export function joindreImages(texte: string, pieces: string[]): string {
    if (!pieces.length) return texte;
    const liste = pieces.map((p, i) => `[${EST_IMAGE.test(p) ? 'image' : 'fichier'} ${i + 1}] : ${p}`).join('\n');
    return `${texte}\n\nPièces jointes (lis-les avec l'outil Read) :\n${liste}`;
}

// Un fichier glissé dans Windows Terminal arrive comme son chemin collé (entre guillemets s'il a des espaces).
// Renvoie les fichiers si TOUT le texte collé est une liste de fichiers existants.
export function fichiersDeposes(colle: string): string[] | undefined {
    const morceaux = [...colle.trim().matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
    if (!morceaux.length || !morceaux.every((p) => /^([A-Za-z]:\\|\\\\)/.test(p))) return undefined;
    try {
        return morceaux.every((p) => fs.statSync(p).isFile()) ? morceaux : undefined;
    } catch {
        return undefined;
    }
}

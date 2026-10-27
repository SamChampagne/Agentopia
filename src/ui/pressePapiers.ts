import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const DOSSIER = path.join(os.tmpdir(), 'claudetopia-images');

// Alt+V : enregistre l'image du presse-papiers (capture d'écran, ou fichier image copié) en PNG
// et renvoie son chemin. Windows.Forms exige un thread STA, d'où powershell -STA.
export function imageDuPressePapiers(): string | undefined {
    fs.mkdirSync(DOSSIER, { recursive: true });
    const cible = path.join(DOSSIER, `image-${Date.now()}.png`);
    const script = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$img = [Windows.Forms.Clipboard]::GetImage()
if ($img) { $img.Save('${cible}', [Drawing.Imaging.ImageFormat]::Png); 'ok'; exit }
$f = [Windows.Forms.Clipboard]::GetFileDropList() | Where-Object { $_ -match '\\.(png|jpe?g|gif|webp|bmp)$' } | Select-Object -First 1
if ($f) { "fichier:$f" }`;
    const res = spawnSync('powershell', ['-STA', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf-8', timeout: 10_000 });
    const sortie = (res.stdout ?? '').trim();
    if (sortie === 'ok') return cible;
    if (sortie.startsWith('fichier:')) return sortie.slice(8);
    return undefined;
}

// Remplace les jetons [image N] d'un texte par une consigne que Claude sait suivre (outil Read)
export function joindreImages(texte: string, images: string[]): string {
    if (!images.length) return texte;
    const nettoye = texte.replace(/\[image (\d+)\]/g, (_, n) => `[image ${n}]`);
    const liste = images.map((p, i) => `[image ${i + 1}] : ${p}`).join('\n');
    return `${nettoye}\n\nImages jointes (lis-les avec l'outil Read) :\n${liste}`;
}

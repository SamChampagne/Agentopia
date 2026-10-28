import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { couleurProjet } from './theme.js';
import { surPath } from './chemins.js';

// PowerShell 7 si dispo, sinon Windows PowerShell
const SHELL = surPath('pwsh') ? 'pwsh' : 'powershell';

// -EncodedCommand évite tous les problèmes de guillemets / ; avec wt
function encoder(commande: string): string {
    return Buffer.from(commande, 'utf16le').toString('base64');
}

// Échappe une chaîne pour la mettre entre '...' en PowerShell
export function quotePS(texte: string): string {
    return `'${texte.replace(/'/g, "''")}'`;
}

// Ouvre un nouvel onglet Windows Terminal dans `dossier` et y exécute `commande`
// (couleur d'onglet fixe par projet)
export function ouvrirOnglet(dossier: string, titre: string, commande?: string): void {
    const couleur = couleurProjet(path.basename(dossier));
    const args = ['-w', '0', 'new-tab', '--title', titre, '--tabColor', couleur, '--suppressApplicationTitle',
        '-d', dossier, SHELL, '-NoExit'];
    if (commande) args.push('-EncodedCommand', encoder(commande));
    spawn('wt', args, { detached: true, stdio: 'ignore' }).unref();
}

// Exécute une commande PowerShell et renvoie sa sortie ligne par ligne (l'interface reste affichée)
export function executer(commande: string, dossier: string, surLigne: (ligne: string) => void): Promise<number> {
    return new Promise((ok) => {
        const proc = spawn(SHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoder(commande)], {
            cwd: dossier,
            env: { ...process.env, FORCE_COLOR: '1' },
        });
        const flux = (morceau: Buffer, tampon: { t: string }) => {
            tampon.t += morceau.toString('utf-8');
            const lignes = tampon.t.split(/\r?\n/);
            tampon.t = lignes.pop()!;
            lignes.forEach(surLigne);
        };
        const out = { t: '' }, err = { t: '' };
        proc.stdout.on('data', (d) => flux(d, out));
        proc.stderr.on('data', (d) => flux(d, err));
        proc.on('close', (code) => {
            if (out.t) surLigne(out.t);
            if (err.t) surLigne(err.t);
            ok(code ?? 1);
        });
        proc.stdin.end();
    });
}

// Copie un texte (UTF-8, accents compris) dans le presse-papiers Windows
export function copier(texte: string): void {
    const b64 = Buffer.from(texte, 'utf-8').toString('base64');
    const script = `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`;
    // Sans attendre : PowerShell met près d'une seconde à démarrer, l'interface ne doit pas figer
    spawn(SHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoder(script)], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
}

// Lance un programme GUI sans attendre (code, explorer...)
export function lancerDetache(programme: string, args: string[]): void {
    const argsQuotes = args.map((a) => `"${a}"`);
    spawn(programme, argsQuotes, { detached: true, stdio: 'ignore', shell: true }).unref();
}

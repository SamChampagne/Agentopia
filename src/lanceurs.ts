import * as path from 'path';
import * as fs from 'node:fs';
import { spawn } from 'child_process';
import { couleurProjet } from './theme.js';
import { surPath } from './chemins.js';
import { bus } from './ui/bus.js';
import { citerPowerShell, encoderPowerShell, executableGraphique, invocationNative, invocationTerminal, invocationWeb, type InvocationWindows } from './lancementsWindows.js';

// PowerShell 7 si dispo, sinon Windows PowerShell
const SHELL = surPath('pwsh') || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// -EncodedCommand évite tous les problèmes de guillemets / ; avec wt
const encoder = encoderPowerShell;

// Échappe une chaîne pour la mettre entre '...' en PowerShell
export const quotePS = citerPowerShell;

export function lancerInvocation(invocation: InvocationWindows): void {
    const enfant = spawn(invocation.programme, invocation.args, { ...invocation.options, shell: false, windowsVerbatimArguments: false });
    enfant.once('error', (erreur) => {
        const message = `Ouverture impossible (${path.basename(invocation.programme)}) : ${erreur.message}`;
        if (bus.listenerCount('notice')) bus.emit('notice', message); else console.error(message);
    });
    enfant.unref();
}

// Ouvre un nouvel onglet Windows Terminal dans `dossier` et y exécute `commande`
// (couleur d'onglet fixe par projet) ; nouvelleFenetre : dans une fenêtre à part
export function ouvrirOnglet(dossier: string, titre: string, commande?: string, nouvelleFenetre = false): void {
    const couleur = couleurProjet(path.basename(dossier));
    const args = ['-NoExit'];
    if (commande) args.push('-EncodedCommand', encoder(commande));
    lancerInvocation(invocationTerminal(SHELL, args, dossier, titre, { wt: surPath('wt'), couleur, nouvelleFenetre }));
}

// Coupe la fenêtre Windows Terminal en deux et exécute `commande` dans le panneau de droite ;
// hors de Windows Terminal (pas de WT_SESSION), c'est une nouvelle fenêtre. Renvoie false dans ce cas.
export function ouvrirACote(dossier: string, titre: string, commande: string): boolean {
    if (!process.env.WT_SESSION) {
        ouvrirOnglet(dossier, titre, commande, true);
        return false;
    }
    const invocation = invocationTerminal(SHELL, ['-NoExit', '-EncodedCommand', encoder(commande)], dossier, titre,
        { wt: surPath('wt'), couleur: couleurProjet(path.basename(dossier)), aCote: true });
    lancerInvocation(invocation);
    return !!invocation.aCote;
}

// Exécute une commande PowerShell et renvoie sa sortie ligne par ligne (l'interface reste affichée)
export function executer(commande: string, dossier: string, surLigne: (ligne: string) => void): Promise<number> {
    return new Promise((ok) => {
        const proc = spawn(SHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoder(commande)], {
            cwd: dossier,
            env: { ...process.env, FORCE_COLOR: '1' },
            windowsHide: true, shell: false,
        });
        proc.once('error', (erreur) => { surLigne(`Impossible de lancer PowerShell : ${erreur.message}`); ok(127); });
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
    // Compatibilité avec les anciens appels d'ouverture web, sans exécuter « start ».
    if (programme.toLowerCase() === 'start') {
        if (args.length !== 2 || args[0] !== '') throw new Error('Utilise une adresse web unique pour ouvrir le navigateur.');
        return ouvrirUrlWeb(args[1]);
    }
    const invocation = invocationNative(executableGraphique(programme, surPath, fs.existsSync), args);
    if (/^Code\.exe$/i.test(path.basename(invocation.programme))) {
        // Un parent Electron peut laisser ce mode activé : ouvrir un fichier
        // dans l'éditeur ne doit jamais démarrer Code.exe comme interpréteur Node.
        invocation.options.env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined, VSCODE_DEV: undefined };
    }
    lancerInvocation(invocation);
}

export function ouvrirUrlWeb(adresse: string): void { lancerInvocation(invocationWeb(adresse, SHELL)); }

// Fenêtre interactive demandée par l'utilisateur (installation d'un outil).
export function ouvrirFenetrePowerShell(script: string): void {
    lancerInvocation(invocationNative(SHELL, ['-NoExit', '-NoProfile', '-EncodedCommand', encoder(script)], undefined, true));
}

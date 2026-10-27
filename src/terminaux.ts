import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { couleurProjet } from './theme.js';

// Terminaux qu'on peut ouvrir dans un dossier : PowerShell, cmd, Git Bash, WSL…
// Dans un nouvel onglet Windows Terminal si présent, sinon dans une nouvelle fenêtre.

export interface Terminal {
    cle: string;
    nom: string;
    exe: string;
    args: (dossier: string) => string[];
}

const existe = (p: string | undefined): p is string => !!p && fs.existsSync(p);
const trouver = (cmd: string) => spawnSync('where', [cmd], { encoding: 'utf-8' }).stdout?.split(/\r?\n/)[0]?.trim() || undefined;
const PROGRAMMES = process.env.ProgramFiles ?? 'C:\\Program Files';

let connus: Terminal[] | undefined;
let wt: string | undefined | null = null;

// Détectés une fois (where est lent) puis gardés
export function terminaux(): Terminal[] {
    if (connus) return connus;
    const liste: Terminal[] = [];
    const pwsh = [path.join(PROGRAMMES, 'PowerShell', '7', 'pwsh.exe')].find(existe) ?? trouver('pwsh');
    if (pwsh) liste.push({ cle: 'pwsh', nom: 'PowerShell 7', exe: pwsh, args: () => ['-NoLogo'] });
    liste.push({ cle: 'powershell', nom: pwsh ? 'Windows PowerShell 5' : 'PowerShell', exe: 'powershell.exe', args: () => ['-NoLogo'] });
    liste.push({ cle: 'cmd', nom: 'Invite de commandes (cmd)', exe: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), args: () => [] });
    const git = trouver('git');
    const bash = [path.join(PROGRAMMES, 'Git', 'bin', 'bash.exe'), git && path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe')].find(existe);
    if (bash) liste.push({ cle: 'bash', nom: 'Git Bash', exe: bash, args: () => ['--login', '-i'] });
    const wsl = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
    if (existe(wsl)) liste.push({ cle: 'wsl', nom: 'WSL (Linux)', exe: wsl, args: (dossier) => ['--cd', dossier] });
    connus = liste;
    return liste;
}

export function terminal(cle: string): Terminal | undefined {
    const c = cle.toLowerCase();
    return terminaux().find((t) => t.cle === c || (c === 'ps' && t.cle === 'powershell') || (c === 'gitbash' && t.cle === 'bash'));
}

export function ouvrirTerminal(t: Terminal, dossier: string): void {
    if (wt === null) wt = trouver('wt');
    if (wt) {
        const args = ['-w', '0', 'new-tab', '--title', `${t.nom.split(' ')[0]} · ${path.basename(dossier)}`,
            '--tabColor', couleurProjet(path.basename(dossier)), '-d', dossier, t.exe, ...t.args(dossier)];
        spawn(wt, args, { detached: true, stdio: 'ignore' }).unref();
        return;
    }
    // Sans Windows Terminal : une nouvelle fenêtre
    spawn('cmd.exe', ['/c', 'start', '""', '/D', dossier, t.exe, ...t.args(dossier)], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
}

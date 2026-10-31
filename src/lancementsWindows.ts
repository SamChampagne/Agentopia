import * as path from 'node:path';
import type { SpawnOptions } from 'node:child_process';

export interface InvocationWindows { programme: string; args: string[]; options: SpawnOptions; aCote?: boolean }
export const encoderPowerShell = (script: string): string => Buffer.from(script, 'utf16le').toString('base64');
// PowerShell reconnaît également les quatre apostrophes typographiques comme
// délimiteurs. Doubler chacune conserve le texte et empêche de sortir du littéral.
export const citerPowerShell = (texte: string): string => `'${texte.replace(/['\u2018-\u201b]/g, (c) => c + c)}'`;
function argumentValide(texte: string): void {
    if (typeof texte !== 'string' || /[\0\r\n]/.test(texte)) throw new Error('Un chemin ou argument contient un caractère interdit.');
}
export function invocationNative(programme: string, args: string[], dossier?: string, visible = false): InvocationWindows {
    argumentValide(programme); args.forEach(argumentValide); if (dossier !== undefined) argumentValide(dossier);
    if (!programme || /\.(cmd|bat)$/i.test(programme)) throw new Error('Un lanceur batch ne peut pas être ouvert comme programme natif. Choisis son exécutable.');
    return { programme, args: [...args], options: { ...(dossier !== undefined ? { cwd: dossier } : {}), detached: true,
        stdio: 'ignore', shell: false, windowsHide: !visible, windowsVerbatimArguments: false } };
}

export function executableGraphique(programme: string, chercher: (nom: string) => string | undefined, existe: (chemin: string) => boolean,
    racineWindows = process.env.SystemRoot || 'C:\\Windows'): string {
    argumentValide(programme);
    if (/^explorer(?:\.exe)?$/i.test(programme)) return path.join(racineWindows, 'explorer.exe');
    const trouve = path.isAbsolute(programme) ? programme : chercher(programme);
    if (/^code(?:\.cmd)?$/i.test(path.basename(programme)) && trouve && /\.(cmd|bat)$/i.test(trouve)) {
        // code.cmd ne sert qu'à démarrer VS Code. Ne pas confier le chemin du
        // fichier à cmd.exe : Code.exe accepte directement les arguments d'ouverture.
        const exe = path.resolve(path.dirname(trouve), '..', 'Code.exe');
        if (!existe(exe)) throw new Error('Code.exe est introuvable à côté du lanceur VS Code. Réinstalle VS Code ou vérifie son PATH.');
        return exe;
    }
    const resultat = trouve || programme;
    if (/\.(cmd|bat)$/i.test(resultat)) throw new Error('Ce raccourci utilise un script batch. Choisis un exécutable natif.');
    return resultat;
}

export function invocationWeb(adresse: string, powershell: string): InvocationWindows {
    argumentValide(adresse);
    let url: URL;
    try { url = new URL(adresse); } catch { throw new Error('Adresse web invalide.'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Seules les adresses web HTTP et HTTPS peuvent être ouvertes dans le navigateur.');
    // L'URL est un littéral PowerShell, pas une commande cmd ni un protocole arbitraire.
    return invocationNative(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        encoderPowerShell(`Start-Process -FilePath ${citerPowerShell(url.href)}`)]);
}

export function invocationTerminal(programme: string, args: string[], dossier: string, titre: string,
    options: { wt?: string; couleur?: string; aCote?: boolean; nouvelleFenetre?: boolean } = {}): InvocationWindows {
    const natif = invocationNative(programme, args, dossier, true);
    argumentValide(titre);
    // WT interprète lui-même les points-virgules comme séparateurs de commandes.
    // Un chemin légitime qui en contient reste utilisable dans une fenêtre native.
    if (!options.wt || [programme, dossier, titre, ...args].some((s) => s.includes(';'))) return { ...natif, aCote: false };
    const wtArgs = ['-w', options.nouvelleFenetre ? 'new' : '0', ...(options.aCote ? ['split-pane', '-V', '--size', '0.5'] : ['new-tab']),
        '--title', titre, '--suppressApplicationTitle', ...(options.couleur ? ['--tabColor', options.couleur] : []), '-d', dossier, programme, ...args];
    if (wtArgs.some((s) => s.includes(';'))) return { ...natif, aCote: false };
    return { ...invocationNative(options.wt, wtArgs), aCote: !!options.aCote };
}

export function scriptInstallationWinget(nom: string, id: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new Error('Identifiant winget invalide.');
    return `Write-Host ${citerPowerShell(`Installation de ${nom}…`)} -ForegroundColor Cyan; `
        + `winget install -e --id ${citerPowerShell(id)} --accept-source-agreements --accept-package-agreements; `
        + `Write-Host ''; Write-Host ${citerPowerShell(`Terminé : ferme cette fenêtre. Relance Agentopia pour qu’il voie ${nom}.`)} -ForegroundColor Green`;
}

export function scriptRaccourciWindows(raccourci: string, cible: string, args: string, dossier: string, icone: string): string {
    return `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${citerPowerShell(raccourci)});`
        + `$s.TargetPath = ${citerPowerShell(cible)}; $s.Arguments = ${citerPowerShell(args)}; $s.WorkingDirectory = ${citerPowerShell(dossier)};`
        + `$s.IconLocation = ${citerPowerShell(`${icone},0`)}; $s.Description = 'Agentopia : sessions et equipes multi-agents, projets, Git, Docker, SSH'; $s.Save()`;
}

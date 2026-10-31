import { spawn } from 'node:child_process';
import { oublierPath, surPath } from './chemins.js';

const INSTALLATIONS = {
    codex: "irm https://chatgpt.com/codex/install.ps1 | iex",
    claude: "irm https://claude.ai/install.ps1 | iex",
    git: 'winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements --silent',
} as const;

// Commandes fixes uniquement ; ni consigne ni clé ne peuvent devenir du code shell.
export async function commandePreparation(programme: string, args: string[], delai = 300_000): Promise<void> {
    await new Promise<void>((ok, ko) => {
        const p = spawn(programme, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        // Les outils de connexion peuvent afficher des codes temporaires : pas de journal persistant.
        p.stdout?.resume(); p.stderr?.resume();
        const timer = setTimeout(() => { p.kill(); ko(new Error('Délai dépassé. Tu peux reprendre cette étape sans recommencer.')); }, delai);
        p.once('error', () => { clearTimeout(timer); ko(new Error('Impossible de démarrer cet outil. Vérifie son installation.')); });
        p.once('close', (code) => { clearTimeout(timer); code === 0 ? ok() : ko(new Error(`L’outil s’est arrêté (code ${code ?? 'inconnu'}). Réessaie cette étape.`)); });
    });
}

export async function installerOutil(nom: keyof typeof INSTALLATIONS): Promise<void> {
    if (surPath(nom)) return;
    if (process.platform !== 'win32') throw new Error('L’installation automatique est disponible sous Windows.');
    const script = `$ErrorActionPreference = 'Stop'; ${INSTALLATIONS[nom]}; if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
    await commandePreparation('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    oublierPath();
    if (!surPath(nom)) throw new Error(`${nom} reste introuvable après installation. Réessaie ou relance Agentopia.`);
}

export async function connecterCodex(): Promise<void> {
    const binaire = surPath('codex');
    if (!binaire) throw new Error('Codex n’est pas encore installé.');
    await commandePreparation(binaire, ['login']);
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { jetonCompteGitHub, loginGitHubValide } from './githubLocal.js';

/** Protocole credential de Git : aucune clé n'est fournie à un autre hôte ou à HTTP. */
export async function reponseCredentialGitHub(entree: string, login: string, action: string, lire = jetonCompteGitHub): Promise<string> {
    if (action !== 'get') return '';
    if (!loginGitHubValide(login) || entree.length > 65_536 || entree.includes('\0')) throw new Error('Demande GitHub invalide.');
    const champs = new Map<string, string>();
    for (const ligne of entree.split(/\r?\n/)) {
        if (!ligne) continue;
        const i = ligne.indexOf('=');
        if (i < 1 || champs.has(ligne.slice(0, i))) throw new Error('Demande GitHub invalide.');
        champs.set(ligne.slice(0, i), ligne.slice(i + 1));
    }
    if (champs.get('protocol') !== 'https' || !['github.com', 'github.com:443'].includes(champs.get('host') || '')) return '';
    return `username=${login}\npassword=${await lire(login)}\n\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let entree = '';
    try {
        for await (const b of process.stdin) { entree += b.toString(); if (entree.length > 65_536) throw new Error(); }
        process.stdout.write(await reponseCredentialGitHub(entree, process.argv[2], process.argv[3]));
    } catch { process.stderr.write('Compte GitHub sélectionné indisponible. Reconnecte-le dans Agentopia.\n'); process.exitCode = 1; }
}

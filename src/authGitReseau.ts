import { fileURLToPath } from 'node:url';
import { chargerConfig } from './config.js';
import { loginGitHubValide } from './githubLocal.js';

const citerSh = (s: string) => `'${s.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
/** Configuration éphémère du seul hôte HTTPS GitHub ; aucun changement du Git global. */
export function argumentsGitCompte(args: string[], compte = chargerConfig().compteGitHub): string[] {
    if (!compte || !['clone', 'fetch', 'pull', 'push', 'ls-remote'].includes(args[0])) return args;
    if (!loginGitHubValide(compte)) throw new Error('Compte GitHub invalide.');
    const helper = `!${citerSh(process.execPath)} ${citerSh(fileURLToPath(new URL('./githubCredential.js', import.meta.url)))} ${compte}`;
    return ['-c', 'credential.https://github.com.helper=', '-c', `credential.https://github.com.helper=${helper}`, ...args];
}

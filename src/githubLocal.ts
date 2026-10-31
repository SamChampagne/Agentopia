import { execFile } from 'node:child_process';
import { surPath } from './chemins.js';

export const loginGitHubValide = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(v);
export interface CompteGitHubLocal { login: string; actif: boolean; valide: boolean }

/** Les comptes du coffre local restent accessibles même si le terminal a un GH_TOKEN. */
export function environnementGhLocal(): NodeJS.ProcessEnv {
    const env = { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PAGER: 'cat' };
    for (const cle of Object.keys(env)) if (/^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_DEBUG|DEBUG)$/i.test(cle)) delete (env as NodeJS.ProcessEnv)[cle];
    return env;
}

export async function executerGhLocal(args: string[]): Promise<string> {
    const binaire = surPath('gh');
    if (!binaire) throw new Error('GitHub CLI absent : installe-le depuis Connexions → Outils.');
    return new Promise((ok, ko) => execFile(binaire, args, { env: environnementGhLocal(), encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 }, (erreur, stdout) => {
        // Les erreurs du processus peuvent contenir stdout, stderr et les identifiants : ne pas les propager.
        if (erreur) ko(new Error('Connexion GitHub locale indisponible. Vérifie GitHub CLI puis réessaie.'));
        else ok(stdout);
    }));
}

export function lireComptesGitHubJson(texte: string): CompteGitHubLocal[] {
    let donnees: any;
    try { donnees = JSON.parse(texte); } catch { throw new Error('Réponse GitHub CLI illisible. Aucun compte modifié.'); }
    const comptes = donnees?.hosts?.['github.com'];
    if (!Array.isArray(comptes)) throw new Error('Aucun compte github.com détecté dans GitHub CLI.');
    const uniques = new Map<string, CompteGitHubLocal>();
    for (const c of comptes) if (c && c.host === 'github.com' && loginGitHubValide(c.login)) {
        uniques.set(c.login.toLowerCase(), { login: c.login, actif: c.active === true, valide: c.state === 'success' });
    }
    return [...uniques.values()];
}

export async function listerComptesGitHub(executer = executerGhLocal): Promise<CompteGitHubLocal[]> {
    return lireComptesGitHubJson(await executer(['auth', 'status', '--hostname', 'github.com', '--json', 'hosts']));
}

export async function jetonCompteGitHub(login?: string, executer = executerGhLocal, verifier = verifierCompteGitHub): Promise<string> {
    if (login !== undefined && !loginGitHubValide(login)) throw new Error('Nom de compte GitHub invalide.');
    const cle = (await executer(['auth', 'token', '--hostname', 'github.com', ...(login ? ['--user', login] : [])])).trim();
    if (!cle || cle.length > 1000 || /\s/.test(cle)) throw new Error('Identifiant GitHub local indisponible. Reconnecte ce compte dans GitHub CLI.');
    // Le coffre natif reste partagé même avec GH_CONFIG_DIR. Ne jamais croire le
    // seul nom demandé à gh : confirmer l'identité avant de transmettre la clé.
    if (login && (await verifier(cle)).toLowerCase() !== login.toLowerCase()) throw new Error('Compte GitHub sélectionné indisponible : identité différente. Reconnecte ce compte dans GitHub CLI.');
    return cle;
}

export async function verifierCompteGitHub(cle: string, obtenir: typeof fetch = fetch): Promise<string> {
    try {
        const r = await obtenir('https://api.github.com/user', { headers: { Authorization: `Bearer ${cle}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(12_000) });
        if (!r.ok) throw new Error();
        const v = await r.json() as { login?: unknown };
        if (!loginGitHubValide(v.login)) throw new Error();
        return v.login;
    } catch { throw new Error('GitHub ne confirme pas ce compte. Vérifie sa connexion ou réessaie lorsque le réseau est disponible.'); }
}

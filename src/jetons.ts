import { spawn, spawnSync } from 'child_process';
import { CHEMINS } from './chemins.js';
import { CoffreSecrets } from './coffreSecrets.js';
import { origineGitLab } from './originesGit.js';

// Jetons d'accès (lecture seule) fournis par l'utilisateur pour lire les pull requests.
// Chiffrés avec DPAPI (ProtectedData, portée CurrentUser) : seul ce compte Windows sur ce poste peut les relire.
// Le secret passe par stdin, jamais par la ligne de commande.

export type Hebergeur = 'GitHub' | 'Azure DevOps' | 'GitLab';

const FICHIER = CHEMINS.jetons;
export const coffreSecrets = new CoffreSecrets(FICHIER);
let erreurCoffre: string | undefined;
export const etatCoffre = () => erreurCoffre;

export const AIDE_JETONS: Record<Hebergeur, { page: string; consigne: string }> = {
    'GitHub': {
        page: 'https://github.com/settings/tokens/new?scopes=repo&description=Agentopia%20(lecture%20PR)',
        consigne: 'jeton « classic » avec la case repo (ou un fine-grained : Pull requests en lecture)',
    },
    'Azure DevOps': {
        page: 'https://dev.azure.com/',
        consigne: 'User settings → Personal access tokens → New Token → Scopes : Code (Read)',
    },
    'GitLab': {
        page: 'https://gitlab.com/-/user_settings/personal_access_tokens',
        consigne: 'scope read_api',
    },
};

// Page de création du jeton, au plus près : l'organisation Azure DevOps ou le serveur GitLab des dépôts de ce poste
export function pageJeton(h: Hebergeur, remotes: string[], origine?: string): string {
    if (h === 'Azure DevOps') {
        const org = remotes.map((r) => /dev\.azure\.com[/:](?:v3\/)?([^/]+)\//.exec(r)?.[1] ?? /\/\/([^.@/]+)\.visualstudio\.com/.exec(r)?.[1]).find(Boolean);
        if (org) return `https://dev.azure.com/${org}/_usersSettings/tokens`;
    }
    if (h === 'GitLab') {
        return `${origineGitLab(origine || 'https://gitlab.com')}/-/user_settings/personal_access_tokens`;
    }
    return AIDE_JETONS[h].page;
}

function powershell(script: string, entree: string): string {
    const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { input: entree, encoding: 'utf-8', timeout: 15_000 });
    return res.status === 0 && !res.error ? (res.stdout ?? '').trim() : '';
}

// DPAPI directement via .NET : le module PowerShell "Security" (ConvertTo-SecureString) ne se charge pas
// quand Windows PowerShell est lancé depuis un environnement PowerShell 7
const DPAPI = 'Add-Type -AssemblyName System.Security; ';

function chiffrer(secret: string): string {
    return powershell(DPAPI + '$o = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); '
        + '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($o, $null, "CurrentUser"))', secret);
}

function dechiffrer(chiffre: string): string {
    return powershell(DPAPI + '$o = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); '
        + '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($o, $null, "CurrentUser"))', chiffre);
}

function lireFichier(): Record<string, string> {
    try { const v = coffreSecrets.lire(); erreurCoffre = undefined; return v; }
    catch { erreurCoffre = 'Coffre inaccessible ou invalide : secrets conservés, modifications refusées. /recuperer-coffre'; return {}; }
}

// Déchiffrés une fois, gardés en mémoire (un échec aussi : on ne relance pas PowerShell à chaque appel)
const cache = new Map<string, { chiffre: string; clair: string }>();
const cleJeton = (h: Hebergeur, origine?: string): string => h === 'GitLab' ? `gitlab:${origineGitLab(origine || '')}` : h;
export const originesGitLab = (): string[] => Object.keys(lireFichier()).filter(k => k.startsWith('gitlab:')).map(k => {
    try { return origineGitLab(k.slice(7)); } catch { return ''; }
}).filter(Boolean);
export const ancienGitLabPresent = () => !!lireFichier().GitLab;
/** Appel uniquement après consentement à l'association de l'ancien compte. */
export const ancienJetonGitLab = () => { const v = lireFichier().GitLab; return v ? dechiffrer(v) : undefined; };

export function jeton(h: Hebergeur, origine?: string): string | undefined {
    if (h === 'GitLab' && !origine) return undefined; // Un ancien jeton sans origine ne part jamais sur le réseau.
    const cle = cleJeton(h, origine), chiffre = lireFichier()[cle];
    if (!chiffre) return undefined;
    if (cache.get(cle)?.chiffre === chiffre) return cache.get(cle)!.clair || undefined;
    const clair = dechiffrer(chiffre);
    cache.set(cle, { chiffre, clair });
    return clair || undefined;
}

// Au démarrage : tous les jetons déchiffrés en un seul PowerShell, en arrière-plan.
// Sinon le premier appel à jeton() bloquerait l'interface près d'une seconde.
export function prechargerJetons(): Promise<void> {
    const chiffres = Object.entries(lireFichier()).filter(([h, v]) => v && h !== 'GitLab' && (HEBERGEURS.includes(h as Hebergeur) || h.startsWith('gitlab:')) && cache.get(h)?.chiffre !== v);
    if (!chiffres.length) return Promise.resolve();
    const script = DPAPI + '$j = [Console]::In.ReadToEnd() | ConvertFrom-Json; $r = @{}; '
        + 'foreach ($p in $j.PSObject.Properties) { try { $r[$p.Name] = [Text.Encoding]::UTF8.GetString('
        + '[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($p.Value), $null, "CurrentUser")) } catch { $r[$p.Name] = "" } }; '
        + '$r | ConvertTo-Json -Compress';
    return new Promise((ok) => {
        const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
        const delai = setTimeout(() => { proc.kill(); ok(); }, 15_000); delai.unref();
        let sortie = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => { sortie += d; if (sortie.length > 4 * 1024 * 1024) proc.kill(); });
        proc.on('error', () => { clearTimeout(delai); ok(); });
        proc.on('close', () => {
            clearTimeout(delai);
            try {
                for (const [h, clair] of Object.entries(JSON.parse(sortie) as Record<string, string>)) {
                    const chiffre = chiffres.find(([k]) => k === h)?.[1];
                    if (chiffre && typeof clair === 'string') cache.set(h, { chiffre, clair });
                }
            } catch {
                // échec : jeton() réessaiera à la demande
            }
            ok();
        });
        proc.stdin.on('error', () => undefined);
        proc.stdin.end(JSON.stringify(Object.fromEntries(chiffres)), 'utf-8');
    });
}

export function enregistrerJeton(h: Hebergeur, secret: string, origine?: string): boolean {
    const cle = cleJeton(h, origine);
    const chiffre = chiffrer(secret.trim());
    if (!chiffre) return false;
    coffreSecrets.modifier(fichier => { fichier[cle] = chiffre; });
    cache.set(cle, { chiffre, clair: secret.trim() });
    return true;
}
export function associerAncienGitLab(origine: string, clairAttendu: string): void {
    const cle = cleJeton('GitLab', origine);
    coffreSecrets.modifier(v => {
        if (!v.GitLab || dechiffrer(v.GitLab) !== clairAttendu) throw new Error('L’ancien compte a changé. Recommence l’association.');
        if (v[cle]) throw new Error('Un compte existe déjà pour cette adresse. Reconnecte-le explicitement.');
        v[cle] = v.GitLab; delete v.GitLab;
    });
}

export function oublierJeton(h: Hebergeur, origine?: string): void {
    const cle = h === 'GitLab' && !origine ? 'GitLab' : cleJeton(h, origine);
    coffreSecrets.modifier(fichier => { delete fichier[cle]; }); cache.delete(cle);
}

const HEBERGEURS: Hebergeur[] = ['GitHub', 'Azure DevOps', 'GitLab'];
export function jetonsConfigures(): Hebergeur[] {
    const cles = Object.keys(lireFichier());
    return HEBERGEURS.filter(h => cles.includes(h) || h === 'GitLab' && cles.some(k => k.startsWith('gitlab:')));
}

// ─── Autres secrets (mots de passe SFTP…) : même fichier, même chiffrement, clé « type:nom » ───

const secrets = new Map<string, { chiffre: string; clair: string }>();

export function secret(cle: string): string | undefined {
    const chiffre = (lireFichier() as Record<string, string>)[cle];
    if (!chiffre) return undefined;
    if (secrets.get(cle)?.chiffre === chiffre) return secrets.get(cle)!.clair || undefined;
    const clair = dechiffrer(chiffre);
    secrets.set(cle, { chiffre, clair });
    return clair || undefined;
}

export function enregistrerSecret(cle: string, valeur: string): boolean {
    const chiffre = chiffrer(valeur);
    if (!chiffre) return false;
    coffreSecrets.modifier(fichier => { fichier[cle] = chiffre; });
    secrets.set(cle, { chiffre, clair: valeur });
    return true;
}

export function oublierSecret(cle: string): void {
    coffreSecrets.modifier(fichier => { delete fichier[cle]; });
    secrets.delete(cle);
}

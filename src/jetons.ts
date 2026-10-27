import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { CHEMINS } from './chemins.js';

// Jetons d'accès (lecture seule) fournis par l'utilisateur pour lire les pull requests.
// Chiffrés avec DPAPI (ProtectedData, portée CurrentUser) : seul ce compte Windows sur ce poste peut les relire.
// Le secret passe par stdin, jamais par la ligne de commande.

export type Hebergeur = 'GitHub' | 'Azure DevOps' | 'GitLab';

const FICHIER = CHEMINS.jetons;

export const AIDE_JETONS: Record<Hebergeur, { page: string; consigne: string }> = {
    'GitHub': {
        page: 'https://github.com/settings/tokens/new?scopes=repo&description=Claudetopia%20(lecture%20PR)',
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
export function pageJeton(h: Hebergeur, remotes: string[]): string {
    if (h === 'Azure DevOps') {
        const org = remotes.map((r) => /dev\.azure\.com[/:](?:v3\/)?([^/]+)\//.exec(r)?.[1] ?? /\/\/([^.@/]+)\.visualstudio\.com/.exec(r)?.[1]).find(Boolean);
        if (org) return `https://dev.azure.com/${org}/_usersSettings/tokens`;
    }
    if (h === 'GitLab') {
        const hote = remotes.map((r) => /^(https?):\/\/(?:[^@/]+@)?([^/]+)/.exec(r) ?? /^git@([^:]+):/.exec(r))
            .map((m) => (m ? (m.length > 2 ? `${m[1]}://${m[2]}` : `https://${m[1]}`) : ''))
            .find((u) => u && !/github\.com|azure\.com|visualstudio\.com|bitbucket/.test(u));
        if (hote) return `${hote}/-/user_settings/personal_access_tokens`;
    }
    return AIDE_JETONS[h].page;
}

function powershell(script: string, entree: string): string {
    const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { input: entree, encoding: 'utf-8', timeout: 15_000 });
    return (res.stdout ?? '').trim();
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

function lireFichier(): Partial<Record<Hebergeur, string>> {
    try {
        return JSON.parse(fs.readFileSync(FICHIER, 'utf-8'));
    } catch {
        return {};
    }
}

// Déchiffrés une fois, gardés en mémoire (un échec aussi : on ne relance pas PowerShell à chaque appel)
const cache = new Map<Hebergeur, string>();

export function jeton(h: Hebergeur): string | undefined {
    if (cache.has(h)) return cache.get(h) || undefined;
    const chiffre = lireFichier()[h];
    if (!chiffre) return undefined;
    const clair = dechiffrer(chiffre);
    cache.set(h, clair);
    return clair || undefined;
}

// Au démarrage : tous les jetons déchiffrés en un seul PowerShell, en arrière-plan.
// Sinon le premier appel à jeton() bloquerait l'interface près d'une seconde.
export function prechargerJetons(): Promise<void> {
    const chiffres = Object.entries(lireFichier()).filter(([h, v]) => v && HEBERGEURS.includes(h as Hebergeur) && !cache.has(h as Hebergeur));
    if (!chiffres.length) return Promise.resolve();
    const script = DPAPI + '$j = [Console]::In.ReadToEnd() | ConvertFrom-Json; $r = @{}; '
        + 'foreach ($p in $j.PSObject.Properties) { try { $r[$p.Name] = [Text.Encoding]::UTF8.GetString('
        + '[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($p.Value), $null, "CurrentUser")) } catch { $r[$p.Name] = "" } }; '
        + '$r | ConvertTo-Json -Compress';
    return new Promise((ok) => {
        const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
        let sortie = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.on('error', () => ok());
        proc.on('close', () => {
            try {
                for (const [h, clair] of Object.entries(JSON.parse(sortie) as Record<string, string>)) cache.set(h as Hebergeur, clair);
            } catch {
                // échec : jeton() réessaiera à la demande
            }
            ok();
        });
        proc.stdin.end(JSON.stringify(Object.fromEntries(chiffres)), 'utf-8');
    });
}

export function enregistrerJeton(h: Hebergeur, secret: string): boolean {
    const chiffre = chiffrer(secret.trim());
    if (!chiffre) return false;
    const fichier = lireFichier();
    fichier[h] = chiffre;
    fs.writeFileSync(FICHIER, JSON.stringify(fichier, null, 2), 'utf-8');
    cache.set(h, secret.trim());
    return true;
}

export function oublierJeton(h: Hebergeur): void {
    const fichier = lireFichier();
    delete fichier[h];
    fs.writeFileSync(FICHIER, JSON.stringify(fichier, null, 2), 'utf-8');
    cache.delete(h);
}

const HEBERGEURS: Hebergeur[] = ['GitHub', 'Azure DevOps', 'GitLab'];
export function jetonsConfigures(): Hebergeur[] {
    return (Object.keys(lireFichier()) as Hebergeur[]).filter((h) => HEBERGEURS.includes(h));
}

// ─── Autres secrets (mots de passe SFTP…) : même fichier, même chiffrement, clé « type:nom » ───

const secrets = new Map<string, string>();

export function secret(cle: string): string | undefined {
    if (secrets.has(cle)) return secrets.get(cle) || undefined;
    const chiffre = (lireFichier() as Record<string, string>)[cle];
    if (!chiffre) return undefined;
    const clair = dechiffrer(chiffre);
    secrets.set(cle, clair);
    return clair || undefined;
}

export function enregistrerSecret(cle: string, valeur: string): boolean {
    const chiffre = chiffrer(valeur);
    if (!chiffre) return false;
    const fichier = lireFichier() as Record<string, string>;
    fichier[cle] = chiffre;
    fs.writeFileSync(FICHIER, JSON.stringify(fichier, null, 2), 'utf-8');
    secrets.set(cle, valeur);
    return true;
}

export function oublierSecret(cle: string): void {
    const fichier = lireFichier() as Record<string, string>;
    delete fichier[cle];
    fs.writeFileSync(FICHIER, JSON.stringify(fichier, null, 2), 'utf-8');
    secrets.delete(cle);
}

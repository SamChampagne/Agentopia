import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

export const LIMITE_ARCHIVE_DISTRIBUTION = 1024 ** 3;
export function validerUrlDistribution(adresse: string): URL {
    const u = new URL(adresse);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash
        || !['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(u.hostname))
        throw new Error('Adresse de téléchargement Agentopia refusée');
    return u;
}

// Valider chaque saut avant de l'envoyer : jamais de redirection HTTP ou vers
// un serveur arbitraire. GitHub sert ses pièces jointes via ses domaines CDN.
export async function obtenirDistribution(url: string, obtenir: typeof fetch = fetch, delai = 20_000): Promise<Response> {
    const signal = AbortSignal.timeout(delai);
    let adresse = validerUrlDistribution(url);
    for (let saut = 0; saut < 6; saut++) {
        const r = await obtenir(adresse.href, { redirect: 'manual', signal, headers: { Accept: adresse.hostname === 'api.github.com' ? 'application/vnd.github+json' : '*/*' } });
        if (![301, 302, 303, 307, 308].includes(r.status)) return r;
        const suivant = r.headers.get('location'); await r.body?.cancel();
        if (!suivant) throw new Error('Redirection de téléchargement invalide');
        adresse = validerUrlDistribution(new URL(suivant, adresse).href);
    }
    throw new Error('Trop de redirections de téléchargement');
}

function verifierTaille(r: Response, limite: number): void {
    const longueur = r.headers.get('content-length');
    if (longueur !== null && (!/^\d+$/.test(longueur) || Number(longueur) > limite)) throw new Error('Téléchargement trop volumineux');
}
export async function lireJsonDistribution(r: Response, limite: number): Promise<unknown> {
    const morceaux: Uint8Array[] = []; let taille = 0;
    try {
        verifierTaille(r, limite); if (!r.body) throw new Error('Réponse de mise à jour vide');
        for await (const b of r.body as unknown as AsyncIterable<Uint8Array>) {
            taille += b.byteLength; if (taille > limite) throw new Error('Réponse de mise à jour trop volumineuse'); morceaux.push(b);
        }
        return JSON.parse(Buffer.concat(morceaux).toString('utf8'));
    } catch (e) { if (!r.body?.locked) await r.body?.cancel().catch(() => {}); throw e; }
}

export async function telechargerArchiveDistribution(url: string, archive: string, attendu: string, obtenir: typeof fetch = fetch, limite = LIMITE_ARCHIVE_DISTRIBUTION): Promise<void> {
    if (!Number.isSafeInteger(limite) || limite < 1 || limite > LIMITE_ARCHIVE_DISTRIBUTION || !/^[a-f0-9]{64}$/.test(attendu)) throw new Error('Paramètres de téléchargement invalides');
    const r = await obtenirDistribution(url, obtenir, 300_000);
    let fd: number | undefined, cree = false;
    try {
        if (!r.ok || !r.body) throw new Error('Téléchargement interrompu');
        verifierTaille(r, limite);
        fd = fs.openSync(archive, 'wx'); cree = true;
        const hash = createHash('sha256'); let taille = 0;
        for await (const bloc of r.body as unknown as AsyncIterable<Uint8Array>) {
            taille += bloc.byteLength; if (taille > limite) throw new Error('Téléchargement trop volumineux. Rien n’a été installé.');
            let ecrit = 0; while (ecrit < bloc.byteLength) ecrit += fs.writeSync(fd, bloc, ecrit, bloc.byteLength - ecrit);
            hash.update(bloc);
        }
        if (hash.digest('hex') !== attendu) throw new Error('Le téléchargement est incomplet ou modifié. Rien n’a été installé.');
    } catch (e) {
        if (fd !== undefined) { fs.closeSync(fd); fd = undefined; }
        if (cree) fs.rmSync(archive, { force: true });
        if (!r.body?.locked) await r.body?.cancel().catch(() => {});
        throw e;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function origineGitLab(valeur: string): string {
    let u: URL; try { u = new URL(valeur); } catch { throw new Error('Adresse GitLab invalide : indique https://ton-serveur.'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/')
        throw new Error('Indique uniquement l’origine HTTPS de GitLab, sans chemin ni identifiants.');
    return u.origin;
}
export async function appelGitAuthentifie(url: string, entetes: Record<string, string>, obtenir: typeof fetch = fetch): Promise<{ ok: boolean; statut: number; json?: any }> {
    try {
        let adresse = new URL(url);
        if (adresse.protocol !== 'https:' || adresse.username || adresse.password) throw new Error('Adresse non sécurisée');
        const origine = adresse.origin, signal = AbortSignal.timeout(15_000);
        for (let i = 0; i < 4; i++) {
            const r = await obtenir(adresse.href, { headers: { 'User-Agent': 'Agentopia', ...entetes }, redirect: 'manual', signal });
            if ([301, 302, 303, 307, 308].includes(r.status)) {
                const location = r.headers.get('location'); await r.body?.cancel();
                if (!location) throw new Error('Redirection sans destination');
                adresse = new URL(location, adresse);
                if (adresse.origin !== origine || adresse.username || adresse.password) throw new Error('Redirection hors du compte refusée');
                continue;
            }
            if (!r.ok) { await r.body?.cancel(); return { ok: false, statut: r.status }; }
            const chunks: Uint8Array[] = []; let taille = 0;
            if (Number(r.headers.get('content-length')) > 4 * 1024 * 1024) { await r.body?.cancel(); throw new Error('Réponse trop grande'); }
            const lecteur = r.body?.getReader();
            if (lecteur) try { for (;;) { const d = await lecteur.read(); if (d.done) break; taille += d.value.length; if (taille > 4 * 1024 * 1024) throw new Error('Réponse trop grande'); chunks.push(d.value); } }
            finally { await lecteur.cancel().catch(() => undefined); }
            return { ok: true, statut: r.status, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
        }
    } catch { /* Ni URL ni entêtes sensibles dans le message. */ }
    return { ok: false, statut: 0 };
}

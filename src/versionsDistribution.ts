import { obtenirDistribution, lireJsonDistribution } from './telechargementDistribution.js';

export const DEPOT_DISTRIBUTION = 'SamChampagne/Agentopia';
export const DEPOT_DISTRIBUTION_ID = 1436267735;
const DEPOTS_DISTRIBUTION_AUTORISES = [DEPOT_DISTRIBUTION, 'Intebec/Agentopia'] as const;
type Release = { tag_name: string; draft?: boolean; prerelease?: boolean; assets?: { name: string; browser_download_url: string }[] };
function version(s: string) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(s);
    if (!m) throw new Error(`Version invalide : ${s}`);
    const nombres = m.slice(1, 4).map(Number);
    if (!nombres.every(Number.isSafeInteger)) throw new Error('Version invalide');
    return { nombres, pre: m[4]?.split('.') };
}
export function comparerVersions(a: string, b: string): number {
    const x = version(a), y = version(b);
    for (let i = 0; i < 3; i++) if (x.nombres[i] !== y.nombres[i]) return x.nombres[i] - y.nombres[i];
    if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        const p = x.pre[i], q = y.pre[i];
        if (p === q) continue;
        if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
        const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
        if (pn && qn) return Number(p) - Number(q);
        if (pn !== qn) return pn ? -1 : 1;
        return p < q ? -1 : 1;
    }
    return 0;
}
export function choisirRelease(releases: Release[], actuelle: string): Release | undefined {
    const beta = !!version(actuelle).pre;
    return releases.filter((r) => {
        try {
            const v = r.tag_name.replace(/^agentopia-/, '');
            return !r.draft && (beta || (!r.prerelease && !version(v).pre)) && comparerVersions(v, actuelle) > 0
                && r.assets?.some((a) => a.name === 'agentopia-release.json') && r.assets.some((a) => a.name === 'Agentopia-Windows-x64.zip');
        } catch { return false; }
    }).sort((a, b) => comparerVersions(b.tag_name.replace(/^agentopia-/, ''), a.tag_name.replace(/^agentopia-/, '')))[0];
}
export async function chercherMiseAJour(actuelle: string, obtenir: typeof fetch = fetch) {
    const reponse = await obtenirDistribution(`https://api.github.com/repositories/${DEPOT_DISTRIBUTION_ID}/releases?per_page=100`, obtenir);
    if (!reponse.ok) throw new Error('Vérification des mises à jour indisponible. Réessaie plus tard.');
    const releases = await lireJsonDistribution(reponse, 4 * 1024 * 1024);
    if (!Array.isArray(releases)) throw new Error('Réponse de mise à jour invalide');
    const release = choisirRelease(releases, actuelle); if (!release) return;
    // Both assets must come from the same explicitly authorized owner of the stable repository.
    const depot = DEPOTS_DISTRIBUTION_AUTORISES.find(d =>
        ['agentopia-release.json', 'Agentopia-Windows-x64.zip'].every(nom =>
            release.assets?.find(a => a.name === nom)?.browser_download_url === `https://github.com/${d}/releases/download/${release.tag_name}/${nom}`));
    if (!depot) throw new Error('Téléchargement Windows incompatible');
    const prefixe = `https://github.com/${depot}/releases/download/${release.tag_name}/`;
    const urlAsset = (nom: string) => {
        const url = release.assets?.find((a) => a.name === nom)?.browser_download_url;
        if (url !== prefixe + nom) throw new Error('Téléchargement Windows incompatible');
        return url;
    };
    const mr = await obtenirDistribution(urlAsset('agentopia-release.json'), obtenir);
    if (!mr.ok) throw new Error('Manifeste de mise à jour inaccessible');
    const lu = await lireJsonDistribution(mr, 64 * 1024);
    const manifeste = lu as Record<string, any>;
    if (!manifeste || typeof manifeste !== 'object' || manifeste.format !== 'agentopia-release-v1' || manifeste.plateforme !== 'win32-x64'
        || manifeste.asset !== 'Agentopia-Windows-x64.zip' || typeof manifeste.id !== 'string'
        || manifeste.id.length > 160 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9_-])?$/.test(manifeste.id)
        || typeof manifeste.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifeste.sha256) || manifeste.version !== release.tag_name.replace(/^agentopia-/, '')) {
        throw new Error('Manifeste de mise à jour invalide');
    }
    return { manifeste, url: urlAsset(manifeste.asset) };
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { choisir, tache } from './ui/bus.js';

const DEPOT = 'SamChampagne/ClaudeTopia';
const estSous = (racine: string, cible: string) => { const r = path.relative(racine, cible); return !r.startsWith('..') && !path.isAbsolute(r); };
export function estDistribution(racine: string): boolean { return fs.existsSync(path.join(racine, 'distribution.json')); }
async function moduleInstallation(racine: string): Promise<any> { return import(pathToFileURL(path.join(racine, 'outils', 'installation-windows.mjs')).href); }
export async function maintenirDistribution(racine: string, reparer = false): Promise<void> {
    const root = process.env.AGENTOPIA_DISTRIBUTION_ROOT;
    if (!root) throw new Error('Version portable : ouvre Agentopia-Setup.exe pour installer ou mettre à jour.');
    const manifeste = JSON.parse(fs.readFileSync(path.join(racine, 'distribution.json'), 'utf8'));
    const installer = await moduleInstallation(racine);
    if (reparer) {
        const archive = path.join(root, 'paquets', `${manifeste.id}.zip`);
        const hash = fs.readFileSync(`${archive}.sha256`, 'utf8').trim();
        await tache('Réparation de la version installée', () => installer.installerArchive(archive, hash, { destination: root, reparer: true }));
        return;
    }
    const reponse = await fetch(`https://api.github.com/repos/${DEPOT}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
    if (reponse.status === 404) throw new Error('Aucune version Windows publiée pour le moment. Ta version installée est conservée.');
    if (!reponse.ok) throw new Error('Vérification des mises à jour indisponible. Réessaie plus tard.');
    const release: any = await reponse.json();
    const asset = release.assets?.find((a: any) => a.name === 'agentopia-release.json');
    const prefixe = `https://github.com/${DEPOT}/releases/download/`;
    if (!asset?.browser_download_url?.startsWith(prefixe)) throw new Error('Cette version ne contient pas de paquet Windows compatible.');
    const mr = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(20_000) });
    if (!mr.ok) throw new Error('Manifeste de mise à jour inaccessible');
    const nouveau: any = await mr.json();
    if (nouveau.format !== 'agentopia-release-v1' || nouveau.plateforme !== 'win32-x64' || !/^[a-f0-9]{64}$/.test(nouveau.sha256)) throw new Error('Manifeste de mise à jour invalide');
    if (nouveau.id === manifeste.id) { console.log('Cette version Windows est déjà installée.'); return; }
    const zip = release.assets.find((a: any) => a.name === nouveau.asset);
    if (!zip?.browser_download_url?.startsWith(prefixe)) throw new Error('Téléchargement Windows absent');
    const action = await choisir(`Agentopia ${nouveau.version} est disponible`, [{ label: 'Installer la mise à jour', valeur: true }, { label: 'Plus tard', valeur: false }], false, 'Tes données sont conservées. La version précédente restera disponible.');
    if (!action) return;
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-maj-'));
    try {
        await tache('Téléchargement et vérification de la mise à jour', async () => {
            const r = await fetch(zip.browser_download_url, { signal: AbortSignal.timeout(300_000) });
            if (!r.ok || !r.body) throw new Error('Téléchargement interrompu');
            const archive = path.join(dossier, 'mise-a-jour.zip');
            const fd = fs.openSync(archive, 'wx'), hash = createHash('sha256');
            try { for await (const bloc of r.body as any) {
                let ecrit = 0; while (ecrit < bloc.length) ecrit += fs.writeSync(fd, bloc, ecrit, bloc.length - ecrit);
                hash.update(bloc);
            } }
            finally { fs.closeSync(fd); }
            if (hash.digest('hex') !== nouveau.sha256) throw new Error('Le téléchargement est incomplet ou modifié. Rien n’a été installé.');
            await installer.installerArchive(archive, nouveau.sha256, { destination: root });
        });
    } finally { if (estSous(os.tmpdir(), dossier)) fs.rmSync(dossier, { recursive: true, force: true }); }
}
export async function revenirVersion(racine: string): Promise<void> {
    const root = process.env.AGENTOPIA_DISTRIBUTION_ROOT;
    if (!root) throw new Error('Le retour de version concerne les installations Windows.');
    const activation = JSON.parse(fs.readFileSync(path.join(root, 'activation.json'), 'utf8'));
    if (!activation.precedente) throw new Error('Aucune version précédente conservée.');
    const installer = await moduleInstallation(racine);
    await tache('Vérification de la version précédente', () => installer.activerVersion(root, activation.precedente));
    console.log('Version précédente préparée. Ferme et relance Agentopia.');
}

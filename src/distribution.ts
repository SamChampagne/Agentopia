import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
import { choisir, tache } from './ui/bus.js';
import { chercherMiseAJour } from './versionsDistribution.js';
import { telechargerArchiveDistribution } from './telechargementDistribution.js';

const estSous = (racine: string, cible: string) => { const r = path.relative(racine, cible); return !r.startsWith('..') && !path.isAbsolute(r); };
export function estDistribution(racine: string): boolean { return fs.existsSync(path.join(racine, 'distribution.json')); }
async function moduleInstallation(racine: string): Promise<any> { return import(pathToFileURL(path.join(racine, 'outils', 'installation-windows.mjs')).href); }
export async function maintenirDistribution(racine: string, reparer = false): Promise<void> {
    const root = process.env.AGENTOPIA_DISTRIBUTION_ROOT;
    if (!root) throw new Error('Version portable : ouvre Agentopia-Setup.exe pour installer ou mettre à jour.');
    const installer = await moduleInstallation(racine);
    installer.verifierCheminPhysique(root);
    const fichierManifeste = path.join(racine, 'distribution.json');
    const info = installer.verifierCheminPhysique(fichierManifeste);
    if (!info?.isFile() || info.size > 8 * 1024 * 1024) throw new Error('Manifeste installé invalide ou trop volumineux');
    const manifeste = JSON.parse(fs.readFileSync(fichierManifeste, 'utf8'));
    if (typeof manifeste.id !== 'string' || manifeste.id.length > 160 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9_-])?$/.test(manifeste.id)
        || typeof manifeste.version !== 'string') throw new Error('Manifeste installé invalide');
    if (reparer) {
        const archive = path.join(root, 'paquets', `${manifeste.id}.zip`);
        installer.verifierCheminPhysique(archive);
        const infoHash = installer.verifierCheminPhysique(`${archive}.sha256`);
        if (!infoHash?.isFile() || infoHash.size > 1024) throw new Error('Empreinte du paquet local invalide');
        const hash = fs.readFileSync(`${archive}.sha256`, 'utf8').trim();
        await tache('Réparation de la version installée', () => installer.installerArchive(archive, hash, { destination: root, reparer: true, raccourci: false }));
        return;
    }
    const miseAJour = await chercherMiseAJour(manifeste.version);
    if (!miseAJour) { console.log('Aucune version Windows plus récente sur ton canal.'); return; }
    const nouveau = miseAJour.manifeste;
    const action = await choisir(`Agentopia ${nouveau.version} est disponible`, [{ label: 'Installer la mise à jour', valeur: true }, { label: 'Plus tard', valeur: false }], false, 'Tes données sont conservées. La version précédente restera disponible.');
    if (!action) return;
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-maj-'));
    try {
        await tache('Téléchargement et vérification de la mise à jour', async () => {
            const archive = path.join(dossier, 'mise-a-jour.zip');
            await telechargerArchiveDistribution(miseAJour.url, archive, nouveau.sha256);
            await installer.installerArchive(archive, nouveau.sha256, { destination: root, raccourci: false, idAttendu: nouveau.id, versionAttendue: nouveau.version });
        });
    } finally { if (estSous(os.tmpdir(), dossier)) fs.rmSync(dossier, { recursive: true, force: true }); }
}
export async function revenirVersion(racine: string): Promise<void> {
    const root = process.env.AGENTOPIA_DISTRIBUTION_ROOT;
    if (!root) throw new Error('Le retour de version concerne les installations Windows.');
    const installer = await moduleInstallation(racine);
    const fichier = path.join(root, 'activation.json'), info = installer.verifierCheminPhysique(fichier);
    if (!info?.isFile() || info.size > 64 * 1024) throw new Error('Activation invalide ou trop volumineuse');
    const activation = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    if (!activation.precedente) throw new Error('Aucune version précédente conservée.');
    await tache('Vérification de la version précédente', () => installer.activerVersion(root, activation.precedente));
    console.log('Version précédente préparée. Ferme et relance Agentopia.');
}

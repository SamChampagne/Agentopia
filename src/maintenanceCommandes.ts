import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Commande } from './commandes.js';
import { RACINE_CLI } from './configCommandes.js';
import { choisir, confirmer, tache } from './ui/bus.js';
import { ouvrirFenetrePowerShell } from './lanceurs.js';

async function moduleMaintenance(): Promise<{ root: string; m: any }> {
    const root = process.env.AGENTOPIA_DISTRIBUTION_ROOT;
    if (!root) throw new Error('Cette commande concerne Agentopia installé avec le Setup Windows. Le ZIP portable peut être retiré après fermeture de ses fenêtres.');
    return { root, m: await import(pathToFileURL(path.join(RACINE_CLI, 'outils', 'maintenance-windows.mjs')).href) };
}
export function commandesMaintenance(): Commande[] {
    return [
        { nom: 'espace-installation', groupe: 'Config', description: 'Voir les versions et paquets conservés, puis nettoyer ceux qui ne servent plus', executer: async () => {
            const { root, m } = await moduleMaintenance();
            const inventaire = await tache('Inventaire de l’installation', async () => m.inventorierInstallation(root, { racineCourante: RACINE_CLI }));
            for (const v of inventaire.versions) console.log(`${v.protegee ? 'Conservée' : 'Nettoyable'} · version ${v.id} · ${(v.octets / 1048576).toFixed(1)} Mio${v.erreur ? ` · ${v.erreur}` : ''}`);
            for (const a of inventaire.archives) console.log(`${a.protegee ? 'Réparation disponible' : 'Nettoyable'} · paquet ${a.id} · ${(a.octets / 1048576).toFixed(1)} Mio`);
            const versions = inventaire.versions.filter((v: any) => !v.protegee), archives = inventaire.archives.filter((v: any) => !v.protegee);
            if (!versions.length && !archives.length) { console.log('Rien à nettoyer. Version active, précédente, ouverte et leurs paquets conservés.'); return; }
            const choix = await choisir('Entretien de l’installation', [{ label: 'Conserver tous les fichiers', valeur: false }, { label: `Nettoyer ${versions.length} ancienne(s) version(s) et ${archives.length} paquet(s)`, valeur: true }], false);
            if (!choix || !await confirmer('Retirer uniquement les anciennes versions et paquets indiqués comme nettoyables ? Réglages, conversations, projets et worktrees sont conservés.')) return;
            const r = await tache('Nettoyage des anciennes versions', async () => m.nettoyerInstallation(root, { versions: versions.map((v: any) => v.id), archives: archives.map((v: any) => v.id) }, { racineCourante: RACINE_CLI }));
            console.log(`Nettoyage terminé : ${r.versions} version(s), ${r.archives} paquet(s). Les fichiers ajoutés manuellement dans ces dossiers restent conservés.`);
        } },
        { nom: 'desinstaller', groupe: 'Config', description: 'Ouvrir la désinstallation Windows en conservant réglages, conversations et comptes', executer: async () => {
            const { root, m } = await moduleMaintenance();
            if (!fs.existsSync(path.join(root, 'Desinstaller-Agentopia.mjs'))) m.preparerDesinstallation(root, false);
            if (!await confirmer('Ouvrir le retrait d’Agentopia ? Windows demandera confirmation avant de fermer ses processus. Tes données, projets et comptes seront conservés.')) return;
            // Script complet encodé par le lanceur, pas de chemin interpolé dans cmd.exe.
            ouvrirFenetrePowerShell(m.scriptDesinstallation(root));
        } },
    ];
}

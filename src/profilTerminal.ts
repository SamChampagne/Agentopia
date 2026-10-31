import * as fs from 'node:fs';
import * as path from 'node:path';

export const GUID_PROFIL = '{7e6c2b1e-1c5a-4d4e-9a5e-c1a0d70b1a01}';
export function cheminProfilTerminal(): string {
    const racine = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows Terminal', 'Fragments');
    const ancien = path.join(racine, 'Claudetopia', 'claudetopia.json');
    // Réutiliser le même fragment évite deux profils avec le même identifiant.
    return fs.existsSync(ancien) ? ancien : path.join(racine, 'Agentopia', 'agentopia.json');
}
export function migrerProfilTerminal(fichier = cheminProfilTerminal()): void {
    if (!fs.existsSync(fichier)) return;
    try {
        const avant = fs.readFileSync(fichier, 'utf8');
        const fragment = JSON.parse(avant);
        let modifie = false;
        for (const profil of fragment.profiles ?? []) {
            if (profil.guid !== GUID_PROFIL) continue;
            for (const cle of ['name', 'tabTitle']) {
                if (/^claudetopia$/i.test(profil[cle] ?? '')) { profil[cle] = 'Agentopia'; modifie = true; }
            }
            if (typeof profil.commandline === 'string' && /Claudetopia\.bat/i.test(profil.commandline)) {
                profil.commandline = profil.commandline.replace(/Claudetopia\.bat/gi, 'Agentopia.bat'); modifie = true;
            }
        }
        if (!modifie) return;
        const sauvegarde = `${fichier}.avant-agentopia.bak`;
        if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, avant, { encoding: 'utf8', flag: 'wx' });
        fs.writeFileSync(fichier, JSON.stringify(fragment, null, 2), 'utf8');
    } catch { /* Un profil personnalisé illisible reste intact. */ }
}

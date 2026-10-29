import fs from 'node:fs';
import { installerArchive } from './installation-windows.mjs';

const envoyer = (objet) => process.stdout.write(`@agentopia ${JSON.stringify(objet)}\n`);
try {
    const { archive, hash, ...options } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const r = await installerArchive(archive, hash, { ...options,
        progression: (etat) => envoyer({ type: 'progression', ...etat }),
    });
    envoyer({ type: 'resultat', ...r });
} catch (e) {
    envoyer({ type: 'erreur', message: e.message });
    process.exitCode = 1;
}

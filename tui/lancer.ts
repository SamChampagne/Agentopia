import * as path from 'node:path';

// Ce fichier démarre avec tui/ comme cwd pour que Bun charge la configuration
// de l'interface. Aucun module applicatif ne doit être importé avant ce retour.
const dossier = process.env.AGENTOPIA_DOSSIER_DEMARRAGE;
delete process.env.AGENTOPIA_DOSSIER_DEMARRAGE;
if (dossier !== undefined) {
    if (!path.isAbsolute(dossier)) throw new Error('Dossier de démarrage Agentopia invalide.');
    process.chdir(dossier);
}

if (process.argv[2] === '--verifier-installation') {
    await import('./verifier-installation.tsx');
} else {
    const { demarrerInterface } = await import('./app.tsx');
    await demarrerInterface();
}

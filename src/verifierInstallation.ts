import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { trouverBun } from './runtimeInterface.js';

// Diagnostic sans scan du poste, sans connexion à un fournisseur et sans génération.
export async function verifierInstallation(racine: string): Promise<void> {
    await Promise.all([import('ink'), import('@anthropic-ai/claude-agent-sdk'), import('ssh2')]);
    const bun = trouverBun();
    if (!bun) throw new Error('Moteur de l’interface manquant');
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-verification-'));
    try {
        fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false, modele: 'haiku' } }));
        // Même mode que le lanceur : un rendu valide en développement ne prouve
        // pas que le paquet fonctionne avec le runtime React de production.
        const r = spawnSync(bun, ['--jsx-import-source', '@opentui/react', path.join(racine, 'tui', 'verifier-installation.tsx')], { cwd: racine, encoding: 'utf8', windowsHide: true, timeout: 30_000,
            env: { ...process.env, NODE_ENV: 'production', CLAUDETOPIA_DATA_DIR: dossier, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1', AGENTOPIA_SANS_MOTEUR: '1' } });
        if (r.status !== 0 || r.error) throw new Error(`Interface indisponible : ${r.stderr || r.error?.message}`);
        console.log('Agentopia : moteurs, dépendances et interface vérifiés · aucun modèle appelé.');
    } finally {
        const relatif = path.relative(os.tmpdir(), dossier);
        if (!relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(dossier, { recursive: true, force: true });
    }
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const racine = import.meta.dirname;
const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-demarrage-test-'));
try {
    const env = { ...process.env, CLAUDETOPIA_DATA_DIR: temporaire, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1', AGENTOPIA_SANS_MOTEUR: '1' };
    process.env.CLAUDETOPIA_DATA_DIR = temporaire;
    fs.writeFileSync(path.join(temporaire, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
    // Un projet appelant peut avoir son propre tsconfig ; le lanceur conserve
    // son dossier de travail tout en choisissant le runtime de l'interface.
    fs.writeFileSync(path.join(temporaire, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'fourni-par-le-projet-inexistant' } }));
    const { surPath } = await import('./dist/chemins.js');
    const bun = surPath('bun'); assert.ok(bun);
    for (const mode of ['production', 'development']) {
        const r = spawnSync(bun, ['--jsx-import-source', '@opentui/react', path.join(racine, 'tui', 'verifier-installation.tsx')], {
            cwd: temporaire, env: { ...env, NODE_ENV: mode }, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
        });
        assert.equal(r.status, 0, `${mode} : ${r.error?.message || r.stderr || r.stdout}`);
        assert.match(r.stdout, /accueil, cockpit, saisie, erreur visible et reprise/);
    }
    // Le même index que le raccourci doit tester la production, même si
    // l'environnement appelant est en développement ou n'a pas NODE_ENV.
    const r = spawnSync(process.execPath, [path.join(racine, 'dist', 'index.js'), '--verifier-installation'], {
        cwd: temporaire, env: { ...env, NODE_ENV: 'development' }, encoding: 'utf8', windowsHide: true, timeout: 35_000,
    });
    assert.equal(r.status, 0, r.error?.message || r.stderr || r.stdout);
    assert.match(r.stdout, /moteurs, dépendances et interface vérifiés/);
    console.log('✓ Démarrage : production, développement, tsconfig externe, saisie et récupération du rendu ; précontrôle du vrai lanceur');
} finally {
    const relatif = path.relative(os.tmpdir(), temporaire);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif) && path.basename(temporaire).startsWith('agentopia-demarrage-test-')) fs.rmSync(temporaire, { recursive: true, force: true });
}

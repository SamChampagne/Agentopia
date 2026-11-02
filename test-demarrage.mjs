import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const racine = import.meta.dirname;
const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-demarrage-test-'));
try {
    const env = { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0', CLAUDETOPIA_DATA_DIR: temporaire, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1', AGENTOPIA_SANS_MOTEUR: '1' };
    process.env.CLAUDETOPIA_DATA_DIR = temporaire;
    fs.writeFileSync(path.join(temporaire, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
    // Un projet appelant peut avoir son propre tsconfig ; le lanceur conserve
    // son dossier de travail tout en choisissant le runtime de l'interface.
    fs.writeFileSync(path.join(temporaire, 'module-externe.ts'), "throw new Error('Alias du projet utilisé par Agentopia');");
    const configurations = [
        { jsx: 'react-jsx', jsxImportSource: 'fourni-par-le-projet-inexistant' },
        { jsx: 'react', jsxFactory: 'fabriqueExterneInexistante', jsxFragmentFactory: 'fragmentExterneInexistant' },
        { jsx: 'react-jsxdev', jsxImportSource: 'fourni-par-le-projet-inexistant', baseUrl: '.', paths: { react: ['./module-externe.ts'], '@opentui/react': ['./module-externe.ts'] } },
    ];
    const { lancementInterface, trouverBun } = await import('./dist/runtimeInterface.js');
    const bun = trouverBun(); assert.ok(bun, 'Bun natif ou binaire installé par npm requis');
    if (process.platform === 'win32') {
        const prefixe = path.join(temporaire, 'npm avec & espaces');
        const natif = path.join(prefixe, 'node_modules', 'bun', 'bin', 'bun.exe');
        fs.mkdirSync(path.dirname(natif), { recursive: true });
        try { fs.linkSync(bun, natif); } catch { fs.copyFileSync(bun, natif); }
        const shim = path.join(prefixe, 'bun.cmd');
        fs.writeFileSync(shim, '@echo off\r\necho Ce shim ne doit jamais etre execute\r\nexit /b 87\r\n');
        assert.equal(trouverBun(shim), natif);
        assert.equal(trouverBun(path.join(temporaire, 'installation-incomplete', 'bun.cmd')), undefined);
        env.PATH = `${prefixe};${env.PATH}`;
    }
    for (const mode of ['production', 'development']) for (const compilerOptions of configurations) {
        fs.writeFileSync(path.join(temporaire, 'tsconfig.json'), JSON.stringify({ compilerOptions }));
        const lancement = lancementInterface(racine, ['--verifier-installation'], { ...env, NODE_ENV: mode }, temporaire);
        const r = spawnSync(bun, lancement.args, {
            cwd: lancement.cwd, env: lancement.env, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
        });
        assert.equal(r.status, 0, `${mode} : ${r.error?.message || r.stderr || r.stdout}`);
        assert.match(r.stdout, /accueil, cockpit, saisie, erreur visible et reprise/);
        assert.doesNotMatch(r.stderr, /Internal error:|directory mismatch/i, 'fermeture sans diagnostic interne malgré le code 0');
    }
    // Le cache est local au test : premier lancement à froid, puis réutilisation.
    for (let tour = 0; tour < 2; tour++) {
        const lancement = lancementInterface(racine, ['--verifier-installation'], { ...env, NODE_ENV: 'production', BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(temporaire, 'cache') }, temporaire);
        const r = spawnSync(bun, lancement.args, {
            cwd: lancement.cwd, env: lancement.env, encoding: 'utf8', windowsHide: true, timeout: 30_000,
        });
        assert.equal(r.status, 0, r.error?.message || r.stderr); assert.match(r.stdout, /cockpit/);
        assert.doesNotMatch(r.stderr, /Internal error:|directory mismatch/i);
    }
    // Le vrai amorçage doit restaurer le cwd AVANT les imports applicatifs et
    // préserver les arguments sans laisser son réglage privé aux sous-processus.
    const fixture = path.join(temporaire, 'paquet avec & espaces'), tuiFixture = path.join(fixture, 'tui');
    fs.mkdirSync(tuiFixture, { recursive: true });
    fs.copyFileSync(path.join(racine, 'tui', 'lancer.ts'), path.join(tuiFixture, 'lancer.ts'));
    fs.copyFileSync(path.join(racine, 'tui', 'tsconfig.json'), path.join(tuiFixture, 'tsconfig.json'));
    fs.writeFileSync(path.join(tuiFixture, 'app.tsx'), 'const cwd=process.cwd(); export async function demarrerInterface(){console.log(JSON.stringify({cwd,args:process.argv.slice(2),transmis:process.env.AGENTOPIA_DOSSIER_DEMARRAGE}));}');
    const argumentsProjet = ['/projet', 'Dossier avec espaces & accents é'];
    const lancement = lancementInterface(fixture, argumentsProjet, { ...env, AGENTOPIA_DOSSIER_DEMARRAGE: 'valeur héritée à remplacer' }, temporaire);
    const contexte = spawnSync(bun, lancement.args, { cwd: lancement.cwd, env: lancement.env, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(contexte.status, 0, contexte.stderr);
    assert.deepEqual(JSON.parse(contexte.stdout), { cwd: temporaire, args: argumentsProjet });
    assert.doesNotMatch(contexte.stderr, /Internal error:|directory mismatch/i);
    const invalide = spawnSync(bun, lancement.args, { cwd: lancement.cwd, env: { ...lancement.env, AGENTOPIA_DOSSIER_DEMARRAGE: 'relatif' }, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.notEqual(invalide.status, 0); assert.match(invalide.stderr, /Dossier de démarrage Agentopia invalide/); assert.equal(invalide.stdout, '');
    // Un runtime peut terminer avec 0 malgré une erreur ou un rendu jamais validé.
    // Le précontrôle doit refuser ces deux cas, sans filtrer la sortie du runtime.
    const { verifierInstallation } = await import('./dist/verifierInstallation.js');
    fs.writeFileSync(path.join(tuiFixture, 'lancer.ts'), "console.log('Interface Agentopia vérifiée (production) : accueil, cockpit, saisie, erreur visible et reprise'); console.error('Internal error: directory mismatch fixture');");
    await assert.rejects(verifierInstallation(fixture), /Internal error: directory mismatch fixture/);
    fs.writeFileSync(path.join(tuiFixture, 'lancer.ts'), "console.log('Rendu jamais terminé');");
    await assert.rejects(verifierInstallation(fixture), /vérification incomplète \(code 0\)/);
    // Le même index que le raccourci doit tester la production, même si
    // l'environnement appelant est en développement ou n'a pas NODE_ENV.
    const r = spawnSync(process.execPath, [path.join(racine, 'dist', 'index.js'), '--verifier-installation'], {
        cwd: temporaire, env: { ...env, NODE_ENV: 'development' }, encoding: 'utf8', windowsHide: true, timeout: 35_000,
    });
    assert.equal(r.status, 0, r.error?.message || r.stderr || r.stdout);
    assert.match(r.stdout, /moteurs, dépendances et interface vérifiés/);
    assert.doesNotMatch(r.stderr, /Internal error:|directory mismatch/i);
    console.log('✓ Démarrage et fermeture : production/développement, 3 tsconfig externes, cache froid/chaud, cwd/arguments conservés ; vrai lanceur Bun natif ou npm');
} finally {
    const relatif = path.relative(os.tmpdir(), temporaire);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif) && path.basename(temporaire).startsWith('agentopia-demarrage-test-')) fs.rmSync(temporaire, { recursive: true, force: true });
}

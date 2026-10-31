import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--cas-isole')) {
    test('GitHub : priorité, refus sans repli, autres fournisseurs et résultats tardifs isolés', () => {
        const r = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url), '--cas-isole'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
        assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /ISOLATION_GITHUB_OK/);
    });
} else {
    const config = { compteGitHub: 'CompteA', racines: [] }, demandes = [], appels = [];
    let invalide = false;
    const context = vm.createContext({ console, process: { env: {} }, URL, AbortSignal, Buffer, Response, setTimeout, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval });
    const stubs = {
        fs: {}, path: {}, events: { EventEmitter },
        './config.js': { chargerConfig: () => config },
        './githubLocal.js': { jetonCompteGitHub: async c => { appels.push(c); if (invalide) throw Error('indisponible'); return c; }, verifierCompteGitHub: async c => c },
        './jetons.js': { jeton: h => { appels.push(h); return 'vault'; }, prechargerJetons: async () => {} },
        './projets.js': { listerProjets: () => [] },
        './git.js': {
            lireDepot: async () => undefined, fetchTout: async () => [], cleDepot: s => s, trouverDepot: () => undefined,
            etatPR: {}, ajouterPRs: async () => {}, depotsDistants: () => new Promise(resoudre => demandes.push(resoudre)),
        },
    };
    const modules = new Map();
    async function charger(spec) {
        if (modules.has(spec)) return modules.get(spec);
        const valeurs = stubs[spec];
        const m = valeurs ? new vm.SyntheticModule(Object.keys(valeurs), function () { for (const [k, v] of Object.entries(valeurs)) this.setExport(k, v); }, { context })
            : new vm.SourceTextModule(fs.readFileSync(new URL(`dist/${spec.slice(2)}`, import.meta.url), 'utf8'), { context });
        modules.set(spec, m); await m.link(charger); return m;
    }
    const compte = await charger('./compteGitHub.js'); await compte.evaluate();
    assert.equal(await compte.namespace.cleGitHub(), 'CompteA'); assert.deepEqual(appels, ['CompteA']);
    invalide = true; await assert.rejects(compte.namespace.cleGitHub(), /indisponible/); assert.ok(!appels.includes('GitHub'));
    delete config.compteGitHub; assert.equal(await compte.namespace.cleGitHub(), 'vault'); assert.equal(appels.at(-1), 'GitHub');
    config.compteGitHub = 'CompteA';
    const synchro = await charger('./synchro.js'); await synchro.evaluate();
    const precedent = synchro.namespace.rafraichirDistants();
    demandes.shift()([{ hebergeur: 'GitHub', url: 'https://github.com/CompteA/prive', nom: 'A' }, { hebergeur: 'GitLab', url: 'https://gitlab.com/equipe/projet', nom: 'GL' }]); await precedent;
    const tardif = synchro.namespace.rafraichirDistants(); const finirAncien = demandes.shift();
    config.compteGitHub = 'CompteB'; const nouveau = synchro.namespace.actualiserCompteGitHub();
    assert.deepEqual(synchro.namespace.lireSynchro().nonClones.map(d => d.nom), ['GL']);
    demandes.shift()([{ hebergeur: 'GitHub', url: 'https://github.com/CompteB/prive', nom: 'B' }]); await nouveau;
    finirAncien([{ hebergeur: 'GitHub', url: 'https://github.com/CompteA/prive', nom: 'A' }]); await tardif;
    assert.deepEqual(synchro.namespace.lireSynchro().nonClones.map(d => d.nom), ['B']);
    console.log('ISOLATION_GITHUB_OK');
}

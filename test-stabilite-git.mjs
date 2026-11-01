import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-git-stable-'));
Object.assign(process.env, { CLAUDETOPIA_DATA_DIR: tmp, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1', AGENTOPIA_SANS_MOTEUR: '1', GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' });
const { executerProcessus, annulerOperationsGit } = await import('./dist/gitExecution.js');
const { commit } = await import('./dist/gitia.js');
const { bus } = await import('./dist/ui/bus.js');
let sequence = 0;
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 10_000 }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
function depot(initial = true) {
    const cwd = path.join(tmp, `projet-${++sequence}`); fs.mkdirSync(cwd); git(cwd, 'init', '-b', 'main');
    fs.writeFileSync(path.join(cwd, 'fichier.txt'), 'base\n'); git(cwd, 'add', '.');
    if (initial) { git(cwd, 'commit', '-m', 'base'); fs.appendFileSync(path.join(cwd, 'fichier.txt'), 'modification\n'); git(cwd, 'add', '.'); }
    return cwd;
}
async function parcours(cwd, personnaliser = () => false, proposer = async () => { throw new Error('Aucun agent ne doit être appelé.'); }) {
    const recevoir = d => {
        if (!d || personnaliser(d)) return;
        if (d.type === 'saisie') d.resoudre('feat: améliorer Québec 🚀\n\nMessage sans agent.');
        else if (d.message === 'Message du commit') d.resoudre('manuel');
        else if (d.message.startsWith('Valider le commit')) d.resoudre('commit');
        else if (d.message.startsWith('Rien n’est indexé')) d.resoudre(true);
    };
    bus.on('demande', recevoir);
    try { await commit({ nom: 'Projet fixture', chemin: cwd, racine: tmp }, { proposer }); }
    finally { bus.off('demande', recevoir); }
}
test.after(async () => { await annulerOperationsGit(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('processus : EOF envoyé et UTF-8 préservé entre fragments stdout/stderr', async () => {
    const message = 'Québec 🚀\n  indentation\n';
    const r = await executerProcessus(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], tmp, { entree: message, timeoutMs: 5000 });
    assert.equal(r.stdout, message); assert.equal(r.ok, true);
    const f = await executerProcessus(process.execPath, ['-e', "const b=Buffer.from('é🚀');process.stdout.write(b.subarray(0,1));process.stderr.write(b.subarray(0,3));setTimeout(()=>{process.stdout.write(b.subarray(1));process.stderr.write(b.subarray(3));},50)"], tmp);
    assert.equal(f.stdout, 'é🚀'); assert.equal(f.stderr, 'é🚀'); assert.ok(!f.sortie.includes('�'));
});
test('commit manuel : premier commit et message multiligne conservé sans fournisseur', async () => {
    const cwd = depot(false); await parcours(cwd);
    assert.equal(git(cwd, 'log', '-1', '--format=%B'), 'feat: améliorer Québec 🚀\n\nMessage sans agent.');
    assert.equal(git(cwd, 'status', '--porcelain'), '');
});

test('proposition avec un agent : modification et validation explicite restent possibles', async () => {
    const cwd = depot(); let appels = 0, validations = 0;
    await parcours(cwd, d => {
        if (d.type === 'saisie') { assert.equal(d.defaut, 'fix: proposition'); d.resoudre('fix: message relu'); return true; }
        if (d.message === 'Message du commit') { d.resoudre('agent'); return true; }
        if (d.message.startsWith('Valider le commit')) { d.resoudre(++validations === 1 ? 'modifier' : 'commit'); return true; }
        return false;
    }, async (prompt, chemin) => { appels++; assert.equal(chemin, cwd); assert.match(prompt, /modification/); return '```text\nfix: proposition\n```'; });
    assert.equal(appels, 1); assert.equal(validations, 2); assert.equal(git(cwd, 'log', '-1', '--format=%B'), 'fix: message relu');
});

test('annulation de la validation : aucun commit, index conservé', async () => {
    const cwd = depot(), head = git(cwd, 'rev-parse', 'HEAD'), arbre = git(cwd, 'write-tree');
    await parcours(cwd, d => { if (!d.message.startsWith('Valider le commit')) return false; d.resoudre('annuler'); return true; });
    assert.equal(git(cwd, 'rev-parse', 'HEAD'), head); assert.equal(git(cwd, 'write-tree'), arbre);
});
test('index, HEAD ou branche changé après aperçu : refus, fichiers et index conservés', async () => {
    for (const type of ['index', 'head', 'branche']) {
        const cwd = depot(); let attendu;
        await assert.rejects(parcours(cwd, d => {
            if (!d.message.startsWith('Valider le commit')) return false;
            if (type === 'index') { fs.writeFileSync(path.join(cwd, 'ajout.txt'), 'Autre outil\n'); git(cwd, 'add', '.'); }
            if (type === 'head') { const sha = git(cwd, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Autre outil'); git(cwd, 'update-ref', 'HEAD', sha); }
            if (type === 'branche') git(cwd, 'switch', '-c', 'autre');
            attendu = { head: git(cwd, 'rev-parse', 'HEAD'), arbre: git(cwd, 'write-tree'), branche: git(cwd, 'symbolic-ref', 'HEAD') };
            d.resoudre('commit'); return true;
        }), /changé depuis l’aperçu/);
        assert.deepEqual({ head: git(cwd, 'rev-parse', 'HEAD'), arbre: git(cwd, 'write-tree'), branche: git(cwd, 'symbolic-ref', 'HEAD') }, attendu);
        assert.match(fs.readFileSync(path.join(cwd, 'fichier.txt'), 'utf8'), /modification/);
    }
});
test('hook refusé : aucun commit ni push malgré le choix Committer et pousser', async () => {
    const cwd = depot(), avant = git(cwd, 'rev-parse', 'HEAD'), distant = path.join(tmp, 'distant.git'); fs.mkdirSync(distant); git(distant, 'init', '--bare'); git(cwd, 'remote', 'add', 'origin', distant);
    fs.writeFileSync(path.join(cwd, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho Refus-fixture >&2\nexit 9\n', { mode: 0o755 });
    await parcours(cwd, d => { if (!d.message.startsWith('Valider le commit')) return false; d.resoudre('push'); return true; });
    assert.equal(git(cwd, 'rev-parse', 'HEAD'), avant); assert.equal(git(distant, 'for-each-ref'), '');
    assert.ok(git(cwd, 'diff', '--cached', '--name-only').includes('fichier.txt'));
});
test('échec de git add : arrêt avant message, aucun index écrasé', async () => {
    const cwd = depot(); git(cwd, 'reset'); fs.writeFileSync(path.join(cwd, '.git', 'index.lock'), 'verrou fixture');
    let messageDemande = false;
    await assert.rejects(parcours(cwd, d => { if (d.message === 'Message du commit') messageDemande = true; return false; }), /index.lock/);
    assert.equal(messageDemande, false); assert.equal(fs.readFileSync(path.join(cwd, '.git', 'index.lock'), 'utf8'), 'verrou fixture');
});
test('hook lent : interface réactive, interruption explicite, aucun commit créé', async () => {
    const cwd = depot(), avant = git(cwd, 'rev-parse', 'HEAD'), marqueur = path.join(tmp, 'hook-pret');
    const script = path.join(tmp, 'hook-lent.mjs'); fs.writeFileSync(script, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marqueur)},String(process.pid));setInterval(()=>{},1000);`);
    const sh = s => `'${s.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(path.join(cwd, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\nexec ${sh(process.execPath)} ${sh(script)}\n`, { mode: 0o755 });
    let dialogue, tours = 0; const debut = Date.now();
    const timer = setInterval(() => { tours++; if (dialogue && (fs.existsSync(marqueur) || Date.now() - debut > 10_000)) { dialogue.resoudre(undefined); dialogue = undefined; } }, 20);
    try { await assert.rejects(parcours(cwd, d => { if (d.message === 'Création du commit') dialogue = d; return false; }), /annulée|interrompue/); }
    finally { clearInterval(timer); }
    assert.ok(tours > 2); assert.ok(fs.existsSync(marqueur)); assert.equal(git(cwd, 'rev-parse', 'HEAD'), avant);
});
test('processus : timeout, sortie bornée et attente de fermeture des opérations', async () => {
    await assert.rejects(executerProcessus(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmp, { timeoutMs: 150 }), /Durée maximale/);
    await assert.rejects(executerProcessus(process.execPath, ['-e', "setInterval(()=>process.stdout.write('x'.repeat(2000)),20)"], tmp, { maxOctets: 1000 }), /Sortie maximale/);
    const r = assert.rejects(executerProcessus(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmp), /annulée/);
    await new Promise(ok => setTimeout(ok, 80)); await annulerOperationsGit(); await r;
});

test('push interrompu : commit conservé, hook arrêté et envoi non confirmé', async () => {
    const cwd = depot(), distant = path.join(tmp, 'push-interrompu.git'); fs.mkdirSync(distant); git(distant, 'init', '--bare');
    git(cwd, 'remote', 'add', 'origin', distant); git(cwd, 'push', '-u', 'origin', 'main');
    const avant = git(distant, 'rev-parse', 'refs/heads/main'), marqueur = path.join(tmp, 'push-pret');
    const script = path.join(tmp, 'push-lent.mjs'); fs.writeFileSync(script, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marqueur)},String(process.pid));setInterval(()=>{},1000);`);
    const sh = s => `'${s.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(path.join(cwd, '.git', 'hooks', 'pre-push'), `#!/bin/sh\nexec ${sh(process.execPath)} ${sh(script)}\n`, { mode: 0o755 });
    let dialogue; const debut = Date.now();
    const timer = setInterval(() => { if (dialogue && (fs.existsSync(marqueur) || Date.now() - debut > 10_000)) { dialogue.resoudre('interrompre'); dialogue = undefined; } }, 20);
    try { await assert.rejects(parcours(cwd, d => {
        if (d.message.startsWith('Valider le commit')) { d.resoudre('push'); return true; }
        if (d.message === 'Envoi du commit') dialogue = d;
        return false;
    }), /Commit conservé. Envoi non confirmé/); }
    finally { clearInterval(timer); }
    assert.ok(fs.existsSync(marqueur)); assert.notEqual(git(cwd, 'rev-parse', 'HEAD'), avant);
    assert.equal(git(distant, 'rev-parse', 'refs/heads/main'), avant);
    const pid = Number(fs.readFileSync(marqueur, 'utf8')); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

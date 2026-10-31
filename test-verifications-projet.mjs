import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-verifications-'));
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'profil');
process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.mkdirSync(process.env.CLAUDETOPIA_DATA_DIR);
fs.writeFileSync(path.join(process.env.CLAUDETOPIA_DATA_DIR, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false } }));
const v = await import('./dist/verificationProjet.js');
const { CHEMINS } = await import('./dist/chemins.js');
const { processusVivant } = await import('./dist/verrou.js');
const equipes = [];
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function attendre(fn, limite = 10_000) { const fin = Date.now() + limite; while (Date.now() < fin) { if (fn()) return; await pause(40); } assert.fail('Condition non atteinte dans le délai'); }
async function arreterPID(pid) {
    if (!pid || !processusVivant(pid)) return;
    if (process.platform === 'win32') await new Promise((ok) => { const t = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); t.once('close', ok); });
    else { try { process.kill(-pid, 'SIGKILL'); } catch {} }
}
function enregistrer() { fs.writeFileSync(CHEMINS.equipes, JSON.stringify(equipes)); }
function fixture(nom, code = "console.log('CHECK_OK CI=' + process.env.CI)", scripts = { check: 'node check.cjs' }) {
    const dossier = path.join(racine, nom); fs.mkdirSync(dossier);
    fs.writeFileSync(path.join(dossier, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', packageManager: 'npm@10.0.0', scripts }));
    const suivi = "require('fs').mkdirSync('runtime',{recursive:true}); require('fs').writeFileSync('runtime/runner.pid',String(process.pid));\n";
    fs.writeFileSync(path.join(dossier, 'check.cjs'), suivi + code); fs.writeFileSync(path.join(dossier, 'source.txt'), 'source initiale\n');
    fs.writeFileSync(path.join(dossier, '.gitignore'), 'runtime/\n');
    git(dossier, 'init', '-b', 'main'); git(dossier, 'config', 'user.name', 'Fixture'); git(dossier, 'config', 'user.email', 'fixture@example.test');
    git(dossier, 'config', 'core.autocrlf', 'false'); git(dossier, 'add', '.'); git(dossier, 'commit', '-m', 'Base');
    const equipe = { id: nom, projet: dossier, nomProjet: nom, objectif: 'Vérifier', resume: '', creee: Date.now(), etat: 'prete', mixte: true,
        taches: [{ id: 't1', titre: 'Tâche', role: 'dev', consigne: 'Vérifier', dependances: [], etat: 'faite', fournisseur: 'codex', branche: 'main' }] };
    equipes.push(equipe); enregistrer();
    const cible = { equipe: nom, dossier, titre: 'Projet · branche actuelle' };
    return { dossier, equipe, cible, commande: () => { const d = v.detecterVerifications(dossier); assert.ok(d.commandes.length, d.explication); return d.commandes.find((c) => c.script === 'check') || d.commandes[0]; } };
}
after(async () => {
    // Les fixtures enregistrent leurs PID : jamais de recherche globale ni de kill par nom.
    for (const e of equipes) for (const nom of ['runner.pid', 'enfant.pid', 'commande.pid']) {
        try { await arreterPID(Number(fs.readFileSync(path.join(e.projet, 'runtime', nom), 'utf8'))); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    await pause(300);
    const relatif = path.relative(os.tmpdir(), racine);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) await fs.promises.rm(racine, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

test('détection : scripts existants, gestionnaire explicite, pas de watch, ni commande inventée', () => {
    const f = fixture('detection', '', { check: 'node check.cjs', test: 'node check.cjs', 'test:watch': 'vitest --watch', 'test:unit': 'node check.cjs',
        'test:all': 'jest --watchAll', dev: 'vite', lint: 123, 'test;injection': 'echo non', 'check:enorme': 'x'.repeat(17_000) });
    const d = v.detecterVerifications(f.dossier);
    assert.deepEqual(d.commandes.map((c) => c.script), ['check', 'test', 'test:unit']);
    assert.ok(d.commandes.every((c) => c.commande === `npm run ${c.script}`));
    const p = JSON.parse(fs.readFileSync(path.join(f.dossier, 'package.json'))); delete p.packageManager;
    fs.writeFileSync(path.join(f.dossier, 'package.json'), JSON.stringify(p));
    fs.writeFileSync(path.join(f.dossier, 'yarn.lock'), ''); fs.writeFileSync(path.join(f.dossier, 'pnpm-lock.yaml'), '');
    assert.equal(v.detecterVerifications(f.dossier).commandes.length, 0);
    assert.match(v.detecterVerifications(f.dossier).explication, /Plusieurs gestionnaires/);
    assert.match(v.detecterVerifications(racine).explication, /Aucun package.json/);
});

test('empreinte : distinguer deux changements sales, non suivis, HEAD et capture incomplète', async () => {
    const f = fixture('empreinte'); const propre = await v.capturerProjet(f.dossier); assert.ok(propre.empreinte, propre.erreur);
    fs.writeFileSync(path.join(f.dossier, 'source.txt'), 'premier changement\n'); const premier = await v.capturerProjet(f.dossier);
    const etat = git(f.dossier, 'status', '--porcelain');
    fs.writeFileSync(path.join(f.dossier, 'source.txt'), 'deuxieme changement\n'); const second = await v.capturerProjet(f.dossier);
    assert.equal(git(f.dossier, 'status', '--porcelain'), etat); assert.notEqual(premier.empreinte, second.empreinte);
    fs.writeFileSync(path.join(f.dossier, 'nouveau.txt'), 'non suivi'); const nonSuivi = await v.capturerProjet(f.dossier);
    assert.notEqual(nonSuivi.empreinte, second.empreinte); assert.equal(nonSuivi.head, propre.head);
    git(f.dossier, 'add', '.'); git(f.dossier, 'commit', '-m', 'Avance'); assert.notEqual((await v.capturerProjet(f.dossier)).head, propre.head);
    const limitee = await v.capturerProjet(f.dossier, undefined, { fichiers: 1, octets: 64 }); assert.equal(limitee.empreinte, undefined); assert.match(limitee.erreur, /limitée/);
    assert.equal(v.etatVerification({ resultat: 'reussi', avant: limitee, apres: limitee }, limitee), 'inconnu');
});

test('commande réelle : code, dates, HEAD, journal persistent ; aucun changement de statut équipe', async () => {
    const f = fixture('succes'); const etat = fs.readFileSync(CHEMINS.equipes, 'utf8');
    assert.equal(v.etatVerification(), 'non verifie');
    const p = await v.executerVerification(f.cible, f.commande());
    assert.equal(p.resultat, 'reussi'); assert.equal(p.codeSortie, 0); assert.ok(p.fin >= p.debut);
    assert.equal(p.avant.head, git(f.dossier, 'rev-parse', 'HEAD')); assert.ok(p.pidExecution > 0);
    assert.match(v.lireJournalVerification(p), /CHECK_OK CI=1/);
    assert.equal(v.etatVerification(p, await v.capturerProjet(f.dossier)), 'reussi');
    assert.equal(fs.readFileSync(CHEMINS.equipes, 'utf8'), etat, 'Une commande réussie ne doit ni fusionner ni terminer une équipe');
    assert.equal(v.lirePreuvesVerification(f.equipe.id)[0].codeSortie, 0);
    // Windows réutilise vite les PID sous la suite parallèle. Modéliser un reçu
    // orphelin avec un PID vérifié absent, sans dépendre de l'ancien PID du runner.
    let pidAbsent = 1_000_000_000; while (processusVivant(pidAbsent)) pidAbsent++;
    assert.equal(v.etatVerification({ ...p, pidExecution: pidAbsent, resultat: 'en cours' }), 'inconnu', 'Un reçu final non écrit ne prouve pas l’arrêt des descendants');
    assert.ok(!path.relative(f.dossier, p.journal).startsWith('runtime'));
    fs.writeFileSync(path.join(f.dossier, 'source.txt'), 'après vérification');
    assert.equal(v.etatVerification(p, await v.capturerProjet(f.dossier)), 'perime');
    const dossier = path.dirname(p.journal);
    fs.writeFileSync(path.join(dossier, '9999999999999-bad.json'), JSON.stringify({ ...p, id: '9999999999999-bad', cible: { ...p.cible, dossier: 42 } }));
    fs.writeFileSync(path.join(dossier, '9999999999998-bad.json'), '{');
    assert.equal(v.lirePreuvesVerification(f.equipe.id).length, 1, 'Des reçus corrompus ne doivent pas casser le bilan');
});

test('échec et changement pendant exécution : code non nul et réussite périmée restent distincts', async () => {
    const f = fixture('echec', "console.error('ECHEC_ATTENDU'); process.exit(7)");
    const erreur = await v.executerVerification(f.cible, f.commande());
    assert.equal(erreur.codeSortie, 7); assert.equal(v.etatVerification(erreur, await v.capturerProjet(f.dossier)), 'echoue');
    const change = fixture('change-pendant', "require('fs').writeFileSync('source.txt', 'modifié par le script'); console.log('OK')");
    const p = await v.executerVerification(change.cible, change.commande());
    assert.equal(p.codeSortie, 0); assert.equal(p.resultat, 'reussi'); assert.equal(v.etatVerification(p, await v.capturerProjet(change.dossier)), 'perime');
});

test('gardes : commande changée, agent actif et dossier différent refusés avant lancement', async () => {
    const f = fixture('gardes'); const c = f.commande();
    const avant = v.lirePreuvesVerification(f.equipe.id).length;
    const fichier = path.join(f.dossier, 'package.json'); const original = fs.readFileSync(fichier, 'utf8');
    const nouveau = JSON.parse(original); nouveau.scripts.check = 'node autre.cjs'; fs.writeFileSync(fichier, JSON.stringify(nouveau));
    await assert.rejects(v.executerVerification(f.cible, c), /script ou son gestionnaire a changé/);
    fs.writeFileSync(fichier, original); f.equipe.etat = 'integration'; enregistrer();
    await assert.rejects(v.executerVerification(f.cible, c), /arrêt effectif/);
    f.equipe.etat = 'prete'; enregistrer();
    await assert.rejects(v.executerVerification({ ...f.cible, dossier: racine }, c), /ne correspond plus/);
    assert.equal(v.lirePreuvesVerification(f.equipe.id).length, avant);
});

test('limites : délai et sortie arrêtent la commande et produisent une preuve interrompue', async () => {
    const temps = fixture('duree', "setInterval(() => {}, 1000)");
    const p = await v.executerVerification(temps.cible, temps.commande(), { dureeMs: 1200 });
    assert.equal(p.resultat, 'interrompu'); assert.match(p.raison, /Durée maximale/); assert.equal(v.etatVerification(p), 'interrompu');
    const sortie = fixture('sortie', "process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000)");
    const limite = await v.executerVerification(sortie.cible, sortie.commande(), { octets: 1024 });
    assert.equal(limite.resultat, 'interrompu'); assert.match(limite.raison, /Limite du journal/);
    assert.ok(fs.statSync(limite.journal).size <= 1024);
});

test('annulation réelle : tuer uniquement le processus lancé et son enfant', async () => {
    const f = fixture('enfant', "const fs = require('fs'); const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'}); fs.mkdirSync('runtime', {recursive:true}); fs.writeFileSync('runtime/enfant.pid', String(c.pid)); console.log('ENFANT_PRET'); setInterval(() => {}, 1000)");
    const abort = new AbortController(); let texte = '';
    const p = await v.executerVerification(f.cible, f.commande(), { signal: abort.signal, progression: (s) => {
        texte += s; if (texte.includes('ENFANT_PRET')) abort.abort();
    } });
    const pid = Number(fs.readFileSync(path.join(f.dossier, 'runtime', 'enfant.pid'), 'utf8'));
    assert.equal(p.resultat, 'interrompu'); assert.match(p.raison, /ta demande/);
    await attendre(() => !processusVivant(pid)); assert.equal(processusVivant(process.pid), true);
});

test('fermeture brutale de l’interface : la commande survivante empêche un deuxième lancement', async () => {
    const f = fixture('orpheline', "const fs=require('fs'); fs.mkdirSync('runtime',{recursive:true}); fs.writeFileSync('runtime/commande.pid',String(process.pid)); console.log('EN_COURS'); setInterval(() => {}, 1000)");
    const module = pathToFileURL(path.resolve('dist/verificationProjet.js')).href;
    const source = `import * as v from ${JSON.stringify(module)}; await v.executerVerification(${JSON.stringify(f.cible)}, v.detecterVerifications(${JSON.stringify(f.dossier)}).commandes[0]);`;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true, stdio: 'ignore', env: process.env });
    let p;
    try {
        await attendre(() => { p = v.lirePreuvesVerification(f.equipe.id)[0]; return p?.pidExecution && v.lireJournalVerification(p).includes('EN_COURS'); });
        parent.kill(); await new Promise((ok) => parent.once('close', ok));
        const vivant = processusVivant(p.pidExecution);
        assert.equal(v.etatVerification(p), vivant ? 'en cours' : 'inconnu');
        await assert.rejects(v.executerVerification(f.cible, f.commande()), /encore active|arrêt.*pas été confirmé/);
    } finally {
        if (parent.exitCode === null && parent.signalCode === null) parent.kill();
        await arreterPID(p?.pidExecution);
        const pid = path.join(f.dossier, 'runtime', 'commande.pid');
        if (fs.existsSync(pid)) await arreterPID(Number(fs.readFileSync(pid, 'utf8')));
    }
});

test('arrêt refusé : retour borné, preuve non confirmée et deuxième lancement bloqué', async () => {
    const f = fixture('arret-refuse', "console.log('PRET'); setInterval(() => {}, 1000)");
    let p;
    try {
        const debut = Date.now();
        p = await v.executerVerification(f.cible, f.commande(), { dureeMs: 1500, arreter: async () => false });
        assert.ok(Date.now() - debut < 8000, 'L’interface ne doit pas attendre indéfiniment un arrêt refusé');
        assert.equal(p.arretNonConfirme, true); assert.equal(p.fin, undefined); assert.match(p.raison, /arrêt non confirmé/);
        assert.equal(v.etatVerification(p), 'en cours'); assert.equal(processusVivant(p.pidExecution), true);
        await assert.rejects(v.executerVerification(f.cible, f.commande()), /arrêt.*pas été confirmé/);
    } finally { await arreterPID(p?.pidExecution); }
});

test('sortie normale de l’application : tenter l’arrêt de la commande et de son enfant', async () => {
    const f = fixture('sortie-application', "console.log('EN_COURS'); setInterval(() => {}, 1000)");
    const module = pathToFileURL(path.resolve('dist/verificationProjet.js')).href;
    const source = `import * as v from ${JSON.stringify(module)}; await v.executerVerification(${JSON.stringify(f.cible)}, v.detecterVerifications(${JSON.stringify(f.dossier)}).commandes[0], {progression: (s) => { if (s.includes('EN_COURS')) process.exit(0); }});`;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true, stdio: 'ignore', env: process.env });
    try {
        await new Promise((ok) => parent.once('close', ok));
        assert.equal(parent.exitCode, 0);
        const p = v.lirePreuvesVerification(f.equipe.id)[0]; assert.ok(p?.pidExecution);
        await attendre(() => !processusVivant(p.pidExecution)); assert.equal(v.etatVerification(p), 'interrompu');
        const abort = new AbortController();
        const relance = await v.executerVerification(f.cible, f.commande(), { signal: abort.signal,
            progression: (s) => { if (s.includes('EN_COURS')) abort.abort(); } });
        assert.equal(relance.resultat, 'interrompu', 'Une vraie fermeture propre doit libérer la vérification suivante');
    } finally { await arreterPID(v.lirePreuvesVerification(f.equipe.id)[0]?.pidExecution); }
});

test('parent terminé et fermeture des flux non confirmée : conserver le marqueur après sortie UI', async () => {
    const enfant = "process.on('error',()=>{}); process.stdout.on('error',()=>{}); process.stdout.write('ENFANT_PRET\\n'); process.send('pret',()=>{}); setInterval(()=>process.stdout.write('vivant\\n'),200)";
    const f = fixture('parent-termine', `const fs=require('fs'); const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(enfant)}],{stdio:['ignore','inherit','inherit','ipc']}); fs.mkdirSync('runtime',{recursive:true}); fs.writeFileSync('runtime/enfant.pid',String(c.pid)); c.once('message',()=>process.exit(0));`);
    const module = pathToFileURL(path.resolve('dist/verificationProjet.js')).href;
    const source = `import {spawn} from 'node:child_process'; import * as v from ${JSON.stringify(module)};
        const abort=new AbortController();
        const p=await v.executerVerification(${JSON.stringify(f.cible)},v.detecterVerifications(${JSON.stringify(f.dossier)}).commandes[0],
        {signal:abort.signal,dureeMs:10000,lancer:(_programme,_args,options)=>{const c=spawn(process.execPath,[${JSON.stringify(path.join(f.dossier, 'check.cjs'))}],options); const emit=c.emit.bind(c); c.emit=(event,...args)=>event==='close' ? true : emit(event,...args); c.once('exit',()=>setImmediate(()=>abort.abort())); return c;}});
        process.exit(p.arretNonConfirme ? 0 : 2);`;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true, stdio: 'ignore', env: process.env });
    let p;
    try {
        // Le close de ChildProcess est contrôlé : Windows peut le délivrer dès l'exit
        // malgré stdio inherit. Le parent et son descendant restent de vrais processus.
        // Détruire les flux ne doit pas confirmer l'arrêt de ce descendant à la sortie UI.
        await new Promise((ok) => parent.once('close', ok)); p = v.lirePreuvesVerification(f.equipe.id)[0];
        assert.equal(parent.exitCode, 0, JSON.stringify({ resultat: p?.resultat, raison: p?.raison, code: p?.codeSortie, journal: p && v.lireJournalVerification(p) }));
        assert.equal(p.arretNonConfirme, true); assert.equal(v.etatVerification(p), 'inconnu');
        assert.equal(processusVivant(p.pidExecution), false);
        const enfant = Number(fs.readFileSync(path.join(f.dossier, 'runtime', 'enfant.pid'), 'utf8'));
        assert.ok(enfant > 0, 'Le descendant réel a signalé son démarrage ; sa fin n’a pas été confirmée par le runner');
        await assert.rejects(v.executerVerification(f.cible, f.commande()), /arrêt.*pas été confirmé/);
    } finally {
        if (parent.exitCode === null && parent.signalCode === null) parent.kill();
        const fichier = path.join(f.dossier, 'runtime', 'enfant.pid');
        if (fs.existsSync(fichier)) await arreterPID(Number(fs.readFileSync(fichier, 'utf8')));
        await arreterPID(p?.pidExecution);
    }
});

test('commande projet explicite : vraie exécution Node et preuve invalidée si arguments modifiés', async () => {
    const f = fixture('verification-personnalisee');
    const manifeste = { verifications: [{ nom: 'smoke', programme: 'node', args: ['-e', "console.log('VERIFICATION_EXPLICITE_OK')"] }] };
    const fichier = path.join(f.dossier, 'agentopia.json');
    fs.writeFileSync(fichier, JSON.stringify(manifeste));
    const commande = v.detecterVerifications(f.dossier).commandes.find((c) => c.script === 'projet:smoke');
    assert.ok(commande);
    const preuve = await v.executerVerification(f.cible, commande);
    assert.equal(preuve.resultat, 'reussi');
    assert.match(v.lireJournalVerification(preuve), /VERIFICATION_EXPLICITE_OK/);
    manifeste.verifications[0].args[1] = 'process.exit(2)';
    fs.writeFileSync(fichier, JSON.stringify(manifeste));
    await assert.rejects(v.executerVerification(f.cible, commande), /changé/);
});

test('Python réel : unittest détecté, résultat et journal conservés', async (t) => {
    const f = fixture('verification-python');
    fs.writeFileSync(path.join(f.dossier, 'pyproject.toml'), '[project]\nname="fixture-agentopia"\nversion="0.0.0"\n');
    fs.mkdirSync(path.join(f.dossier, 'tests'));
    fs.writeFileSync(path.join(f.dossier, 'tests', 'test_fixture.py'), 'import unittest\nclass Fixture(unittest.TestCase):\n    def test_execution(self):\n        self.assertEqual(2 + 2, 4)\n');
    const commande = v.detecterVerifications(f.dossier).commandes.find((c) => c.script === 'python:unittest');
    if (!commande) { t.skip('Python absent du PATH de ce runner'); return; }
    const preuve = await v.executerVerification(f.cible, commande);
    assert.equal(preuve.resultat, 'reussi', v.lireJournalVerification(preuve));
    assert.match(v.lireJournalVerification(preuve), /Ran 1 test/);
});

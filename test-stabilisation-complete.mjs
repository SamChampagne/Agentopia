import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-stabilisation-'));
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'profil');
process.env.CLAUDETOPIA_TEST_UI = '1';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.mkdirSync(process.env.CLAUDETOPIA_DATA_DIR);
const types = await import('./dist/providers/types.js');
const config = await import('./dist/config.js');
const v = await import('./dist/verificationProjet.js');
const diag = await import('./dist/diagnostics.js');
const { creerFluxClaude } = await import('./dist/providers/fluxClaude.js');
after(() => { assert.ok(path.resolve(racine).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(racine, { recursive: true, force: true }); });

test('registre : capacités explicites, modèle automatique et identifiant modèle validé', async () => {
    const { ADAPTATEURS, executerFournisseur } = await import('./dist/providers/registre.js');
    assert.deepEqual(Object.keys(ADAPTATEURS).sort(), Object.keys(types.FOURNISSEURS).sort());
    assert.equal(types.capacitesFournisseur('perplexity').fichiers, false);
    assert.equal(types.capacitesFournisseur('perplexity').historiqueLocal, true);
    assert.equal(types.capacitesFournisseur('claude').flux, true);
    assert.throws(() => types.capacitesFournisseur('__proto__'));
    assert.throws(() => types.validerModele('model\ncommande'));
    assert.equal(types.validerModele('provider/model-v2'), 'provider/model-v2');
    assert.equal(await executerFournisseur({ session: { fournisseur: 'codex', modele: 'mon-modele' } }, { codex: async (c) => c.session.modele }), 'mon-modele');
    assert.throws(() => executerFournisseur({ session: { fournisseur: 'perplexity', modele: 'inapplicable' } }));
});
test('configuration : bornes de concurrence et modèles/preparation validées', () => {
    assert.equal(config.normaliserConfig({}).equipe.paralleleGlobal, 3);
    assert.throws(() => config.normaliserConfig({ equipe: { paralleleGlobal: -1 } }));
    assert.throws(() => config.normaliserConfig({ equipe: { parFournisseur: { inconnu: 2 } } }));
    assert.throws(() => config.normaliserConfig({ modelesFournisseurs: { perplexity: 'inventé' } }));
    assert.throws(() => config.normaliserConfig({ preparationProjets: [{ projet: racine, fichiersLocaux: ['../secret'] }] }));
    assert.equal(config.normaliserConfig({ modelesFournisseurs: { codex: 'modele-test' } }).modelesFournisseurs.codex, 'modele-test');
});
test('historique fournisseur : dernière fenêtre, lignes invalides et annulation explicites', async () => {
    const { lireContexteLocal } = await import('./dist/providers/historique.js');
    const f = path.join(racine, 'historique.jsonl');
    fs.writeFileSync(f, Array.from({ length: 200 }, (_, i) => JSON.stringify({ type: i % 2 ? 'assistant' : 'user', message: { content: `message ${i} éà` } })).join('\n') + '\n');
    const h = await lireContexteLocal(f, new AbortController().signal);
    assert.equal(h.length, 20); assert.equal(h[0].content, 'message 180 éà'); assert.equal(h.at(-1).content, 'message 199 éà');
    const c = new AbortController(); c.abort(); await assert.rejects(lireContexteLocal(f, c.signal));
    fs.appendFileSync(f, '{incorrect}\n'); await assert.rejects(lireContexteLocal(f, new AbortController().signal), /illisible/);
});
test('Claude : deltas remplacés par message final, détails outils et interruption', () => {
    const etat = new Map(), flux = creerFluxClaude((e) => etat.set(e.id, e));
    const stream = (event) => flux.recevoir({ type: 'stream_event', event });
    stream({ type: 'message_start', message: { id: 'msg1' } });
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bonjour' } });
    stream({ type: 'content_block_stop', index: 0 });
    flux.recevoir({ type: 'assistant', message: { id: 'msg1', content: [{ type: 'text', text: 'Bonjour final' }, { type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'node --version' } }] } });
    flux.recevoir({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bash1', content: 'code failure', is_error: true }] } });
    flux.recevoir({ type: 'assistant', message: { id: 'msg2', content: [{ type: 'tool_use', id: 'read2', name: 'Read', input: { file_path: 'README.md' } }] } });
    flux.fermer(false);
    assert.equal([...etat.values()].filter((x) => x.role === 'assistant').length, 1);
    assert.equal(etat.get('msg1:0').texte, 'Bonjour final');
    assert.equal(etat.get('outil:bash1').etat, 'erreur');
    assert.equal(etat.get('outil:bash1').sortie, 'code failure');
    assert.equal(etat.get('outil:bash1').commande, 'node --version');
    assert.equal(etat.get('outil:read2').etat, 'interrompu');
});
test('diagnostics : persistance et export n’incluent aucun message, chemin ou secret', () => {
    const secret = 'sk-faux-secret-test-uniquement', chemin = 'C:\\Users\\personne\\projet';
    diag.journaliserDiagnostic('test.execution', Object.assign(new Error(`${secret} ${chemin} prompt confidentiel`), { code: 'EACCES' }), 'session-personnelle');
    const rapport = diag.rapportDiagnostic({ actif: true, enPause: false, version: '1.4.0-beta.12' });
    const texte = JSON.stringify(rapport);
    assert.ok(rapport.evenements.some((d) => d.code === 'EACCES' && d.operation === 'test.execution'));
    for (const interdit of [secret, chemin, 'confidentiel', 'session-personnelle']) assert.equal(texte.includes(interdit), false);
    assert.ok(rapport.evenements[0].correlation.length === 16);
});
test('vérification projet : commande explicite sans shell, modification du manifeste détectable', () => {
    const dossier = path.join(racine, 'custom'); fs.mkdirSync(dossier);
    const manifeste = { verifications: [{ nom: 'smoke', programme: 'node', args: ['-e', "console.log('argument ; $ ; conservé')"] }] };
    fs.writeFileSync(path.join(dossier, 'agentopia.json'), JSON.stringify(manifeste));
    const a = v.detecterVerifications(dossier).commandes[0]; assert.ok(a);
    assert.equal(a.gestionnaire, 'projet');
    assert.deepEqual(v.invocationVerification(a).args, manifeste.verifications[0].args);
    manifeste.verifications[0].args[1] = 'process.exit(1)'; fs.writeFileSync(path.join(dossier, 'agentopia.json'), JSON.stringify(manifeste));
    assert.notEqual(v.detecterVerifications(dossier).commandes[0].manifeste, a.manifeste);
    manifeste.verifications[0].programme = 'node && autre'; fs.writeFileSync(path.join(dossier, 'agentopia.json'), JSON.stringify(manifeste));
    assert.equal(v.detecterVerifications(dossier).commandes.length, 0);
});
test('vérification Python et .NET : détection sans installer de dépendance', () => {
    const dossier = path.join(racine, 'langages'); fs.mkdirSync(dossier);
    fs.writeFileSync(path.join(dossier, 'pyproject.toml'), '[tool.pytest.ini_options]\ntestpaths=["tests"]');
    fs.writeFileSync(path.join(dossier, 'Tests.csproj'), '<Project Sdk="Microsoft.NET.Sdk"/>');
    const r = v.detecterVerifications(dossier);
    for (const [nom, args] of [['python', ['-m', 'pytest']], ['dotnet', ['test', 'Tests.csproj', '--no-restore', '--nologo']]]) {
        const c = r.commandes.find((c) => c.gestionnaire === nom);
        if (c) assert.deepEqual(c.args, args); else assert.match(r.explication, new RegExp(nom + '.*absent|python3.*absent'));
    }
});
test('surveillance Docker : binaire absent et sortie énorme restent contrôlés', async () => {
    const { surveiller, listeSurveillances } = await import('./dist/surveillanceLogs.js');
    const { bus } = await import('./dist/ui/bus.js');
    const enfant = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
    let notices = []; const observer = (s) => notices.push(s); bus.on('notice', observer);
    const avant = process.listenerCount('exit');
    const s = surveiller({ nom: 'local' }, { id: 'fixture', nom: 'fixture' }, 'jamais-correspondre', () => enfant);
    enfant.stdout.emit('data', Buffer.from('a'.repeat(200_000) + '\n'));
    assert.ok(s.recentes.every((l) => l.length <= 4000));
    enfant.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    assert.equal(listeSurveillances().length, 0);
    assert.equal(process.listenerCount('exit'), avant);
    assert.ok(notices.some((n) => n.includes('inaccessible')));
    bus.off('notice', observer);
    assert.throws(() => surveiller({ nom: 'local' }, { id: 'fixture' }, '[', () => assert.fail('Ne doit pas lancer')));
});

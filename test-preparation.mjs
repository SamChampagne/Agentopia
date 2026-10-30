import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-stabilite-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
fs.writeFileSync(path.join(racine, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const { preparerPoste, lirePreparation, preparationAReprendre } = await import('./dist/preparation.js');
const { Annule } = await import('./dist/ui/bus.js');
const { surPath, oublierPath, CHEMINS } = await import('./dist/chemins.js');
const { listerCodex, messagesCodex, importerCodex } = await import('./dist/historiqueAgents.js');
const { dossierIntegre } = await import('./dist/sessionsIntegrees.js');
const { fournisseurMaitre, validerPlanMaitre, conseiller } = await import('./dist/conseiller.js');
const { executerCodex } = await import('./dist/providers/codex.js');
after(() => {
    const rel = path.relative(os.tmpdir(), racine);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true });
});
const config = () => ({ racines: [], extras: [], fournisseurDefaut: 'choisir', maitre: { actif: false } });
const projet = (nom) => ({ nom, chemin: path.join(racine, nom), activite: new Date(), types: [], worktree: false });
const services = (s = {}) => ({ scanner: async () => ({ projets: [], outils: [] }), choisir: async () => assert.fail('Question inattendue'), choisirPlusieurs: async () => [],
    verifier: async () => ({ pret: true, texte: 'Connecté' }), connecter: async () => assert.fail('Connexion inattendue'), installer: async () => assert.fail('Installation inattendue'),
    present: () => 'fixture.exe', disponibilite: () => ({ pret: true, texte: 'Détecté' }), sauvegarderConfig() {}, rafraichir: async () => {}, historique: async () => ({ conversations: [], date: 0 }), ...s });
const fichier = (nom) => path.join(racine, `${nom}.json`);

test('le premier lancement après mise à niveau prépare aussi un profil existant', () => {
    assert.equal(preparationAReprendre(), true);
    fs.writeFileSync(CHEMINS.preparation, JSON.stringify({ version: 1, projetsVus: [], ignores: [], projetsTermines: true, selection: [], etats: {}, terminee: true }));
    assert.equal(preparationAReprendre(), false);
});

test('un Git découvert hors PATH devient disponible aux sous-processus sans relancer', { skip: process.platform !== 'win32' }, () => {
    const ancienPath = process.env.PATH, ancienLocal = process.env.LOCALAPPDATA;
    const local = path.join(racine, 'local'), bin = path.join(local, 'Programs', 'Git', 'cmd');
    fs.mkdirSync(bin, { recursive: true }); fs.writeFileSync(path.join(bin, 'git.exe'), 'fixture');
    const ancienProgram = process.env.ProgramFiles;
    try {
        process.env.PATH = racine; process.env.LOCALAPPDATA = local; process.env.ProgramFiles = path.join(racine, 'programs'); oublierPath();
        assert.equal(surPath('git'), path.join(bin, 'git.exe'));
        assert.ok(process.env.PATH.split(path.delimiter).includes(bin));
    } finally {
        for (const [cle, valeur] of [['PATH', ancienPath], ['LOCALAPPDATA', ancienLocal], ['ProgramFiles', ancienProgram]]) {
            if (valeur === undefined) delete process.env[cle]; else process.env[cle] = valeur;
        }
        oublierPath();
    }
});

test('préparation interrompue : conserve les projets et reprend à la connexion', async () => {
    const c = config(), f = fichier('reprise'), p = projet('Projet A'); let scans = 0, choix = 0;
    await assert.rejects(preparerPoste(c, { fichier: f }, services({ scanner: async () => { scans++; return { projets: [p] }; },
        choisirPlusieurs: async () => ++choix === 1 ? [p.chemin] : ['codex'], verifier: async () => ({ pret: false, texte: 'Connexion requise' }), choisir: async () => { throw new Annule(); },
    })), { name: 'Annule' });
    assert.deepEqual(c.extras, [p.chemin]); assert.equal(lirePreparation(f).projetsTermines, true); assert.equal(lirePreparation(f).terminee, false);
    const r = await preparerPoste(c, { fichier: f }, services({ scanner: async () => assert.fail('Ne pas rescanner'), choisirPlusieurs: async () => assert.fail('Ne pas redemander les choix') }));
    assert.equal(scans, 1); assert.equal(r.terminee, true); assert.equal(c.fournisseurDefaut, 'codex');
});
test('le scan ajoute uniquement les nouveaux choix et préserve les projets existants', async () => {
    const c = config(), f = fichier('rescan'), a = projet('A'), b = projet('B'); c.extras.push(a.chemin);
    const r = await preparerPoste(c, { fichier: f }, services({ scanner: async () => ({ projets: [a, b] }), choisirPlusieurs: async (question, choix) => {
        if (question.includes('projets')) { assert.deepEqual(choix.map((x) => x.valeur), [b.chemin]); return [b.chemin]; } return [];
    } }));
    assert.equal(r.terminee, true); assert.deepEqual(c.extras, [a.chemin, b.chemin]);
    await preparerPoste(c, { fichier: f, rescan: true }, services({ scanner: async () => ({ projets: [a, b] }), choisirPlusieurs: async () => assert.fail('Projets déjà vus') }));
});
test('seul un outil choisi manquant est installé, sans marquer une connexion en échec comme prête', async () => {
    const installations = [], c = config();
    const r = await preparerPoste(c, { fichier: fichier('installation') }, services({ choisirPlusieurs: async () => ['codex'], present: (outil) => outil === 'git' ? 'git.exe' : undefined,
        choisir: async () => 'installer', installer: async (outil) => { installations.push(outil); }, verifier: async () => { throw new Error('Hors ligne'); },
    }));
    assert.deepEqual(installations, ['codex']); assert.equal(r.etats.codex.pret, false); assert.equal(r.terminee, false); assert.equal(c.fournisseurDefaut, 'choisir');
});
test('un fournisseur reporté ne repose pas sa question à chaque reprise', async () => {
    const f = fichier('report');
    const r = await preparerPoste(config(), { fichier: f }, services({ choisirPlusieurs: async () => ['perplexity'], verifier: async () => ({ pret: false, texte: 'Clé absente' }), choisir: async () => 'passer' }));
    assert.deepEqual(r.ignores, ['perplexity']); assert.equal(r.terminee, true);
    await preparerPoste(config(), { fichier: f }, services({ verifier: async () => assert.fail('Ne pas retenter un fournisseur reporté') }));
});
test('un reçu endommagé ne peut pas injecter un fournisseur inconnu', () => {
    const f = fichier('recu'); fs.writeFileSync(f, JSON.stringify({ version: 1, projetsVus: [42, 'A'], ignores: ['inconnu'], selection: ['codex', 'inconnu', 'codex'], etats: null }));
    const r = lirePreparation(f); assert.deepEqual(r.selection, ['codex']); assert.deepEqual(r.ignores, []); assert.deepEqual(r.projetsVus, ['A']); assert.deepEqual(r.etats, {});
});
test('historique Codex : pagination en lecture seule et arrêt sur curseur répété', async () => {
    const appels = [];
    const r = await listerCodex({ demander: async (m, p) => { appels.push([m, p]); return { data: [{ id: String(appels.length), cwd: racine, preview: 'Conversation', updatedAt: 10 }], nextCursor: appels.length === 1 ? 'suite' : null }; } });
    assert.equal(r.length, 2); assert.equal(r[0].maj, 10000); assert.ok(appels.every(([m]) => m === 'thread/list')); assert.equal(appels[1][1].cursor, 'suite');
    await assert.rejects(listerCodex({ demander: async () => ({ data: [], nextCursor: 'identique' }) }), /curseur répété/);
});
test('reprise Codex : copie locale dédupliquée, aucune reprise du thread natif pendant la lecture', async () => {
    const appels = [], tours = [{ items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Question originale' }] }, { type: 'agentMessage', text: 'Réponse originale' }] }];
    const rpc = { demander: async (m) => { appels.push(m); assert.equal(m, 'thread/read'); return { thread: { turns: tours } }; } };
    const source = { fournisseur: 'codex', id: 'native-1', titre: 'Source', cwd: racine, maj: Date.now() };
    const a = await importerCodex(source, rpc), b = await importerCodex(source, rpc);
    assert.equal(a.id, b.id); assert.equal(appels.length, 1); assert.equal(a.origine.copieAuProchainMessage, true);
    const transcript = fs.readFileSync(path.join(dossierIntegre(a.id), 'conversation.jsonl'), 'utf8');
    assert.equal(transcript.trim().split('\n').length, 2); assert.match(transcript, /Question originale/); assert.match(transcript, /Réponse originale/);
});
test('les tours paginés sont tous importés ; un échec ne donne pas un faux historique vide', async () => {
    let pages = 0;
    const r = await messagesCodex('native', { demander: async (m) => m === 'thread/read' ? { thread: {} } : { data: [{ items: [{ type: 'agentMessage', text: String(++pages) }] }], nextCursor: pages === 1 ? 'suite' : null } });
    assert.deepEqual(r.map((m) => m.texte), ['1', '2']);
    await assert.rejects(messagesCodex('native', { demander: async (m) => { if (m === 'thread/read') return { thread: {} }; throw new Error('hors ligne'); } }), /pas pu être chargé/);
});

function transport(attendu, copie = false) {
    return spawn(process.execPath, ['-e', `const rl=require('readline').createInterface({input:process.stdin}); const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
      rl.on('line',l=>{ const m=JSON.parse(l); if(m.method==='initialize')send({id:m.id,result:{}});
      if(m.method?.startsWith('thread/')) { if(m.method!==${JSON.stringify(attendu)}) process.exit(4);
        if(${copie} && (m.params.sandbox!=='read-only'||m.params.ephemeral!==true||m.params.approvalPolicy!=='never')) process.exit(5);
        send({id:m.id,result:{thread:{id:'nouveau'}}}); }
      if(m.method==='turn/start'){ if(m.params.threadId!=='nouveau')process.exit(6); send({id:m.id,result:{turn:{id:'tour'}}});
        send({method:'item/completed',params:{item:{id:'r',type:'agentMessage',text:'Terminé'}}}); send({method:'turn/completed',params:{turn:{status:'completed'}}}); }
    });`], { stdio: 'pipe', windowsHide: true });
}
const contexte = (session, conseil = false) => ({ session: { cwd: racine, ...session }, conseil, prompt: 'Test', historique: [], signal: new AbortController().signal,
    evenement() {}, permission: async () => ({ accepte: false }), thread: (id) => { assert.equal(id, 'nouveau'); } });
test('le premier message bifurque le thread externe, les suivants reprennent la copie', async () => {
    const origine = { threadId: 'original', copieAuProchainMessage: true };
    assert.equal(await executerCodex(contexte({ threadId: 'original', origine }), transport('thread/fork')), 'Terminé');
    assert.equal(await executerCodex(contexte({ threadId: 'copie', origine }), transport('thread/resume')), 'Terminé');
});
test('le maître Codex demande un thread éphémère en lecture seule', async () => {
    assert.equal(await executerCodex(contexte({}, true), transport('thread/start', true)), 'Terminé');
});
test('le choix explicite du maître ne bascule pas silencieusement sur un autre fournisseur', async () => {
    assert.equal(fournisseurMaitre({ maitre: { fournisseur: 'perplexity' } }, () => false), 'perplexity');
    assert.equal(fournisseurMaitre({ fournisseurDefaut: 'claude', maitre: { fournisseur: 'auto' } }, () => true), 'claude');
    assert.equal(fournisseurMaitre({ maitre: {} }, () => false), undefined);
    const r = await conseiller('codex', 'Conseil', async (c) => { assert.equal(c.conseil, true); assert.deepEqual(await c.permission({}), { accepte: false }); return 'Plan'; });
    assert.equal(r.texte, 'Plan');
});
test('un plan inconnu, cyclique ou avec un fournisseur invalide ne peut pas être lancé', () => {
    const t = (fournisseur, dependances) => ({ titre: 'Tâche', consigne: 'Travaille', fournisseur, dependances });
    const p = { projet: 'Projet', objectif: 'Améliorer', taches: [t('perplexity', []), t('codex', ['t1']), t('claude', ['t2'])] };
    assert.deepEqual(validerPlanMaitre(p, ['Projet']), p);
    assert.throws(() => validerPlanMaitre(p, ['Autre']), /invalide/);
    assert.throws(() => validerPlanMaitre({ ...p, taches: [t('inconnu', [])] }, ['Projet']), /invalide/);
    assert.throws(() => validerPlanMaitre({ ...p, taches: [t('codex', ['t2']), t('claude', ['t1'])] }, ['Projet']), /circulaire/i);
});

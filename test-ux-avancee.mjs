import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-ux-avancee-'));
const profil = path.join(tmp, 'profil'), projet = path.join(tmp, 'projet');
fs.mkdirSync(profil); fs.mkdirSync(projet);
process.env.CLAUDETOPIA_DATA_DIR = profil; process.env.CLAUDETOPIA_TEST_UI = '1'; process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.writeFileSync(path.join(profil, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false }));
const { dossierContexte } = await import('./dist/ui/contexteProjet.js');
const { chargerHistoriqueConversation, rechercherHistoriqueConversation, exporterConversation } = await import('./dist/historiqueConversation.js');
const { metriquesLive } = await import('./dist/ui/metriquesLive.js');
const { planifierCorrection, preparerCorrection } = await import('./dist/correctionsIsolees.js');
const { preparerPoste } = await import('./dist/preparation.js');
const { bus } = await import('./dist/ui/bus.js');
const { rechercherConversations, conversationsRecherchables } = await import('./dist/rechercheConversations.js');
after(() => { const r = path.relative(os.tmpdir(), tmp); if (r && !r.startsWith('..') && !path.isAbsolute(r)) fs.rmSync(tmp, { recursive: true, force: true }); });

test('contexte explicite : shell, nouvelle session et projet . gardent le dossier initial', async () => {
    const original = cp.spawn, captures = [];
    cp.spawn = (programme, args, options) => {
        const enfant = new EventEmitter(); enfant.stdin = new PassThrough(); enfant.stdout = new PassThrough(); enfant.stderr = new PassThrough();
        captures.push({ programme, args, options }); setImmediate(() => enfant.emit('close', 0)); return enfant;
    };
    syncBuiltinESMExports();
    try {
        const { executerLigne, COMMANDES } = await import('./dist/commandes.js');
        const dossier = dossierContexte({ cwd: projet });
        await executerLigne('!Write-Output fixture', { dossier });
        assert.equal(captures.at(-1).options.cwd, projet); assert.notEqual(projet, process.cwd());
        assert.equal(dossierContexte({ cwd: projet }, { type: 'projet', cle: tmp }), tmp);
        const session = COMMANDES.find((c) => c.nom === 'session'), avant = session.executer, appels = [];
        session.executer = async (ctx) => { appels.push(ctx); };
        try {
            await executerLigne('Consigne\n  avec indentation', { dossier });
            await executerLigne('/session . autre consigne', { dossier });
        } finally { session.executer = avant; }
        assert.equal(appels[0].projet.chemin, projet); assert.equal(appels[1].projet.chemin, projet);
        assert.equal(appels[0].apresProjet, 'Consigne\n  avec indentation');
    } finally { cp.spawn = original; syncBuiltinESMExports(); }
});

test('rafraîchir les projets publie immédiatement le nouveau tableau', async () => {
    const { config, getProjets, rafraichirProjets } = await import('./dist/commandes.js');
    const ancien = getProjets(), changements = [], recevoir = (p) => changements.push(p); bus.on('projets', recevoir);
    try {
        config.extras = [projet]; rafraichirProjets(); assert.notEqual(getProjets(), ancien); assert.equal(changements.at(-1), getProjets()); assert.equal(getProjets()[0].chemin, projet);
        const { ajusterProjets } = await import('./dist/synchro.js');
        const detectes = [...getProjets(), { nom: 'Détecté automatiquement', chemin: tmp, racine: '(extra)' }];
        ajusterProjets(detectes); assert.equal(getProjets(), detectes); assert.equal(changements.at(-1), detectes);
        rafraichirProjets();
    }
    finally { bus.off('projets', recevoir); }
});

test('préparation sans agent : mode exploration explicite et aucune connexion lancée', async () => {
    const fichier = path.join(profil, 'preparation-fixture.json');
    fs.writeFileSync(fichier, JSON.stringify({ version: 1, selection: [], ignores: [], projetsVus: [], projetsTermines: true, etats: {} }));
    const notices = [], recevoir = (v) => notices.push(v); bus.on('notice', recevoir);
    try {
        const etat = await preparerPoste({ racines: [], extras: [] }, { fichier }, { historique: async () => ({}) });
        assert.equal(etat.terminee, true); assert.match(notices.at(-1), /Mode exploration.*aucun agent prêt/);
    } finally { bus.off('notice', recevoir); }
});

test('historique : recherche avant 2 Mo et 5000 messages, mise à jour outil, pages sans trou', async () => {
    const fichier = path.join(tmp, 'conversation.jsonl');
    const ligne = (texte, id) => JSON.stringify({ type: 'assistant', ...(id ? { agentopia: { id, role: 'assistant', texte } } : {}), message: { content: [{ type: 'text', text: texte }] } }) + '\n';
    fs.writeFileSync(fichier, ligne('ANCIENNE-PREUVE à retrouver') + Array.from({ length: 6000 }, (_, i) => ligne(`Message-${i} ${'x'.repeat(400)}`)).join('')
        + ligne('ancien résultat à remplacer', 'outil-1') + ligne('résultat final de l’outil', 'outil-1') + '{"type":"assistant"');
    assert.ok(fs.statSync(fichier).size > 2_000_000);
    const recherche = await rechercherHistoriqueConversation(fichier, 'ANCIENNE-PREUVE');
    assert.equal(recherche.total, 1); assert.match(recherche.messages[0].texte, /ANCIENNE-PREUVE/);
    assert.equal((await rechercherHistoriqueConversation(fichier, 'ancien résultat')).total, 0);
    let avant, compte = 0, debut = Infinity;
    do { const p = await chargerHistoriqueConversation(fichier, 100_000, undefined, avant); assert.ok(p.debut < debut); debut = p.debut; avant = debut; compte += p.messages.length; } while (debut > 0);
    assert.equal(compte, 6002, 'chaque ligne complète est chargée, la dernière ligne partielle ne l’est pas');
    const borne = await rechercherHistoriqueConversation(fichier, 'Message-', { limite: 12 }); assert.equal(borne.total, 6000); assert.equal(borne.messages.length, 12);
    const controle = new AbortController(); controle.abort();
    await assert.rejects(rechercherHistoriqueConversation(fichier, 'Message', { signal: controle.signal }));
});

test('export local complet : JSONL identique, Markdown lisible, source et fichier existant protégés', async () => {
    const source = path.join(tmp, 'export-source.jsonl');
    fs.writeFileSync(source, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Texte\n  indenté' }] } }) + '\n');
    const json = path.join(tmp, 'export.jsonl'), md = path.join(tmp, 'export.md');
    await exporterConversation(source, json, 'jsonl'); await exporterConversation(source, md, 'markdown');
    assert.deepEqual(fs.readFileSync(json), fs.readFileSync(source)); assert.match(fs.readFileSync(md, 'utf8'), /Texte\n  indenté/);
    await assert.rejects(exporterConversation(source, json, 'markdown'), /EEXIST/);
    await assert.rejects(exporterConversation(source, source, 'jsonl', { ecraser: true }), /source/);
});

test('historique borné : événement trop grand explicite, ligne partielle ignorée et UTF-8 préservé', async () => {
    const fichier = path.join(tmp, 'historique-borne.jsonl');
    fs.writeFileSync(fichier, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Été 🦊 ' + 'é'.repeat(40000) }] } }) + '\n{"type":"assistant"');
    const r = await rechercherHistoriqueConversation(fichier, 'été'); assert.equal(r.total, 1); assert.ok(r.messages[0].texte.startsWith('Été 🦊'));
    fs.writeFileSync(fichier, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }] } }) + '\n');
    await assert.rejects(rechercherHistoriqueConversation(fichier, 'xx'), /8 Mio/);
    await assert.rejects(chargerHistoriqueConversation(fichier, 100000), /8 Mio/);
});

test('recherche globale : archives, résultats bornés, erreur isolée, annulation et ouverture sans modèle', async () => {
    const { creerIntegree, fichierIntegre, archiverIntegree } = await import('./dist/sessionsIntegrees.js');
    const { commandesConversation } = await import('./dist/conversationCommandes.js');
    const { COMMANDES } = await import('./dist/commandes.js');
    const session = creerIntegree('codex', projet, 'Archive de test'), autre = creerIntegree('perplexity', projet, 'Autre conversation');
    const texte = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Constellation-UX retrouvée ici' }] } }) + '\n';
    fs.writeFileSync(fichierIntegre(session.id, 'conversation.jsonl'), texte);
    fs.writeFileSync(fichierIntegre(autre.id, 'conversation.jsonl'), texte);
    archiverIntegree(session.id);
    const liste = await conversationsRecherchables(); assert.ok(liste.some(s => s.id === session.id));
    const resultat = await rechercherConversations([...liste, { ...liste[0], fichier: path.join(tmp, 'absent.jsonl') }], 'Constellation-UX', { limite: 1 });
    assert.equal(resultat.conversations, 2); assert.equal(resultat.correspondances, 2); assert.equal(resultat.resultats.length, 1); assert.equal(resultat.erreursTotal, 1);
    const controle = new AbortController(); controle.abort(); await assert.rejects(rechercherConversations(liste, 'Constellation', { signal: controle.signal }));
    const commande = commandesConversation().find(c => c.nom === 'chercher-conversations');
    let selection, annuler = true;
    const selectionner = id => { selection = id; };
    const repondre = d => {
        if (d?.type !== 'choix') return;
        if (d.message.startsWith('Recherche dans')) { if (annuler) queueMicrotask(() => d.resoudre('annuler')); return; }
        if (d.message.startsWith('Résultats pour')) { const c = d.choix.find(c => c.valeur.conversation.id === session.id); queueMicrotask(() => d.resoudre(c.valeur)); }
        else queueMicrotask(() => d.resoudre('ouvrir'));
    };
    bus.on('demande', repondre); bus.on('selectionner', selectionner);
    try {
        await assert.rejects(commande.executer({ args: ['Constellation-UX'], reste: 'Constellation-UX' }), e => e.name === 'Annule'); assert.equal(selection, undefined);
        annuler = false; await commande.executer({ args: ['Constellation-UX'], reste: 'Constellation-UX' });
        assert.equal(selection, session.id); assert.equal(fs.existsSync(fichierIntegre(session.id, 'archive')), false);
    } finally { bus.off('demande', repondre); bus.off('selectionner', selectionner); }
    for (const nom of ['chercher-conversations', 'sauvegarder', 'recuperer-sessions', 'espace-installation', 'desinstaller']) assert.ok(COMMANDES.some(c => c.nom === nom), nom);
});

test('Live distingue coût nul, inconnu et fournisseurs, sans inventer de plafond', () => {
    assert.equal(metriquesLive([]).cout, undefined);
    const m = metriquesLive([{ fournisseur: 'codex', coutUSD: 0 }, { fournisseur: 'claude', coutUSD: 1.25 }, { fournisseur: 'perplexity' }]);
    assert.equal(m.cout, 1.25); assert.equal(m.inconnus, 1); assert.equal(m.tours, 3); assert.equal(m.fournisseurs.length, 3);
});

test('PR/CI : worktree réel sur commit exact sans changer HEAD, modifications ou .env du projet', async () => {
    const depot = path.join(tmp, 'depot'); fs.mkdirSync(depot);
    const git = (args, cwd = depot) => { const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    git(['init', '-b', 'main']); fs.writeFileSync(path.join(depot, 'fichier.txt'), 'version du commit'); git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
    const sha = git(['rev-parse', 'HEAD']); git(['remote', 'add', 'origin', depot]);
    fs.writeFileSync(path.join(depot, 'fichier.txt'), 'brouillon utilisateur intact'); fs.writeFileSync(path.join(depot, '.env'), 'FIXTURE=ne-pas-copier');
    const plan = planifierCorrection(depot, sha, 'ci-fixture', path.join(tmp, 'copies'));
    const autre = planifierCorrection(depot, sha, 'ci-fixture', path.join(tmp, 'copies')); assert.notEqual(plan.branche, autre.branche);
    const travail = await preparerCorrection(plan);
    assert.equal(travail.base, sha); assert.equal(git(['rev-parse', 'HEAD']), sha); assert.equal(git(['branch', '--show-current']), 'main');
    assert.equal(fs.readFileSync(path.join(depot, 'fichier.txt'), 'utf8'), 'brouillon utilisateur intact');
    assert.equal(fs.readFileSync(path.join(travail.dossier, 'fichier.txt'), 'utf8'), 'version du commit'); assert.equal(fs.existsSync(path.join(travail.dossier, '.env')), false);
    git(['worktree', 'remove', travail.dossier]);
    assert.throws(() => planifierCorrection(depot, '--upload-pack=fixture', 'fixture'), /invalide/);
    let appele = false;
    await assert.rejects(preparerCorrection(autre, undefined, { git: async () => { throw new Error('fetch refusé'); }, worktree: async () => { appele = true; } }), /fetch refusé/);
    assert.equal(appele, false);
});

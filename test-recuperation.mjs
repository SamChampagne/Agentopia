import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-recuperation-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.ANTHROPIC_API_KEY = 'sk-fixture-only';
const sessions = await import('./dist/sessionsIntegrees.js');
const { travailler } = await import('./dist/sessionWorker.js');
const { CHEMINS } = await import('./dist/chemins.js');
const equipes = await import('./dist/equipe.js');
const stockage = await import('./dist/stockageEquipes.js');
const { demarragePoste } = await import('./dist/verrou.js');
const enfants = [];
async function tuer(p) { if (p.exitCode === null && p.signalCode === null) { const fin = once(p, 'exit'); p.kill('SIGKILL'); await fin; } }
after(async () => {
    for (const p of enfants) await tuer(p);
    const rel = path.relative(os.tmpdir(), racine);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true });
});
function preparer() {
    const s = sessions.creerIntegree('claude', racine, 'Reprise');
    s.tour = randomUUID(); s.etat = 'travaille'; sessions.sauverIntegree(s);
    const fichier = (nom) => path.join(sessions.dossierIntegre(s.id), nom);
    fs.writeFileSync(fichier('verrou'), '');
    sessions.ecrireAtomique(fichier('requete.json'), { tour: s.tour, prompt: 'Mission fixture' });
    return { s, fichier };
}

test('un ancien verrou orphelin avant le lancement est récupéré sans perdre la conversation', () => {
    const s = sessions.creerIntegree('claude', racine, 'Orphelin');
    s.threadId = 'conversation-a-garder'; sessions.sauverIntegree(s);
    const verrou = path.join(sessions.dossierIntegre(s.id), 'verrou');
    fs.writeFileSync(verrou, ''); const ancien = new Date(Date.now() - 130_000); fs.utimesSync(verrou, ancien, ancien);
    s.maj = ancien.getTime(); sessions.ecrireAtomique(path.join(sessions.dossierIntegre(s.id), 'etat.json'), s);
    const retrouve = sessions.listerIntegrees().find((a) => a.id === s.id);
    assert.equal(fs.existsSync(verrou), false);
    assert.equal(retrouve.threadId, 'conversation-a-garder'); assert.equal(retrouve.etat, 'attend');
});

test('un ancien worker en nettoyage final conserve son verrou malgré son âge', async () => {
    const { s, fichier } = preparer(); s.etat = 'attend'; s.issue = 'success'; sessions.sauverIntegree(s);
    const ancien = new Date(Date.now() - 500_000); fs.utimesSync(fichier('verrou'), ancien, ancien);
    sessions.listerIntegrees(); assert.ok(fs.existsSync(fichier('verrou')));
    await assert.rejects(sessions.envoyerIntegree(s.id, 'trop tôt'), /déjà en cours/);
    fs.rmSync(fichier('verrou'));
});

test('deux workers pour le même tour ne doublent ni le modèle ni le transcript', async () => {
    const { s, fichier } = preparer(); let finir, appels = 0;
    const premier = travailler(s.id, s.tour, async () => { appels++; return new Promise((r) => { finir = r; }); });
    try {
        await travailler(s.id, s.tour, async () => { appels++; return 'doublon'; });
        assert.equal(appels, 1);
        assert.equal(fs.existsSync(fichier('verrou')), true);
    } finally { finir('résultat unique'); await premier; }
    assert.equal(sessions.lireIntegree(s.id).resultat, 'résultat unique');
    assert.equal(fs.readFileSync(fichier('conversation.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('une permission et des événements tardifs ne ressuscitent pas un tour interrompu', async () => {
    const { s, fichier } = preparer(); let permission, contexte;
    const execution = travailler(s.id, s.tour, async (c) => {
        contexte = c;
        permission = c.permission({ titre: 'Test local', detail: 'En attente' }).catch(() => undefined);
        // Comme le transport réel : son annulation peut finir avant celle de la permission.
        return new Promise((_ok, ko) => c.signal.addEventListener('abort', () => ko(new Error('Interruption')), { once: true }));
    });
    for (let i = 0; i < 100 && !sessions.lireIntegree(s.id).permission; i++) await pause(10);
    sessions.interrompreIntegree(s.id); await execution;
    const finale = fs.readFileSync(fichier('etat.json'), 'utf8');
    const messages = fs.readFileSync(fichier('conversation.jsonl'), 'utf8');
    await permission; contexte.thread('trop-tard'); contexte.utilisation({ coutUSD: 99 }); contexte.evenement({ role: 'assistant', texte: 'trop tard' });
    assert.equal(fs.readFileSync(fichier('etat.json'), 'utf8'), finale);
    assert.equal(fs.readFileSync(fichier('conversation.jsonl'), 'utf8'), messages);
    assert.equal(sessions.lireIntegree(s.id).etat, 'arretee'); assert.equal(sessions.lireIntegree(s.id).issue, 'cancelled');
    assert.equal(fs.existsSync(fichier('verrou')), false);
});

test('un fichier équipes invalide ne peut pas être remplacé par une nouvelle équipe', () => {
    const projet = path.join(racine, 'projet'); fs.mkdirSync(projet);
    for (const args of [['init'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'Base']]) {
        const r = spawnSync('git', args, { cwd: projet, windowsHide: true, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
    }
    const contenu = '{"equipes": "fichier incomplet'; fs.writeFileSync(CHEMINS.equipes, contenu);
    assert.throws(() => equipes.rechargerEquipes(), /équipes.*illisible|équipes.*invalide/i);
    assert.throws(() => equipes.creerEquipeMixte({ chemin: projet, nom: 'Fixture' }, 'Nouveau', [
        { titre: 'Test', fournisseur: 'claude', consigne: 'Mission', dependances: [] },
    ]), /équipes.*illisible|équipes.*invalide/i);
    assert.equal(fs.readFileSync(CHEMINS.equipes, 'utf8'), contenu);
    assert.equal(equipes.lireEquipes().length, 0, 'La création refusée ne reste pas dans le cache');
});

test('un lancement récent et un worker vivant sont conservés même avec un état ancien', async () => {
    const { s, fichier } = preparer();
    assert.equal(sessions.listerIntegrees().find((a) => a.id === s.id).etat, 'travaille');
    assert.ok(fs.existsSync(fichier('verrou')));
    s.maj = Date.now() - 500_000; s.pid = process.pid;
    sessions.ecrireAtomique(fichier('etat.json'), s);
    assert.equal(sessions.listerIntegrees().find((a) => a.id === s.id).etat, 'travaille');
    await assert.rejects(sessions.envoyerIntegree(s.id, 'pas de doublon'), /déjà en cours/);
    s.pid = undefined; sessions.sauverIntegree(s); await travailler(s.id, s.tour, async () => 'fin');
});

test('redémarrage du PC : un numéro de processus réutilisé ne bloque pas la récupération', () => {
    const { s, fichier } = preparer(); s.pid = process.pid; s.demarragePoste = demarragePoste() - 86_400_000;
    sessions.sauverIntegree(s);
    const retrouve = sessions.listerIntegrees().find((a) => a.id === s.id);
    assert.equal(retrouve.etat, 'erreur'); assert.equal(fs.existsSync(fichier('verrou')), false);
});

test('crash réel du worker : récupération, ancien tour ignoré, puis reprise unique', { timeout: 20_000 }, async () => {
    const { s, fichier } = preparer();
    const p = spawn(process.execPath, ['fixtures/recuperation-worker.mjs', s.id, s.tour], { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    enfants.push(p); p.stderr.resume(); await once(p, 'message');
    assert.equal(sessions.lireIntegree(s.id).pid, p.pid);
    await travailler(s.id, s.tour, async () => assert.fail('Le worker existe déjà'));
    await tuer(p);
    const recuperee = sessions.listerIntegrees().find((a) => a.id === s.id);
    assert.equal(recuperee.etat, 'erreur'); assert.equal(recuperee.issue, 'error');
    assert.equal(recuperee.permission, undefined); assert.equal(fs.existsSync(fichier('verrou')), false);
    assert.equal(recuperee.threadId, 'thread-avant-crash');
    recuperee.etat = 'travaille'; recuperee.tour = randomUUID(); sessions.sauverIntegree(recuperee);
    fs.writeFileSync(fichier('verrou'), ''); sessions.ecrireAtomique(fichier('requete.json'), { tour: recuperee.tour, prompt: 'reprendre' });
    await travailler(s.id, s.tour, async () => assert.fail('L’ancien tour ne doit plus démarrer'));
    await travailler(s.id, recuperee.tour, async (c) => { assert.equal(c.session.threadId, 'thread-avant-crash'); return 'repris'; });
    assert.equal(sessions.lireIntegree(s.id).issue, 'success');
    assert.equal(fs.readFileSync(fichier('conversation.jsonl'), 'utf8').trim().split('\n').length, 2);
});

const exemple = () => ({ id: 'equipe-fixture', projet: racine, nomProjet: 'Fixture', objectif: 'Conserver', resume: '', creee: Date.now(), etat: 'plan', taches: [
    { id: 't1', titre: 'Tâche', role: 'dev', fournisseur: 'claude', consigne: 'Mission', dependances: [], etat: 'attente' },
] });
test('structure et lecture : aucun effacement pour un objet JSON, une tâche invalide ou un accès refusé', () => {
    const e = exemple(); fs.writeFileSync(CHEMINS.equipes, JSON.stringify([e])); equipes.rechargerEquipes();
    for (const invalide of ['{}', '[null]', JSON.stringify([{ ...e, taches: [null] }]), JSON.stringify([e, e])]) {
        fs.writeFileSync(CHEMINS.equipes, invalide);
        assert.throws(() => equipes.rechargerEquipes(), /illisible ou invalide/);
        assert.equal(equipes.lireEquipes()[0].id, e.id, 'Le dernier état lisible reste affiché');
        assert.ok(equipes.erreurStockageEquipes()); assert.equal(fs.readFileSync(CHEMINS.equipes, 'utf8'), invalide);
    }
    fs.rmSync(CHEMINS.equipes); fs.mkdirSync(CHEMINS.equipes);
    assert.throws(() => equipes.rechargerEquipes(), /illisible ou invalide/); fs.rmdirSync(CHEMINS.equipes);
    fs.writeFileSync(CHEMINS.equipes, JSON.stringify([e])); equipes.rechargerEquipes(); assert.equal(equipes.erreurStockageEquipes(), undefined);
});

test('sauvegarde et restauration : conserver l’original, mettre en pause et refuser une sauvegarde changée', async () => {
    const e = exemple(); e.taches[0].branche = 'fixture'; fs.writeFileSync(CHEMINS.equipes, JSON.stringify([e])); equipes.rechargerEquipes();
    // Une écriture normale crée la sauvegarde de la version précédente.
    await equipes.basculerEcart(e.id, 't1');
    const sauvegarde = stockage.sauvegardeEquipes(); assert.equal(sauvegarde.equipes[0].id, e.id);
    const original = 'fichier abîmé à conserver'; fs.writeFileSync(CHEMINS.equipes, original);
    assert.throws(() => equipes.rechargerEquipes());
    await assert.rejects(equipes.recupererEquipes('ancienne-empreinte'), /sauvegarde a changé/);
    assert.equal(fs.readFileSync(CHEMINS.equipes, 'utf8'), original);
    const { s, fichier } = preparer();
    const copie = await equipes.recupererEquipes(sauvegarde.empreinte);
    assert.equal(fs.readFileSync(copie, 'utf8'), original);
    assert.equal(equipes.lireEquipes()[0].id, e.id); assert.equal(equipes.erreurStockageEquipes(), undefined);
    assert.ok(fs.existsSync(path.join(CHEMINS.moteur, 'pause.json')));
    assert.equal(JSON.parse(fs.readFileSync(fichier('arret'), 'utf8')).tour, s.tour);
    await assert.rejects(equipes.recupererEquipes(sauvegarde.empreinte), /de nouveau lisible/);
    fs.rmSync(CHEMINS.equipes); assert.throws(() => equipes.rechargerEquipes(), /illisible/);
    await equipes.recupererEquipes(sauvegarde.empreinte);
    assert.equal(equipes.lireEquipes()[0].id, e.id);
});

test('surveillance : signaler un fichier abîmé, puis reconnaître sa réparation sans redémarrer', async () => {
    equipes.suivreFichierEquipes();
    const bon = fs.readFileSync(CHEMINS.equipes, 'utf8'); fs.writeFileSync(CHEMINS.equipes, 'invalide');
    for (let i = 0; i < 100 && !equipes.erreurStockageEquipes(); i++) await pause(10);
    assert.ok(equipes.erreurStockageEquipes());
    fs.writeFileSync(CHEMINS.equipes, bon);
    for (let i = 0; i < 100 && equipes.erreurStockageEquipes(); i++) await pause(10);
    assert.equal(equipes.erreurStockageEquipes(), undefined);
});

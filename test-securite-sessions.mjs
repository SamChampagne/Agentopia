import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-securite-sessions-'));
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'profil');
process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.mkdirSync(process.env.CLAUDETOPIA_DATA_DIR);
fs.writeFileSync(path.join(process.env.CLAUDETOPIA_DATA_DIR, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false } }));
const sessions = await import('./dist/sessionsIntegrees.js');
const { importerCodex } = await import('./dist/historiqueAgents.js');
const { travailler } = await import('./dist/sessionWorker.js');
const { creerDemandesPermission } = await import('./dist/demandesPermission.js');
const { executerTerminalCodex } = await import('./dist/terminalCodex.js');
const fixture = (titre = 'Fixture') => sessions.creerIntegree('codex', racine, titre);
const etat = (id) => path.join(sessions.RACINE_SESSIONS, id, 'etat.json');
const brut = (s, valeur) => fs.writeFileSync(etat(s.id), typeof valeur === 'string' ? valeur : JSON.stringify(valeur));
async function attendre(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await pause(30); } assert.fail('Condition non atteinte'); }
after(async () => {
    const relatif = path.relative(os.tmpdir(), racine);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) await fs.promises.rm(racine, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

test('identifiants : aucune traversée, chemin absolu, flux NTFS ou nom de fichier parent', () => {
    for (const id of ['../autre', '..\\autre', '/tmp/autre', 'C:\\autre', `ct-${randomUUID()}/..`, `ct-${randomUUID()}:flux`, 'ct-' + '-'.repeat(36)]) {
        assert.throws(() => sessions.dossierIntegre(id), /invalide/);
        assert.equal(sessions.lireIntegree(id), undefined);
    }
    const s = fixture();
    for (const nom of ['../etat.json', '..\\etat.json', '/autre', '.', '..', 'etat.json:flux', ''])
        assert.throws(() => sessions.fichierIntegre(s.id, nom), /invalide/);
});

test('identité du disque : une session ne peut ni se faire passer pour une autre ni l’écraser', () => {
    const a = fixture('A'), b = fixture('B'), avantB = fs.readFileSync(etat(b.id), 'utf8');
    brut(a, { ...a, id: b.id, titre: 'A injecté', etat: 'travaille', pid: 999999, maj: Date.now() - 300000, tour: 'ancien' });
    const avantA = fs.readFileSync(etat(a.id), 'utf8');
    assert.equal(sessions.lireIntegree(a.id), undefined);
    assert.throws(() => sessions.lireIntegreeStrict(a.id), /identité incohérente/);
    assert.ok(sessions.listerIntegrees().some((s) => s.id === b.id));
    assert.throws(() => sessions.sauverIntegree(a), /identité incohérente/);
    assert.equal(fs.readFileSync(etat(a.id), 'utf8'), avantA);
    assert.equal(fs.readFileSync(etat(b.id), 'utf8'), avantB);
});

test('état corrompu : préserver JSON et transcript, refuser toute nouvelle exécution', async () => {
    const s = fixture(), transcript = sessions.fichierIntegre(s.id, 'conversation.jsonl');
    fs.writeFileSync(transcript, 'conversation à préserver\n'); brut(s, '{'); let appels = 0;
    assert.equal(sessions.lireIntegree(s.id), undefined);
    assert.throws(() => sessions.sauverIntegree(s), /corrompues/);
    await assert.rejects(sessions.envoyerIntegree(s.id, 'bonjour'), /corrompues/);
    await assert.rejects(travailler(s.id, s.tour, async () => { appels++; return 'non'; }), /corrompues/);
    assert.equal(appels, 0); assert.equal(fs.readFileSync(etat(s.id), 'utf8'), '{');
    assert.equal(fs.readFileSync(transcript, 'utf8'), 'conversation à préserver\n');
});

test('schéma : champs JSON valides mais mal typés refusés sans masquer une autre session', () => {
    const saine = fixture('Saine');
    for (const modification of [{ fournisseur: 'inconnu' }, { cwd: {} }, { tour: 42 }, { creee: 'hier' }, { pid: -2 },
        { permission: { id: 'p', titre: {}, detail: '' } }, { bilan: { commandes: 'oops' } }, { utilisation: { coutUSD: 'gratuit' } }]) {
        const s = fixture(); brut(s, { ...s, ...modification }); const avant = fs.readFileSync(etat(s.id), 'utf8');
        assert.equal(sessions.lireIntegree(s.id), undefined); assert.throws(() => sessions.sauverIntegree(s), /corrompues/);
        assert.equal(fs.readFileSync(etat(s.id), 'utf8'), avant);
    }
    assert.ok(sessions.listerIntegrees().some((s) => s.id === saine.id));
});

test('import Codex : ne jamais réinitialiser un transcript si son état est corrompu ou absent', async () => {
    let lectures = 0;
    const rpc = { demander: async () => { lectures++; return { thread: { turns: [{ items: [{ type: 'agentMessage', text: 'Texte fixture' }] }] } }; } };
    const native = { fournisseur: 'codex', id: randomUUID(), cwd: racine, titre: 'Import fixture', maj: Date.now() };
    const s = await importerCodex(native, rpc), transcript = sessions.fichierIntegre(s.id, 'conversation.jsonl');
    fs.appendFileSync(transcript, 'ancien échange local\n'); const avant = fs.readFileSync(transcript, 'utf8');
    const lecturesAvant = lectures; brut(s, '{');
    await assert.rejects(importerCodex(native, rpc), /corrompues/); assert.equal(lectures, lecturesAvant);
    assert.equal(fs.readFileSync(transcript, 'utf8'), avant); assert.equal(fs.readFileSync(etat(s.id), 'utf8'), '{');
    fs.rmSync(etat(s.id));
    await assert.rejects(importerCodex(native, rpc), /conversation existe déjà/);
    assert.equal(lectures, lecturesAvant); assert.equal(fs.readFileSync(transcript, 'utf8'), avant);
});

test('permission : interdire les chemins du disque et l’écrasement de la liaison par le payload', () => {
    const s = fixture(); s.tour = randomUUID(); s.etat = 'bloquee'; s.permission = { id: 'p', titre: 'Fixture', detail: '' }; sessions.sauverIntegree(s);
    for (const id of ['../../../../hors-profil', '..\\..\\hors-profil', 'p:flux', '/absolu', '.', ''])
        assert.throws(() => sessions.repondrePermission(s.id, id, { accepte: true }), /invalide/);
    assert.equal(fs.existsSync(path.join(racine, 'hors-profil.json')), false);
    assert.throws(() => sessions.repondrePermission(s.id, 'p', { accepte: 'oui' }), /invalide/);
    sessions.repondrePermission(s.id, 'p', { accepte: false, reponses: { choix: 'non' }, tour: 'faux', session: 'autre', permission: 'autre' });
    assert.deepEqual(JSON.parse(fs.readFileSync(sessions.fichierIntegre(s.id, 'reponse-p.json'), 'utf8')),
        { session: s.id, permission: 'p', tour: s.tour, accepte: false, reponses: { choix: 'non' } });
    s.etat = 'attend'; sessions.sauverIntegree(s);
    assert.throws(() => sessions.repondrePermission(s.id, 'p', { accepte: true }), /expiré/);
});

test('permission : mauvaise session, demande, tour ou réponse mal typée ne donnent jamais accès', async () => {
    const s = fixture(), abort = new AbortController(); s.tour = randomUUID(); let permission, resolue = false;
    const demander = creerDemandesPermission({ dossier: sessions.dossierIntegre(s.id), session: s.id, tour: s.tour, signal: abort.signal,
        suspendre: () => () => {}, publier: (p) => { permission = p; s.permission = p; s.etat = p ? 'bloquee' : 'attend'; sessions.sauverIntegree(s); } });
    const promesse = demander({ titre: 'Décider', detail: '' }).then((r) => { resolue = true; return r; });
    try {
        await attendre(() => permission); const pid = permission.id, fichier = sessions.fichierIntegre(s.id, `reponse-${pid}.json`);
        for (const r of [{ session: 'autre', permission: pid, tour: s.tour, accepte: true },
            { session: s.id, permission: 'autre', tour: s.tour, accepte: true },
            { session: s.id, permission: pid, tour: 'ancien', accepte: true },
            { session: s.id, permission: pid, tour: s.tour, accepte: 'oui' }, null]) {
            fs.writeFileSync(fichier, JSON.stringify(r)); await attendre(() => !fs.existsSync(fichier)); assert.equal(resolue, false);
        }
        sessions.repondrePermission(s.id, pid, { accepte: false }); assert.deepEqual(await promesse, { accepte: false });
    } finally { abort.abort(); await promesse.catch(() => {}); }
});

test('jonction de session : aucune lecture ni écriture vers la cible extérieure au profil', () => {
    const cible = path.join(racine, 'cible-exterieure'); fs.mkdirSync(cible); const id = `ct-${randomUUID()}`;
    fs.writeFileSync(path.join(cible, 'etat.json'), JSON.stringify({ ...fixture(), id })); const avant = fs.readFileSync(path.join(cible, 'etat.json'), 'utf8');
    fs.symlinkSync(cible, path.join(sessions.RACINE_SESSIONS, id), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => sessions.dossierIntegre(id), /lien ou jonction/);
    assert.equal(sessions.lireIntegree(id), undefined); assert.throws(() => sessions.archiverIntegree(id), /lien ou jonction/);
    assert.equal(fs.existsSync(path.join(cible, 'archive')), false); assert.equal(fs.readFileSync(path.join(cible, 'etat.json'), 'utf8'), avant);
});

test('liens de fichier et jonctions de verrou : préserver les cibles et ne pas ouvrir de terminal', async () => {
    const s = fixture(); s.threadId = randomUUID(); sessions.sauverIntegree(s);
    const externe = path.join(racine, 'transcript-externe'); fs.writeFileSync(externe, 'ne pas modifier');
    fs.linkSync(externe, path.join(sessions.dossierIntegre(s.id), 'conversation.jsonl'));
    assert.throws(() => sessions.ajouterMessage(s.id, 'user', 'interdit'), /lien ou jonction/);
    assert.equal(fs.readFileSync(externe, 'utf8'), 'ne pas modifier');
    const verrou = path.join(racine, 'verrou-externe'); fs.mkdirSync(verrou); fs.writeFileSync(path.join(verrou, 'proprietaire.json'), 'sentinelle');
    fs.symlinkSync(verrou, path.join(sessions.dossierIntegre(s.id), 'operation'), process.platform === 'win32' ? 'junction' : 'dir');
    let lance = false;
    await assert.rejects(executerTerminalCodex(s.id, { rpc: { demander: async () => { lance = true; return {}; } }, lancer: async () => { lance = true; return 0; } }), /lien ou jonction/);
    assert.equal(lance, false); assert.equal(fs.readFileSync(path.join(verrou, 'proprietaire.json'), 'utf8'), 'sentinelle');
});

test('worker : une requête mal typée ne parvient pas au fournisseur', async () => {
    const s = fixture(); s.tour = randomUUID(); s.etat = 'travaille'; sessions.sauverIntegree(s);
    fs.writeFileSync(sessions.fichierIntegre(s.id, 'requete.json'), JSON.stringify({ tour: s.tour, prompt: { commande: 'interdit' } }));
    let appels = 0; await travailler(s.id, s.tour, async () => { appels++; return 'ne doit pas arriver'; });
    assert.equal(appels, 0); assert.equal(sessions.lireIntegreeStrict(s.id).issue, 'error');
    assert.match(sessions.lireIntegreeStrict(s.id).erreur, /requête invalide/);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-evolution-moteur-'));
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'profil'); process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.ANTHROPIC_API_KEY = 'sk-fixture-only';
fs.mkdirSync(process.env.CLAUDETOPIA_DATA_DIR);
fs.writeFileSync(path.join(process.env.CLAUDETOPIA_DATA_DIR, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false }, equipe: { parallele: 3, paralleleGlobal: 0 } }));
const eq = await import('./dist/equipe.js'), sessions = await import('./dist/sessionsIntegrees.js');
const plans = await import('./dist/planificateur.js'), stockage = await import('./dist/stockagePlanifications.js');
const config = await import('./dist/config.js'), file = await import('./dist/fileAgents.js');
const preparation = await import('./dist/preparationWorktrees.js'), execution = await import('./dist/gitExecution.js');
const worktrees = await import('./dist/worktrees.js');
const { recetteCollaboration } = await import('./dist/equipesGuidees.js');
const { bilanEquipe } = await import('./dist/equipeBilan.js');
const usage = await import('./dist/utilisation.js');
const { CHEMINS } = await import('./dist/chemins.js');
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
function depot(nom) { const p = path.join(racine, nom); fs.mkdirSync(p); git(p, 'init', '-b', 'main'); git(p, 'config', 'user.name', 'Fixture'); git(p, 'config', 'user.email', 'fixture@example.test'); fs.writeFileSync(path.join(p, 'commun.txt'), 'base\n'); git(p, 'add', '.'); git(p, 'commit', '-m', 'Base'); return p; }
const definition = (titre, dependances = []) => ({ titre, fournisseur: 'claude', consigne: titre, dependances });
const creer = (p, defs) => eq.creerEquipeMixte({ nom: path.basename(p), chemin: p }, 'Fixture', defs);
const configurer = (valeur) => { const c = config.chargerConfig(); Object.assign(c, valeur); config.sauverConfig(c); };
const succes = (id, texte = 'Résultat fixture') => { const s = sessions.lireIntegreeStrict(id); s.etat = 'attend'; s.issue = 'success'; s.resultat = texte; sessions.sauverIntegree(s); return s; };
after(async () => { const relatif = path.relative(os.tmpdir(), racine); if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) await fs.promises.rm(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

test('worktree manuel : aucune copie locale implicite, création asynchrone et refus propre après annulation', async () => {
    const p = depot('manuel'), avant = git(p, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(p, '.env'), 'FIXTURE=local-only');
    fs.writeFileSync(path.join(p, '.env.autre'), 'FIXTURE=unselected');
    let rendu = false; const timer = setTimeout(() => { rendu = true; }, 0);
    const r = await worktrees.creerWorktree(p, 'test/propre'); clearTimeout(timer);
    assert.ok(r.dossier, r.erreur); assert.equal(rendu, true);
    assert.equal(fs.existsSync(path.join(r.dossier, '.env')), false);
    assert.equal(fs.existsSync(path.join(r.dossier, '.env.autre')), false);
    assert.equal(git(p, 'rev-parse', 'HEAD'), avant);
    const liste = worktrees.listerWorktrees(p); assert.equal(liste.length, 2); assert.equal(liste[0].principal, true);
    const arret = new AbortController(); arret.abort();
    const annule = await worktrees.creerWorktree(p, 'test/annule', undefined, arret.signal);
    assert.equal(annule.dossier, undefined); assert.ok(annule.erreur); assert.equal(worktrees.listerWorktrees(p).length, 2);
});

test('worktree manuel : profil explicite appliqué et préparation en erreur conservée sans lancement', async () => {
    const p = depot('manuel-prepare');
    fs.writeFileSync(path.join(p, '.env'), 'FIXTURE=selected');
    fs.writeFileSync(path.join(p, '.env.autre'), 'FIXTURE=unselected');
    const c = config.chargerConfig(); c.preparationProjets = [{ projet: p, fichiersLocaux: ['.env'], commande: { programme: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("prepare.txt", "fixture")'] } }]; config.sauverConfig(c);
    const r = await worktrees.creerWorktree(p, 'test/preparation'); assert.ok(r.dossier, r.erreur);
    assert.equal(fs.readFileSync(path.join(r.dossier, '.env'), 'utf8'), 'FIXTURE=selected');
    assert.equal(fs.existsSync(path.join(r.dossier, '.env.autre')), false);
    assert.equal(fs.readFileSync(path.join(r.dossier, 'prepare.txt'), 'utf8'), 'fixture');
    c.preparationProjets[0].commande.args = ['-e', 'process.exit(3)']; config.sauverConfig(c);
    const echec = await worktrees.creerWorktree(p, 'test/echec'); assert.equal(echec.dossier, undefined);
    assert.match(echec.erreur, /code 3/); assert.match(echec.erreur, /Worktree conservé.*Aucun agent n’a été lancé/s);
    assert.equal(worktrees.listerWorktrees(p).length, 3);
    c.preparationProjets = []; config.sauverConfig(c);
});

test('planifications : corruption bloque le rejeu, récupération conserve original et bloque toute répétition du jour', async () => {
    const p = { id: 'audit', nom: 'Audit', projet: racine, heure: '00:00', jours: [], actif: true, consigne: 'Fixture', fournisseur: 'claude' };
    let appels = 0; const lancer = async () => ({ ok: true, message: 'Fixture', id: `f-${++appels}` });
    assert.equal((await plans.lancerPlanification(p, true, lancer)).ok, true);
    assert.equal((await plans.lancerPlanification(p, true, lancer)).ok, false);
    fs.writeFileSync(CHEMINS.planifications, '{');
    await assert.rejects(plans.lancerPlanification(p, true, lancer), /illisible/); assert.equal(appels, 1); assert.equal(fs.readFileSync(CHEMINS.planifications, 'utf8'), '{');
    const copie = stockage.recupererRecusPlanifications([p.id]); assert.equal(fs.readFileSync(copie, 'utf8'), '{');
    assert.ok(fs.existsSync(path.join(CHEMINS.moteur, 'pause.json')));
    fs.rmSync(path.join(CHEMINS.moteur, 'pause.json'));
    assert.equal((await plans.lancerPlanification(p, true, lancer)).ok, false); assert.equal(appels, 1);
    const valide = fs.readFileSync(CHEMINS.planifications, 'utf8');
    for (const valeur of [[], { audit: { jour: true, etat: 'lance' } }, { audit: { jour: '2026-10-30', etat: 'lance', session: {} } }]) {
        fs.writeFileSync(CHEMINS.planifications, JSON.stringify(valeur)); assert.throws(() => stockage.lireRecusPlanifications(), /illisible/);
    }
    fs.writeFileSync(CHEMINS.planifications, valide);
});

test('dépendances en conflit : conserver session/worktree puis reprendre la fusion sans nouvelle tentative', async () => {
    const p = depot('conflit'), e = creer(p, [definition('A'), definition('B'), definition('Suite', ['t1', 't2'])]);
    const services = { notifier() {}, envoyer: async (id) => { const s = sessions.lireIntegreeStrict(id), t = e.taches.find((t) => t.agentId === id); fs.writeFileSync(path.join(s.cwd, 'commun.txt'), `${t.titre}\n`); git(s.cwd, 'add', '.'); git(s.cwd, 'commit', '-m', t.titre); succes(id); } };
    await eq.lancerEquipe(e.id); await eq.avancerEquipes([], services); await eq.attendreLancements(); await eq.avancerEquipes([], services); await eq.attendreLancements();
    const t = e.taches[2]; assert.equal(t.preparation.etat, 'conflit'); assert.ok(t.agentId); assert.equal(t.etat, 'erreur');
    const avant = { cwd: t.cwd, branche: t.branche, agentId: t.agentId, tentative: t.tentative };
    assert.equal(await eq.reprendreTache(e.id, t.id, async (id, prompt) => {
        assert.match(prompt, /PRÉPARATION INTERROMPUE/); fs.writeFileSync(path.join(t.cwd, 'commun.txt'), 'A et B\n'); git(t.cwd, 'add', '.'); git(t.cwd, 'commit', '-m', 'Résoudre'); succes(id);
    }), undefined);
    await eq.avancerEquipes([], services); assert.equal(t.etat, 'faite');
    assert.deepEqual({ cwd: t.cwd, branche: t.branche, agentId: t.agentId, tentative: t.tentative }, avant); e.archivee = true;
});

test('file globale : attente visible, annulation ciblée et préparation non comptée deux fois', async () => {
    configurer({ equipe: { parallele: 3, paralleleGlobal: 1, permissions: 'default' } });
    const p = depot('file'), a = creer(p, [definition('A')]), b = creer(p, [definition('B')]);
    const services = { notifier() {}, envoyer: async (id) => { const s = sessions.lireIntegreeStrict(id); s.etat = 'travaille'; sessions.sauverIntegree(s); } };
    await eq.lancerEquipe(a.id); await eq.lancerEquipe(b.id); await eq.avancerEquipes([], services); await eq.attendreLancements();
    assert.equal([a, b].filter((e) => e.taches[0].agentId).length, 1);
    const active = a.taches[0].agentId ? a : b, attente = active === a ? b : a;
    assert.match(attente.taches[0].attenteFile, /Plafond global/);
    assert.equal(file.capaciteAgents([a, b]).total, 1);
    await eq.annulerAttenteTache(attente.id, 't1'); assert.equal(attente.taches[0].etat, 'arretee'); assert.equal(sessions.lireIntegreeStrict(active.taches[0].agentId).etat, 'travaille');
    succes(active.taches[0].agentId); await eq.avancerEquipes([], services); active.archivee = true; attente.archivee = true;
    const place = file.reserverPreparationAgent('fixture/place', 'claude');
    try { const s = sessions.creerIntegree('claude', p, 'Préparation'); place.lierSession(s.id); file.sousCapaciteAgent(s.id, 'claude', () => { s.etat = 'travaille'; sessions.sauverIntegree(s); }); assert.equal(file.capaciteAgents().total, 1); succes(s.id); } finally { place.liberer(); }
    configurer({ equipe: { parallele: 3, paralleleGlobal: 0, permissions: 'default' } });
});

test('bilan : deux tentatives conservent conversations, branches et coûts cumulés', async () => {
    const p = depot('tentatives'), e = creer(p, [definition('Essai')]);
    const premier = { notifier() {}, envoyer: async (id) => { const s = sessions.lireIntegreeStrict(id); s.etat = 'erreur'; s.issue = 'error'; s.erreur = 'Fixture'; sessions.sauverIntegree(s); usage.sauverUsage(usage.commencerUsage(id, 'claude'), { coutUSD: 1 }, 'error'); } };
    await eq.lancerEquipe(e.id); await eq.avancerEquipes([], premier); await eq.attendreLancements(); await eq.avancerEquipes([], premier);
    const ancienne = { ...e.taches[0] }; await eq.relancerTache(e.id, 't1');
    const second = { notifier() {}, envoyer: async (id) => { succes(id); usage.sauverUsage(usage.commencerUsage(id, 'claude'), { coutUSD: 2 }, 'success'); } };
    await eq.avancerEquipes([], second); await eq.attendreLancements(); await eq.avancerEquipes([], second);
    assert.equal(e.taches[0].tentatives[0].agentId, ancienne.agentId); assert.ok(fs.existsSync(ancienne.cwd)); assert.match(bilanEquipe(e), /3\.0000/); assert.match(bilanEquipe(e), /TENTATIVES PRÉCÉDENTES/); e.archivee = true;
});

test('planification en file : attendre une place sans consommer sa tentative quotidienne', async () => {
    configurer({ equipe: { parallele: 3, paralleleGlobal: 1, permissions: 'default' } });
    const active = sessions.creerIntegree('claude', racine, 'Capacité occupée'); active.etat = 'travaille'; sessions.sauverIntegree(active);
    const p = { id: 'attente', nom: 'En file', projet: racine, heure: '00:00', jours: [], actif: true, consigne: 'Fixture', fournisseur: 'claude' };
    let appels = 0; const lancer = async () => { appels++; return { ok: true, message: 'Fixture' }; };
    assert.equal((await plans.lancerPlanification(p, true, lancer)).ok, false); assert.equal(plans.recuPlanification(p.id).etat, 'attente'); assert.equal(appels, 0);
    succes(active.id); assert.equal((await plans.lancerPlanification(p, true, lancer)).ok, true);
    assert.equal((await plans.lancerPlanification(p, true, lancer)).ok, false); assert.equal(appels, 1);
    configurer({ equipe: { parallele: 3, paralleleGlobal: 0, permissions: 'default' } });
});

test('préparation : commande réelle bornée, fichiers choisis seulement et journal consultable', async () => {
    const p = depot('preparation'), cible = path.join(racine, 'worktree-fixture'); fs.mkdirSync(cible);
    fs.writeFileSync(path.join(p, 'configuration.locale'), 'fixture'); fs.writeFileSync(path.join(p, '.env'), 'FAUX_SECRET=fixture');
    configurer({ preparationProjets: [{ projet: p, commande: { programme: process.execPath, args: ['-e', 'console.log("PREPARATION_OK")'] }, fichiersLocaux: ['configuration.locale'] }] });
    let journal; await preparation.preparerWorktree(p, cible, { journal: (p) => { journal = p; } });
    assert.equal(fs.readFileSync(path.join(cible, 'configuration.locale'), 'utf8'), 'fixture'); assert.equal(fs.existsSync(path.join(cible, '.env')), false); assert.match(preparation.lireJournalPreparation(journal), /PREPARATION_OK/);
    await assert.rejects(preparation.preparerWorktree(p, cible, { journal() {} }), /exist|EEXIST/);
    configurer({ preparationProjets: [] });
});

test('préparation : un parent redirigé ou une source liée ne permet aucune copie extérieure', async () => {
    const p = depot('copie-protegee'), cible = path.join(racine, 'destination-protegee'), externe = path.join(racine, 'externe');
    fs.mkdirSync(cible); fs.mkdirSync(externe); fs.mkdirSync(path.join(p, 'sous')); fs.writeFileSync(path.join(p, 'sous', 'local.txt'), 'fixture');
    fs.symlinkSync(externe, path.join(cible, 'sous'), process.platform === 'win32' ? 'junction' : 'dir');
    configurer({ preparationProjets: [{ projet: p, fichiersLocaux: ['sous/local.txt'] }] });
    await assert.rejects(preparation.preparerWorktree(p, cible, { journal() {} }), /Parent de copie/); assert.equal(fs.existsSync(path.join(externe, 'local.txt')), false);
    fs.writeFileSync(path.join(externe, 'original'), 'conserver'); fs.linkSync(path.join(externe, 'original'), path.join(p, 'lien-local'));
    configurer({ preparationProjets: [{ projet: p, fichiersLocaux: ['lien-local'] }] });
    await assert.rejects(preparation.preparerWorktree(p, cible, { journal() {} }), /refusé/); assert.equal(fs.readFileSync(path.join(externe, 'original'), 'utf8'), 'conserver');
    configurer({ preparationProjets: [] });
});

test('reçus : récupération bornée et refus des liens sans modifier la cible', () => {
    const avant = fs.readFileSync(CHEMINS.planifications), externe = path.join(racine, 'recu-externe'); fs.writeFileSync(externe, avant);
    fs.rmSync(CHEMINS.planifications); fs.linkSync(externe, CHEMINS.planifications);
    assert.throws(() => stockage.lireRecusPlanifications(), /illisible/); assert.throws(() => stockage.recupererRecusPlanifications(['audit']), /refusé/); assert.deepEqual(fs.readFileSync(externe), avant);
    fs.rmSync(CHEMINS.planifications); fs.writeFileSync(CHEMINS.planifications, Buffer.alloc(4 * 1024 * 1024 + 1));
    assert.throws(() => stockage.recupererRecusPlanifications(['audit']), /volumineux/); assert.equal(fs.statSync(CHEMINS.planifications).size, 4 * 1024 * 1024 + 1);
    fs.writeFileSync(CHEMINS.planifications, avant);
});

test('exécution : événement UI continue pendant processus et annulation réelle bornée', async () => {
    const abort = new AbortController(); let ticks = 0, sortie = '';
    const timer = setInterval(() => ticks++, 10);
    try { await assert.rejects(execution.executerProcessus(process.execPath, ['-e', 'console.log("PRET");setInterval(()=>{},1000)'], racine,
        { signal: abort.signal, timeoutMs: 10_000, progression: (t) => { sortie += t; if (sortie.includes('PRET')) setTimeout(() => abort.abort(), 80); } }), /annulée|interrompue/); assert.ok(ticks > 2); }
    finally { clearInterval(timer); }
});

test('exécution : erreur de journal ne devient pas exception non interceptée', async () => {
    await assert.rejects(execution.executerProcessus(process.execPath, ['-e', 'console.log("PRET");setInterval(()=>{},1000)'], racine,
        { timeoutMs: 10_000, progression() { throw new Error('EACCES fixture'); } }), /journal impossible/);
});

test('collaboration : avis indépendants puis synthèse bornée, modèles et lecture seule conservés', async () => {
    const p = depot('comparaison'), defs = recetteCollaboration('comparaison', 'claude', 'claude'); defs[0].modele = 'fixture-model';
    const e = creer(p, defs); assert.equal(e.taches.length, 3); const recus = [];
    const services = { notifier() {}, envoyer: async (id, prompt) => { const s = sessions.lireIntegreeStrict(id); assert.equal(s.lectureSeule, true); recus.push({ titre: s.titre, prompt, modele: s.modele }); succes(id, s.titre.endsWith(' A') ? 'AVIS_A' : 'AVIS_B'); } };
    await eq.lancerEquipe(e.id);
    for (let i = 0; i < 8 && e.etat !== 'prete'; i++) { await eq.avancerEquipes([], services); await eq.attendreLancements(); }
    assert.equal(recus.length, 3); assert.ok(recus.some((r) => r.modele === 'fixture-model')); assert.doesNotMatch(recus[1].prompt, /AVIS_A/); assert.match(recus[2].prompt, /AVIS_A/); assert.match(recus[2].prompt, /AVIS_B/); assert.equal(e.etat, 'prete');
    const croisee = recetteCollaboration('croisee', 'claude', 'codex'); assert.equal(croisee.length, 4); assert.deepEqual(croisee[3].dependances, ['t1', 't2', 't3']); e.archivee = true;
});

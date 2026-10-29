import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-equipes-test-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.ANTHROPIC_API_KEY = 'sk-fixture-only';
fs.writeFileSync(path.join(racine, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false }, fournisseurDefaut: 'choisir' }));
const { recetteEquipe, preparerEquipeGuidee } = await import('./dist/equipesGuidees.js');
const modeles = await import('./dist/modelesEquipes.js');
const equipes = await import('./dist/equipe.js');
const sessions = await import('./dist/sessionsIntegrees.js');
const { chargerConfig, sauverConfig } = await import('./dist/config.js');
const { bilanEquipe, prochaineAction } = await import('./dist/equipeBilan.js');
const { commencerUsage, sauverUsage } = await import('./dist/utilisation.js');
const { CHEMINS } = await import('./dist/chemins.js');
const { COMMANDES, executerLigne } = await import('./dist/commandes.js');
const { citerArgument } = await import('./dist/ligneCommande.js');
after(() => {
    const rel = path.relative(os.tmpdir(), racine);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true });
});
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const depot = path.join(racine, "Projet de l'équipe"); fs.mkdirSync(depot);
git(depot, 'init'); git(depot, 'config', 'user.name', 'Fixture'); git(depot, 'config', 'user.email', 'fixture@example.test');
fs.writeFileSync(path.join(depot, 'base.txt'), 'base'); git(depot, 'add', '.'); git(depot, 'commit', '-m', 'Base');
const projet = { chemin: depot, nom: 'Fixture' };

function services(reponses, prets = ['claude'], stock = []) {
    const appels = [], creations = [];
    return { appels, creations, modeles: () => stock, disponible: (f) => ({ pret: prets.includes(f), texte: prets.includes(f) ? 'Prêt' : 'Connexion requise' }),
        choisir: async (question, choix, _filtre, detail) => {
            appels.push({ question, choix, detail }); const r = reponses.shift();
            assert.ok(choix.some((c) => c.valeur === r), `${question} : réponse inattendue ${r}`); return r;
        }, saisir: async () => 'Objectif fixture', choisirPlusieurs: async () => [],
        creer: (p, objectif, taches) => { const e = { p, objectif, taches }; creations.push(e); return e; } };
}
test('parcours : agents prêts, même fournisseur si nécessaire, aucune création avant confirmation', async () => {
    const s = services(['duo', 'creer']);
    const e = await preparerEquipeGuidee(projet, 'Ajouter une recherche', s);
    assert.deepEqual(e.taches.map((t) => t.fournisseur), ['claude', 'claude']);
    assert.equal(s.appels.length, 2); assert.equal(s.creations.length, 1);
    assert.match(s.appels[1].detail, /t2.*Revue et vérification.*Claude/);
    assert.match(s.appels[1].detail, /Après : t1/);
    const annule = services(['bug', 'annuler']);
    assert.equal(await preparerEquipeGuidee(projet, 'Corriger', annule), undefined);
    assert.equal(annule.creations.length, 0);
});
test('parcours : préférence explicite, relecteur différent disponible, recherche seulement sur demande', async () => {
    sauverConfig({ ...chargerConfig(), fournisseurDefaut: 'codex' });
    try {
        const s = services(['duo', 'creer'], ['claude', 'codex']);
        const e = await preparerEquipeGuidee(projet, 'Développer', s);
        assert.deepEqual(e.taches.map((t) => t.fournisseur), ['codex', 'claude']);
        const trio = services(['trio', 'creer'], ['claude', 'codex']);
        const recherche = await preparerEquipeGuidee(projet, 'Étudier', trio);
        assert.deepEqual(recherche.taches.map((t) => t.dependances), [[], ['t1'], ['t1', 't2']]);
        assert.match(trio.appels[1].detail, /Perplexity : Connexion requise/);
    } finally { sauverConfig({ ...chargerConfig(), fournisseurDefaut: 'choisir' }); }
    assert.throws(() => recetteEquipe('duo', 'perplexity', 'codex'), /fichiers/);
});
test('modèle : remappage des dépendances, copie du plan uniquement et validation des fichiers', async () => {
    const e = { mixte: true, projet: 'PRIVATE_PATH', objectif: 'OLD_OBJECTIVE', taches: recetteEquipe('duo', 'claude', 'codex').map((t, i) => ({ ...t, id: `custom-${i}`, dependances: i ? ['custom-0'] : [], resultat: 'PRIVATE_RESULT', agentId: 'PRIVATE_SESSION', cwd: 'PRIVATE_WORKTREE' })) };
    const m = modeles.enregistrerModeleEquipe(e, '  Relecture  ');
    assert.equal(m.nom, 'Relecture'); assert.deepEqual(m.taches[1].dependances, ['t1']);
    const texte = fs.readFileSync(path.join(CHEMINS.modelesEquipes, `${m.id}.json`), 'utf8');
    assert.doesNotMatch(texte, /PRIVATE_|OLD_OBJECTIVE/);
    fs.writeFileSync(path.join(CHEMINS.modelesEquipes, `${randomUUID()}.json`), '{cassé');
    fs.writeFileSync(path.join(CHEMINS.modelesEquipes, `${randomUUID()}.json`), JSON.stringify({ ...m, taches: [{ ...m.taches[0], fournisseur: 'inconnu' }] }));
    assert.equal(modeles.lireModelesEquipes().length, 1);
    const s = services([`modele:${m.id}`, 'agents', 'codex', 'claude', 'creer'], ['claude', 'codex'], [m]);
    const nouvelle = await preparerEquipeGuidee(projet, 'Nouvel objectif', s);
    assert.deepEqual(nouvelle.taches.map((t) => t.fournisseur), ['codex', 'claude']);
    assert.deepEqual(m.taches.map((t) => t.fournisseur), ['claude', 'codex']);
    assert.equal(nouvelle.objectif, 'Nouvel objectif');
    assert.throws(() => modeles.retirerModeleEquipe('../claudetopia'), /Identifiant/);
    assert.throws(() => modeles.validerDefinitions([]), /1 à 8/);
    assert.throws(() => modeles.validerDefinitions([{ ...m.taches[0], dependances: ['t1'] }]), /circulaire/);
    assert.throws(() => modeles.validerDefinitions([{ ...m.taches[0], dependances: ['absent'] }]), /inconnue/);
    modeles.retirerModeleEquipe(m.id); assert.equal(modeles.lireModelesEquipes().length, 0);
});
test('Nouvelle équipe : la commande normale ouvre le parcours intégré, chemin avec espaces conservé', async () => {
    const c = COMMANDES.find((c) => c.nom === 'equipe-mixte'), avant = c.executer; let recu;
    c.executer = (contexte) => { recu = contexte; };
    try { await executerLigne(`/equipe ${citerArgument(depot)} -- Ajouter un filtre`); }
    finally { c.executer = avant; }
    assert.equal(recu.projet.chemin, depot); assert.equal(recu.apresProjet, 'Ajouter un filtre');
    assert.ok(COMMANDES.some((c) => c.nom === 'equipe-cli'));
});
test('reprise : mêmes fichiers, branche et conversation après échec, une seule exécution, checkout principal intact', async () => {
    const e = equipes.creerEquipeMixte(projet, 'Finir une modification', [recetteEquipe('duo', 'claude', 'claude')[0]]);
    await equipes.lancerEquipe(e.id);
    const services = { notifier() {}, envoyer: async (id) => {
        const s = sessions.lireIntegree(id); s.threadId = 'conversation-existante';
        fs.writeFileSync(path.join(s.cwd, 'travail.txt'), 'travail partiel');
        s.etat = 'erreur'; s.issue = 'error'; s.erreur = 'Interruption fixture'; sessions.sauverIntegree(s);
    } };
    equipes.avancerEquipes([], services); await equipes.attendreLancements(); equipes.avancerEquipes([], services);
    const t = e.taches[0]; assert.equal(e.etat, 'erreur');
    const avant = { agentId: t.agentId, sessionId: t.sessionId, tentative: t.tentative, cwd: t.cwd, branche: t.branche };
    git(t.cwd, 'checkout', '--detach');
    assert.match(await equipes.reprendreTache(e.id, t.id, async () => assert.fail('Branche incorrecte')), /branche du dossier a changé/);
    git(t.cwd, 'checkout', t.branche);
    let terminer, envois = 0;
    const reprise = equipes.reprendreTache(e.id, t.id, async (id, prompt) => {
        envois++; const s = sessions.lireIntegree(id);
        assert.equal(s.threadId, 'conversation-existante'); assert.match(prompt, /Ne réinitialise pas/);
        assert.equal(fs.readFileSync(path.join(s.cwd, 'travail.txt'), 'utf8'), 'travail partiel');
        await new Promise((ok) => { terminer = ok; });
        git(s.cwd, 'add', '.'); git(s.cwd, 'commit', '-m', 'Terminer');
        s.etat = 'attend'; s.issue = 'success'; s.resultat = 'Travail terminé et vérifié'; sessions.sauverIntegree(s);
    });
    assert.match(await equipes.reprendreTache(e.id, t.id, async () => { envois++; }), /arrêtée ou en erreur/);
    terminer(); assert.equal(await reprise, undefined); equipes.avancerEquipes([], services);
    assert.equal(envois, 1); assert.equal(e.etat, 'prete');
    for (const [cle, valeur] of Object.entries(avant)) assert.equal(t[cle], valeur);
    assert.equal(sessions.listerIntegrees().length, 1);
    assert.equal(git(depot, 'status', '--porcelain'), ''); assert.equal(fs.existsSync(path.join(depot, 'travail.txt')), false);
});
test('reprise : pause, dépendances actives, session active et erreur au démarrage expliquées', async () => {
    const e = equipes.creerEquipeMixte(projet, 'Protections', recetteEquipe('duo', 'claude', 'claude'));
    const s = sessions.creerIntegree('claude', depot, 'Protection');
    const t = e.taches[0]; Object.assign(t, { agentId: s.id, cwd: depot, etat: 'erreur' });
    const interdit = async () => assert.fail('Aucun lancement autorisé');
    e.taches[1].etat = 'faite';
    assert.match(await equipes.reprendreTache(e.id, t.id, interdit), /dépendante a déjà démarré/);
    e.taches[1].etat = 'attente'; s.etat = 'travaille'; sessions.sauverIntegree(s);
    assert.match(await equipes.reprendreTache(e.id, t.id, interdit), /encore actif/);
    s.etat = 'erreur'; sessions.sauverIntegree(s);
    fs.mkdirSync(CHEMINS.moteur, { recursive: true }); fs.writeFileSync(path.join(CHEMINS.moteur, 'pause.json'), '{}');
    assert.match(await equipes.reprendreTache(e.id, t.id, interdit), /pause/); fs.rmSync(path.join(CHEMINS.moteur, 'pause.json'));
    assert.equal(await equipes.reprendreTache(e.id, t.id, async () => { throw new Error('Connexion interrompue'); }), 'Connexion interrompue');
    assert.equal(t.etat, 'erreur'); assert.equal(t.resultat, 'Connexion interrompue');
    const t2 = e.taches[1]; Object.assign(t2, { agentId: s.id, etat: 'erreur' });
    assert.match(await equipes.reprendreTache(e.id, t2.id, interdit), /dont cette étape dépend/);
});
test('bilan : résultats distincts des preuves, blocages et coûts cumulés de la session sur plusieurs jours', () => {
    const s = sessions.creerIntegree('codex', depot, 'Bilan');
    s.bilan = { commandes: [{ commande: 'npm test', codeSortie: 1 }, { commande: 'verification interrompue' }], fichiers: [] }; sessions.sauverIntegree(s);
    const a = commencerUsage(s.id, 'codex'), b = commencerUsage(s.id, 'codex');
    sauverUsage(a, { coutUSD: 0.5 }, 'success'); sauverUsage(b, {}, 'error');
    const f = path.join(CHEMINS.utilisation, `${a}.json`), recu = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, JSON.stringify({ ...recu, date: Date.now() - 3 * 86400_000 }));
    const e = { nomProjet: 'Fixture', objectif: 'Bilan', etat: 'erreur', taches: [
        { id: 't1', titre: 'Correction', fournisseur: 'codex', agentId: s.id, etat: 'erreur', resultat: 'Résumé du modèle', dependances: [] },
        { id: 't2', titre: 'Revue', fournisseur: 'claude', etat: 'attente', dependances: ['t1'] } ] };
    const texte = bilanEquipe(e);
    assert.match(texte, /Code de sortie 1 · npm test/); assert.match(texte, /Résultat non renseigné · verification interrompue/);
    assert.match(texte, /0\.5000.*total incomplet/); assert.match(texte, /2 tour/);
    assert.match(texte, /Attend : t1 \(erreur\)/); assert.match(texte, /ne prouvent pas/);
    assert.match(prochaineAction(e, { etat: 'bloquee' }), /permission|demande/);
});

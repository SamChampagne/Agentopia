import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-stabilite-equipes-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.ANTHROPIC_API_KEY = 'sk-fixture-only';
fs.writeFileSync(path.join(racine, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false } }));
const eq = await import('./dist/equipe.js');
const sessions = await import('./dist/sessionsIntegrees.js');
const { editerPlan } = await import('./dist/editionEquipe.js');
const { boutonsEquipe } = await import('./dist/ui/VueEquipe.js');
const { CHEMINS } = await import('./dist/chemins.js');
const { bus, choisir, afficherVue } = await import('./dist/ui/bus.js');
after(() => { const rel = path.relative(os.tmpdir(), racine); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true }); });
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
function depot(nom) {
    const p = path.join(racine, nom); fs.mkdirSync(p);
    git(p, 'init'); git(p, 'config', 'user.name', 'Fixture'); git(p, 'config', 'user.email', 'fixture@example.test');
    fs.writeFileSync(path.join(p, 'fichier.txt'), 'base\n'); git(p, 'add', '.'); git(p, 'commit', '-m', 'Base'); return p;
}
const definitions = () => [
    { titre: 'Coder', fournisseur: 'claude', consigne: 'Modifier et vérifier', dependances: [] },
    { titre: 'Relire', fournisseur: 'claude', consigne: 'Vérifier', dependances: ['t1'] },
];
const creer = (p, defs = definitions()) => eq.creerEquipeMixte({ chemin: p, nom: path.basename(p) }, 'Objectif original', defs);
const donnees = (e) => ({ attendu: eq.empreintePlan(e), objectif: 'Objectif modifié', taches: definitions() });
const interdit = async () => assert.fail('Aucun agent ne doit être lancé');
const suivre = () => eq.avancerEquipes([], { envoyer: interdit, notifier() {} });

test('plan : validation atomique, conflit entre fenêtres et verrouillage après lancement', async () => {
    const e = creer(depot('edition'));
    const a = donnees(e), b = donnees(e), ancien = JSON.stringify(e);
    assert.match(await eq.modifierPlan(e.id, { ...a, taches: [{ ...a.taches[0], dependances: ['t1'] }] }), /circulaire/);
    assert.equal(JSON.stringify(e), ancien);
    a.taches[0].fournisseur = 'codex'; a.taches[0].consigne = 'Nouveaux critères';
    assert.equal(await eq.modifierPlan(e.id, a), undefined);
    assert.equal(e.objectif, a.objectif); assert.equal(e.taches[0].fournisseur, 'codex'); assert.equal(e.taches[0].consigne, 'Nouveaux critères');
    assert.match(await eq.modifierPlan(e.id, b), /autre fenêtre/);
    assert.equal(sessions.listerIntegrees().length, 0);
    e.etat = 'en cours'; assert.match(await eq.modifierPlan(e.id, donnees(e)), /premier lancement/);
    e.etat = 'plan'; e.taches[0].debut = Date.now(); assert.equal(eq.peutModifierPlan(e), false); e.archivee = true;
});
test('dialogues : une validation ou fermeture répétée ne masque pas la question suivante', async () => {
    let active; const observer = (d) => { active = d; }; bus.on('demande', observer);
    try {
        const premier = choisir('Premier', [{ label: 'Un', valeur: 1 }]); const ancien = active;
        ancien.resoudre(1); assert.equal(await premier, 1);
        const second = choisir('Second', [{ label: 'Deux', valeur: 2 }]); const actuel = active;
        ancien.resoudre(1); assert.equal(active, actuel); actuel.resoudre(2); assert.equal(await second, 2);
        const vue = afficherVue(() => null); const fermeture = active.resoudre; fermeture(); await vue;
        const suivant = choisir('Après la vue', [{ label: 'Suite', valeur: 3 }]); const apres = active;
        fermeture(); assert.equal(active, apres); apres.resoudre(3); assert.equal(await suivant, 3);
    } finally { bus.off('demande', observer); }
});
test('éditeur : mission, fournisseur, dépendances précochées et annulation sans toucher au plan', async () => {
    const e = creer(depot('brouillon'));
    const original = JSON.stringify(e); let saves = 0;
    const choix = ['tache:0', 'consigne', 'tache:0', 'fournisseur', 'codex', 'tache:1', 'dependances', 'annuler'];
    await editerPlan(e, {
        saisir: async () => 'Mission personnalisée',
        choisir: async (_q, options) => { const r = choix.shift(); assert.ok(options.some((o) => o.valeur === r), r); return r; },
        choisirPlusieurs: async (_q, options) => { assert.equal(options[0].coche, true); return []; },
        sauver: async () => { saves++; },
    });
    assert.equal(saves, 0); assert.equal(JSON.stringify(e), original);
    const reponses = ['tache:0', 'consigne', 'sauver'];
    assert.equal(await editerPlan(e, { saisir: async () => 'Mission sauvegardée', choisir: async () => reponses.shift(), choisirPlusieurs: async () => [],
        sauver: async (id, plan) => { saves++; return eq.modifierPlan(id, plan); } }), true);
    assert.equal(saves, 1); assert.equal(e.taches[0].consigne, 'Mission sauvegardée'); e.archivee = true;
});
test('éditeur : dépendance circulaire refusée en conservant le brouillon précédent', async () => {
    const e = creer(depot('cycle-editeur'));
    const reponses = ['tache:0', 'dependances', 'retour', 'sauver']; let explication = '';
    await editerPlan(e, { saisir: async () => '', choisirPlusieurs: async () => ['t2'],
        choisir: async (_q, _o, _r, detail) => { if (/circulaire/.test(detail || '')) explication = detail; return reponses.shift(); },
        sauver: eq.modifierPlan });
    assert.match(explication, /circulaire/); assert.deepEqual(e.taches[0].dependances, []); e.archivee = true;
});
test('retrait : conserver au moins une tâche et ne pas supprimer implicitement une dépendance', async () => {
    const e = creer(depot('retrait'));
    assert.match(await eq.retirerTache(e.id, 't1'), /dépend/); assert.equal(e.taches.length, 2);
    assert.equal(await eq.retirerTache(e.id, 't2'), undefined);
    assert.match(await eq.retirerTache(e.id, 't1'), /au moins une tâche/);
    e.taches[0].debut = Date.now(); assert.match(await eq.retirerTache(e.id, 't1'), /déjà démarré/); e.archivee = true;
});
test('premier lancement : partir du dernier commit, puis conserver cette base aux reprises', async () => {
    const p = depot('base'), e = creer(p, definitions().slice(0, 1)), baseInitiale = e.base;
    fs.writeFileSync(path.join(p, 'ajout.txt'), 'Ajout après création du plan'); git(p, 'add', '.'); git(p, 'commit', '-m', 'Projet avancé');
    const nouvelleBase = git(p, 'rev-parse', 'HEAD'); assert.notEqual(nouvelleBase, baseInitiale);
    assert.equal(await eq.lancerEquipe(e.id), undefined); assert.equal(e.base, nouvelleBase);
    eq.avancerEquipes([], { notifier() {}, envoyer: async (id) => {
        const s = sessions.lireIntegree(id); assert.equal(fs.readFileSync(path.join(s.cwd, 'ajout.txt'), 'utf8'), 'Ajout après création du plan');
        s.etat = 'erreur'; s.issue = 'error'; sessions.sauverIntegree(s);
    } });
    await eq.attendreLancements(); suivre(); assert.equal(e.etat, 'erreur');
    fs.writeFileSync(path.join(p, 'autre.txt'), 'Autre commit'); git(p, 'add', '.'); git(p, 'commit', '-m', 'Après lancement');
    await eq.lancerEquipe(e.id); assert.equal(e.base, nouvelleBase); e.archivee = true;
});
test('intégration : exclusivité entre équipes, conflit Git et reprise dans la même conversation et branche', async () => {
    const p = depot('fusion'), e = creer(p, definitions().slice(0, 1));
    await eq.lancerEquipe(e.id);
    eq.avancerEquipes([], { notifier() {}, envoyer: async (id) => {
        const s = sessions.lireIntegree(id); fs.writeFileSync(path.join(s.cwd, 'fichier.txt'), 'agent\n');
        git(s.cwd, 'add', '.'); git(s.cwd, 'commit', '-m', 'Agent'); s.etat = 'attend'; s.issue = 'success'; s.resultat = 'Changement agent'; sessions.sauverIntegree(s);
    } });
    await eq.attendreLancements(); suivre(); assert.equal(e.etat, 'prete');
    const autre = creer(p, definitions().slice(0, 1)); autre.etat = 'prete'; autre.taches[0].etat = 'faite'; autre.taches[0].branche = e.taches[0].branche;
    fs.writeFileSync(path.join(p, 'fichier.txt'), 'humain\n'); git(p, 'add', '.'); git(p, 'commit', '-m', 'Travail humain');
    let terminer, nombre = 0;
    const lancement = eq.integrer(e.id, async (id) => {
        nombre++; const s = sessions.lireIntegree(id); s.threadId = 'fusion-existante'; s.etat = 'travaille'; sessions.sauverIntegree(s);
        await new Promise((ok) => { terminer = ok; });
        const fusion = spawnSync('git', ['merge', '--no-edit', e.taches[0].branche], { cwd: p, encoding: 'utf8', windowsHide: true });
        assert.equal(fusion.status, 1, 'Conflit réel attendu dans le dépôt temporaire');
        fs.writeFileSync(path.join(p, 'fichier.txt'), 'solution partielle\n');
        s.etat = 'erreur'; s.issue = 'error'; s.erreur = 'Interruption pendant la résolution'; sessions.sauverIntegree(s);
    });
    assert.match(await eq.integrer(autre.id, interdit), /autre équipe/);
    e.archivee = true; e.etat = 'prete';
    assert.match(await eq.integrer(autre.id, interdit), /autre équipe/, 'Le worker doit être réellement arrêté même si son équipe est rangée');
    e.archivee = false; e.etat = 'integration'; terminer(); await lancement; suivre();
    assert.equal(e.etat, 'prete'); const integration = e.integrateur, sessionAvant = integration.agentId;
    assert.match(await eq.integrer(e.id, interdit), /intégration existante/);
    assert.equal(await eq.reprendreTache(e.id, 'integration', async (id, prompt) => {
        nombre++; assert.equal(id, sessionAvant); assert.match(prompt, /fusion en cours/); assert.match(prompt, /Ne refais pas les fusions/);
        const s = sessions.lireIntegree(id); assert.equal(s.threadId, 'fusion-existante');
        assert.equal(fs.readFileSync(path.join(p, 'fichier.txt'), 'utf8'), 'solution partielle\n');
        fs.writeFileSync(path.join(p, 'fichier.txt'), 'solution finale agent et humain\n'); git(p, 'add', '.'); git(p, 'commit', '-m', 'Résoudre le conflit');
        s.etat = 'attend'; s.issue = 'success'; s.resultat = 'Fusion résolue et vérifiée'; sessions.sauverIntegree(s);
    }), undefined);
    suivre(); assert.equal(e.etat, 'finie'); assert.equal(nombre, 2); assert.equal(e.integrateur, integration);
    assert.match(await eq.lancerEquipe(e.id), /déjà intégrée/);
    assert.match(await eq.relancerTache(e.id, 't1'), /ne peut plus être relancée/);
    await eq.arreterEquipe(e.id); assert.equal(e.etat, 'finie');
    assert.equal(git(p, 'status', '--porcelain'), ''); assert.equal(git(p, 'show', '-s', '--format=%P').split(' ').length, 2);
    assert.equal(sessions.listerIntegrees().filter((s) => s.cwd === p).length, 1); autre.archivee = true; e.archivee = true;
});
test('intégration : branche détachée, pause et branche changée avant reprise sont refusées', async () => {
    const p = depot('garde-fusion'), e = creer(p, definitions().slice(0, 1)); e.etat = 'prete'; e.taches[0].etat = 'faite';
    const branche = git(p, 'branch', '--show-current'); e.taches[0].branche = branche;
    git(p, 'checkout', '--detach'); assert.match(await eq.integrer(e.id, interdit), /aucune branche/); git(p, 'checkout', branche);
    fs.mkdirSync(CHEMINS.moteur, { recursive: true }); fs.writeFileSync(path.join(CHEMINS.moteur, 'pause.json'), '{}');
    assert.match(await eq.integrer(e.id, interdit), /pause/); fs.rmSync(path.join(CHEMINS.moteur, 'pause.json'));
    await eq.integrer(e.id, async (id) => { const s = sessions.lireIntegree(id); s.etat = 'erreur'; s.issue = 'error'; sessions.sauverIntegree(s); }); suivre();
    e.integrateur.branche = undefined;
    assert.match(await eq.reprendreTache(e.id, 'integration', interdit), /ancienne intégration/); e.integrateur.branche = branche;
    git(p, 'checkout', '-b', 'autre-branche');
    assert.match(await eq.reprendreTache(e.id, 'integration', interdit), /branche du dossier a changé/);
    assert.ok(boutonsEquipe(e).some((b) => /Reprendre l’intégration/.test(b.label))); e.archivee = true;
});
test('équipe de recherche : bilan et rangement disponibles, aucun bouton de fusion inutile', () => {
    const e = { mixte: true, etat: 'prete', taches: [{ id: 't1', etat: 'faite', fournisseur: 'perplexity' }] };
    const boutons = boutonsEquipe(e); assert.ok(boutons.some((b) => b.action === 'actions-equipe'));
    assert.ok(boutons.some((b) => b.action === 'ranger')); assert.ok(!boutons.some((b) => b.action === 'integrer'));
});

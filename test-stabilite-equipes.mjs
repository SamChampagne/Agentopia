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
const { suiteEquipe, relireEquipe } = await import('./dist/finEquipe.js');
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

test('relance ciblée : préserver exactement les autres tentatives en erreur', async () => {
    const e = creer(depot('relance-ciblee'), definitions().map((t) => ({ ...t, dependances: [] })));
    e.etat = 'erreur';
    for (const t of e.taches) Object.assign(t, { etat: 'erreur', agentId: `session-${t.id}`, sessionId: `conversation-${t.id}`,
        branche: `branche-${t.id}`, cwd: `dossier-${t.id}`, resultat: `Résultat ${t.id}`, debut: 100, fin: 200 });
    const autre = JSON.stringify(e.taches[1]), tentative = e.taches[0].tentative;
    assert.equal(await eq.relancerTache(e.id, 't1'), undefined);
    assert.equal(JSON.stringify(e.taches[1]), autre, 'Une relance ciblée ne doit pas effacer la branche, la conversation ou le résultat d’une autre tâche');
    assert.equal(e.taches[0].etat, 'attente'); assert.notEqual(e.taches[0].tentative, tentative);
    for (const champ of ['agentId', 'sessionId', 'branche', 'cwd', 'resultat', 'debut', 'fin']) assert.equal(e.taches[0][champ], undefined);
    assert.equal(e.etat, 'en cours'); e.archivee = true;
});

test('relance : refus atomique si un dépendant indirect a démarré ou si le projet est modifié', async () => {
    const p = depot('garde-relance'), e = creer(p, [...definitions(), { titre: 'Valider', fournisseur: 'claude', consigne: 'Valider', dependances: ['t2'] }]);
    e.etat = 'erreur'; e.taches[0].etat = 'erreur'; e.taches[2].etat = 'faite';
    const avant = JSON.stringify(e);
    assert.match(await eq.relancerTache(e.id, 't1'), /dépendante a déjà démarré.*Valider/);
    assert.equal(JSON.stringify(e), avant);
    assert.match(await eq.lancerEquipe(e.id), /dépendante a déjà démarré/);
    assert.equal(JSON.stringify(e), avant);
    e.taches[2].etat = 'attente'; fs.writeFileSync(path.join(p, 'fichier.txt'), 'Travail local');
    const modifiee = JSON.stringify(e);
    assert.match(await eq.relancerTache(e.id, 't1'), /modifications locales/);
    assert.equal(JSON.stringify(e), modifiee); e.archivee = true;
});

test('relance : attendre la fin effective de l’ancien agent et préserver une intégration interrompue', async () => {
    const p = depot('agent-encore-actif'), e = creer(p, definitions().slice(0, 1)); e.etat = 'erreur';
    const s = sessions.creerIntegree('claude', p, 'Ancienne tentative'); s.etat = 'travaille'; sessions.sauverIntegree(s);
    Object.assign(e.taches[0], { etat: 'arretee', agentId: s.id, cwd: p });
    const avant = JSON.stringify(e);
    assert.match(await eq.relancerTache(e.id, 't1'), /encore actif/); assert.equal(JSON.stringify(e), avant);
    assert.match(await eq.lancerEquipe(e.id), /encore actif/); assert.equal(JSON.stringify(e), avant);
    s.etat = 'attend'; s.issue = 'cancelled'; sessions.sauverIntegree(s);
    e.integrateur = { id: 'integration', titre: 'Intégration', role: 'integrateur', consigne: '', dependances: [], etat: 'erreur' };
    assert.match(await eq.relancerTache(e.id, 't1'), /intégration a déjà démarré/);
    assert.match(await eq.lancerEquipe(e.id), /intégration a déjà démarré/); e.archivee = true;
});

async function branchesTerminees(nom, defs = definitions()) {
    const p = depot(nom), e = creer(p, defs);
    await eq.lancerEquipe(e.id);
    for (let i = 0; i < defs.length; i++) {
        eq.avancerEquipes([], { notifier() {}, envoyer: async (id) => {
            const s = sessions.lireIntegree(id), t = e.taches.find((t) => t.agentId === id);
            fs.writeFileSync(path.join(s.cwd, `${t.id}.txt`), `Travail ${t.id}\n`);
            git(s.cwd, 'add', '.'); git(s.cwd, 'commit', '-m', t.titre);
            s.etat = 'attend'; s.issue = 'success'; s.resultat = `Travail de ${t.titre} terminé`; sessions.sauverIntegree(s);
        } });
        await eq.attendreLancements();
    }
    suivre(); assert.equal(e.etat, 'prete'); return { p, e };
}
const succesIntegration = (id, resultat = 'Toutes les branches ont été intégrées') => {
    const s = sessions.lireIntegree(id); s.etat = 'attend'; s.issue = 'success'; s.resultat = resultat; sessions.sauverIntegree(s);
};

test('exclusion : refuser un ancêtre retenu indirectement, et empêcher sa réintroduction', async () => {
    const { p, e } = await branchesTerminees('exclusion-transitive', [...definitions(),
        { titre: 'Valider', fournisseur: 'claude', consigne: 'Valider', dependances: ['t2'] }]);
    git(p, 'merge-base', '--is-ancestor', e.taches[0].branche, e.taches[2].branche);
    await assert.rejects(eq.basculerEcart(e.id, 't2'), /contient le travail/);
    assert.equal(e.taches[1].ecartee, undefined);
    assert.equal(await eq.basculerEcart(e.id, 't3'), true);
    assert.equal(await eq.basculerEcart(e.id, 't2'), true);
    assert.equal(await eq.basculerEcart(e.id, 't1'), true);
    await assert.rejects(eq.basculerEcart(e.id, 't3'), /contient le travail/);
    assert.equal(e.taches[2].ecartee, true);
    assert.equal(await eq.basculerEcart(e.id, 't1'), false);
    assert.equal(await eq.basculerEcart(e.id, 't2'), false);
    assert.equal(await eq.basculerEcart(e.id, 't3'), false);
    // Simuler un fichier créé par une ancienne version qui autorisait une sélection incohérente.
    e.taches[0].ecartee = true; e.taches[1].ecartee = true;
    assert.equal(suiteEquipe(e).peutIntegrer, false); assert.match(suiteEquipe(e).instruction, /Valider.*Coder/);
    assert.match(await eq.integrer(e.id, interdit), /Valider.*Coder/); assert.equal(e.integrateur, undefined);
    e.archivee = true;
});

test('Relire : conserver le bilan et expliquer une exclusion impossible', async () => {
    const { e } = await branchesTerminees('explication-exclusion');
    const reponses = ['diff:t1', 'ecarter', 'retour']; let explication = '';
    const repondre = (d) => {
        if (!d) return;
        if (/contient le travail/.test(d.detail || '')) explication = d.detail;
        const reponse = reponses.shift(); assert.ok(reponse, 'Dialogue inattendu');
        queueMicrotask(() => d.resoudre(reponse));
    };
    bus.on('demande', repondre);
    try { await relireEquipe(e.id); } finally { bus.off('demande', repondre); }
    assert.match(explication, /Relire.*Coder/); assert.equal(reponses.length, 0);
    assert.equal(eq.equipeDe(e.id).taches[0].ecartee, undefined); eq.equipeDe(e.id).archivee = true;
});

test('exclusion : réparer une ancienne sélection incohérente en plusieurs étapes', async () => {
    const e = creer(depot('reparer-selection'), [...definitions(),
        { titre: 'Autre base', fournisseur: 'claude', consigne: 'Autre', dependances: [] },
        { titre: 'Autre suite', fournisseur: 'claude', consigne: 'Suite', dependances: ['t3'] }]);
    e.etat = 'prete'; for (const t of e.taches) { t.etat = 'faite'; t.branche = `branche-${t.id}`; }
    e.taches[0].ecartee = true; e.taches[2].ecartee = true;
    assert.equal(await eq.basculerEcart(e.id, 't1'), false, 'La première correction ne doit pas être refusée à cause de la seconde erreur existante');
    assert.equal(suiteEquipe(e).peutIntegrer, false);
    assert.equal(await eq.basculerEcart(e.id, 't3'), false); assert.equal(suiteEquipe(e).peutIntegrer, true);
    e.archivee = true;
});

test('intégration : un faux succès reste récupérable jusqu’à la preuve Git de toutes les branches', async () => {
    const { p, e } = await branchesTerminees('fusion-incomplete', definitions().map((t) => ({ ...t, dependances: [] })));
    await eq.integrer(e.id, async (id) => succesIntegration(id)); suivre();
    assert.equal(e.etat, 'prete'); assert.equal(e.integrateur.etat, 'erreur'); assert.match(e.message, /n’est pas intégrée/);
    assert.equal(fs.existsSync(path.join(p, 't1.txt')), false);
    const id = e.integrateur.agentId, branche = e.integrateur.branche;
    assert.equal(suiteEquipe(e).reprise, true);
    await assert.rejects(eq.basculerEcart(e.id, 't1'), /sélection est conservée/);
    assert.equal(await eq.reprendreTache(e.id, 'integration', async (sid) => {
        assert.equal(sid, id); git(p, 'merge', '--no-edit', e.taches[0].branche); succesIntegration(sid);
    }), undefined); suivre();
    assert.equal(e.etat, 'prete'); assert.match(e.message, /Relire.*n’est pas intégrée/);
    assert.equal(await eq.reprendreTache(e.id, 'integration', async (sid) => {
        assert.equal(sid, id); git(p, 'merge', '--no-edit', e.taches[1].branche); succesIntegration(sid);
    }), undefined); suivre();
    assert.equal(e.etat, 'finie'); assert.equal(e.integrateur.branche, branche);
    assert.equal(e.integrateur.agentId, id);
    for (const t of e.taches) git(p, 'merge-base', '--is-ancestor', t.branche, 'HEAD');
    e.archivee = true;
});

test('intégration : ne pas valider des fusions effectuées sur une autre branche', async () => {
    const { p, e } = await branchesTerminees('mauvaise-destination', definitions().slice(0, 1));
    const destination = git(p, 'branch', '--show-current');
    await eq.integrer(e.id, async (id) => {
        git(p, 'checkout', '-b', 'autre-destination'); git(p, 'merge', '--no-edit', e.taches[0].branche); succesIntegration(id);
    }); suivre();
    assert.equal(e.etat, 'prete'); assert.match(e.message, /branche du projet a changé/);
    assert.equal(e.integrateur.branche, destination);
    assert.match(await eq.reprendreTache(e.id, 'integration', interdit), /branche du dossier a changé/);
    git(p, 'checkout', destination);
    assert.equal(await eq.reprendreTache(e.id, 'integration', async (id) => {
        git(p, 'merge', '--no-edit', e.taches[0].branche); succesIntegration(id);
    }), undefined); suivre(); assert.equal(e.etat, 'finie'); e.archivee = true;
});

test('intégration : une branche indépendante écartée reste hors du projet', async () => {
    const { p, e } = await branchesTerminees('exclusion-independante', definitions().map((t) => ({ ...t, dependances: [] })));
    await eq.basculerEcart(e.id, 't2');
    await eq.integrer(e.id, async (id, prompt) => {
        assert.ok(!prompt.includes(e.taches[1].branche));
        git(p, 'merge', '--no-edit', e.taches[0].branche); succesIntegration(id);
    }); suivre();
    assert.equal(e.etat, 'finie'); assert.equal(fs.existsSync(path.join(p, 't1.txt')), true);
    assert.equal(fs.existsSync(path.join(p, 't2.txt')), false); e.archivee = true;
});

test('intégration native : garder la destination initiale et refuser une ancienne destination inconnue', async () => {
    const { p, e } = await branchesTerminees('destination-native', definitions().slice(0, 1));
    const destination = git(p, 'branch', '--show-current');
    const fichier = path.join(racine, 'integration-native.jsonl');
    fs.writeFileSync(fichier, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fusion terminée' }] } }) + '\n');
    e.mixte = false; e.etat = 'integration';
    e.integrateur = { id: 'integration', titre: 'Intégration', role: 'integrateur', consigne: '', dependances: [],
        etat: 'en cours', agentId: 'native-fixture', branche: destination };
    git(p, 'checkout', '-b', 'autre-destination'); git(p, 'merge', '--no-edit', e.taches[0].branche);
    const agents = [{ id: 'native-fixture', statut: 'terminee', sessionId: 'native', cwd: p, fichier }];
    eq.avancerEquipes(agents, { envoyer: interdit, notifier() {} });
    assert.equal(e.etat, 'prete'); assert.equal(e.integrateur.branche, destination); assert.match(e.message, /branche du projet a changé/);
    e.integrateur.branche = undefined; e.integrateur.etat = 'en cours'; e.etat = 'integration';
    eq.avancerEquipes(agents, { envoyer: interdit, notifier() {} });
    assert.equal(e.etat, 'prete'); assert.equal(e.integrateur.branche, undefined); assert.match(e.message, /ancienne intégration/);
    e.archivee = true;
});

test('intégration : un échec de lecture Git ne devient jamais une réussite', async () => {
    const { e } = await branchesTerminees('branche-introuvable', definitions().slice(0, 1));
    e.taches[0].branche = 'branche-introuvable';
    await eq.integrer(e.id, async (id) => succesIntegration(id)); suivre();
    assert.equal(e.etat, 'prete'); assert.equal(e.integrateur.etat, 'erreur');
    assert.ok(e.message); assert.equal(suiteEquipe(e).reprise, true); e.archivee = true;
});

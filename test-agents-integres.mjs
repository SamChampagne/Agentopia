import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';

// Aucune lecture des comptes/configurations personnelles, aucun appel à un modèle.
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'claudetopia-agents-test-'));
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'donnees');
process.env.ANTHROPIC_API_KEY = 'sk-fixture-only';
process.env.PERPLEXITY_API_KEY = 'pplx-fixture-only';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.mkdirSync(process.env.CLAUDETOPIA_DATA_DIR);
const sessions = await import('./dist/sessionsIntegrees.js');
const { travailler } = await import('./dist/sessionWorker.js');
const { decoderPerplexity, executerPerplexity } = await import('./dist/providers/perplexity.js');
const { executerCodex } = await import('./dist/providers/codex.js');
const { executerClaude } = await import('./dist/providers/claude.js');
const { validerDependances } = await import('./dist/equipePlan.js');
const equipe = await import('./dist/equipe.js');
const { contexteSaisie } = await import('./dist/ui/contexteSaisie.js');
const { lireTranscript } = await import('./dist/agents.js');

after(() => fs.rmSync(racine, { recursive: true, force: true }));
function preparer(fournisseur = 'claude', prompt = 'bonjour') {
    const s = sessions.creerIntegree(fournisseur, racine, 'Fixture');
    s.tour = randomUUID(); s.etat = 'travaille'; sessions.sauverIntegree(s);
    const dossier = sessions.dossierIntegre(s.id);
    fs.writeFileSync(path.join(dossier, 'verrou'), '');
    sessions.ecrireAtomique(path.join(dossier, 'requete.json'), { tour: s.tour, prompt });
    return s;
}
async function attendre(condition) {
    for (let n = 0; n < 100; n++) { if (condition()) return; await pause(30); }
    assert.fail('Condition non atteinte');
}
const git = (args, cwd) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};

test('états de saisie : liste filtrable, vue Projets, dialogue et saisie normale', () => {
    assert.match(contexteSaisie({ type: 'choix', recherche: true }), /filtre/);
    assert.match(contexteSaisie({ type: 'vue' }, '/projets'), /Projets.*filtrer/);
    assert.match(contexteSaisie({ type: 'saisie' }), /dialogue/);
    assert.equal(contexteSaisie(undefined), undefined);
});
test('validation du plan : cycles, doublons, références invalides', () => {
    assert.throws(() => validerDependances([{ id: 'a', dependances: ['b'] }, { id: 'b', dependances: ['a'] }]), /circulaire/);
    assert.throws(() => validerDependances([{ id: 'a', dependances: [] }, { id: 'a', dependances: [] }]), /unique/);
    assert.throws(() => validerDependances([{ id: 'a', dependances: ['absent'] }]), /inconnue/);
    validerDependances([{ id: 'a', dependances: [] }, { id: 'b', dependances: [] }, { id: 'c', dependances: ['a', 'b'] }]);
});
test('un worker garde le thread, le résultat et un transcript lisible', async () => {
    const s = preparer();
    await travailler(s.id, s.tour, async (c) => {
        c.thread('thread-fixture'); c.evenement({ role: 'assistant', texte: 'Réponse réelle du faux transport' });
        return 'Résumé final';
    });
    const fini = sessions.lireIntegree(s.id);
    assert.equal(fini.issue, 'success'); assert.equal(fini.threadId, 'thread-fixture');
    assert.equal(fini.resultat, 'Résumé final'); assert.equal(fini.etat, 'attend');
    const transcript = lireTranscript(path.join(sessions.dossierIntegre(s.id), 'conversation.jsonl'));
    assert.deepEqual(transcript.map((m) => m.role), ['user', 'assistant']);
    assert.equal(fs.existsSync(path.join(sessions.dossierIntegre(s.id), 'verrou')), false);
});
test('deux messages simultanés ne lancent pas deux workers', async () => {
    const s = preparer();
    await assert.rejects(sessions.envoyerIntegree(s.id, 'autre message'), /déjà en cours/);
    await travailler(s.id, s.tour, async () => 'terminé');
});
test('un processus disparu est récupérable sans être déclaré réussi', () => {
    const s = preparer(); s.pid = 2147483647; s.maj = Date.now() - 130_000;
    sessions.ecrireAtomique(path.join(sessions.dossierIntegre(s.id), 'etat.json'), s);
    const r = sessions.listerIntegrees().find((a) => a.id === s.id);
    assert.equal(r.issue, 'error'); assert.equal(r.etat, 'erreur');
    assert.equal(fs.existsSync(path.join(sessions.dossierIntegre(s.id), 'verrou')), false);
});
test('une permission attend une décision explicite et rejette une réponse périmée', async () => {
    const s = preparer(); let accepte;
    const travail = travailler(s.id, s.tour, async (c) => {
        const r = await c.permission({ titre: 'Écrire un fichier', detail: 'fixture' }); accepte = r.accepte;
        return 'Action refusée, aucune écriture';
    });
    await attendre(() => !!sessions.lireIntegree(s.id)?.permission);
    const p = sessions.lireIntegree(s.id).permission;
    assert.equal(sessions.lireIntegree(s.id).etat, 'bloquee');
    assert.throws(() => sessions.repondrePermission(s.id, 'ancien', { accepte: true }), /expiré/);
    sessions.repondrePermission(s.id, p.id, { accepte: false });
    await travail;
    assert.equal(accepte, false); assert.equal(sessions.lireIntegree(s.id).permission, undefined);
});
test('interruption pendant une permission : annulé, jamais réussi', async () => {
    const s = preparer();
    const travail = travailler(s.id, s.tour, async (c) => { await c.permission({ titre: 'Commande', detail: 'fixture' }); return 'ne doit pas arriver'; });
    await attendre(() => sessions.lireIntegree(s.id)?.etat === 'bloquee');
    sessions.interrompreIntegree(s.id); await travail;
    assert.equal(sessions.lireIntegree(s.id).issue, 'cancelled');
    assert.equal(sessions.lireIntegree(s.id).permission, undefined);
});
test('erreur du fournisseur et masquage des clés dans les erreurs', async () => {
    const s = preparer();
    await travailler(s.id, s.tour, async () => { throw new Error('Refus sk-secret-fixture pplx-secret-fixture'); });
    const fini = sessions.lireIntegree(s.id);
    assert.equal(fini.issue, 'error'); assert.doesNotMatch(fini.erreur, /secret-fixture/);
    assert.equal(fini.resultat, undefined);
});
test('archiver pendant un tour ne ressuscite pas la carte', async () => {
    const s = preparer();
    await travailler(s.id, s.tour, async () => { sessions.archiverIntegree(s.id); return 'fin'; });
    assert.equal(sessions.listerIntegrees().some((a) => a.id === s.id), false);
    assert.ok(sessions.lireIntegree(s.id));
    sessions.restaurerIntegree(s.id);
    assert.ok(sessions.listerIntegrees().some((a) => a.id === s.id));
    assert.throws(() => sessions.dossierIntegre('../ailleurs'), /invalide/);
});
test('Claude : entrée en flux, reprise, autorisation et succès explicite', async () => {
    const c = { session: { cwd: racine, threadId: 'ancien' }, prompt: 'Mission', historique: [], signal: new AbortController().signal,
        thread(id) { assert.equal(id, 'ancien'); }, evenement() {}, async permission() { return { accepte: false }; } };
    async function* requete({ prompt, options }) {
        assert.equal(options.resume, 'ancien'); assert.equal(options.permissionMode, 'default');
        for await (const message of prompt) assert.equal(message.message.content, 'Mission');
        const decision = await options.canUseTool('Bash', { command: 'npm test' });
        assert.equal(decision.behavior, 'deny');
        yield { type: 'assistant', session_id: 'ancien', message: { content: [{ type: 'text', text: 'Résumé' }] } };
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'ancien', result: 'Résumé' };
    }
    assert.equal(await executerClaude(c, requete), 'Résumé');
    await assert.rejects(executerClaude(c, async function* () {}), /sans résultat final/);
    await assert.rejects(executerClaude(c, async function* () { yield { type: 'result', subtype: 'success', is_error: true, result: 'refus API' }; }), /refus API/);
});
test('Perplexity : endpoint Agent, historique, citations et erreurs HTTP', async () => {
    const reponse = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Réponse',
        annotations: [{ type: 'url_citation', url: 'https://example.org/doc', title: 'Documentation' }] }] }] };
    assert.match(decoderPerplexity(reponse), /Sources.*\n- Documentation : https:\/\/example.org\/doc/);
    assert.throws(() => decoderPerplexity({ status: 'failed', output: [] }), /non terminée/);
    const c = { session: { fournisseur: 'perplexity' }, prompt: 'Suite', historique: [{ role: 'user', content: 'Avant' }], signal: new AbortController().signal, evenement() {} };
    await executerPerplexity(c, async (url, opts) => {
        assert.equal(url, 'https://api.perplexity.ai/v1/agent');
        const corps = JSON.parse(opts.body); assert.equal(corps.input.length, 2); assert.equal(corps.effort, 'low');
        return new Response(JSON.stringify(reponse), { status: 200 });
    });
    await assert.rejects(executerPerplexity(c, async () => new Response('', { status: 401 })), /refusée/);
});
test('Codex : protocole, reprise du thread, permissions et résultat final', async () => {
    // Processus local simulant app-server ; aucun binaire Codex ni réseau.
    const script = `
        const rl = require('readline').createInterface({input:process.stdin});
        const send = (m) => process.stdout.write(JSON.stringify(m)+'\\n');
        rl.on('line', l => { const m=JSON.parse(l);
          if(m.method==='initialize') send({id:m.id,result:{}});
          if(m.method==='thread/resume') {
            if(m.params.threadId!=='thread-ancien'||m.params.sandbox!=='workspace-write'||m.params.approvalsReviewer!=='user') process.exit(4);
            send({id:m.id,result:{thread:{id:'thread-ancien'}}});
          }
          if(m.method==='turn/start') { send({id:m.id,result:{turn:{id:'tour'}}}); send({id:'permission',method:'item/commandExecution/requestApproval',params:{command:'npm test'}}); }
          if(m.id==='permission'&&m.result) {
            if(m.result.decision!=='decline') process.exit(5);
            send({method:'item/agentMessage/delta',params:{itemId:'message',delta:'Résultat'}});
            send({method:'item/completed',params:{item:{id:'message',type:'agentMessage',text:'Résultat'}}});
            send({method:'turn/completed',params:{turn:{id:'tour',status:'completed'}}});
          }
        });`;
    const proc = spawn(process.execPath, ['-e', script], { stdio: 'pipe', windowsHide: true });
    const ev = []; let demandes = 0;
    const resultat = await executerCodex({ session: { cwd: racine, threadId: 'thread-ancien' }, prompt: 'Bonjour', historique: [],
        signal: new AbortController().signal, thread(id) { assert.equal(id, 'thread-ancien'); }, evenement(e) { ev.push(e); },
        async permission() { demandes++; return { accepte: false }; } }, proc);
    assert.equal(resultat, 'Résultat'); assert.equal(demandes, 1); assert.equal(ev.length, 1);
});
test('une équipe échange les sources, isole et fusionne les dépendances sans toucher au checkout initial', async () => {
    const depot = path.join(racine, 'projet'); fs.mkdirSync(depot);
    git(['init'], depot); git(['config', 'user.name', 'Fixture'], depot); git(['config', 'user.email', 'fixture@example.test'], depot);
    fs.writeFileSync(path.join(depot, 'base.txt'), 'base'); git(['add', '.'], depot); git(['commit', '-m', 'Base'], depot);
    const e = equipe.creerEquipeMixte({ chemin: depot, nom: 'Projet test' }, 'Objectif fixture', [
        { titre: 'Recherche', fournisseur: 'perplexity', consigne: 'chercher', dependances: [] },
        { titre: 'Code', fournisseur: 'claude', consigne: 'coder', dependances: ['t1'] },
        { titre: 'Revue', fournisseur: 'codex', consigne: 'vérifier', dependances: ['t2'] },
    ]);
    // Le mock évite les vérifications de connexion et n'appelle aucun modèle.
    e.etat = 'en cours'; const lancements = [];
    const services = { notifier() {}, async envoyer(id, prompt) {
        const s = sessions.lireIntegree(id); lancements.push(s.fournisseur);
        if (s.fournisseur === 'claude') {
            assert.match(prompt, /https:\/\/example.org\/source/); assert.notEqual(s.cwd, depot);
            fs.writeFileSync(path.join(s.cwd, 'livraison.txt'), 'travail');
            git(['add', '.'], s.cwd); git(['commit', '-m', 'Travail'], s.cwd);
        }
        if (s.fournisseur === 'codex') {
            assert.equal(fs.readFileSync(path.join(s.cwd, 'livraison.txt'), 'utf8'), 'travail');
            assert.match(prompt, /Livraison terminée/);
        }
        s.etat = 'attend'; s.issue = 'success'; s.resultat = s.fournisseur === 'perplexity' ? 'Source https://example.org/source' : 'Livraison terminée';
        sessions.sauverIntegree(s);
    } };
    for (let n = 0; n < 12 && e.etat !== 'prete'; n++) { equipe.avancerEquipes([], services); await pause(30); }
    assert.equal(e.etat, 'prete'); assert.deepEqual(lancements, ['perplexity', 'claude', 'codex']);
    assert.equal(fs.existsSync(path.join(depot, 'livraison.txt')), false);
    assert.notEqual(e.taches[1].cwd, e.taches[2].cwd);
    assert.equal(git(['status', '--porcelain'], depot), '');
    e.archivee = true;
});
test('une équipe ne confond pas attente, permission, erreur et réussite', async () => {
    const depot = path.join(racine, 'projet');
    const e = equipe.creerEquipeMixte({ chemin: depot, nom: 'Échec test' }, 'Fixture', [
        { titre: 'Tâche', fournisseur: 'claude', consigne: 'mission', dependances: [] },
        { titre: 'Suite', fournisseur: 'perplexity', consigne: 'suite', dependances: ['t1'] },
    ]);
    const s = sessions.creerIntegree('claude', depot, 'Session fixture');
    e.etat = 'en cours'; e.taches[0].etat = 'en cours'; e.taches[0].agentId = s.id;
    const services = { notifier() {}, async envoyer() { assert.fail('La dépendance ne doit pas démarrer'); } };
    equipe.avancerEquipes([], services); assert.equal(e.taches[0].etat, 'en cours');
    s.etat = 'bloquee'; sessions.sauverIntegree(s); equipe.avancerEquipes([], services); assert.equal(e.taches[0].etat, 'bloquee');
    s.etat = 'erreur'; s.issue = 'error'; s.erreur = 'Connexion refusée'; sessions.sauverIntegree(s);
    equipe.avancerEquipes([], services); assert.equal(e.etat, 'erreur'); assert.equal(e.taches[1].etat, 'attente');
    e.archivee = true;
});
test('les tâches indépendantes démarrent ensemble ; leur suite attend les deux résultats', async () => {
    const e = equipe.creerEquipeMixte({ chemin: path.join(racine, 'projet'), nom: 'Parallèle' }, 'Fixture', [
        { titre: 'Analyse A', fournisseur: 'claude', consigne: 'analyser A', dependances: [] },
        { titre: 'Analyse B', fournisseur: 'codex', consigne: 'analyser B', dependances: [] },
        { titre: 'Synthèse', fournisseur: 'perplexity', consigne: 'synthétiser', dependances: ['t1', 't2'] },
    ]);
    const enCours = []; e.etat = 'en cours';
    const services = { notifier() {}, envoyer(id) { return new Promise((ok) => enCours.push(() => {
        const s = sessions.lireIntegree(id); s.etat = 'attend'; s.issue = 'success'; s.resultat = `Résultat ${s.fournisseur}`;
        sessions.sauverIntegree(s); ok();
    })); } };
    equipe.avancerEquipes([], services);
    assert.equal(enCours.length, 2); assert.equal(e.taches[2].etat, 'attente');
    enCours[0](); await pause(10); equipe.avancerEquipes([], services);
    assert.equal(enCours.length, 2); assert.equal(e.taches[2].etat, 'attente');
    enCours[1](); await pause(10); equipe.avancerEquipes([], services);
    assert.equal(enCours.length, 3);
    enCours[2](); await pause(10); equipe.avancerEquipes([], services);
    assert.equal(e.etat, 'prete'); e.archivee = true;
});
test('des modifications non commitées empêchent de déclarer une tâche réussie', async () => {
    const e = equipe.creerEquipeMixte({ chemin: path.join(racine, 'projet'), nom: 'Travail incomplet' }, 'Fixture', [
        { titre: 'Code', fournisseur: 'claude', consigne: 'coder', dependances: [] },
    ]);
    e.etat = 'en cours';
    const services = { notifier() {}, async envoyer(id) {
        const s = sessions.lireIntegree(id); fs.writeFileSync(path.join(s.cwd, 'non-commite.txt'), 'en cours');
        s.etat = 'attend'; s.issue = 'success'; s.resultat = 'Le modèle prétend avoir fini'; sessions.sauverIntegree(s);
    } };
    equipe.avancerEquipes([], services); await pause(20); equipe.avancerEquipes([], services);
    assert.equal(e.etat, 'erreur'); assert.match(e.taches[0].resultat, /non commitées/); e.archivee = true;
});
test('une ancienne session Claude qui attend n’est pas une tâche terminée', () => {
    const e = equipe.creerEquipeMixte({ chemin: path.join(racine, 'projet'), nom: 'Ancien mode' }, 'Fixture', [
        { titre: 'Tâche', fournisseur: 'claude', consigne: 'mission', dependances: [] },
    ]);
    e.mixte = false; e.etat = 'en cours'; const t = e.taches[0];
    t.fournisseur = undefined; t.etat = 'en cours'; t.agentId = 'native-fixture'; t.vuTravailler = true;
    equipe.avancerEquipes([{ id: t.agentId, statut: 'attend', sessionId: 'native', cwd: e.projet }], { envoyer() { assert.fail(); }, notifier() {} });
    assert.equal(t.etat, 'bloquee'); assert.notEqual(e.etat, 'prete'); e.archivee = true;
});

test('une double action ne relance pas une tâche active ou deux intégrateurs dans le checkout principal', async () => {
    const e = equipe.creerEquipeMixte({ chemin: path.join(racine, 'projet'), nom: 'Doublons' }, 'Fixture', [
        { titre: 'Code', fournisseur: 'claude', consigne: 'coder', dependances: [] },
    ]);
    e.etat = 'en cours'; e.taches[0].etat = 'en cours'; e.taches[0].agentId = 'agent-actif';
    assert.match(await equipe.relancerTache(e.id, 't1'), /encore active/);
    assert.equal(e.taches[0].agentId, 'agent-actif');
    e.etat = 'integration';
    assert.match(await equipe.integrer(e.id), /déjà en cours/);
    assert.match(await equipe.lancerEquipe(e.id), /déjà en cours/);
    e.archivee = true;
});

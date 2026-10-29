import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-missions-test-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.PERPLEXITY_API_KEY = 'pplx-fixture-only';
process.env.ANTHROPIC_API_KEY = 'sk-fixture-only';
fs.writeFileSync(path.join(racine, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false } }));
const usage = await import('./dist/utilisation.js');
const { chargerConfig, sauverConfig } = await import('./dist/config.js');
const { executerClaude } = await import('./dist/providers/claude.js');
const { executerCodex } = await import('./dist/providers/codex.js');
const { executerPerplexity } = await import('./dist/providers/perplexity.js');
const { commencerUsage, sauverUsage, lireUsage, bilanUsage } = usage;
const { lancerPlanification, recuPlanification, heureValide } = await import('./dist/planificateur.js');
const { CHEMINS } = await import('./dist/chemins.js');
const { consigneMission, bilanSession } = await import('./dist/missions.js');
const { actionsSession, commandeSession } = await import('./dist/ui/saisie.js');
const sessions = await import('./dist/sessionsIntegrees.js');
const { travailler } = await import('./dist/sessionWorker.js');
const { prendreVerrou } = await import('./dist/verrou.js');
after(() => { const rel = path.relative(os.tmpdir(), racine); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true }); });
const contexte = (session = {}) => ({ session: { cwd: racine, ...session }, prompt: 'Fixture', historique: [], signal: new AbortController().signal, evenement() {}, thread() {}, permission: async () => ({ accepte: false }) });

test('utilisation : coût inconnu distinct de zéro, données invalides exclues, limite persistante', () => {
    assert.deepEqual(usage.normaliserUsage({ entree: NaN, sortie: -1, coutUSD: Infinity, cache: 0 }), { cache: 0 });
    const a = commencerUsage('a', 'claude'), b = commencerUsage('b', 'codex');
    sauverUsage(a, { coutUSD: 0, entree: 12, sortie: 3 }, 'success'); sauverUsage(b, {}, 'error');
    assert.match(bilanUsage(), /0\.0000.*total incomplet/);
    assert.match(bilanUsage(lireUsage().filter((r) => r.id === b)), /Coût indisponible/);
    const config = chargerConfig(); config.limitesAgents = { toursJour: 2, dureeMinutes: 10 }; sauverConfig(config);
    assert.throws(() => commencerUsage('c', 'perplexity'), /Limite de 2/);
    assert.equal(lireUsage().length, 2);
    config.limitesAgents.toursJour = 0; sauverConfig(config);
});

test('Claude : soustraire le cumul repris sans facturer à nouveau l’ancien historique', async () => {
    const c = contexte(); const valeurs = []; c.utilisation = (u) => valeurs.push(u);
    const reponse = (n) => async function* () { yield { type: 'result', subtype: 'success', is_error: false, session_id: 'thread', result: 'OK', total_cost_usd: n,
        modelUsage: { fixture: { inputTokens: 100 * n, outputTokens: 20 * n, cacheReadInputTokens: 5 * n, cacheCreationInputTokens: 2 * n } } }; };
    await executerClaude(c, reponse(1)); c.session.threadId = 'thread'; await executerClaude(c, reponse(3));
    assert.equal(valeurs[0].coutUSD, 1); assert.equal(valeurs[1].coutUSD, 2);
    assert.equal(valeurs[1].entree, 214); assert.equal(valeurs[1].sortie, 40);
    const ancienne = contexte({ threadId: 'ancien' }); ancienne.utilisation = (u) => assert.deepEqual(u, {});
    await executerClaude(ancienne, reponse(7));
});

test('Codex : comptage cumulatif du tour, notification répétée sans double compte et coût inconnu', async () => {
    const script = `const rl=require('readline').createInterface({input:process.stdin}); const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
    const u=(i,o)=>({inputTokens:i,outputTokens:o,cachedInputTokens:0});
    rl.on('line',l=>{const m=JSON.parse(l);
      if(m.method==='initialize')send({id:m.id,result:{}});
      if(m.method==='thread/resume') {send({method:'thread/tokenUsage/updated',params:{tokenUsage:{total:u(100,10),last:u(100,10)}}});send({id:m.id,result:{thread:{id:'ancien'}}});}
      if(m.method==='turn/start') {send({id:m.id,result:{turn:{id:'t'}}});
        for(const [i,o] of [[150,20],[230,35],[230,35]])send({method:'thread/tokenUsage/updated',params:{tokenUsage:{total:u(i,o),last:u(80,15)}}});
        send({method:'item/completed',params:{item:{id:'cmd',type:'commandExecution',command:'npm test',exitCode:1}}});
        send({method:'turn/completed',params:{turn:{status:'completed'}}});}});`;
    const proc = spawn(process.execPath, ['-e', script], { stdio: 'pipe', windowsHide: true });
    const c = contexte({ threadId: 'ancien' }), valeurs = [], evenements = [];
    c.utilisation = (u) => valeurs.push(u); c.evenement = (e) => evenements.push(e);
    await executerCodex(c, proc);
    assert.deepEqual(valeurs.at(-1), { entree: 130, sortie: 25, cache: 0 });
    assert.equal(evenements[0].codeSortie, 1); assert.equal(valeurs.at(-1).coutUSD, undefined);
});

test('Perplexity : coût USD seulement quand communiqué par la réponse', async () => {
    const c = contexte(), valeurs = []; c.utilisation = (u) => valeurs.push(usage.normaliserUsage(u));
    for (const cout of [undefined, { currency: 'USD', total_cost: 0.012 }]) {
        await executerPerplexity(c, async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
            usage: { input_tokens: 10, output_tokens: 5, cost: cout } }), { status: 200 }));
    }
    assert.equal(valeurs[0].coutUSD, undefined); assert.equal(valeurs[1].coutUSD, 0.012);
});

test('mission Analyse : Claude reçoit des outils de lecture et refuse une écriture', async () => {
    await executerClaude(contexte({ lectureSeule: true }), async function* ({ options }) {
        assert.equal(options.permissionMode, 'plan'); assert.deepEqual(options.tools, ['Read', 'Glob', 'Grep']);
        assert.equal((await options.canUseTool('Write', { file_path: 'fichier' })).behavior, 'deny');
        yield { type: 'result', subtype: 'success', is_error: false, result: 'Analyse' };
    });
});

test('planification : une réservation avant lancement évite le doublon et persiste les erreurs', async () => {
    const p = { id: 'fixture', nom: 'Test', fournisseur: 'codex', projet: racine, consigne: 'Tester', heure: '08:00', jours: [], actif: true };
    let n = 0, finir; const lancement = () => { n++; return new Promise((ok) => finir = ok); };
    const premier = lancerPlanification(p, true, lancement);
    assert.equal(recuPlanification(p.id).etat, 'reserve');
    assert.equal((await lancerPlanification(p, true, lancement)).ok, false); assert.equal(n, 1);
    finir({ ok: true, message: 'Fixture', id: 'fixture' }); await premier;
    assert.equal(recuPlanification(p.id).etat, 'lance');
    const erreur = await lancerPlanification({ ...p, id: 'echec' }, true, async () => { throw new Error('Connexion indisponible'); });
    assert.equal(erreur.ok, false); assert.equal(recuPlanification('echec').etat, 'erreur');
    await lancerPlanification({ ...p, id: 'echec' }, true, async () => assert.fail('Pas de relance automatique après une erreur'));
    assert.equal(heureValide('24:00'), false); assert.equal(heureValide('12:61'), false); assert.equal(heureValide('23:59'), true);
    fs.mkdirSync(CHEMINS.moteur, { recursive: true }); fs.writeFileSync(path.join(CHEMINS.moteur, 'pause.json'), '{}');
    assert.match((await lancerPlanification(p, false, async () => assert.fail())).message, /pause/);
    assert.throws(() => commencerUsage('pause', 'codex'), /Tout est en pause/);
    fs.rmSync(path.join(CHEMINS.moteur, 'pause.json'));
});

test('mission et reprise : actions dans les vues existantes, bilan sans fausse preuve de succès', () => {
    assert.match(consigneMission('analyser', 'Comprendre'), /lecture seule.*Ne modifie aucun fichier/);
    assert.match(consigneMission('corriger', 'Bug'), /Reproduis.*Vérifications.*réellement exécutées/s);
    const s = { integree: true, sessionId: 'ct-test', fournisseur: 'codex', statut: 'erreur', issue: 'error' };
    assert.ok(actionsSession(s).some((a) => a.action === 'reprendre-agent'));
    assert.ok(actionsSession(s).some((a) => a.action === 'reconnecter'));
    assert.equal(commandeSession('reconnecter', s), '/fournisseurs codex');
    assert.equal(commandeSession('reprendre-agent', s), '/reprendre-agent ct-test');
    assert.equal(actionsSession({ ...s, statut: 'travaille' }).some((a) => a.action === 'reprendre-agent'), false);
    assert.match(bilanSession({ titre: 'Test', fournisseur: 'codex', etat: 'erreur', bilan: { resume: 'Je pense que cela marche', commandes: [{ commande: 'npm test', codeSortie: 1 }] } }), /Code de sortie 1.*coût indisponible/s);
});

test('worker : bilan et reçu final persistés, même si aucune facture n’est disponible', async () => {
    const s = sessions.creerIntegree('perplexity', racine, 'Bilan'); s.tour = randomUUID(); s.etat = 'travaille'; s.recuUsage = commencerUsage(s.id, 'perplexity'); sessions.sauverIntegree(s);
    const dossier = sessions.dossierIntegre(s.id); fs.writeFileSync(path.join(dossier, 'verrou'), '');
    sessions.ecrireAtomique(path.join(dossier, 'requete.json'), { tour: s.tour, prompt: 'Test' });
    await travailler(s.id, s.tour, async (c) => { c.utilisation({ entree: 4, sortie: 2 }); c.evenement({ role: 'outil', texte: 'npm test', commande: 'npm test', codeSortie: 0 }); return 'Test fixture réussi'; });
    const apres = sessions.lireIntegree(s.id);
    assert.equal(apres.bilan.commandes[0].codeSortie, 0); assert.equal(apres.bilan.resume, 'Test fixture réussi');
    assert.equal(lireUsage().find((r) => r.id === s.recuUsage).etat, 'success');
    assert.equal(fs.existsSync(path.join(dossier, 'verrou')), false);
});

test('verrou : un propriétaire vivant est protégé et un ancien démarrage du PC est récupéré', () => {
    const dossier = path.join(racine, 'verrou-test'); const liberer = prendreVerrou(dossier);
    assert.equal(typeof liberer, 'function'); assert.equal(prendreVerrou(dossier), undefined); liberer();
    fs.mkdirSync(dossier); fs.writeFileSync(path.join(dossier, 'proprietaire.json'), JSON.stringify({ pid: process.pid, token: 'ancien', demarragePoste: 1 }));
    const nouveau = prendreVerrou(dossier); assert.equal(typeof nouveau, 'function'); nouveau();
});

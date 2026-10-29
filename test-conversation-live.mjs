import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import stringWidth from 'string-width';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-conversation-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
process.env.AGENTOPIA_SANS_MOTEUR = '1';
const sessions = await import('./dist/sessionsIntegrees.js');
const { lireTranscript, fichiersModifies } = await import('./dist/agents.js');
const { creerFluxCodex } = await import('./dist/providers/fluxCodex.js');
const { executerTerminalCodex, verifierRepriseTerminal } = await import('./dist/terminalCodex.js');
const { lignesTranscript } = await import('./dist/ui/Zones.js');
const { commandeLisible, textePropre } = await import('./dist/presentationConversation.js');
const { prendreVerrou } = await import('./dist/verrou.js');
after(() => fs.rmSync(racine, { recursive: true, force: true }));
const fichier = (s) => path.join(sessions.dossierIntegre(s.id), 'conversation.jsonl');
function session() {
    const s = sessions.creerIntegree('codex', racine, 'Fixture');
    s.threadId = randomUUID(); sessions.sauverIntegree(s); return s;
}

test('les fragments apparaissent avant la fin, puis remplacent le même message', async () => {
    const s = session();
    const flux = creerFluxCodex((e) => sessions.ajouterEvenement(s.id, 'tour', e));
    flux.recevoir('item/started', { item: { id: 'a', type: 'agentMessage', text: '' } });
    flux.recevoir('item/agentMessage/delta', { itemId: 'a', delta: 'Bonjour' });
    await pause(150);
    assert.equal(lireTranscript(fichier(s))[0].texte, 'Bonjour');
    assert.equal(lireTranscript(fichier(s))[0].etat, 'en_cours');
    flux.recevoir('item/agentMessage/delta', { itemId: 'a', delta: ' monde' });
    flux.recevoir('item/completed', { item: { id: 'a', type: 'agentMessage', text: 'Bonjour monde' } });
    flux.fermer(true);
    assert.equal(lireTranscript(fichier(s)).length, 1);
    assert.equal(lireTranscript(fichier(s))[0].texte, 'Bonjour monde');
    assert.equal(lireTranscript(fichier(s))[0].etat, 'termine');
    assert.equal(flux.resultat(), 'Bonjour monde');
    // Une autre fenêtre / un démarrage à froid relit aussi un seul message.
    assert.equal(lireTranscript(fichier(s), 2_100_000).length, 1);
});

test('commandes en cours, sortie progressive, code d’échec et tous les fichiers', async () => {
    const s = session(); const flux = creerFluxCodex((e) => sessions.ajouterEvenement(s.id, 'tour', e));
    flux.recevoir('item/started', { item: { id: 'cmd', type: 'commandExecution', command: 'npm test' } });
    flux.recevoir('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'premier test\n' });
    await pause(150);
    assert.match(lireTranscript(fichier(s))[0].sortie, /premier test/);
    flux.recevoir('item/completed', { item: { id: 'cmd', type: 'commandExecution', command: 'npm test', aggregatedOutput: 'premier test\néchec', exitCode: 1 } });
    const chemins = ['a.ts', 'b.ts'].map((f) => path.join(racine, f));
    flux.recevoir('item/completed', { item: { id: 'files', type: 'fileChange', changes: chemins.map((p) => ({ path: p, diff: '+ exemple' })) } });
    flux.fermer(false);
    const messages = lireTranscript(fichier(s));
    assert.equal(messages[0].etat, 'erreur'); assert.equal(messages[0].codeSortie, 1);
    assert.deepEqual(fichiersModifies(fichier(s)), chemins);
    assert.match(messages[1].sortie, /b.ts/);
});

test('une interruption garde le texte partiel et signale la sortie limitée', () => {
    const ev = []; const flux = creerFluxCodex((e) => ev.push(e));
    flux.recevoir('item/agentMessage/delta', { itemId: 'a', delta: 'Analyse partielle' });
    flux.recevoir('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'x'.repeat(140_000) });
    flux.fermer(false);
    assert.equal(ev[0].texte, 'Analyse partielle'); assert.equal(ev[0].etat, 'interrompu');
    assert.equal(ev[1].sortie.length, 128_000); assert.equal(ev[1].sortieTronquee, true);
    assert.equal(flux.resultat(), '');
});

test('commandes PowerShell historiques lisibles, détails complets et tables adaptées', () => {
    const s = session();
    const cmd = '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command \'Get-Content AGENTS.md -TotalCount 65\'';
    assert.equal(commandeLisible(cmd), 'Get-Content AGENTS.md -TotalCount 65');
    sessions.ajouterMessage(s.id, 'outil', cmd);
    let lignes = lignesTranscript(lireTranscript(fichier(s)), 90);
    assert.match(textePropre(lignes.join('\n')), /Lire · AGENTS.md/);
    assert.doesNotMatch(lignes.join('\n'), /System32/);
    lignes = lignesTranscript(lireTranscript(fichier(s)), 90, true);
    assert.match(lignes.join('\n'), /System32/);
    const tableau = '| Application | À quoi elle sert |\n|---|---|\n| Transport | Organiser les livraisons et suivre les équipes sur plusieurs projets. |\n| WMS | Gérer les stocks |';
    for (const largeur of [28, 70, 120]) {
        const rendu = lignesTranscript([{ role: 'assistant', texte: tableau }], largeur);
        assert.doesNotMatch(rendu.join('\n'), /\|---/);
        assert.match(rendu.join('\n'), /Transport/);
        assert.ok(rendu.every((l) => stringWidth(l) <= largeur), `largeur ${largeur}`);
    }
    assert.equal(textePropre('\x1b]0;Titre\x07abc\x1b[2J'), 'abc');
});

test('le terminal garde le même thread et le contrôle exclusif, puis synchronise sans doublons', async () => {
    const s = session(); let fermer; let tours = []; let entree;
    const pret = new Promise((r) => entree = r);
    const rpc = { async demander(m, p) {
        assert.equal(m, 'thread/read'); assert.equal(p.threadId, s.threadId);
        return { thread: { id: s.threadId, turns: tours } };
    } };
    const travail = executerTerminalCodex(s.id, { rpc, lancer: async (native) => {
        assert.equal(native.threadId, s.threadId); entree();
        await new Promise((r) => fermer = r); return 0;
    } });
    await pret;
    assert.equal(sessions.lireIntegree(s.id).terminalExterne, true);
    assert.equal(prendreVerrou(path.join(sessions.dossierIntegre(s.id), 'execution')), undefined);
    await assert.rejects(executerTerminalCodex(s.id, { rpc }), /déjà ouverte/);
    tours = [{ id: 'native-turn', status: 'completed', items: [
        { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'depuis le terminal' }] },
        { id: 'a', type: 'agentMessage', text: 'réponse synchronisée' },
    ] }];
    await pause(1650);
    assert.deepEqual(lireTranscript(fichier(s)).map((m) => m.texte), ['depuis le terminal', 'réponse synchronisée']);
    fermer(); await travail;
    assert.equal(lireTranscript(fichier(s)).length, 2);
    const fini = sessions.lireIntegree(s.id);
    assert.equal(fini.terminalExterne, undefined); assert.equal(fini.etat, 'attend'); assert.equal(fini.threadId, s.threadId);
    const liberer = prendreVerrou(path.join(sessions.dossierIntegre(s.id), 'execution')); assert.ok(liberer); liberer();
    verifierRepriseTerminal(fini);
});

test('échec avant lancement et historique indisponible libèrent la conversation sans faux succès', async () => {
    const s = session(); let lance = false;
    await assert.rejects(executerTerminalCodex(s.id, { rpc: { demander: async () => { throw new Error('hors ligne'); } }, lancer: async () => { lance = true; return 0; } }), /hors ligne/);
    assert.equal(lance, false); assert.equal(sessions.lireIntegree(s.id).terminalExterne, undefined);
    assert.equal(sessions.lireIntegree(s.id).issue, 'error');
    let lectures = 0;
    await executerTerminalCodex(s.id, { rpc: { demander: async () => { if (++lectures > 1) throw new Error('lecture perdue'); return { thread: { turns: [] } }; } }, lancer: async () => 0 });
    assert.match(sessions.lireIntegree(s.id).erreur, /historique.*relu/);
    assert.equal(sessions.lireIntegree(s.id).issue, 'error');
    assert.equal(sessions.lireIntegree(s.id).terminalExterne, undefined);
});

test('fermer normalement le CLI ne déclare pas réussi un tour natif en échec', async () => {
    const s = session(); let termine = false;
    await executerTerminalCodex(s.id, { rpc: { demander: async () => ({ thread: { turns: termine ? [{ id: 'echec', status: 'failed', error: { message: 'Quota indisponible' }, items: [] }] : [] } }) },
        lancer: async () => { termine = true; return 0; } });
    assert.equal(sessions.lireIntegree(s.id).issue, 'error');
    assert.match(sessions.lireIntegree(s.id).erreur, /Quota indisponible/);
});

test('une copie importée ou un tour actif ne peuvent pas être repris dans un terminal', () => {
    const s = session(); s.origine = { fournisseur: 'codex', threadId: s.threadId, copieAuProchainMessage: true };
    assert.throws(() => verifierRepriseTerminal(s), /indépendante/);
    s.origine = undefined; s.etat = 'travaille';
    assert.throws(() => verifierRepriseTerminal(s), /fin du tour/);
    s.etat = 'attend'; s.threadId = undefined;
    assert.throws(() => verifierRepriseTerminal(s), /premier message/);
});

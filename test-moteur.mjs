import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-moteur-test-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
process.env.PERPLEXITY_API_KEY = 'pplx-fixture-only';
delete process.env.AGENTOPIA_SANS_MOTEUR; delete process.env.AGENTOPIA_MOTEUR;
fs.writeFileSync(path.join(racine, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false } }));
const moteur = await import('./dist/moteurClient.js');
const equipes = await import('./dist/equipe.js');
const sessions = await import('./dist/sessionsIntegrees.js');
const { processusVivant } = await import('./dist/verrou.js');
const { CHEMINS } = await import('./dist/chemins.js');
const enfants = [];
const detaches = [];
async function attendre(fn) { for (let i = 0; i < 200; i++) { const r = fn(); if (r) return r; await pause(75); } assert.fail(`Délai dépassé : ${JSON.stringify(moteur.etatMoteur())}`); }
const liste = () => JSON.parse(fs.readFileSync(CHEMINS.equipes, 'utf8'));
const lancements = () => fs.existsSync(path.join(racine, 'lancements.jsonl')) ? fs.readFileSync(path.join(racine, 'lancements.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
async function ouvrir(mode) {
    const p = spawn(process.execPath, ['fixtures/moteur.mjs', ...(mode ? [mode] : [])], { env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    enfants.push(p); let erreurs = ''; p.stderr.on('data', (d) => erreurs += d); p.stdout.resume();
    p.erreurs = () => erreurs; await once(p, 'spawn'); return p;
}
async function tuer(p) {
    if (p.exitCode === null && p.signalCode === null) { const fin = once(p, 'close'); p.kill('SIGKILL'); await fin; }
    // Sous Windows, la fermeture des flux peut précéder la disparition du PID.
    // La reprise doit être testée après la mort confirmée, pas pendant sa terminaison.
    if (p.pid) await attendre(() => !processusVivant(p.pid));
}
after(async () => {
    for (const p of enfants) await tuer(p);
    for (const pid of detaches) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    for (const s of sessions.listerIntegrees()) if (s.pid) { try { process.kill(s.pid, 'SIGKILL'); } catch {} }
    await pause(200);
    const rel = path.relative(os.tmpdir(), racine);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true });
});
test('moteur indépendant : propriétaire unique, reprise après crash, dépendances et pause persistante', { timeout: 60_000 }, async () => {
    const depot = path.join(racine, 'depot'); fs.mkdirSync(depot);
    const git = (...args) => { const r = spawnSync('git', args, { cwd: depot, windowsHide: true, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
    fs.writeFileSync(path.join(depot, 'base.txt'), 'base'); git('add', '.'); git('commit', '-m', 'Base');
    const equipe = equipes.creerEquipeMixte({ chemin: depot, nom: 'Fixture' }, 'Chaîne sans interface ouverte', [
        { titre: 'Attendre source', fournisseur: 'perplexity', consigne: 'Source', dependances: [] },
        { titre: 'Synthèse', fournisseur: 'perplexity', consigne: 'Synthèse', dependances: ['t1'] },
        { titre: 'Relecture', fournisseur: 'perplexity', consigne: 'Relecture', dependances: ['t2'] },
    ]);
    const premier = await ouvrir(); await attendre(() => moteur.etatMoteur().pid === premier.pid && moteur.etatMoteur().actif);
    const concurrent = await ouvrir(); await attendre(() => concurrent.exitCode !== null);
    assert.equal(concurrent.exitCode, 0, concurrent.erreurs()); assert.equal(moteur.etatMoteur().pid, premier.pid);
    const modification = { attendu: equipes.empreintePlan(equipe), objectif: 'Plan ajusté avant lancement', taches: equipe.taches };
    assert.equal(await equipes.modifierPlan(equipe.id, modification), undefined);
    assert.equal(liste().find((e) => e.id === equipe.id).objectif, modification.objectif);
    assert.match(await equipes.modifierPlan(equipe.id, modification), /autre fenêtre/);
    assert.equal(await moteur.commanderMoteur('lancer', equipe.id), undefined);
    assert.match(await equipes.modifierPlan(equipe.id, modification), /premier lancement/);
    await attendre(() => lancements().length === 1);
    const idPremier = lancements()[0].id; await attendre(() => sessions.lireIntegree(idPremier).pid);
    await tuer(premier);
    // Une commande en cours au crash ne doit jamais être rejouée (écarter est une bascule).
    fs.writeFileSync(path.join(moteur.DOSSIER_MOTEUR, 'commandes', 'interrompue.en-cours'), JSON.stringify({ action: 'ecarter', id: equipe.id, tache: 't1' }));
    const second = await ouvrir(); await attendre(() => moteur.etatMoteur().pid === second.pid && moteur.etatMoteur().actif);
    await pause(300); assert.equal(lancements().length, 1);
    assert.match(fs.readFileSync(path.join(moteur.DOSSIER_MOTEUR, 'commandes', 'interrompue.reponse'), 'utf8'), /interrompue/);
    fs.writeFileSync(path.join(racine, `${idPremier}.liberer`), '');
    await attendre(() => liste().find((e) => e.id === equipe.id)?.etat === 'prete');
    assert.equal(lancements().length, 3); assert.equal(new Set(lancements().map((l) => l.id)).size, 3);
    assert.match(lancements()[1].prompt, /Résultat de Fixture · Attendre source/);
    assert.match(lancements()[2].prompt, /Résultat de Fixture · Synthèse/);
    // Le cache UI est volontairement ancien : créer une autre équipe ne doit pas écraser la fin de la première.
    const autre = equipes.creerEquipeMixte({ chemin: depot, nom: 'Autre' }, 'Interruption', [{ titre: 'Attendre décision', fournisseur: 'perplexity', consigne: 'Attente', dependances: [] }]);
    assert.equal(liste().find((e) => e.id === equipe.id).etat, 'prete');
    await moteur.commanderMoteur('lancer', autre.id); await attendre(() => lancements().length === 4);
    await moteur.pauseGlobale(); assert.equal(moteur.moteurEnPause(), true);
    await attendre(() => sessions.lireIntegree(lancements()[3].id).issue === 'cancelled');
    await tuer(second);
    const troisieme = await ouvrir(); await attendre(() => moteur.etatMoteur().pid === troisieme.pid && moteur.etatMoteur().actif);
    await assert.rejects(moteur.commanderMoteur('lancer', autre.id), /pause/);
    assert.equal(lancements().length, 4);
    await moteur.reprendreMoteur(); assert.equal(moteur.moteurEnPause(), false);
    await pause(300); assert.equal(lancements().length, 4, 'La reprise du moteur ne relance pas les équipes arrêtées');
    const idReprise = lancements()[3].id;
    assert.equal(await moteur.commanderMoteur('reprendre', autre.id, 't1'), undefined);
    await attendre(() => lancements().length === 5);
    assert.equal(lancements()[4].id, idReprise, 'La reprise conserve la conversation');
    assert.match(await moteur.commanderMoteur('reprendre', autre.id, 't1'), /arrêtée ou en erreur/);
    fs.writeFileSync(path.join(racine, `${idReprise}.liberer`), '');
    await attendre(() => liste().find((e) => e.id === autre.id)?.etat === 'prete');
    assert.equal(lancements().length, 5);
    await tuer(troisieme);
});

test('fichier abîmé : moteur disponible pour arrêter et récupérer, aucun rejeu automatique', { timeout: 30_000 }, async () => {
    const { sauvegardeEquipes } = await import('./dist/stockageEquipes.js');
    const sauvegarde = sauvegardeEquipes(), avant = lancements().length;
    const abime = '{"interruption'; fs.writeFileSync(CHEMINS.equipes, abime);
    const p = await ouvrir();
    try {
        await attendre(() => {
            if (p.exitCode !== null) {
                const verrou = path.join(moteur.DOSSIER_MOTEUR, 'instance', 'proprietaire.json');
                assert.fail(`Moteur fermé avant récupération : ${p.erreurs()} · verrou : ${fs.existsSync(verrou) ? fs.readFileSync(verrou, 'utf8') : 'absent'}`);
            }
            return moteur.etatMoteur().pid === p.pid && moteur.etatMoteur().erreur;
        });
        await assert.rejects(moteur.commanderMoteur('lancer', sauvegarde.equipes[0].id), /illisible ou invalide/);
        await moteur.pauseGlobale();
        const copie = await equipes.recupererEquipes(sauvegarde.empreinte);
        assert.equal(fs.readFileSync(copie, 'utf8'), abime);
        assert.deepEqual(liste(), sauvegarde.equipes);
        assert.equal(moteur.moteurEnPause(), true);
        await attendre(() => !moteur.etatMoteur().erreur);
        await pause(250); assert.equal(lancements().length, avant);
    } finally { await tuer(p); }
});

test('mise à niveau : préserver le moteur occupé, remplacer automatiquement le moteur ancien au repos', { timeout: 30_000 }, async () => {
    const ancien = await ouvrir('ancien');
    await attendre(() => {
        if (ancien.exitCode !== null) assert.fail(`Le moteur fixture s’est fermé : ${ancien.erreurs()}`);
        return moteur.etatMoteur().pid === ancien.pid && moteur.etatMoteur().actif;
    });
    fs.writeFileSync(CHEMINS.equipes, JSON.stringify([{ id: 'fixture-occupee', etat: 'en cours' }]));
    await assert.rejects(moteur.assurerMoteur(), /encore au travail/);
    assert.equal(moteur.etatMoteur().pid, ancien.pid); assert.equal(ancien.exitCode, null);
    fs.writeFileSync(CHEMINS.equipes, '[]');
    const commande = path.join(moteur.DOSSIER_MOTEUR, 'commandes', 'fixture-en-attente.json');
    fs.writeFileSync(commande, '{}');
    await assert.rejects(moteur.assurerMoteur(), /encore au travail/); fs.rmSync(commande);
    await moteur.assurerMoteur();
    const actuel = moteur.etatMoteur(); detaches.push(actuel.pid);
    assert.equal(actuel.version, moteur.VERSION_MOTEUR); assert.equal(actuel.actif, true); assert.notEqual(actuel.pid, ancien.pid);
    await moteur.assurerMoteur(); assert.equal(moteur.etatMoteur().pid, actuel.pid);
});

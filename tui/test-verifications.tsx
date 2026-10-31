import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

// Le profil et ses journaux restent hors du dépôt : ils ne doivent pas rendre
// périmée l'empreinte des fichiers que la commande vient de vérifier.
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-verif-tui-'));
const profil = path.join(racine, 'profil'), projet = path.join(racine, 'projet');
fs.mkdirSync(profil); fs.mkdirSync(projet);
process.env.CLAUDETOPIA_DATA_DIR = profil;
process.env.CLAUDETOPIA_SANS_REPRISE = '1'; process.env.CLAUDETOPIA_TEST_UI = '1'; process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.AGENTOPIA_FIXTURE_MARKER = path.join(profil, 'check-execute.json');
process.env.npm_config_update_notifier = 'false'; process.env.npm_config_audit = 'false'; process.env.npm_config_fund = 'false';
process.env.npm_config_offline = 'true'; process.env.npm_config_cache = path.join(profil, 'npm-cache');
process.env.npm_config_userconfig = path.join(profil, 'npm-user.ini'); process.env.npm_config_globalconfig = path.join(profil, 'npm-global.ini');
fs.writeFileSync(process.env.npm_config_userconfig, ''); fs.writeFileSync(process.env.npm_config_globalconfig, '');
fs.writeFileSync(path.join(profil, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false,
    maitre: { actif: false }, ecran: { laterale: 'cachee' } }));
fs.writeFileSync(path.join(projet, 'package.json'), JSON.stringify({ name: 'agentopia-verification-fixture', version: '1.0.0', private: true,
    scripts: { check: 'node check.cjs' } }));
fs.writeFileSync(path.join(projet, 'source.txt'), 'Version initiale\n');
fs.writeFileSync(path.join(projet, 'check.cjs'), [
    "const fs = require('node:fs'); const assert = require('node:assert/strict');",
    "assert.equal(process.env.CI, '1'); assert.ok(fs.readFileSync('source.txt', 'utf8').trim());",
    "fs.writeFileSync(process.env.AGENTOPIA_FIXTURE_MARKER, JSON.stringify({ cwd: process.cwd(), ci: process.env.CI }));",
    "console.log('FIXTURE_CHECK_OK : script local réellement exécuté');",
    "console.log('FIXTURE_JOURNAL_FIN : contrôle terminé');",
].join('\n'));
const git = (...args: string[]) => {
    const resultat = spawnSync('git', args, { cwd: projet, encoding: 'utf8', windowsHide: true });
    assert.equal(resultat.status, 0, resultat.stderr); return resultat.stdout;
};
git('init', '-b', 'main'); git('config', 'core.autocrlf', 'false'); git('add', '.');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Base de vérification');
const { App } = await import('./app.tsx');
const { bus } = await import('../dist/ui/bus.js');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { CHEMINS } = await import('../dist/chemins.js');
const { rechargerEquipes } = await import('../dist/equipe.js');
const { lirePreuvesVerification, lireJournalVerification } = await import('../dist/verificationProjet.js');
const { CarnetBrouillons, destinationBrouillon } = await import('../dist/ui/brouillons.js');
const equipe: any = { id: 'verification-fixture', mixte: true, projet, nomProjet: 'Projet fixture', objectif: 'Vérifier un script existant',
    resume: '', creee: Date.now(), etat: 'prete', taches: [{ id: 't1', titre: 'Contrôle local', consigne: 'Vérifier', role: 'dev',
        etat: 'faite', fournisseur: 'codex', dependances: [], resultat: 'À vérifier avec le script du projet.' }] };
fs.writeFileSync(CHEMINS.equipes, JSON.stringify([equipe])); rechargerEquipes(); lireDonnees().equipes = [equipe];
const brouillon = 'Brouillon conservé pendant les vérifications';
const carnet = new CarnetBrouillons(); carnet.ecrire(destinationBrouillon(), { texte: brouillon }); carnet.sauver();
const ui = await createTestRenderer({ width: 100, height: 36, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
let dialogue: any;
const observer = (d: any) => { dialogue = d; }; bus.on('demande', observer);
const dessiner = async (ms = 130) => { await new Promise((r) => setTimeout(r, ms)); await ui.flush(); await ui.renderOnce(); };
const attendre = async (texte: RegExp, delai = 12_000) => {
    const limite = Date.now() + delai;
    while (!texte.test(ui.captureCharFrame()) && Date.now() < limite) await dessiner(70);
    assert.match(ui.captureCharFrame(), texte);
};
const attendreDialogue = async (message: string) => {
    const limite = Date.now() + 12_000;
    while ((dialogue?.message !== message || !ui.captureCharFrame().includes(message)) && Date.now() < limite) await dessiner(70);
    assert.equal(dialogue?.message, message); assert.ok(ui.captureCharFrame().includes(message));
};
const choisir = async (libelle: RegExp) => {
    assert.equal(dialogue?.type, 'choix');
    const index = dialogue.choix.findIndex((c: any) => libelle.test(c.label));
    assert.ok(index >= 0, `Option absente : ${libelle}`);
    for (let i = 0; i < index; i++) ui.mockInput.pressArrow('down');
    await dessiner(); ui.mockInput.pressEnter(); await dessiner();
};
const lireDetail = async (texte: RegExp) => {
    for (let i = 0; i < 24 && !texte.test(ui.captureCharFrame()); i++) {
        ui.mockInput.pressKey('\x1b[6~'); await dessiner(70);
    }
    assert.match(ui.captureCharFrame(), texte, 'Le détail doit être lisible au clavier');
};
const ouvrirConfirmation = async () => {
    await choisir(/^Vérifier le projet/); await attendreDialogue('Dossier à vérifier');
    await choisir(/^Projet · branche actuelle/); await attendreDialogue('Vérification à exécuter');
    await choisir(/^npm run check$/); await attendreDialogue('Exécuter cette vérification ?');
    assert.match(ui.captureCharFrame(), /Commande : npm run check/);
    const visible = ui.captureCharFrame().replace(/[│\s]/g, '');
    assert.ok(visible.includes(`Dossier : ${projet}`.replace(/\s/g, '')), 'le dossier exact reste visible même quand le chemin se replie');
    assert.ok(dialogue.detail.includes(`Dossier : ${projet}`));
    assert.match(dialogue.detail, /Script : node check\.cjs/);
};
try {
    root.render(<App quitter={() => {}} />); await dessiner();
    for (const largeur of [100, 130]) {
        ui.resize(largeur, 36); await dessiner();
        const preuvesAvant = lirePreuvesVerification(equipe.id).length;
        fs.rmSync(process.env.AGENTOPIA_FIXTURE_MARKER, { force: true });
        bus.emit('lancer', `/equipe ${equipe.id}`); await attendre(/Relire \(b\)/);
        ui.mockInput.pressKey('b'); await attendreDialogue('Bilan de l’équipe');
        await ouvrirConfirmation();
        assert.equal(fs.existsSync(process.env.AGENTOPIA_FIXTURE_MARKER), false, 'la sélection seule ne lance aucun script');
        await choisir(/^Retour sans exécuter$/); await attendreDialogue('Bilan de l’équipe');
        assert.equal(fs.existsSync(process.env.AGENTOPIA_FIXTURE_MARKER), false);
        assert.equal(lirePreuvesVerification(equipe.id).length, preuvesAvant, 'aucune preuve après annulation');
        await ouvrirConfirmation(); await choisir(/^Exécuter$/);
        await attendreDialogue('Résultat de la vérification');
        assert.match(ui.captureCharFrame(), /Réussi · npm run check/); assert.match(ui.captureCharFrame(), /Code de sortie : 0/);
        await lireDetail(/FIXTURE_JOURNAL_FIN/);
        const marqueur = JSON.parse(fs.readFileSync(process.env.AGENTOPIA_FIXTURE_MARKER, 'utf8'));
        // Le TEMP Windows du runner peut être en notation courte (RUNNER~1).
        // Comparer les dossiers réels, comme le moteur, plutôt que leurs alias.
        assert.equal(fs.realpathSync.native(marqueur.cwd).toLowerCase(), fs.realpathSync.native(projet).toLowerCase()); assert.equal(marqueur.ci, '1');
        const preuves = lirePreuvesVerification(equipe.id);
        assert.equal(preuves.length, preuvesAvant + 1); assert.equal(preuves[0].codeSortie, 0); assert.equal(preuves[0].resultat, 'reussi');
        assert.match(lireJournalVerification(preuves[0]), /FIXTURE_CHECK_OK/);
        await choisir(/^Retour$/); await attendreDialogue('Bilan de l’équipe');
        await choisir(/^Journaux des vérifications$/); await attendreDialogue('Journaux des vérifications');
        await choisir(/npm run check/); await attendreDialogue('Résultat de la vérification');
        assert.match(ui.captureCharFrame(), /Code de sortie : 0/); await lireDetail(/FIXTURE_CHECK_OK/);
        fs.writeFileSync(path.join(projet, 'source.txt'), `Fichier modifié après la vérification à ${largeur} colonnes\n`);
        await choisir(/^Retour$/); await attendreDialogue('Journaux des vérifications');
        await choisir(/^Retour au bilan$/); await attendreDialogue('Bilan de l’équipe');
        await lireDetail(/Périmé · projet modifié/);
        assert.equal(JSON.parse(fs.readFileSync(CHEMINS.equipes, 'utf8'))[0].etat, 'prete', 'le code 0 ne valide ni ne range automatiquement l’équipe');
        await choisir(/^Retour à l’équipe$/); await attendre(/Relire \(b\)/);
        ui.mockInput.pressEscape(); await dessiner(); await attendre(new RegExp(brouillon));
    }
    root.render(<text>fermé</text>); await dessiner();
    assert.equal(new CarnetBrouillons().lire(destinationBrouillon()).texte, brouillon);
    process.stdout.write('✓ TUI : Relire → Vérifier, annulation sans lancement, npm réel code 0, journal, preuve périmée et brouillon préservé (100/130 colonnes)\n');
} finally {
    bus.off('demande', observer); root.render(<text>fin</text>); await dessiner(); await ui.dispose();
    const relatif = path.relative(os.tmpdir(), racine);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(racine, { recursive: true, force: true });
}

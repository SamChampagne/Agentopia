import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-choix-session-'));
process.env.CLAUDETOPIA_DATA_DIR = tmp;
process.env.CLAUDETOPIA_TEST_UI = '1';
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
const projet = { nom: 'Projet fixture', chemin: path.join(tmp, 'Projet fixture'), racine: tmp };
fs.mkdirSync(projet.chemin);
fs.writeFileSync(path.join(tmp, 'claudetopia.json'), JSON.stringify({ fournisseurDefaut: 'codex', racines: [], extras: [projet.chemin], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const { Annule, bus } = await import('../dist/ui/bus.js');
const connexions: string[] = [], envois: { id: string; texte: string }[] = [];
let refuserConnexion = false;
mock.module('../dist/providers/assistantConnexion.js', () => ({ guiderConnexion: async (f: string) => {
    connexions.push(f); if (refuserConnexion) throw new Annule();
} }));
const disponibilites = await import('../dist/providers/config.js');
mock.module('../dist/providers/config.js', () => ({ ...disponibilites, disponibilite: () => ({ pret: true, texte: 'Connexion de test' }) }));
const sessions = await import('../dist/sessionsIntegrees.js');
mock.module('../dist/sessionsIntegrees.js', () => ({ ...sessions, envoyerIntegree: async (id: string, texte: string) => { envois.push({ id, texte }); } }));
const { COMMANDES, config } = await import('../dist/commandes.js');
const { Choix } = await import('./dialogues.tsx');
const { Conversation } = await import('./conversation.tsx');
const { App } = await import('./app.tsx');
const { FOURNISSEURS } = await import('../dist/providers/types.js');
const ui = await createTestRenderer({ width: 130, height: 34, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 100)); await ui.flush(); await ui.renderOnce(); };
let demande: any;
const recevoir = (d: any) => { if (d) { demande = d; root.render(<Choix d={d} hauteur={34} />); } };
const contexte = (texte = '') => ({ args: [], reste: '', projet, apresProjet: texte });
const commande = (nom: string) => COMMANDES.find(c => c.nom === nom)!;
try {
    bus.on('demande', recevoir);
    for (const [f, nom] of Object.entries(FOURNISSEURS)) {
        const avant = sessions.listerIntegrees().length, avantConnexions = connexions.length, avantEnvois = envois.length;
        const texte = 'Explique ce projet\n  sans modifier de fichier.';
        const creation = Promise.resolve(commande('session').executer(contexte(texte)));
        await dessiner();
        assert.match(ui.captureCharFrame(), /Nouvelle session : quel agent/);
        assert.match(ui.captureCharFrame(), /Codex · par défaut/);
        assert.match(ui.captureCharFrame(), /Projet : Projet fixture/);
        assert.match(ui.captureCharFrame(), /message sera envoyé après ce choix/);
        assert.equal(demande.choix[0].valeur, 'codex');
        assert.equal(sessions.listerIntegrees().length, avant);
        assert.equal(connexions.length, avantConnexions); assert.equal(envois.length, avantEnvois);
        const index = demande.choix.findIndex((c: any) => c.valeur === f);
        for (let i = 0; i < index; i++) ui.mockInput.pressArrow('down');
        ui.mockInput.pressEnter(); await creation; await dessiner();
        const creee = sessions.lireIntegree(envois.at(-1)!.id)!;
        assert.equal(creee.fournisseur, f); assert.equal(creee.cwd, projet.chemin);
        assert.equal(creee.titre, `${nom.nom} · ${projet.nom}`);
        assert.equal(connexions.at(-1), f); assert.equal(envois.at(-1)!.texte, texte);
        assert.equal(config.fournisseurDefaut, 'codex');
        assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'claudetopia.json'), 'utf8')).fournisseurDefaut, 'codex');
        assert.equal(sessions.listerIntegrees().length, avant + 1);
    }
    const total = sessions.listerIntegrees().length, connectees = connexions.length, envoyes = envois.length;
    const annulee = assert.rejects(Promise.resolve(commande('session').executer(contexte('à conserver'))), { name: 'Annule' });
    await dessiner(); ui.mockInput.pressEscape(); await annulee;
    assert.equal(sessions.listerIntegrees().length, total); assert.equal(connexions.length, connectees); assert.equal(envois.length, envoyes);
    refuserConnexion = true;
    const connexionAnnulee = assert.rejects(Promise.resolve(commande('session').executer(contexte('pas envoyé'))), { name: 'Annule' });
    await dessiner(); ui.mockInput.pressEnter(); await connexionAnnulee;
    assert.equal(sessions.listerIntegrees().length, total); assert.equal(envois.length, envoyes);
    refuserConnexion = false;
    // Une commande qui nomme déjà l’agent reste directe, sans deuxième choix.
    demande = undefined;
    await commande('perplexity').executer(contexte('cherche'));
    assert.equal(demande, undefined); assert.equal(sessions.lireIntegree(envois.at(-1)!.id)!.fournisseur, 'perplexity');
    // Aucune préférence : les trois agents restent disponibles et la sélection reste explicite.
    config.fournisseurDefaut = 'choisir';
    const sansPreference = assert.rejects(Promise.resolve(commande('session').executer(contexte())), { name: 'Annule' });
    await dessiner(); assert.deepEqual(demande.choix.map((c: any) => c.valeur), Object.keys(FOURNISSEURS));
    assert.doesNotMatch(ui.captureCharFrame(), /par défaut/); ui.mockInput.pressEscape(); await sansPreference;
    bus.off('demande', recevoir); config.fournisseurDefaut = 'codex';
    // Parcours réel : texte libre -> sélection -> Échap -> brouillon restauré.
    root.render(<App quitter={() => {}} />); await dessiner();
    const nbAvant = sessions.listerIntegrees().length, envoisAvant = envois.length;
    await ui.mockInput.typeText('Explique mon projet sans rien modifier'); ui.mockInput.pressEnter(); await dessiner();
    assert.match(ui.captureCharFrame(), /Nouvelle session : quel agent/);
    for (const largeur of [60, 80, 130]) {
        ui.resize(largeur, 34); await dessiner();
        for (const { nom } of Object.values(FOURNISSEURS)) assert.ok(ui.captureCharFrame().includes(nom), `${nom} visible à ${largeur} colonnes`);
    }
    ui.mockInput.pressEscape(); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /Explique mon projet sans rien modifier/);
    assert.equal(sessions.listerIntegrees().length, nbAvant); assert.equal(envois.length, envoisAvant);
    // L’identité reste en tête du chat, même si le projet et le titre débordent.
    for (const largeur of [60, 80, 130]) {
        ui.resize(largeur, 24);
        for (const [fournisseur, { nom }] of Object.entries(FOURNISSEURS)) {
            const s = { integree: true, fournisseur, nom: 'Projet très long '.repeat(12), titre: 'Conversation très longue '.repeat(12), fichier: path.join(tmp, 'vide.jsonl') };
            root.render(<Conversation key={`${largeur}-${fournisseur}`} s={s} largeur={largeur} agir={() => {}} position="cache" diff={false} />); await dessiner();
            assert.ok(ui.captureCharFrame().split('\n')[0].includes(`Agent : ${nom}`));
        }
    }
    process.stdout.write('✓ Création : choix explicite des trois agents, préférence, annulations, brouillon, commandes directes et identité visible à 60/80/130 colonnes\n');
} finally { bus.off('demande', recevoir); await ui.dispose(); fs.rmSync(tmp, { recursive: true, force: true }); }

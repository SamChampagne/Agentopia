import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-sftp-consentement-tui-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier; process.env.CLAUDETOPIA_TEST_UI = '1';
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false }));
const { VueSftp } = await import('./vues/sftp.tsx');
const { EmpreinteSftpInconnue, empreinteSftp } = await import('../dist/confianceSftp.js');
const { CHEMINS } = await import('../dist/chemins.js');
const empreinte = empreinteSftp(Buffer.from('cle publique de fixture locale, aucun serveur'));
const serveur = 'sftp.example.invalid:2222';
const cible = { nom: 'Serveur fixture', hote: 'sftp.example.invalid', port: 2222, utilisateur: 'fixture', auth: 'motdepasse',
    dossier: '/fixture', secretFixture: 'NE_PAS_AFFICHER_LE_SECRET_FIXTURE' };
const ui = await createTestRenderer({ width: 60, height: 24, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 100)); await ui.flush(); await ui.renderOnce(); };
function clientFixture(erreurListing?: string) {
    const tentatives: { empreinteAcceptee?: string }[] = [], clients: { fermetures: number }[] = [];
    const creer = (recue: typeof cible) => {
        assert.equal(recue.hote, cible.hote); assert.equal(recue.port, cible.port);
        const s = { fermetures: 0, nouvelleEmpreinte: undefined as string | undefined,
            connecter: async (options: { empreinteAcceptee?: string } = {}) => {
                tentatives.push({ ...options });
                if (!options.empreinteAcceptee) throw new EmpreinteSftpInconnue(serveur, empreinte);
                assert.equal(options.empreinteAcceptee, empreinte, 'accord lié à la clé exacte affichée');
                s.nouvelleEmpreinte = empreinte;
            },
            reel: async (chemin: string) => { assert.equal(chemin, '/fixture'); return chemin; },
            lister: async (chemin: string) => { assert.equal(chemin, '/fixture'); if (erreurListing) throw new Error(erreurListing); return []; },
            fermer: () => { s.fermetures++; },
        };
        clients.push(s); return s as any;
    };
    return { tentatives, clients, creer };
}
async function verifierConsentementVisible() {
    await dessiner();
    const texte = ui.captureCharFrame();
    assert.match(texte, /Première connexion/);
    assert.ok(texte.replace(/\s/g, '').includes(serveur), 'serveur affiché en entier');
    assert.ok(texte.replace(/\s/g, '').includes(empreinte), 'SHA256 complet affiché, même à 60 colonnes');
    assert.doesNotMatch(texte, /NE_PAS_AFFICHER_LE_SECRET_FIXTURE/);
    assert.match(texte, /Accepter la clé \(o\)/);
}
try {
    for (const largeur of [60, 100]) {
        ui.resize(largeur, 24);
        const annulation = clientFixture(); let fermeturesVue = 0;
        root.render(<VueSftp key={`annuler-${largeur}`} cible={cible} creerConnexion={annulation.creer} fermer={() => { fermeturesVue++; }} />);
        await verifierConsentementVisible(); assert.equal(annulation.tentatives.length, 1);
        ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await dessiner();
        assert.equal(annulation.tentatives.length, 1, 'Entrée ne consent jamais à une première clé');
        ui.mockInput.pressKey('o', { ctrl: true }); ui.mockInput.pressKey('o', { meta: true }); await dessiner();
        assert.equal(annulation.tentatives.length, 1, 'un raccourci modifié ne vaut pas consentement');
        ui.mockInput.pressEscape(); await dessiner();
        assert.match(ui.captureCharFrame(), /Connexion annulée/); assert.equal(annulation.tentatives.length, 1);
        assert.equal(fs.existsSync(CHEMINS.sftpEmpreintes), false, 'la vue ne mémorise pas une clé refusée');
        ui.mockInput.pressEscape(); await dessiner(); assert.equal(fermeturesVue, 1);
        const fermeturesAvant = annulation.clients[0].fermetures;
        root.render(<text>transition</text>); await dessiner();
        assert.ok(annulation.clients[0].fermetures > fermeturesAvant, 'unmount ferme le client refusé');

        const accord = clientFixture();
        root.render(<VueSftp key={`accepter-${largeur}`} cible={cible} creerConnexion={accord.creer} fermer={() => {}} />);
        await verifierConsentementVisible();
        ui.mockInput.pressKey('o'); ui.mockInput.pressKey('o'); await dessiner();
        assert.equal(accord.tentatives.length, 2, 'un double appui explicite ne crée qu’une reconnexion');
        assert.equal(accord.tentatives[0].empreinteAcceptee, undefined);
        assert.equal(accord.tentatives[1].empreinteAcceptee, empreinte);
        assert.match(ui.captureCharFrame(), /empreinte acceptée et enregistrée/); assert.match(ui.captureCharFrame(), /dossier vide/);
        assert.doesNotMatch(ui.captureCharFrame(), /NE_PAS_AFFICHER_LE_SECRET_FIXTURE/);
        root.render(<text>transition</text>); await dessiner();
        assert.ok(accord.clients.at(-1)!.fermetures > 0, 'unmount ferme le client connecté');

        const echec = clientFixture('Lecture refusée pour le dossier fixture');
        root.render(<VueSftp key={`listing-refuse-${largeur}`} cible={cible} creerConnexion={echec.creer} fermer={() => {}} />);
        await verifierConsentementVisible();
        ui.mockInput.pressKey('o'); await dessiner();
        assert.equal(echec.tentatives.length, 2);
        assert.match(ui.captureCharFrame(), /Lecture refusée pour le dossier fixture/);
        assert.doesNotMatch(ui.captureCharFrame(), /empreinte acceptée et enregistrée|Connecté/,
            'le message de succès ne masque pas l’erreur de lecture après accord');
        root.render(<text>transition</text>); await dessiner();
        assert.ok(echec.clients.at(-1)!.fermetures > 0, 'unmount ferme le client dont le listing a échoué');
    }
    process.stdout.write('✓ TUI SFTP : empreinte complète, accord explicite, annulation, erreur listing conservée, clients fermés (60/100 colonnes)\n');
} finally {
    root.render(<text>fin</text>); await dessiner(); await ui.dispose();
    const relatif = path.relative(os.tmpdir(), dossier);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(dossier, { recursive: true, force: true });
}

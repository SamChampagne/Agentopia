import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-tui-avis-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
process.env.CLAUDETOPIA_SANS_REPRISE = '1'; process.env.CLAUDETOPIA_TEST_UI = '1';
delete process.env.ANTHROPIC_API_KEY; delete process.env.PERPLEXITY_API_KEY;
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { fournisseur: 'claude', actif: false } }));
const { App } = await import('./app.tsx');
const { VUES } = await import('./vues/index.ts');
const { bus } = await import('../dist/ui/bus.js');
const { historiqueAvis } = await import('../dist/ui/avis.js');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { CarnetBrouillons, destinationBrouillon } = await import('../dist/ui/brouillons.js');
const { COMMANDES } = await import('../dist/commandes.js');
const image = path.join(dossier, 'capture.png'); fs.writeFileSync(image, 'fixture');
const d = lireDonnees();
for (const id of ['a', 'b']) {
    const fichier = path.join(dossier, `${id}.jsonl`);
    fs.writeFileSync(fichier, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Conversation conservée' }] } }) + '\n');
    d.agents.push({ cle: id, id, sessionId: id, integree: true, arrierePlan: true, fournisseur: 'codex', cwd: dossier,
        nom: `Projet ${id}`, titre: 'Session', debut: new Date(), statut: 'attend', fichier } as any);
}
const graines = new CarnetBrouillons();
graines.ecrire(destinationBrouillon('a'), { texte: 'Brouillon A' }); graines.ecrire(destinationBrouillon('b'), { texte: 'Brouillon B' }); graines.sauver();
const ui = await createTestRenderer({ width: 130, height: 34, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 230)); await ui.flush(); await ui.renderOnce(); };
const choisir = async (id: string) => { bus.emit('selectionner', id); await dessiner(); };
let terminer: ((image?: string) => void) | undefined, echouer: ((e: Error) => void) | undefined, captures = 0;
const lireImage = async () => { captures++; return new Promise<string | undefined>((ok, ko) => { terminer = ok; echouer = ko; }); };
const commande = COMMANDES.find((c: any) => c.nom === 'envoyer')!;
const avant = commande.executer, envoyes: string[] = [], copies: string[] = [];
commande.executer = async (ctx: any) => { envoyes.push(ctx.reste); };
const VueAvis = VUES.VueAvis;
VUES.VueAvis = (props: any) => <VueAvis {...props} copierTexte={(texte: string) => { copies.push(texte); }} />;
try {
    root.render(<App quitter={() => {}} lireImage={lireImage} />); await dessiner(); await choisir('a');
    ui.mockInput.pressKey('v', { meta: true }); ui.mockInput.pressKey('v', { meta: true }); await dessiner();
    assert.equal(captures, 1); assert.match(ui.captureCharFrame(), /Ajout de l’image en cours/);
    await ui.mockInput.typeText(' suite'); await dessiner();
    ui.mockInput.pressEnter(); await dessiner(); assert.equal(envoyes.length, 0);
    await choisir('b'); await ui.mockInput.typeText(' autre'); await dessiner();
    terminer!(image); await dessiner();
    assert.match(ui.captureCharFrame(), /Brouillon B/); assert.doesNotMatch(ui.captureCharFrame(), /\[image 1\]/);
    await choisir('a'); assert.match(ui.captureCharFrame(), /Brouillon A/); assert.match(ui.captureCharFrame(), /suite/); assert.match(ui.captureCharFrame(), /\[image 1\]/);
    ui.mockInput.pressKey('v', { meta: true }); await dessiner(); echouer!(new Error('Presse-papiers fixture indisponible')); await dessiner();
    assert.match(ui.captureCharFrame(), /Brouillon A/); assert.match(ui.captureCharFrame(), /\[image 1\]/);
    ui.mockInput.pressKey('m', { meta: true }); await dessiner();
    await ui.mockInput.typeText('Demande maître fixture'); ui.mockInput.pressEnter(); await dessiner();
    assert.ok(historiqueAvis.lire().some((a) => /Maître : Claude : Configure une clé API Anthropic/.test(a.texte)), 'la cause réelle reste consultable, pas seulement la restauration du brouillon');
    ui.mockInput.pressEscape(); await dessiner();
    const long = `Avis long à relire\n${Array.from({ length: 35 }, (_, i) => `Détail ${i} : texte entier conservé`).join('\n')}\nFIN_DETAIL_FIXTURE`;
    bus.emit('notice', long); bus.emit('notice', long); await dessiner();
    assert.equal(historiqueAvis.lire()[0].repetitions, 2);
    await new Promise((r) => setTimeout(r, 6100)); await dessiner();
    assert.doesNotMatch(ui.captureCharFrame(), /Avis long à relire/); assert.match(ui.captureCharFrame(), /Avis \d+ · Alt\+N/);
    const nombre = historiqueAvis.lire().length;
    ui.mockInput.pressKey('n', { meta: true }); await dessiner();
    assert.match(ui.captureCharFrame(), /AVIS ET ERREURS/); assert.match(ui.captureCharFrame(), /Avis long à relire/);
    ui.mockInput.pressEnter(); await dessiner();
    ui.mockInput.pressKey('END'); await dessiner(); assert.match(ui.captureCharFrame(), /FIN_DETAIL_FIXTURE/);
    ui.mockInput.pressKey('c'); await dessiner();
    assert.equal(copies.length, 1); assert.ok(copies[0].includes(long)); assert.equal(historiqueAvis.lire().length, nombre, 'consulter et copier ne créent pas de boucle d’avis');
    ui.mockInput.pressEscape(); await dessiner(); ui.mockInput.pressEscape(); await dessiner();
    assert.match(ui.captureCharFrame(), /Brouillon A/); assert.match(ui.captureCharFrame(), /\[image 1\]/);
    for (const [largeur, hauteur] of [[60, 18], [80, 24]]) {
        ui.resize(largeur, hauteur); await dessiner();
        const lignes = ui.captureCharFrame().split('\n'), ligneAvis = lignes.findIndex((l) => l.includes('Avis') && l.includes('Alt+N'));
        assert.ok(ligneAvis >= 0); await ui.mockMouse.click(lignes[ligneAvis].indexOf('Avis') + 1, ligneAvis); await dessiner();
        assert.match(ui.captureCharFrame(), /AVIS ET ERREURS/);
        const erreurIndex = historiqueAvis.lire().findIndex((a) => a.texte.includes('Presse-papiers fixture indisponible'));
        for (let i = 0; i < erreurIndex; i++) { ui.mockInput.pressArrow('down'); await dessiner(); }
        ui.mockInput.pressEnter(); await dessiner();
        assert.match(ui.captureCharFrame().replace(/\s+/g, ' '), /Presse-papiers fixture indisponible/);
        ui.mockInput.pressEscape(); await dessiner(); ui.mockInput.pressEscape(); await dessiner();
        assert.match(ui.captureCharFrame(), /Brouillon A/); assert.equal(ui.captureCharFrame().split('\n')[hauteur - 1].indexOf('╯'), largeur - 2);
    }
    root.render(<text>fermé</text>); await dessiner();
    const persiste = new CarnetBrouillons();
    assert.ok(persiste.lire(destinationBrouillon('a')).texte.includes('suite'));
    assert.deepEqual(persiste.lire(destinationBrouillon('a')).images, [image]);
    assert.ok(persiste.lire(destinationBrouillon('b')).texte.includes('autre'));
    assert.deepEqual(persiste.lire(destinationBrouillon('b')).images, []);
    process.stdout.write('✓ TUI : avis complets après expiration, copie sans boucle, brouillon conservé, collage asynchrone dans la bonne conversation (60/80/130)\n');
} finally {
    commande.executer = avant; VUES.VueAvis = VueAvis; root.render(<text>fin</text>); await dessiner(); await ui.dispose();
    const relatif = path.relative(os.tmpdir(), dossier);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(dossier, { recursive: true, force: true });
}

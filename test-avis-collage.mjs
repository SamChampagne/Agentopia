import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-avis-collage-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
const { HistoriqueAvis, texteAvis } = await import('./dist/ui/avis.js');
const { CarnetBrouillons } = await import('./dist/ui/brouillons.js');
const { CollageImage } = await import('./dist/ui/collageImage.js');
const { imageDuPressePapiers } = await import('./dist/ui/pressePapiers.js');
const image = path.join(dossier, 'fixture.png'); fs.writeFileSync(image, 'fixture');
const carnets = [];
const carnet = (nom) => { const c = new CarnetBrouillons(path.join(dossier, nom)); carnets.push(c); return c; };
after(() => {
    carnets.forEach((c) => c.sauver());
    const relatif = path.relative(os.tmpdir(), dossier);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(dossier, { recursive: true, force: true });
});

test('avis : mémoire bornée, répétitions regroupées, détail entier et lecture sans doublon', () => {
    const h = new HistoriqueAvis(3);
    h.ajouter('Premier', 1); h.ajouter('Erreur\nDétail complet', 2); h.ajouter('Erreur\nDétail complet', 3);
    assert.equal(h.lire().length, 2); assert.equal(h.lire()[0].repetitions, 2);
    assert.match(texteAvis(h.lire()[0]), /Erreur\nDétail complet/);
    h.marquerLus(); assert.ok(h.lire().every((a) => a.lu));
    h.ajouter('Erreur\nDétail complet', 4); assert.equal(h.lire()[0].lu, false); assert.equal(h.lire()[0].repetitions, 3);
    h.ajouter('Troisième', 5); h.ajouter('Quatrième', 6);
    assert.equal(h.lire().length, 3); assert.ok(!h.lire().some((a) => a.texte === 'Premier'));
    const instantane = h.lire(); h.marquerLus(); h.marquerLus();
    assert.equal(h.lire().length, instantane.length);
    assert.equal(new HistoriqueAvis().lire().length, 0, 'aucune persistance entre lancements');
});

test('capture Windows : attente asynchrone et chemins avec apostrophe, sans vrai presse-papiers', async () => {
    let terminer, recu;
    const enCours = imageDuPressePapiers({ dossier: path.join(dossier, "dossier d'image"), executer: async (args) => {
        recu = args;
        return new Promise((ok) => { terminer = ok; });
    } });
    for (let n = 0; n < 50 && !terminer; n++) await new Promise((r) => setTimeout(r, 2));
    assert.ok(terminer); assert.equal(recu[0], '-STA');
    assert.match(Buffer.from(recu.at(-1), 'base64').toString('utf16le'), /dossier d''image/);
    terminer(`fichier:${image}\r\n`); assert.equal(await enCours, image);
    assert.equal(await imageDuPressePapiers({ dossier, executer: async () => '' }), undefined);
    await assert.rejects(imageDuPressePapiers({ dossier, executer: async () => { throw new Error('Délai fixture'); } }), /Délai fixture/);
});

test('collage : une capture, texte récent conservé et destination initiale respectée', async () => {
    const c = carnet('destination'); c.ecrire('a', { texte: 'Avant' }); c.ecrire('b', { texte: 'Autre' });
    let terminer, appels = 0;
    const avis = [], collage = new CollageImage(c, () => { appels++; return new Promise((ok) => { terminer = ok; }); }, (m) => avis.push(m));
    const attente = collage.coller('a', 'Projet A');
    assert.equal(collage.lire().destination, 'a'); assert.equal(await collage.coller('b', 'Projet B'), false); assert.equal(appels, 1);
    c.ecrire('a', { texte: 'Avant et nouvelle frappe' }); c.ecrire('b', { texte: 'Autre brouillon modifié' });
    terminer(image); assert.equal(await attente, true);
    assert.deepEqual(c.lire('a'), { texte: 'Avant et nouvelle frappe [image 1] ', images: [image] });
    assert.deepEqual(c.lire('b'), { texte: 'Autre brouillon modifié', images: [] });
    assert.equal(collage.lire().destination, undefined); assert.match(avis[0], /Projet A/);
});

test('collage : fichier déjà joint, presse-papiers vide, erreur et fichier disparu gardent le brouillon', async () => {
    const c = carnet('erreurs'); const initial = { texte: 'À conserver [image 1]', images: [image] }; c.ecrire('a', initial);
    const avis = [];
    for (const lecteur of [async () => image, async () => undefined, async () => { throw new Error('Lecture refusée'); }, async () => path.join(dossier, 'absent.png')]) {
        await new CollageImage(c, lecteur, (m) => avis.push(m)).coller('a', 'Projet A');
        assert.deepEqual(c.lire('a'), initial);
    }
    assert.ok(avis.some((m) => m.includes('déjà jointe'))); assert.ok(avis.some((m) => m.includes('Lecture refusée')));
});

test('collage : fermer pendant la capture annule le rattachement au brouillon', async () => {
    const c = carnet('fermeture'); c.ecrire('a', { texte: 'Conservé' });
    let terminer, signal; const avis = [];
    const collage = new CollageImage(c, (s) => { signal = s; return new Promise((ok) => { terminer = ok; }); }, (m) => avis.push(m));
    const attente = collage.coller('a', 'Projet A'); collage.fermer(); assert.ok(signal.aborted);
    terminer(image); assert.equal(await attente, false); assert.deepEqual(c.lire('a'), { texte: 'Conservé', images: [] }); assert.equal(avis.length, 0);
});

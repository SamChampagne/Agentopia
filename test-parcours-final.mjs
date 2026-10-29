import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-parcours-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
process.env.AGENTOPIA_SANS_MOTEUR = '1';
const { HorlogeTravail } = await import('./dist/horlogeTravail.js');
const { creerDemandesPermission } = await import('./dist/demandesPermission.js');
const { presenterPermission } = await import('./dist/presentationPermission.js');
const { suiteEquipe } = await import('./dist/finEquipe.js');
const { comparerVersions, choisirRelease, chercherMiseAJour } = await import('./dist/versionsDistribution.js');
const { remplacerFichier, ecrireAtomique } = await import('./dist/stockageAtomique.js');
after(() => {
    const rel = path.relative(os.tmpdir(), racine);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true });
});
function tempsManuel() {
    let ms = 0, id = 0; const actions = new Map();
    return { maintenant: () => ms, programmer: (fn, delai) => { actions.set(++id, { fn, a: ms + delai }); return id; },
        annuler: (id) => actions.delete(id),
        avancer: (delta) => { const fin = ms + delta; while (true) {
            const prochain = [...actions].filter(([, x]) => x.a <= fin).sort((a, b) => a[1].a - b[1].a)[0];
            if (!prochain) break; ms = prochain[1].a; actions.delete(prochain[0]); prochain[1].fn();
        } ms = fin; },
    };
}
test('écriture Windows : réessayer les refus transitoires sans supprimer le dernier état lisible', () => {
    const fichier = path.join(racine, 'etat-fixture.json'), temporaire = fichier + '.tmp';
    ecrireAtomique(fichier, { etat: 'avant' }); fs.writeFileSync(temporaire, '{"etat":"apres"}');
    let appels = 0; const delais = [];
    remplacerFichier(temporaire, fichier, { windows: true, patienter: (ms) => delais.push(ms), renommer: (a, b) => {
        if (++appels <= 3) { assert.equal(JSON.parse(fs.readFileSync(b)).etat, 'avant'); throw Object.assign(new Error('Fichier occupé'), { code: 'EPERM' }); }
        fs.renameSync(a, b);
    } });
    assert.equal(JSON.parse(fs.readFileSync(fichier)).etat, 'apres'); assert.deepEqual(delais, [10, 20, 40]);
    for (const code of ['EPERM', 'EIO']) {
        appels = 0;
        assert.throws(() => remplacerFichier(temporaire, fichier, { windows: true, patienter() {}, renommer() { appels++; throw Object.assign(new Error(code), { code }); } }), new RegExp(code));
        assert.equal(appels, code === 'EPERM' ? 10 : 1); assert.equal(JSON.parse(fs.readFileSync(fichier)).etat, 'apres');
    }
});
test('limite : des heures de permission ne consomment pas les minutes de travail restantes', () => {
    const temps = tempsManuel(); let expirations = 0;
    const h = new HorlogeTravail(60_000, () => expirations++, temps);
    temps.avancer(20_000); const reprendre = h.suspendre(); temps.avancer(7_200_000);
    assert.equal(expirations, 0); reprendre(); reprendre(); temps.avancer(39_999); assert.equal(expirations, 0);
    temps.avancer(1); assert.equal(expirations, 1);
    assert.deepEqual(h.bilan(), { travailMs: 60_000, attenteMs: 7_200_000 });
});
test('permissions simultanées : pas de reprise du compteur tant que la dernière attend', () => {
    const t = tempsManuel(); let fini = false; const h = new HorlogeTravail(100, () => fini = true, t);
    t.avancer(10); const a = h.suspendre(), b = h.suspendre(); t.avancer(1000); a(); t.avancer(1000);
    assert.equal(fini, false); b(); t.avancer(89); assert.equal(fini, false); h.arreter(); t.avancer(1000);
    assert.equal(fini, false); assert.deepEqual(h.bilan(), { travailMs: 99, attenteMs: 2000 });
});
test('file de permissions : réponse périmée ignorée, refus conservé et annulation sans publication tardive', async () => {
    const controller = new AbortController(), temps = tempsManuel(); let affichee;
    const h = new HorlogeTravail(100, () => controller.abort(), temps), publications = [];
    const demander = creerDemandesPermission({ dossier: racine, tour: 'tour', signal: controller.signal,
        suspendre: () => h.suspendre(), publier: (p) => { affichee = p; publications.push(p); } });
    const a = demander({ titre: 'A', detail: '' }), b = demander({ titre: 'B', detail: '' });
    const annulation = assert.rejects(b, { name: 'AbortError' });
    await pause(10); const premiere = affichee;
    fs.writeFileSync(path.join(racine, `reponse-${premiere.id}.json`), JSON.stringify({ tour: 'ancien', accepte: true }));
    await pause(300); assert.equal(affichee.id, premiere.id); temps.avancer(5000); assert.equal(controller.signal.aborted, false);
    fs.writeFileSync(path.join(racine, `reponse-${premiere.id}.json`), JSON.stringify({ tour: 'tour', accepte: false }));
    assert.equal((await a).accepte, false); await pause(10); assert.equal(affichee.titre, 'B');
    temps.avancer(5000); assert.equal(controller.signal.aborted, false); h.arreter(); controller.abort(); await annulation;
    assert.equal(publications.at(-1).titre, 'B', 'Aucun état travaille publié après arrêt');
});
test('permissions lisibles : commande exacte préservée et séquences ambiguës non simplifiées', () => {
    const p = (commande) => presenterPermission({ id: 'p', titre: 'outil', action: 'commande', commande, dossier: racine, detail: 'raison technique' });
    assert.equal(p('npm run test:ci').titre, 'Lancer les tests');
    assert.equal(p('powershell.exe -NoProfile -Command "node --test"').titre, 'Lancer les tests');
    assert.equal(p('git commit -m "Correction"').titre, 'Enregistrer les changements dans Git');
    assert.equal(p('git merge branche').titre, 'Fusionner une branche');
    for (const c of ['npm test; Remove-Item x', 'npm test && git push', 'npm test\ngit push', 'npm test $(foo)', 'git merge x | sh']) {
        assert.equal(p(c).titre, 'Exécuter une commande'); assert.ok(p(c).contexte.includes(c));
    }
    assert.match(p('npm test').details, /raison technique/);
    assert.equal(presenterPermission({ titre: 'Ancienne permission', detail: '{}' }).titre, 'Autoriser une action de l’agent');
});
test('fin de mission : intégrer seulement les branches prêtes, recherche sans fusion, reprise existante', () => {
    const e = { etat: 'prete', mixte: true, taches: [{ id: 't1', etat: 'faite', branche: 'travail' }] };
    assert.equal(suiteEquipe(e).peutIntegrer, true); assert.equal(suiteEquipe(e).peutRanger, true);
    assert.equal(suiteEquipe({ ...e, taches: [{ etat: 'faite', fournisseur: 'perplexity' }] }).peutIntegrer, false);
    assert.equal(suiteEquipe({ ...e, taches: [...e.taches, { etat: 'bloquee' }] }).peutRanger, false);
    assert.equal(suiteEquipe({ ...e, taches: [...e.taches, { etat: 'erreur' }] }).peutIntegrer, false);
    assert.equal(suiteEquipe({ ...e, etat: 'finie' }).peutIntegrer, false);
    const reprise = suiteEquipe({ ...e, integrateur: { agentId: 'existant', etat: 'arretee' } });
    assert.equal(reprise.peutIntegrer, false); assert.equal(reprise.reprise, true);
});
const release = (v, prerelease = v.includes('-')) => ({ tag_name: `agentopia-${v}`, prerelease,
    assets: ['agentopia-release.json', 'Agentopia-Windows-x64.zip'].map((name) => ({ name, browser_download_url: `https://github.com/SamChampagne/ClaudeTopia/releases/download/agentopia-${v}/${name}` })) });
test('mises à jour : canaux stable/bêta, ordre numérique et absence de retour arrière', () => {
    assert.ok(comparerVersions('1.4.0-beta.10', '1.4.0-beta.2') > 0);
    assert.ok(comparerVersions('1.4.0', '1.4.0-beta.10') > 0);
    const rs = [release('1.3.1'), release('1.4.0-beta.2'), release('1.4.0-beta.10')];
    assert.equal(choisirRelease(rs, '1.3.1'), undefined);
    assert.equal(choisirRelease(rs, '1.4.0-beta.1').tag_name, 'agentopia-1.4.0-beta.10');
    assert.equal(choisirRelease([...rs, release('1.4.0')], '1.4.0-beta.1').tag_name, 'agentopia-1.4.0');
    assert.equal(choisirRelease(rs, '1.5.0'), undefined);
    assert.equal(choisirRelease([{ ...release('2.0.0'), draft: true }], '1.3.1'), undefined);
});
test('manifeste de mise à jour : version et origine vérifiées avant tout téléchargement du paquet', async () => {
    const r = release('1.4.0-beta.2');
    const manifeste = { format: 'agentopia-release-v1', plateforme: 'win32-x64', version: '1.4.0-beta.2', id: 'fixture', asset: 'Agentopia-Windows-x64.zip', sha256: 'a'.repeat(64) };
    const obtenir = async (url) => Response.json(url.includes('/releases?') ? [r] : manifeste);
    assert.equal((await chercherMiseAJour('1.4.0-beta.1', obtenir)).manifeste.version, manifeste.version);
    manifeste.version = '1.3.0'; await assert.rejects(chercherMiseAJour('1.4.0-beta.1', obtenir), /invalide/);
    r.assets[0].browser_download_url = 'https://example.org/agentopia-release.json';
    await assert.rejects(chercherMiseAJour('1.4.0-beta.1', obtenir), /incompatible/);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StockageConfig } from './dist/stockageConfig.js';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-config-test-'));
after(() => {
    const relatif = path.relative(os.tmpdir(), racine);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(racine, { recursive: true, force: true });
});
const normaliser = (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.nom !== 'string') throw new Error('invalide');
    return { couleur: 'bleu', ...v };
};
function stockage(nom) {
    const dossier = path.join(racine, nom); fs.mkdirSync(dossier);
    return new StockageConfig(path.join(dossier, 'config.json'), normaliser, () => ({ nom: 'défaut', couleur: 'bleu' }));
}

test('configuration corrompue : sauvegarde relue, original intégral préservé et diagnostic stable', () => {
    const s = stockage('recuperation');
    s.sauver({ nom: 'réglages personnels', couleur: 'vert', champFutur: 42 });
    s.sauver({ nom: 'réglages récents', couleur: 'rouge', champFutur: 43 });
    const original = '{"nom":"réglages tronqués",';
    fs.writeFileSync(s.fichier, original);
    const retour = s.charger();
    assert.equal(retour.nom, 'réglages personnels'); assert.equal(retour.champFutur, 42);
    assert.equal(fs.readFileSync(s.etat.copie, 'utf8'), original);
    assert.equal(s.etat.sauvegarde, s.sauvegarde);
    const etat = s.etat;
    s.charger(); s.charger();
    assert.equal(s.etat, etat, 'pas de nouveau signal de récupération à chaque lecture');
    assert.equal(fs.readdirSync(path.dirname(s.fichier)).filter((f) => f.includes('.illisible-')).length, 1);
});

test('configuration sans sauvegarde : copie récupérable avant usage des réglages par défaut', () => {
    const s = stockage('sans-secours'); fs.writeFileSync(s.fichier, 'JSON incomplet');
    assert.equal(s.charger().nom, 'défaut');
    assert.equal(fs.readFileSync(s.etat.copie, 'utf8'), 'JSON incomplet');
    assert.match(s.etat.message, /original conservé/);
});

test('migration refusée par le disque : les réglages valides restent chargés et intacts', () => {
    const s = stockage('migration'); const original = JSON.stringify({ nom: 'personnalisé' });
    fs.writeFileSync(s.fichier, original); fs.mkdirSync(s.sauvegarde);
    assert.equal(s.charger().nom, 'personnalisé');
    assert.equal(fs.readFileSync(s.fichier, 'utf8'), original);
    assert.match(s.etat.message, /non enregistrée/);
});

test('original impossible à préserver : aucune écriture par défaut sur les données existantes', () => {
    const s = stockage('inaccessible'); fs.mkdirSync(s.fichier);
    assert.equal(s.charger().nom, 'défaut');
    assert.equal(fs.statSync(s.fichier).isDirectory(), true);
    assert.match(s.etat.message, /données existantes conservées/);
});

test('config structurée : valeurs nulles refusées, préférences nouvelles et anciennes conservées', async () => {
    const dossier = path.join(racine, 'structure'); fs.mkdirSync(dossier);
    process.env.CLAUDETOPIA_DATA_DIR = dossier;
    const { chargerConfig, sauverConfig, CHEMIN_CONFIG, etatRecuperationConfig } = await import('./dist/config.js');
    fs.writeFileSync(CHEMIN_CONFIG, JSON.stringify({ prenom: 'Personne', racines: ['C:\\dev'], extras: [], equipe: { parallele: 2 }, maitre: { actif: false }, futur: 'conservé' }));
    const config = chargerConfig();
    assert.equal(config.prenom, 'Personne'); assert.equal(config.maitre.actif, false);
    assert.equal(config.maitre.modele, 'haiku'); assert.equal(config.equipe.parallele, 2); assert.equal(config.futur, 'conservé');
    sauverConfig({ ...config, prenom: 'Autre' });
    fs.writeFileSync(CHEMIN_CONFIG, '{"racines":null}');
    assert.equal(chargerConfig().prenom, 'Personne');
    assert.equal(fs.readFileSync(etatRecuperationConfig().copie, 'utf8'), '{"racines":null}');
    for (const invalide of [{ theme: { primaire: null } }, { couleurs: { projet: 42 } }, { ecran: { cockpitMasques: null } }, { maitre: { actif: 'oui' } }]) {
        fs.writeFileSync(CHEMIN_CONFIG, JSON.stringify(invalide));
        const recuperee = chargerConfig();
        assert.equal(recuperee.prenom, 'Personne');
        assert.equal(typeof recuperee.theme.primaire, 'string');
        assert.equal(fs.readFileSync(etatRecuperationConfig().copie, 'utf8'), JSON.stringify(invalide));
    }
});

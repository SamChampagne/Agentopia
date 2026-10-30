import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-import-'));
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'donnees');
process.env.CLAUDETOPIA_SSH_CONFIG = path.join(racine, 'ssh-config');
process.env.CLAUDETOPIA_TEST_UI = '1';
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
const { listerProjets, trouverProjet } = await import('./dist/projets.js');
const { validerExportConfiguration, validerHoteSsh } = await import('./dist/importConfiguration.js');
const { config, COMMANDES, executerLigne, rafraichirProjets } = await import('./dist/commandes.js');
const { CHEMIN_CONFIG, sauverConfig } = await import('./dist/config.js');
const { commandesExport } = await import('./dist/exportImport.js');
const { bus } = await import('./dist/ui/bus.js');
const a = path.join(racine, 'travail', 'Demo'), b = path.join(racine, 'copie', 'Demo');
for (const p of [a, b]) fs.mkdirSync(p, { recursive: true });
const fichier = path.join(racine, 'pas-un-dossier'); fs.writeFileSync(fichier, 'texte');
config.racines = [path.dirname(a), path.dirname(b), fichier, path.join(racine, 'absent')];
config.extras = [a, a + path.sep, fichier]; config.planifications = []; config.sftp = [];
sauverConfig(config); rafraichirProjets();
after(() => {
    const relatif = path.relative(os.tmpdir(), racine);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(racine, { recursive: true, force: true });
});
const document = (configuration = {}, ssh = []) => ({ format: 'claudetopia-export', version: 1, config: configuration, ssh });
const tache = (id, projet) => ({ id, nom: id, projet, consigne: 'Vérifier', heure: '09:15', jours: [1, 2], actif: true, fournisseur: 'codex' });
const importer = async (d, reponse = true) => {
    const fichier = path.join(racine, 'import.json'); fs.writeFileSync(fichier, JSON.stringify(d));
    let demandes = 0;
    const repondre = (d) => { if (d) { demandes++; d.resoudre(reponse); } };
    bus.on('demande', repondre);
    try { await commandesExport(config).find((c) => c.nom === 'importer').executer({ reste: fichier }); }
    finally { bus.off('demande', repondre); }
    return demandes;
};

test('scan : chemins répétés dédupliqués, fichiers/disques absents ignorés, homonymes conservés', () => {
    const projets = listerProjets(config);
    assert.deepEqual(projets.map((p) => p.chemin), [a, b]);
    assert.equal(trouverProjet(projets, 'demo').length, 2);
    assert.equal(trouverProjet(projets, '1').chemin, a);
});

test('commande : choix du chemin avant tout lancement, annulation et dossier invalide sans exécution', async () => {
    const commande = COMMANDES.find((c) => c.nom === 'codex'), original = commande.executer;
    const executions = []; commande.executer = (ctx) => { executions.push(ctx); };
    let reponse = b;
    const repondre = (d) => {
        if (!d) return;
        assert.equal(executions.length, 0);
        assert.deepEqual(d.choix.map((c) => c.description), [a, b]);
        d.resoudre(reponse ? d.choix.find((c) => c.valeur.chemin === reponse).valeur : undefined);
    };
    bus.on('demande', repondre);
    try {
        await executerLigne('/codex Demo Décris "ce projet"');
        assert.equal(executions[0].projet.chemin, b);
        assert.equal(executions[0].apresProjet, 'Décris "ce projet"');
        executions.length = 0; reponse = undefined;
        await assert.rejects(executerLigne('/codex Demo bonjour'), { name: 'Annule' });
        await assert.rejects(executerLigne(`/codex "${fichier}" bonjour`), /Dossier de projet/);
        await assert.rejects(executerLigne('/codex projet-inexistant bonjour'), /Aucun projet/);
        assert.equal(executions.length, 0);
    } finally { commande.executer = original; bus.off('demande', repondre); }
});

test('import : document entier validé avant confirmation et sans modification partielle', async () => {
    const avant = fs.readFileSync(CHEMIN_CONFIG, 'utf8'), objetAvant = structuredClone(config);
    const invalides = [
        document({ banniere: 'remplacée', racines: 'non' }), document({ planifications: [tache('x', a), tache('x', b)] }),
        document({ theme: {} }), document({ planifications: [{ ...tache('x', a), heure: '99:99' }] }),
        document({ banniere: 'remplacée' }, [{ alias: 'host', hote: 'localhost\nProxyCommand mauvaise-commande' }]),
    ];
    let confirmations = 0; const observer = (d) => { if (d) confirmations++; }; bus.on('demande', observer);
    try { for (const d of invalides) await assert.rejects(importer(d), /Import refusé/); }
    finally { bus.off('demande', observer); }
    assert.equal(confirmations, 0); assert.equal(fs.readFileSync(CHEMIN_CONFIG, 'utf8'), avant);
    assert.deepEqual(config, objetAvant); assert.equal(fs.existsSync(process.env.CLAUDETOPIA_SSH_CONFIG), false);
});

test('import : tâches en pause, projet ambigu ignoré et tâche locale active préservée', async () => {
    config.planifications = [tache('locale', a)]; sauverConfig(config);
    assert.equal(await importer(document({ planifications: [tache('exacte', b), tache('ambigue', path.join(racine, 'ancien', 'Demo'))] })), 1);
    assert.equal(config.planifications.find((p) => p.id === 'locale').actif, true);
    assert.deepEqual(config.planifications.find((p) => p.id === 'exacte'), { ...tache('exacte', b), actif: false });
    assert.equal(config.planifications.some((p) => p.id === 'ambigue'), false);
    const avant = fs.readFileSync(CHEMIN_CONFIG, 'utf8');
    await importer(document({ banniere: 'annulée' }), false);
    assert.equal(fs.readFileSync(CHEMIN_CONFIG, 'utf8'), avant);
});

test('SSH : rejette les blocs injectés et ports invalides, accepte IPv6 et clés avec espaces', () => {
    for (const h of [{ alias: '*', hote: 'host' }, { alias: 'a\nHost autre', hote: 'host' },
        { alias: 'a', hote: '-oProxyCommand=x' }, { alias: 'a', hote: 'host', port: 70000 },
        { alias: 'a', hote: 'host', cle: 'cle\nProxyCommand x' }]) assert.throws(() => validerHoteSsh(h), /invalide/);
    assert.doesNotThrow(() => validerHoteSsh({ alias: 'serveur', hote: '2001:db8::1', port: 2222, cle: 'C:/Mes clés/id_ed25519' }));
    assert.doesNotThrow(() => validerExportConfiguration(document()));
});

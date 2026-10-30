import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-qol-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
fs.writeFileSync(path.join(racine, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const { CarnetBrouillons, destinationBrouillon } = await import('./dist/ui/brouillons.js');
const { HistoriqueSaisie } = await import('./dist/ui/historiqueSaisie.js');
const { argumentsCommande, citerArgument } = await import('./dist/ligneCommande.js');
const { executerLigne, COMMANDES, config } = await import('./dist/commandes.js');
const { bus } = await import('./dist/ui/bus.js');
const { activiteAgents, derniereSessionProjet } = await import('./dist/activiteAgents.js');
const { creerIntegree, dossierIntegre } = await import('./dist/sessionsIntegrees.js');
const { projetsRecents } = await import('./dist/dashboard.js');
const { lignesConfig } = await import('./dist/ui/VueConfig.js');
const { maintenirInstallation } = await import('./dist/miseAJour.js');
const { verifierConnexion, verifierCompteCodex } = await import('./dist/providers/connexion.js');
const { guiderConnexion } = await import('./dist/providers/assistantConnexion.js');
const { chargerConfig, CHEMIN_CONFIG } = await import('./dist/config.js');
const { migrerProfilTerminal, GUID_PROFIL } = await import('./dist/profilTerminal.js');
after(() => fs.rmSync(racine, { recursive: true, force: true }));

test('navigation historique : retrouve le brouillon, même après plusieurs commandes et une édition', () => {
    const n = new HistoriqueSaisie();
    assert.equal(n.parcourir('up', 'brouillon', []), 'brouillon');
    assert.equal(n.parcourir('down', 'brouillon', ['récent', 'ancien']), 'brouillon');
    assert.equal(n.parcourir('up', 'brouillon', ['récent', 'ancien']), 'récent');
    assert.equal(n.parcourir('up', 'récent', ['récent', 'ancien']), 'ancien');
    assert.equal(n.parcourir('down', 'ancien', ['récent', 'ancien']), 'récent');
    assert.equal(n.parcourir('down', 'récent', ['récent', 'ancien']), 'brouillon');
    n.reinitialiser();
    assert.equal(n.parcourir('up', 'modifié', ['récent']), 'récent');
    assert.equal(n.parcourir('down', 'récent', ['récent']), 'modifié');
});

test('renommage : ancienne bannière migrée, préférences et titre personnalisé préservés', () => {
    const avant = fs.readFileSync(CHEMIN_CONFIG, 'utf8');
    try {
        const config = { ...JSON.parse(avant), banniere: 'CLAUDETOPIA', prenom: 'Fixture', largeurLaterale: 41, champPersonnel: 'conservé' };
        fs.writeFileSync(CHEMIN_CONFIG, JSON.stringify(config));
        assert.equal(chargerConfig().banniere, 'AGENTOPIA');
        const apres = JSON.parse(fs.readFileSync(CHEMIN_CONFIG, 'utf8'));
        assert.equal(apres.prenom, 'Fixture'); assert.equal(apres.largeurLaterale, 41); assert.equal(apres.champPersonnel, 'conservé');
        fs.writeFileSync(CHEMIN_CONFIG, JSON.stringify({ ...apres, banniere: 'Mon atelier' }));
        assert.equal(chargerConfig().banniere, 'Mon atelier');
    } finally { fs.writeFileSync(CHEMIN_CONFIG, avant); }
});
test('profil Terminal : même identité et même apparence après renommage, sauvegarde conservée', () => {
    const fichier = path.join(racine, 'profil.json');
    const profil = { guid: GUID_PROFIL, name: 'Claudetopia', tabTitle: 'Claudetopia', commandline: 'cmd.exe /k "C:\\Projet\\Claudetopia.bat"', colorScheme: 'Claudetopia Nord', opacity: 75, font: { size: 13 } };
    const autre = { guid: 'autre', name: 'Mon terminal' };
    const avant = JSON.stringify({ profiles: [profil, autre], schemes: [{ name: 'Claudetopia Nord' }] });
    fs.writeFileSync(fichier, avant); migrerProfilTerminal(fichier);
    const apres = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    assert.deepEqual(apres.profiles[0], { ...profil, name: 'Agentopia', tabTitle: 'Agentopia', commandline: 'cmd.exe /k "C:\\Projet\\Agentopia.bat"' });
    assert.deepEqual(apres.profiles[1], autre); assert.deepEqual(apres.schemes, [{ name: 'Claudetopia Nord' }]);
    assert.equal(fs.readFileSync(`${fichier}.avant-agentopia.bak`, 'utf8'), avant);
    migrerProfilTerminal(fichier);
    assert.equal(fs.readFileSync(`${fichier}.avant-agentopia.bak`, 'utf8'), avant);
});

test('brouillons : session, recherche et pièces jointes isolées puis restaurées après redémarrage', () => {
    const dossier = path.join(racine, 'brouillons');
    const c = new CarnetBrouillons(dossier);
    const a = destinationBrouillon('a'), b = destinationBrouillon('b'), recherche = destinationBrouillon('a', false, true);
    c.ecrire(a, { texte: 'Travail A', images: ['capture A.png'] });
    c.ecrire(b, { texte: 'Travail B' }); c.ecrire(recherche, { texte: 'filtre' }); c.sauver();
    const apres = new CarnetBrouillons(dossier);
    assert.deepEqual(apres.lire(a), { texte: 'Travail A', images: ['capture A.png'] });
    assert.deepEqual(apres.lire(b), { texte: 'Travail B', images: [] });
    assert.equal(apres.lire(recherche).texte, '');
    c.ecrire(a, { texte: '', images: [] }); c.sauver();
    assert.equal(new CarnetBrouillons(dossier).lire(a).texte, '');
});
test('échec d’envoi : conserve le nouveau texte et restaure la destination originale', () => {
    const c = new CarnetBrouillons(path.join(racine, 'echec'));
    c.ecrire('a', { texte: 'nouveau message', images: ['autre.png'] });
    c.ecrire('b', { texte: 'B' });
    c.restaurer('a', { texte: 'message refusé', images: ['capture.png'] });
    assert.equal(c.lire('a').texte, 'message refusé\n\nnouveau message');
    assert.deepEqual(c.lire('a').images, ['capture.png', 'autre.png']);
    assert.equal(c.lire('b').texte, 'B'); c.sauver();
});
test('sauvegardes indépendantes : une autre fenêtre ne perd pas son brouillon', () => {
    const dossier = path.join(racine, 'fenetres');
    const a = new CarnetBrouillons(dossier), b = new CarnetBrouillons(dossier);
    a.ecrire('a', { texte: 'A' }); b.ecrire('b', { texte: 'B' }); a.sauver(); b.sauver();
    assert.equal(new CarnetBrouillons(dossier).lire('a').texte, 'A');
});
test('arguments Windows : espaces, apostrophes, antislash final et guillemets échappés', () => {
    for (const p of ['C:\\Mes projets\\app', "C:\\L'équipe\\app", 'C:\\Mes projets\\', 'dossier "cité"']) {
        assert.deepEqual(argumentsCommande(citerArgument(p)), [p]);
    }
    assert.deepEqual(argumentsCommande("'C:\\Mes projets\\app' autre"), ['C:\\Mes projets\\app', 'autre']);
    assert.throws(() => argumentsCommande('"C:\\Mes projets'), /Guillemet non fermé/);
});
test('route réelle : chemin avec espaces et consigne multiligne conservés', async () => {
    const dossier = path.join(racine, "Projet de l'équipe"); fs.mkdirSync(dossier);
    const cmd = COMMANDES.find((c) => c.nom === 'codex'), avant = cmd.executer;
    let recu; cmd.executer = (c) => { recu = c; };
    const texte = 'Vérifie "hello world"\n  puis l’erreur `a b`';
    try { await executerLigne(`/codex ${citerArgument(dossier)} ${texte}`); }
    finally { cmd.executer = avant; }
    assert.equal(recu.projet.chemin, dossier); assert.equal(recu.apresProjet, texte);
});
test('faute de commande : erreur et suggestion, aucun lancement implicite', async () => {
    await assert.rejects(executerLigne('/codxe'), /Commande inconnue.*\/codex.*Aucun agent lancé/);
});

test('texte libre : passe par les sessions intégrées et conserve le message, sans imposer Claude', async () => {
    const commande = COMMANDES.find((c) => c.nom === 'session'), avant = commande.executer;
    let recu;
    commande.executer = (c) => { recu = c; };
    const message = 'Explique "ce fichier"\n  et préserve les espaces.';
    try { await executerLigne(message); }
    finally { commande.executer = avant; }
    assert.equal(recu.projet.chemin, process.cwd());
    assert.equal(recu.apresProjet, message);
});

test('agent par défaut : choix persistant et annulation préservant la préférence', async () => {
    const avant = fs.readFileSync(CHEMIN_CONFIG, 'utf8'), preference = config.fournisseurDefaut;
    let annuler = false;
    const choisir = (d) => {
        if (!d) return;
        assert.equal(d.type, 'choix');
        assert.deepEqual(d.choix.map((c) => c.valeur), ['choisir', 'claude', 'codex', 'perplexity']);
        d.resoudre(annuler ? undefined : 'codex');
    };
    bus.on('demande', choisir);
    try {
        await executerLigne('/agent-defaut');
        assert.equal(config.fournisseurDefaut, 'codex');
        assert.equal(chargerConfig().fournisseurDefaut, 'codex');
        const lignes = lignesConfig({ config, git: { nom: '', email: '' }, jetons: [], raccourci: false }, { connecte: false });
        assert.ok(lignes.some((l) => l.type === 'section' && l.texte === 'AGENTS ET SESSIONS'));
        assert.equal(lignes.find((l) => l.commande === '/agent-defaut').valeur, 'Codex');
        assert.equal(lignes.find((l) => l.commande?.startsWith('/lancement')).label, 'Lancement Claude CLI');
        annuler = true;
        await assert.rejects(executerLigne('/agent-defaut'), { name: 'Annule' });
        assert.equal(config.fournisseurDefaut, 'codex');
        assert.equal(chargerConfig().fournisseurDefaut, 'codex');
    } finally {
        bus.off('demande', choisir); config.fournisseurDefaut = preference;
        fs.writeFileSync(CHEMIN_CONFIG, avant);
    }
});

test('activité des projets : Codex et Perplexity, y compris archivés, alimentent aussi les récents', () => {
    const a = path.join(racine, 'activite-a'), b = path.join(racine, 'activite-b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    const sa = creerIntegree('codex', a, 'A'), sb = creerIntegree('perplexity', b, 'B');
    try {
        fs.writeFileSync(path.join(dossierIntegre(sa.id), 'etat.json'), JSON.stringify({ ...sa, maj: 1000, archivee: true }));
        fs.writeFileSync(path.join(dossierIntegre(sb.id), 'etat.json'), JSON.stringify({ ...sb, maj: 2000 }));
        const dates = activiteAgents();
        assert.equal(derniereSessionProjet(a, dates).getTime(), 1000);
        assert.equal(derniereSessionProjet(b, dates).getTime(), 2000);
        assert.equal(derniereSessionProjet(path.join(racine, 'aucune'), dates), undefined);
        const recents = projetsRecents([a, b].map((chemin) => ({ nom: path.basename(chemin), chemin, racine })), 2);
        assert.deepEqual(recents.map((r) => r.projet.chemin), [b, a]);
    } finally {
        fs.rmSync(dossierIntegre(sa.id), { recursive: true, force: true });
        fs.rmSync(dossierIntegre(sb.id), { recursive: true, force: true });
    }
});
function installation(nom, reponse = () => ({ ok: true, sortie: '' })) {
    const dossier = path.join(racine, nom); fs.mkdirSync(path.join(dossier, '.git'), { recursive: true });
    const appels = [];
    return { dossier, appels, options: { bun: 'bun', lancer: async (cmd, args, cwd) => { appels.push({ cmd, args, cwd }); return reponse(cmd, args); } } };
}
test('Git déjà à jour : installe aussi les dépendances TUI et vérifie la compilation', async () => {
    const i = installation('maj', (cmd, args) => ({ ok: true, sortie: args[0] === 'pull' ? 'Already up to date.' : '' }));
    await maintenirInstallation(i.dossier, false, i.options);
    assert.deepEqual(i.appels.slice(0, 6).map((a) => a.args[0]), ['status', 'pull', 'ci', 'run', 'install', path.join(i.dossier, 'node_modules', 'typescript', 'bin', 'tsc')]);
    assert.equal(i.appels[4].cwd, path.join(i.dossier, 'tui'));
    assert.ok(i.appels[4].args.includes('--frozen-lockfile'));
    assert.ok(fs.existsSync(path.join(i.dossier, 'dist', 'installation.json')));
});
test('réparation locale : aucune récupération Git ; échec de compilation sans reçu de réussite', async () => {
    const i = installation('reparer', (cmd, args) => ({ ok: args[0] !== 'run', sortie: 'fixture compile error' }));
    await assert.rejects(maintenirInstallation(i.dossier, true, i.options), /Compilation.*fixture compile error/);
    assert.ok(!i.appels.some((a) => a.cmd === 'git'));
    assert.ok(!fs.existsSync(path.join(i.dossier, 'dist', 'installation.json')));
});
test('mise à jour : changements locaux préservés avant toute modification', async () => {
    const i = installation('sale', () => ({ ok: true, sortie: ' M src/mon-fichier.ts' }));
    await assert.rejects(maintenirInstallation(i.dossier, false, i.options), /changements locaux/);
    assert.equal(i.appels.length, 1);
});
test('vérification API : catalogue uniquement, erreur lisible sans exposition de la clé', async () => {
    for (const f of ['claude', 'perplexity']) {
        const r = await verifierConnexion(f, async (url, init) => {
            assert.match(url, /\/v1\/models/); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
            assert.equal(init.headers.Authorization, 'Bearer fixture-secret');
            return new Response('{"data":[{"id":"fixture"}]}', { status: 200 });
        }, 'fixture-secret');
        assert.equal(r.pret, true);
    }
    const r = await verifierConnexion('claude', async () => new Response('fixture-secret', { status: 401 }), 'fixture-secret');
    assert.equal(r.pret, false); assert.doesNotMatch(r.texte, /fixture-secret/);
    const reseau = await verifierConnexion('perplexity', async () => { throw new Error('fixture-secret'); }, 'fixture-secret');
    assert.match(reseau.texte, /réseau/); assert.doesNotMatch(reseau.texte, /fixture-secret/);
});
test('Codex : compte lu sans thread créé ; processus fermé après vérification', async () => {
    const p = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { this.tue = true; } });
    const methodes = [];
    p.stdin.on('data', (d) => {
        const m = JSON.parse(d); methodes.push(m.method);
        if (m.id) queueMicrotask(() => p.stdout.write(JSON.stringify({ id: m.id, result: m.id === 2 ? { account: { type: 'chatgpt' } } : {} }) + '\n'));
    });
    assert.equal((await verifierCompteCodex(p)).pret, true);
    assert.deepEqual(methodes, ['initialize', 'initialized', 'account/read']); assert.equal(p.tue, true);
});
test('connexion guidée : configure, vérifie et reprend sans recréer le projet', async () => {
    const ancien = process.env.PERPLEXITY_API_KEY; delete process.env.PERPLEXITY_API_KEY;
    let stockee = false, verifications = 0;
    try {
        await guiderConnexion('perplexity', true, {
            verifier: async () => ({ pret: ++verifications > 1, texte: 'fixture' }),
            choisir: async () => 'cle', saisir: async (_m, _d, masque) => { assert.equal(masque, true); return 'fixture'; },
            enregistrer: (_f, cle) => { stockee = cle === 'fixture'; return true; }, oublier() {}, connecterCodex() {},
        });
        assert.equal(stockee, true); assert.equal(verifications, 2);
    } finally { if (ancien !== undefined) process.env.PERPLEXITY_API_KEY = ancien; }
});
test('connexion guidée annulée : aucune session créée ni clé enregistrée', async () => {
    await assert.rejects(guiderConnexion('codex', true, {
        verifier: async () => ({ pret: false, texte: 'Déconnecté' }), choisir: async () => 'retour',
        saisir: async () => assert.fail(), enregistrer: () => assert.fail(), oublier() {}, connecterCodex() {},
    }), { name: 'Annule' });
});

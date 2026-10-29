import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (process.platform !== 'win32' || !process.argv[2]) throw new Error('Usage : node test-installation-windows.mjs releases/<identifiant>');
const release = path.resolve(process.argv[2]);
const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-installation-test-'));
const destination = path.join(temporaire, 'Installation avec espaces'), donnees = path.join(temporaire, 'profil');
fs.mkdirSync(donnees);
const temoin = path.join(donnees, 'conversation-a-preserver.json'); fs.writeFileSync(temoin, '{"message":"à conserver"}');
const systeme = process.env.SystemRoot || 'C:\\Windows';
const env = { ...process.env, PATH: [path.join(systeme, 'System32'), path.join(systeme, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    CLAUDETOPIA_DATA_DIR: donnees, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1' };
let moteurPid;
function lancer(programme, args, options = {}) {
    const r = spawnSync(programme, args, { encoding: 'utf8', windowsHide: true, timeout: 180_000, env, ...options });
    assert.equal(r.status, 0, `${programme} : ${r.error?.message || r.stderr || r.stdout}`);
    return r.stdout;
}
try {
    console.log('Installation du vrai Setup dans un dossier isolé…');
    lancer(path.join(release, 'Agentopia-Setup.exe'), ['--destination', destination, '--sans-raccourci', '--sans-lancer']);
    const activation = () => JSON.parse(fs.readFileSync(path.join(destination, 'activation.json'), 'utf8'));
    const initiale = activation().active;
    const version = path.join(destination, 'versions', initiale);
    const { installerArchive, activerVersion, verifierPaquet, sha256 } = await import(pathToFileURL(path.join(version, 'outils', 'installation-windows.mjs')).href);
    verifierPaquet(version);
    console.log('Lancement via le raccourci de commande avec un PATH sans Node/Bun…');
    const sortie = lancer(process.env.ComSpec || path.join(systeme, 'System32', 'cmd.exe'), ['/d', '/s', '/c', `""${path.join(destination, 'Agentopia.cmd')}" --verifier-installation"`], { windowsVerbatimArguments: true });
    assert.match(sortie, /moteurs, dépendances et interface vérifiés/);
    assert.match(lancer(path.join(version, 'runtime', 'node.exe'), ['--version']), /^v(?:2[4-9]|[3-9]\d)\./);
    assert.ok(lancer(path.join(version, 'runtime', 'bun.exe'), ['--version']).trim());
    console.log('Modèle créé et relu avec le runtime embarqué…');
    const scriptModele = `const m = await import(${JSON.stringify(pathToFileURL(path.join(version, 'dist', 'modelesEquipes.js')).href)});
        const e = { mixte:true, taches:[{id:'t1',titre:'Vérifier',fournisseur:'codex',consigne:'Relire le diff',dependances:[]}] };
        const modele=m.enregistrerModeleEquipe(e,'Modèle à préserver'); console.log(JSON.stringify(m.lireModelesEquipes().find(x=>x.id===modele.id)));`;
    const modele = JSON.parse(lancer(path.join(version, 'runtime', 'node.exe'), ['--input-type=module', '-e', scriptModele]));
    assert.equal(modele.nom, 'Modèle à préserver');
    const fichierModele = path.join(donnees, 'claudetopia-modeles-equipes', `${modele.id}.json`);
    const modeleAvant = fs.readFileSync(fichierModele, 'utf8');
    console.log('Sauvegarde et récupération des équipes avec le runtime embarqué…');
    const scriptRecuperation = `import fs from 'node:fs'; import assert from 'node:assert/strict';
        process.env.AGENTOPIA_SANS_MOTEUR='1';
        const s=await import(${JSON.stringify(pathToFileURL(path.join(version, 'dist', 'stockageEquipes.js')).href)});
        const q=await import(${JSON.stringify(pathToFileURL(path.join(version, 'dist', 'equipe.js')).href)});
        const {CHEMINS}=await import(${JSON.stringify(pathToFileURL(path.join(version, 'dist', 'chemins.js')).href)});
        s.ecrireStockageEquipes([{id:'preserver',projet:process.cwd(),nomProjet:'Fixture',objectif:'Données à préserver',etat:'plan',creee:Date.now(),taches:[]}]);
        fs.writeFileSync(CHEMINS.equipes,'fichier abîmé fixture');
        assert.throws(()=>q.rechargerEquipes());
        const copie=await q.recupererEquipes(s.sauvegardeEquipes().empreinte);
        assert.equal(q.lireEquipes()[0].id,'preserver'); assert.equal(fs.readFileSync(copie,'utf8'),'fichier abîmé fixture');
        console.log(JSON.stringify([CHEMINS.equipes,s.SAUVEGARDE_EQUIPES,copie]));`;
    const fichiersEquipes = JSON.parse(lancer(path.join(version, 'runtime', 'node.exe'), ['--input-type=module', '-e', scriptRecuperation]));
    const equipesAvant = fichiersEquipes.map((f) => fs.readFileSync(f, 'utf8'));
    console.log('Moteur embarqué : survit à son lanceur et reste unique entre deux ouvertures…');
    const scriptMoteur = `const m = await import(${JSON.stringify(pathToFileURL(path.join(version, 'dist', 'moteurClient.js')).href)}); await m.assurerMoteur(); console.log(JSON.stringify(m.etatMoteur()));`;
    const demarrerMoteur = () => JSON.parse(lancer(path.join(version, 'runtime', 'node.exe'), ['--input-type=module', '-e', scriptMoteur], {
        env: { ...env, CLAUDETOPIA_TEST_UI: '0', AGENTOPIA_SANS_MOTEUR: '', AGENTOPIA_MOTEUR: '', PATH: `${path.join(version, 'runtime')};${env.PATH}` },
    }));
    const premierMoteur = demarrerMoteur(); moteurPid = premierMoteur.pid;
    assert.equal(premierMoteur.version, JSON.parse(fs.readFileSync(path.join(version, 'package.json'), 'utf8')).version);
    assert.equal(premierMoteur.actif, true); assert.ok(moteurPid);
    assert.equal(demarrerMoteur().pid, moteurPid);
    process.kill(moteurPid, 'SIGKILL'); moteurPid = undefined;
    const archive = path.join(destination, 'paquets', `${initiale}.zip`);
    const hash = fs.readFileSync(`${archive}.sha256`, 'utf8').trim();
    assert.equal(sha256(archive), hash);
    console.log('Mise à jour par le gestionnaire de l’app, puis retour à la version installée…');
    // Le réseau est simulé ; le ZIP, son contrôle et son installation sont réels.
    const nouveauId = `${initiale}-maj-fixture`, nouvelleVersion = '99.0.0';
    const zipMaj = path.join(temporaire, 'mise-a-jour.zip'); fs.copyFileSync(archive, zipMaj);
    const manifesteMaj = { ...JSON.parse(fs.readFileSync(path.join(version, 'distribution.json'), 'utf8')), id: nouveauId, version: nouvelleVersion };
    const fichierManifesteMaj = path.join(temporaire, 'manifeste-maj.json'); fs.writeFileSync(fichierManifesteMaj, JSON.stringify(manifesteMaj));
    const ps = (s) => `'${s.replaceAll("'", "''")}'`;
    const modifierZip = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open(${ps(zipMaj)},[IO.Compression.ZipArchiveMode]::Update); try { $z.GetEntry('distribution.json').Delete(); $s=New-Object IO.StreamWriter($z.CreateEntry('distribution.json').Open()); try { $s.Write([IO.File]::ReadAllText(${ps(fichierManifesteMaj)})) } finally { $s.Dispose() } } finally { $z.Dispose() }`;
    lancer('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(modifierZip, 'utf16le').toString('base64')]);
    const { maintenirDistribution } = await import('./dist/distribution.js');
    const { bus } = await import('./dist/ui/bus.js');
    const fetchAvant = globalThis.fetch, rootAvant = process.env.AGENTOPIA_DISTRIBUTION_ROOT;
    const repondre = (d) => { if (d?.type === 'choix') d.resoudre(true); };
    const tag = `agentopia-${nouvelleVersion}`, base = `https://github.com/SamChampagne/ClaudeTopia/releases/download/${tag}/`;
    const publication = { tag_name: tag, prerelease: false, assets: ['agentopia-release.json', 'Agentopia-Windows-x64.zip'].map((name) => ({ name, browser_download_url: base + name })) };
    globalThis.fetch = async (url) => url.includes('/releases?') ? Response.json([publication])
        : url.endsWith('agentopia-release.json') ? Response.json({ format: 'agentopia-release-v1', plateforme: 'win32-x64', id: nouveauId, version: nouvelleVersion, asset: 'Agentopia-Windows-x64.zip', sha256: sha256(zipMaj) })
        : new Response(fs.readFileSync(zipMaj));
    process.env.AGENTOPIA_DISTRIBUTION_ROOT = destination; bus.on('demande', repondre);
    try { await maintenirDistribution(version); }
    finally { globalThis.fetch = fetchAvant; bus.off('demande', repondre); if (rootAvant === undefined) delete process.env.AGENTOPIA_DISTRIBUTION_ROOT; else process.env.AGENTOPIA_DISTRIBUTION_ROOT = rootAvant; }
    assert.equal(activation().active, nouveauId); assert.equal(activation().precedente, initiale);
    activerVersion(destination, initiale); assert.equal(activation().active, initiale);
    console.log('Réparation depuis le paquet local puis retour à la version précédente…');
    const reparee = await installerArchive(archive, hash, { destination, reparer: true, raccourci: false });
    assert.notEqual(reparee.id, initiale); assert.equal(activation().precedente, initiale);
    assert.equal(activation().active, reparee.id);
    activerVersion(destination, activation().precedente);
    assert.equal(activation().active, initiale);
    const fichier = path.join(destination, 'versions', reparee.id, 'dist', 'index.js');
    fs.appendFileSync(fichier, '\n// corruption simulée\n');
    assert.throws(() => activerVersion(destination, reparee.id), /modifié/);
    assert.equal(activation().active, initiale);
    await assert.rejects(installerArchive(archive, '0'.repeat(64), { destination, raccourci: false }), /incomplet ou modifié/);
    assert.equal(activation().active, initiale);
    assert.equal(fs.readFileSync(temoin, 'utf8'), '{"message":"à conserver"}');
    assert.equal(fs.readFileSync(fichierModele, 'utf8'), modeleAvant);
    assert.deepEqual(fichiersEquipes.map((f) => fs.readFileSync(f, 'utf8')), equipesAvant);
    console.log('✓ Setup, runtimes inclus, interface, moteur détaché unique, réparation, retour arrière, contrôle d’intégrité et données préservées');
} finally {
    if (moteurPid) { try { process.kill(moteurPid, 'SIGKILL'); } catch {} }
    const rel = path.relative(os.tmpdir(), temporaire);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && path.basename(temporaire).startsWith('agentopia-installation-test-')) fs.rmSync(temporaire, { recursive: true, force: true });
}

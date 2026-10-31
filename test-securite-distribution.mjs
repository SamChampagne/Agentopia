import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validerCheminPaquet, verifierCheminPhysique, verifierPaquet, verifierVersionExistante, extraireArchive, activerVersion, sha256, LIMITES_PAQUET } from './outils/installation-windows.mjs';
const { obtenirDistribution, lireJsonDistribution, telechargerArchiveDistribution } = await import('./dist/telechargementDistribution.js');
const { chercherMiseAJour } = await import('./dist/versionsDistribution.js');

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-securite-distribution-'));
after(() => {
    const rel = path.relative(os.tmpdir(), racine);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true });
});
const digest = (texte) => createHash('sha256').update(texte).digest('hex');
const destination = (nom) => path.join(racine, nom);
const url = 'https://github.com/SamChampagne/Agentopia/releases/download/agentopia-9.0.0/Agentopia-Windows-x64.zip';
function paquet(nom, id = 'fixture') {
    const dossier = destination(nom);
    const fichiers = ['runtime/node.exe', 'runtime/bun.exe', 'dist/index.js', 'tui/app.tsx'].map((chemin) => {
        const f = path.join(dossier, chemin); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'fixture inerte');
        return { chemin, sha256: digest('fixture inerte') };
    });
    const manifeste = { format: 'agentopia-windows-v1', id, fichiers }, fichier = path.join(dossier, 'distribution.json');
    fs.writeFileSync(fichier, JSON.stringify(manifeste)); return { dossier, manifeste, fichier };
}
const ps = (s) => `'${s.replace(/['\u2018-\u201b]/g, (c) => c + c)}'`;
function zip(nom, entrees) {
    const archive = destination(`${nom}.zip`), donnees = destination(`${nom}.json`); fs.writeFileSync(donnees, JSON.stringify(entrees));
    const script = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';Add-Type -AssemblyName System.IO.Compression.FileSystem;$z=[IO.Compression.ZipFile]::Open(${ps(archive)},'Create');try{foreach($n in (Get-Content -LiteralPath ${ps(donnees)} -Encoding utf8 -Raw | ConvertFrom-Json)){$e=$z.CreateEntry($n.nom);if($null -ne $n.attributs){$e.ExternalAttributes=[int]$n.attributs};$w=New-Object IO.StreamWriter($e.Open());try{$w.Write([string]$n.texte)}finally{$w.Dispose()}}}finally{$z.Dispose()}`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(r.status, 0, r.stderr); return archive;
}

test('paquet : refuse traversées, alias Windows, périphériques et flux alternatifs', () => {
    for (const nom of ['../ailleurs', '.. /ailleurs', '.../ailleurs', 'C:/ailleurs', '/ailleurs', '\\serveur\\partage', 'a//b', 'a/./b', 'a\\..\\b', 'runtime/NUL.txt', 'runtime/COM¹.txt', 'CONIN$', 'aux .txt', 'runtime/file.', 'runtime/file ', 'a:stream', 'a\0b'])
        assert.throws(() => validerCheminPaquet(nom), /interdit|ambigu/);
    assert.equal(validerCheminPaquet('node_modules/@scope/lib/index.js'), 'node_modules/@scope/lib/index.js');
    assert.equal(validerCheminPaquet('répertoire/fichier.txt'), 'répertoire/fichier.txt');
});

test('hash : lecture bornée, digest inchangé et dossiers refusés avant ouverture', () => {
    const f = destination('hash.bin'), contenu = Buffer.alloc(1024 * 1024 + 11, 42); fs.writeFileSync(f, contenu);
    assert.equal(sha256(f), digest(contenu)); assert.throws(() => sha256(f, 16), /volumineux/); assert.throws(() => sha256(racine), /régulier/);
});

test('manifeste : IDs typés, doublons normalisés et taille bornée', () => {
    const p = paquet('manifeste'); assert.equal(verifierPaquet(p.dossier).id, 'fixture');
    fs.writeFileSync(p.fichier, JSON.stringify({ ...p.manifeste, id: 123 })); assert.throws(() => verifierPaquet(p.dossier), /invalide/);
    fs.writeFileSync(p.fichier, JSON.stringify({ ...p.manifeste, fichiers: [...p.manifeste.fichiers, { chemin: 'DIST/index.js', sha256: digest('fixture inerte') }] }));
    assert.throws(() => verifierPaquet(p.dossier), /dupliqué/);
    fs.truncateSync(p.fichier, LIMITES_PAQUET.manifeste + 1); assert.throws(() => verifierPaquet(p.dossier), /volumineux/);
});

test('version existante : manifeste auto-cohérent différent du paquet authentifié refusé', () => {
    const sain = paquet('sain'), altere = paquet('altere');
    verifierVersionExistante(altere.dossier, sain.dossier);
    fs.writeFileSync(path.join(altere.dossier, 'dist/index.js'), 'AUTRE CONTENU INERTE');
    altere.manifeste.fichiers.find((f) => f.chemin === 'dist/index.js').sha256 = digest('AUTRE CONTENU INERTE');
    fs.writeFileSync(altere.fichier, JSON.stringify(altere.manifeste));
    assert.equal(verifierPaquet(altere.dossier).id, 'fixture', 'les hashes internes seuls ne prouvent pas l’origine');
    assert.throws(() => verifierVersionExistante(altere.dossier, sain.dossier), /manifeste différent/);
});

test('confinement physique : jonction et lien dur ne peuvent fournir un fichier du paquet', (t) => {
    const p = paquet('liens'), hors = destination('exterieur'); fs.mkdirSync(hors);
    const jonction = path.join(p.dossier, 'redirige');
    try { fs.symlinkSync(hors, jonction, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('Création de liens interdite par le profil d’exécution'); return; } throw e; }
    assert.throws(() => verifierCheminPhysique(path.join(jonction, 'absent')), /redirigé/);
    fs.unlinkSync(jonction);
    const lien = path.join(p.dossier, 'runtime/node.exe'); fs.unlinkSync(lien);
    const externe = path.join(hors, 'runtime-inerte'); fs.writeFileSync(externe, 'fixture inerte'); fs.linkSync(externe, lien);
    assert.throws(() => verifierPaquet(p.dossier), /redirigé|spécial/);
});

test('activation : ancien reçu au type invalide ne contamine pas la nouvelle activation', () => {
    const p = paquet('activation/versions/fixture'); const root = path.dirname(path.dirname(p.dossier));
    fs.writeFileSync(path.join(root, 'activation.json'), JSON.stringify({ active: 123 }));
    assert.deepEqual(activerVersion(root, 'fixture'), { active: 'fixture', precedente: undefined });
    for (const id of [123, 'CON', 'version.', 'a'.repeat(161)]) assert.throws(() => activerVersion(root, id), /Identifiant/);
});

test('ZIP : prévalidation des noms, liens et collisions avant toute extraction', { skip: process.platform !== 'win32' }, async () => {
    const cas = [
        [{ nom: '../echappe.txt', texte: 'inerte' }], [{ nom: '.. /echappe.txt', texte: 'inerte' }],
        [{ nom: 'runtime/NUL.txt', texte: 'inerte' }], [{ nom: 'runtime/test.', texte: 'inerte' }],
        [{ nom: 'runtime/COM¹', texte: 'inerte' }], [{ nom: 'CONIN$', texte: 'inerte' }], [{ nom: 'aux .txt', texte: 'inerte' }],
        [{ nom: 'A.txt', texte: 'a' }, { nom: 'a.txt', texte: 'b' }],
        [{ nom: 'lien', texte: '../ailleurs', attributs: -1610612736 }],
    ];
    for (const [i, entrees] of cas.entries()) {
        const sortie = destination(`zip-refus-${i}`);
        await assert.rejects(extraireArchive(zip(`zip-malforme-${i}`, entrees), sortie), undefined, `entrée refusée : ${entrees[0].nom}`);
        assert.equal(fs.existsSync(sortie), false, 'aucun fichier avant validation de toutes les entrées');
    }
    assert.equal(fs.existsSync(destination('echappe.txt')), false);
});

test('ZIP : extraction normale et budgets réduits vérifiés sans gros fichiers', { skip: process.platform !== 'win32' }, async () => {
    const archive = zip("zip-'‘’‚‛-valide", [{ nom: 'a.txt', texte: 'bonjour' }, { nom: 'sub/b.txt', texte: 'salut' }]), sortie = destination("zip-'‘’‚‛-sortie");
    await extraireArchive(archive, sortie); assert.equal(fs.readFileSync(path.join(sortie, 'sub/b.txt'), 'utf8'), 'salut');
    await assert.rejects(extraireArchive(archive, destination('zip-trop-entrees'), undefined, { ...LIMITES_PAQUET, entrees: 1 }), /trop de fichiers/);
    await assert.rejects(extraireArchive(archive, destination('zip-trop-grand'), undefined, { ...LIMITES_PAQUET, fichier: 4 }), /volumineux/);
    assert.throws(() => extraireArchive(archive, sortie), /existe déjà/);
});

test('bootstrap Windows : composants bornés avant extraction, sans exécuter le contenu du ZIP', { skip: process.platform !== 'win32' }, () => {
    const compilateur = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const source = destination('TestPaquet.cs'), exe = destination('TestPaquet.exe');
    fs.writeFileSync(source, 'using System; using Agentopia.Installation; class TestPaquet { static int Main(string[] args) { try { Paquet.ExtraireComposants(args[0], args[1], long.Parse(args[2]), 100, int.Parse(args[3])); return 0; } catch (Exception e) { Console.WriteLine(e.Message); return 1; } } }');
    const compilation = spawnSync(compilateur, ['/nologo', '/target:exe', `/out:${exe}`, '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll', path.resolve('outils/installateur/Paquet.cs'), source], { encoding: 'utf8', windowsHide: true });
    assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
    const archive = zip('bootstrap', ['runtime/node.exe', 'outils/installation-windows.mjs', 'outils/installer-worker.mjs'].map((nom) => ({ nom, texte: 'INERTE' })));
    for (const [nom, runtime, entrees, code] of [['normal', 100, 10, 0], ['taille', 3, 10, 1], ['entrees', 100, 2, 1]]) {
        const sortie = destination(`bootstrap-${nom}`);
        const r = spawnSync(exe, [archive, sortie, String(runtime), String(entrees)], { encoding: 'utf8', windowsHide: true });
        assert.equal(r.status, code, r.stdout + r.stderr);
        if (code) assert.equal(fs.existsSync(sortie), false, 'aucune extraction avant validation complète');
        else assert.equal(fs.readFileSync(path.join(sortie, 'runtime/node.exe'), 'utf8'), 'INERTE');
    }
});

test('téléchargement : plafond annoncé ou réel et hash erroné ne laissent aucun fichier', async () => {
    const contenu = Buffer.from('contenu inerte'), attendu = digest(contenu);
    const correct = destination('telecharge.zip');
    await telechargerArchiveDistribution(url, correct, attendu, async () => new Response(contenu)); assert.equal(fs.readFileSync(correct, 'utf8'), contenu.toString());
    for (const [nom, reponse, hash] of [
        ['annonce', new Response(contenu, { headers: { 'content-length': '500' } }), attendu],
        ['reel', new Response(contenu), attendu], ['hash', new Response('autre'), attendu],
    ]) {
        const fichier = destination(`${nom}.zip`);
        await assert.rejects(telechargerArchiveDistribution(url, fichier, hash, async () => reponse, nom === 'hash' ? 100 : 8));
        assert.equal(fs.existsSync(fichier), false);
    }
    await assert.rejects(lireJsonDistribution(new Response(' '.repeat(20)), 10), /volumineuse/);
});

test('URL : chaque redirection est vérifiée avant requête, CDN GitHub autorisé', async () => {
    for (const cible of ['http://github.com/file', 'https://evil.example/file', 'https://user:secret@github.com/file', 'https://github.com:8443/file']) {
        const appels = []; await assert.rejects(obtenirDistribution(url, async (u, init) => {
            appels.push(u); assert.equal(init.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: cible } });
        }), /refusée/); assert.equal(appels.length, 1);
    }
    const appels = [], cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture?signature=inerte';
    const r = await obtenirDistribution(url, async (u) => { appels.push(u); return u === url ? new Response(null, { status: 302, headers: { location: cdn } }) : new Response('ok'); });
    assert.equal(await r.text(), 'ok'); assert.deepEqual(appels, [url, cdn]);
});

test('release : manifeste hostile refusé avant téléchargement du ZIP', async () => {
    const base = url.slice(0, url.lastIndexOf('/') + 1), assets = ['agentopia-release.json', 'Agentopia-Windows-x64.zip'].map((name) => ({ name, browser_download_url: base + name }));
    await assert.rejects(chercherMiseAJour('1.0.0', async (u) => u.includes('/releases?') ? Response.json([{ tag_name: 'agentopia-9.0.0', assets }])
        : Response.json({ format: 'agentopia-release-v1', plateforme: 'win32-x64', asset: 'Agentopia-Windows-x64.zip', id: '../autre', version: '9.0.0', sha256: 'a'.repeat(64) })), /invalide/);
});

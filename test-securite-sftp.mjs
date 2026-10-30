import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-securite-sftp-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
const { Sftp, cheminCopieSftp, dossierTemporaire } = await import('./dist/sftp.js');
const { EmpreinteSftpInconnue, verifierEmpreinteSftp, nomFichierSftp } = await import('./dist/confianceSftp.js');
const cle = ssh2.utils.generateKeyPairSync('ed25519').private;
const CODES = ssh2.utils.sftp.STATUS_CODE;
const contenu = Buffer.from('Fichier de test local\n');
const attrs = { mode: 0o100600, uid: 0, gid: 0, size: contenu.length, atime: 1, mtime: 1 };
async function serveur() {
    const clients = new Set(); const etat = { authentifications: 0, nom: 'normal.txt', ferme: false };
    const server = new ssh2.Server({ hostKeys: [cle] }, (client) => {
        clients.add(client); client.on('close', () => clients.delete(client)); client.on('error', () => {});
        client.on('authentication', (ctx) => {
            etat.authentifications++;
            if (ctx.method === 'password' && ctx.password === 'secret-fixture') ctx.accept(); else ctx.reject(['password']);
        });
        client.on('ready', () => client.on('session', (accepter) => accepter().on('sftp', (acc) => {
            const sftp = acc(); let lu = false;
            sftp.on('REALPATH', (id) => sftp.name(id, [{ filename: '/', longname: '', attrs }]));
            sftp.on('OPENDIR', (id) => { lu = false; sftp.handle(id, Buffer.from('dir')); });
            sftp.on('READDIR', (id) => { if (lu) return sftp.status(id, CODES.EOF); lu = true; sftp.name(id, [{ filename: etat.nom, longname: '', attrs }]); });
            sftp.on('OPEN', (id, p) => p === '/absent' ? sftp.status(id, CODES.NO_SUCH_FILE) : sftp.handle(id, Buffer.from('file')));
            sftp.on('FSTAT', (id) => sftp.attrs(id, attrs));
            sftp.on('STAT', (id) => sftp.attrs(id, attrs));
            sftp.on('READ', (id, h, off, len) => off >= contenu.length ? sftp.status(id, CODES.EOF) : sftp.data(id, contenu.subarray(off, off + len)));
            sftp.on('CLOSE', (id) => sftp.status(id, CODES.OK));
        })));
    });
    await new Promise((ok, ko) => { server.once('error', ko); server.listen(0, '127.0.0.1', ok); });
    const cible = { nom: 'Fixture', hote: '127.0.0.1', port: server.address().port, utilisateur: 'fixture', auth: 'motdepasse' };
    const fichier = path.join(racine, `empreintes-${cible.port}.json`);
    const sessions = [];
    return { etat, cible, fichier,
        client: () => { const s = new Sftp(cible, { lireSecret: () => 'secret-fixture', fichierEmpreintes: fichier }); sessions.push(s); return s; },
        fermer: async () => { sessions.forEach((s) => s.fermer()); clients.forEach((c) => c.end()); await new Promise((ok) => server.close(ok)); },
    };
}
async function inconnue(f) {
    const s = f.client(); let erreur;
    await assert.rejects(s.connecter(), (e) => { erreur = e; return e instanceof EmpreinteSftpInconnue; }); s.fermer(); return erreur;
}
after(() => {
    const r = path.relative(os.tmpdir(), racine);
    assert.ok(r && !r.startsWith('..') && !path.isAbsolute(r));
    fs.rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('vrai serveur : clé inconnue refusée avant authentification, consentement exact puis reconnexion', async () => {
    const f = await serveur();
    try {
        const proposition = await inconnue(f);
        assert.equal(f.etat.authentifications, 0); assert.equal(fs.existsSync(f.fichier), false);
        assert.match(proposition.empreinte, /^SHA256:[A-Za-z0-9+/]{43}$/);
        const s = f.client(); await s.connecter({ empreinteAcceptee: proposition.empreinte });
        assert.ok(f.etat.authentifications > 0); assert.equal(await s.reel('.'), '/');
        assert.equal(JSON.parse(fs.readFileSync(f.fichier))[proposition.serveur], proposition.empreinte);
        const autre = f.client(); await autre.connecter(); assert.equal(autre.nouvelleEmpreinte, undefined);
    } finally { await f.fermer(); }
});

test('vrai serveur : clé différente de celle acceptée refusée sans secret ni écriture', async () => {
    const f = await serveur();
    try {
        await assert.rejects(f.client().connecter({ empreinteAcceptee: 'SHA256:' + 'A'.repeat(43) }), /changé depuis/);
        assert.equal(f.etat.authentifications, 0); assert.equal(fs.existsSync(f.fichier), false);
    } finally { await f.fermer(); }
});

test('vrai serveur : clé enregistrée changée ou fichier corrompu restent refusés et préservés', async () => {
    const f = await serveur();
    try {
        for (const texte of [JSON.stringify({ [`127.0.0.1:${f.cible.port}`]: 'SHA256:' + 'B'.repeat(43) }), '{corrompu', '[]']) {
            fs.writeFileSync(f.fichier, texte);
            await assert.rejects(f.client().connecter(), /empreinte/i);
            assert.equal(fs.readFileSync(f.fichier, 'utf8'), texte); assert.equal(f.etat.authentifications, 0);
        }
    } finally { await f.fermer(); }
});

test('consentement concurrent : une empreinte déjà enregistrée ne peut pas être remplacée', () => {
    const fichier = path.join(racine, 'concurrent.json'), a = 'SHA256:' + 'C'.repeat(43), b = 'SHA256:' + 'D'.repeat(43);
    assert.equal(verifierEmpreinteSftp(fichier, 'serveur:22', a, a), true);
    assert.throws(() => verifierEmpreinteSftp(fichier, 'serveur:22', b, b), /changé/);
    assert.equal(JSON.parse(fs.readFileSync(fichier))['serveur:22'], a);
});

test('vrai SFTP : noms distants refusés, téléchargement sans écrasement et échec nettoyé', async () => {
    const f = await serveur();
    try {
        const p = await inconnue(f), s = f.client(); await s.connecter({ empreinteAcceptee: p.empreinte });
        assert.equal((await s.lister('/'))[0].nom, 'normal.txt');
        f.etat.nom = '..\\hors.txt'; await assert.rejects(s.lister('/'), /dangereux/);
        const local = path.join(racine, 'telecharge.txt'); await s.telecharger('/normal.txt', local);
        assert.deepEqual(fs.readFileSync(local), contenu);
        await assert.rejects(s.telecharger('/normal.txt', local), /existe déjà/); assert.deepEqual(fs.readFileSync(local), contenu);
        const absent = path.join(racine, 'incomplet.txt'); await assert.rejects(s.telecharger('/absent', absent), /introuvable/);
        assert.equal(fs.existsSync(absent), false);
    } finally { await f.fermer(); }
});

test('chemins SFTP : noms Windows dangereux refusés et copies locales isolées du chemin distant', () => {
    for (const nom of ['..', '.', '../x', '..\\x', 'C:x', 'NUL', 'aux.txt', 'aux .txt', 'COM¹.txt', 'CONIN$', 'a.', 'a ', 'a\n', 'x:y']) assert.throws(() => nomFichierSftp(nom));
    assert.equal(nomFichierSftp('rapport été.txt'), 'rapport été.txt');
    const a = cheminCopieSftp('../serveur', '/../../rapport.txt'), b = cheminCopieSftp('../serveur', '/../../rapport.txt');
    assert.notEqual(a, b); assert.equal(path.basename(a), 'rapport.txt');
    assert.ok(!path.relative(dossierTemporaire('../serveur'), a).startsWith('..'));
});

// Tests SSH / SFTP sans toucher à ~/.ssh/config ni à aucun vrai serveur :
//  1. modification d'un fichier config de test (le reste du fichier doit rester intact)
//  2. serveur SFTP local jetable (ssh2) : mot de passe, liste, envoi, téléchargement, dossier, suppression, empreinte
import fs from 'fs';
import os from 'os';
import path from 'path';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-test-'));
const configTest = path.join(dossier, 'config');
fs.writeFileSync(configTest, '# mes réglages\nHost prod\n    HostName 10.0.0.5\n    User admin\n\nHost *\n    ServerAliveInterval 30\n');
process.env.CLAUDETOPIA_SSH_CONFIG = configTest;
const ssh = await import('./dist/sshConfig.js');
const ok = (cond, msg) => console.log(`${cond ? '✓' : '✗'} ${msg}`);

ssh.enregistrerHote({ alias: 'dev', hote: 'dev.local', utilisateur: 'sam', port: 2222 });
let t = fs.readFileSync(configTest, 'utf-8');
ok(t.indexOf('Host dev') < t.indexOf('Host *'), 'nouveau serveur ajouté avant « Host * »');
ok(t.includes('# mes réglages') && t.includes('ServerAliveInterval 30') && t.includes('HostName 10.0.0.5'), 'reste du fichier intact');
ssh.enregistrerHote({ alias: 'dev2', hote: 'dev.local', utilisateur: 'sam' }, 'dev');
t = fs.readFileSync(configTest, 'utf-8');
ok(t.includes('Host dev2') && !/Host dev\n/.test(t) && !t.includes('Port 2222'), 'serveur renommé et modifié');
ok(ssh.supprimerHote('prod') && !fs.readFileSync(configTest, 'utf-8').includes('10.0.0.5'), 'serveur supprimé');
ok(ssh.lireHotes().map((h) => h.alias).join(',') === 'dev2', 'lecture : ' + ssh.lireHotes().map((h) => h.alias).join(','));

// ─── Serveur SFTP local ───
const { Server, utils } = (await import('ssh2')).default;
const racine = path.join(dossier, 'serveur');
fs.mkdirSync(path.join(racine, 'www'), { recursive: true });
fs.writeFileSync(path.join(racine, 'www', 'index.php'), '<?php echo "ok";');
const cleHote = utils.generateKeyPairSync('ed25519').private;
const CODES = utils.sftp.STATUS_CODE;
const serveur = new Server({ hostKeys: [cleHote] }, (client) => {
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.username === 'sam' && ctx.password === 'secret' ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () => client.on('session', (accepter) => accepter().on('sftp', (acc) => {
        const sftp = acc();
        const local = (p) => path.join(racine, p.replace(/^\/+/, ''));
        const poignees = new Map();
        let n = 0;
        const attrs = (st) => ({ mode: st.mode, uid: 0, gid: 0, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
        const etat = (id, p) => (fs.existsSync(local(p)) ? sftp.attrs(id, attrs(fs.statSync(local(p)))) : sftp.status(id, CODES.NO_SUCH_FILE));
        sftp.on('REALPATH', (id, p) => sftp.name(id, [{ filename: p === '.' ? '/' : path.posix.normalize(p), longname: '', attrs: {} }]));
        sftp.on('STAT', etat);
        sftp.on('LSTAT', etat);
        sftp.on('OPENDIR', (id, p) => {
            const h = Buffer.from(String(++n));
            poignees.set(h.toString(), { dir: local(p), lu: false });
            sftp.handle(id, h);
        });
        sftp.on('READDIR', (id, h) => {
            const x = poignees.get(h.toString());
            if (x.lu) return sftp.status(id, CODES.EOF);
            x.lu = true;
            sftp.name(id, fs.readdirSync(x.dir).map((f) => ({ filename: f, longname: f, attrs: attrs(fs.statSync(path.join(x.dir, f))) })));
        });
        sftp.on('OPEN', (id, p, flags) => {
            const h = Buffer.from(String(++n));
            poignees.set(h.toString(), { fd: fs.openSync(local(p), flags & 2 ? 'w' : 'r') });
            sftp.handle(id, h);
        });
        sftp.on('READ', (id, h, off, len) => {
            const b = Buffer.alloc(len);
            const lus = fs.readSync(poignees.get(h.toString()).fd, b, 0, len, off);
            return lus ? sftp.data(id, b.subarray(0, lus)) : sftp.status(id, CODES.EOF);
        });
        sftp.on('WRITE', (id, h, off, data) => {
            fs.writeSync(poignees.get(h.toString()).fd, data, 0, data.length, off);
            sftp.status(id, CODES.OK);
        });
        sftp.on('FSTAT', (id, h) => sftp.attrs(id, attrs(fs.fstatSync(poignees.get(h.toString()).fd))));
        sftp.on('CLOSE', (id, h) => {
            const x = poignees.get(h.toString());
            if (x?.fd !== undefined) fs.closeSync(x.fd);
            poignees.delete(h.toString());
            sftp.status(id, CODES.OK);
        });
        sftp.on('MKDIR', (id, p) => (fs.mkdirSync(local(p)), sftp.status(id, CODES.OK)));
        sftp.on('REMOVE', (id, p) => (fs.rmSync(local(p)), sftp.status(id, CODES.OK)));
        sftp.on('RMDIR', (id, p) => (fs.rmdirSync(local(p)), sftp.status(id, CODES.OK)));
    })));
}).listen(0, '127.0.0.1');
await new Promise((r) => serveur.on('listening', r));
const port = serveur.address().port;

const { enregistrerSecret, oublierSecret } = await import('./dist/jetons.js');
const { Sftp, cleSecret } = await import('./dist/sftp.js');
const { CHEMINS } = await import('./dist/chemins.js');
const cible = { nom: 'test-local', hote: '127.0.0.1', port, utilisateur: 'sam', auth: 'motdepasse' };
ok(enregistrerSecret(cleSecret('test-local'), 'secret'), 'mot de passe chiffré (DPAPI)');
const s = new Sftp(cible);
await s.connecter();
ok(!!s.nouvelleEmpreinte, `connexion par mot de passe · empreinte enregistrée ${s.nouvelleEmpreinte?.slice(0, 20)}…`);
ok((await s.lister('/www')).some((e) => e.nom === 'index.php'), 'liste du dossier /www');
const copie = path.join(dossier, 'copie.php');
await s.telecharger('/www/index.php', copie);
ok(fs.readFileSync(copie, 'utf-8').includes('echo'), 'téléchargement');
fs.writeFileSync(path.join(dossier, 'nouveau.txt'), 'bonjour');
await s.envoyer(path.join(dossier, 'nouveau.txt'), '/www/nouveau.txt');
ok(fs.readFileSync(path.join(racine, 'www', 'nouveau.txt'), 'utf-8') === 'bonjour', 'envoi');
await s.creerDossier('/www/images');
ok(fs.existsSync(path.join(racine, 'www', 'images')), 'création de dossier');
await s.supprimer('/www/nouveau.txt', false);
ok(!fs.existsSync(path.join(racine, 'www', 'nouveau.txt')), 'suppression');
s.fermer();

// Mauvais mot de passe : message clair
enregistrerSecret(cleSecret('test-local'), 'faux');
try {
    await new Sftp(cible).connecter();
    ok(false, 'mauvais mot de passe refusé');
} catch (e) {
    ok(/refusé/.test(e.message), `mauvais mot de passe : « ${e.message} »`);
}

// Empreinte qui change (serveur « réinstallé » ou usurpé) : refus
const emp = JSON.parse(fs.readFileSync(CHEMINS.sftpEmpreintes, 'utf-8'));
emp[`127.0.0.1:${port}`] = 'SHA256:autre';
fs.writeFileSync(CHEMINS.sftpEmpreintes, JSON.stringify(emp));
enregistrerSecret(cleSecret('test-local'), 'secret');
try {
    await new Sftp(cible).connecter();
    ok(false, 'empreinte changée refusée');
} catch (e) {
    ok(/empreinte/.test(e.message), 'empreinte changée : connexion refusée');
}

// Nettoyage
delete emp[`127.0.0.1:${port}`];
fs.writeFileSync(CHEMINS.sftpEmpreintes, JSON.stringify(emp, null, 2));
oublierSecret(cleSecret('test-local'));
serveur.close();
fs.rmSync(dossier, { recursive: true, force: true });
process.exit(0);

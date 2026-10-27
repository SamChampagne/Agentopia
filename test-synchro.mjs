// Test de la synchro git en direct sur un dépôt jetable
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { demarrerSynchro, lireSynchro, depotDe, synchro } from './dist/synchro.js';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'synchro-'));
const git = (cmd) => execSync(`git -c user.name=t -c user.email=t@t ${cmd}`, { cwd: dossier, stdio: 'pipe' });
git('init -q -b main');
fs.writeFileSync(path.join(dossier, 'a.txt'), 'un');
git('add .');
git('commit -qm init');

const projet = { nom: 'jetable', chemin: dossier, racine: os.tmpdir() };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
// Attend que la condition devienne vraie ; renvoie le délai mesuré
const attendreQue = async (cond, max = 8000) => {
    const t = Date.now();
    while (Date.now() - t < max) {
        if (cond()) return Date.now() - t;
        await new Promise((r) => synchro.once('maj', r) && setTimeout(r, 200));
    }
    return -1;
};

let t = Date.now();
demarrerSynchro([projet]);
console.log('chargement initial :', await attendreQue(() => lireSynchro().pret), 'ms · modifs =', depotDe(dossier)?.modifs);

fs.writeFileSync(path.join(dossier, 'a.txt'), 'deux');
fs.writeFileSync(path.join(dossier, 'b.txt'), 'nouveau');
console.log('2 fichiers modifiés détectés en', await attendreQue(() => depotDe(dossier)?.modifs === 2), 'ms');

git('add .');
git('commit -qm "deuxième"');
console.log('commit détecté (0 modif, nouveau sujet) en', await attendreQue(() => depotDe(dossier)?.modifs === 0 && depotDe(dossier)?.dernierCommit?.sujet === 'deuxième'), 'ms');

git('checkout -q -b feature/test');
console.log('changement de branche détecté en', await attendreQue(() => depotDe(dossier)?.branche === 'feature/test'), 'ms');
process.exit(0);

// Processus de test uniquement : aucun adaptateur réel, aucun réseau.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { lireIntegree, sauverIntegree, dossierIntegre } from '../dist/sessionsIntegrees.js';

const root = process.env.CLAUDETOPIA_DATA_DIR;
if (!root?.includes('agentopia-moteur-test-')) throw new Error('Données de test requises');
if (process.argv[2] === 'worker') {
    const s = lireIntegree(process.argv[3]);
    while (s.titre.includes('Attendre') && !fs.existsSync(path.join(root, `${s.id}.liberer`))) {
        if (fs.existsSync(path.join(dossierIntegre(s.id), 'arret'))) {
            s.etat = 'arretee'; s.issue = 'cancelled'; s.pid = undefined; sauverIntegree(s); process.exit(0);
        }
        sauverIntegree(s); await pause(100);
    }
    s.etat = 'attend'; s.issue = 'success'; s.resultat = `Résultat de ${s.titre}`; s.pid = undefined; sauverIntegree(s);
} else if (process.argv[2] === 'ancien') {
    const { DOSSIER_MOTEUR } = await import('../dist/moteurClient.js');
    const { prendreVerrou } = await import('../dist/verrou.js');
    const { ecrireAtomique } = await import('../dist/sessionsIntegrees.js');
    const liberer = prendreVerrou(path.join(DOSSIER_MOTEUR, 'instance'));
    if (!liberer) throw new Error('Moteur fixture déjà présent');
    const battre = () => ecrireAtomique(path.join(DOSSIER_MOTEUR, 'etat.json'), { pid: process.pid, date: Date.now(), version: '1.1.0' });
    battre(); const timer = setInterval(battre, 100);
    process.once('SIGTERM', () => { clearInterval(timer); liberer(); });
} else {
    const { executerMoteur } = await import('../dist/moteur.js');
    await executerMoteur({ intervalle: 75, async envoyer(id, prompt) {
        const s = lireIntegree(id); s.etat = 'travaille'; s.tour = 'fixture'; s.issue = undefined; s.erreur = undefined;
        fs.rmSync(path.join(dossierIntegre(id), 'arret'), { force: true }); sauverIntegree(s);
        fs.appendFileSync(path.join(root, 'lancements.jsonl'), JSON.stringify({ id, prompt }) + '\n');
        const enfant = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', id], { env: process.env, detached: true, windowsHide: true, stdio: 'ignore' });
        await new Promise((ok, ko) => { enfant.once('spawn', ok); enfant.once('error', ko); });
        s.pid = enfant.pid; sauverIntegree(s); enfant.unref();
    } });
}

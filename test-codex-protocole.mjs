// Diagnostic facultatif du vrai CLI : aucun thread créé et aucun appel à un modèle.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { binaireCodex } from './dist/providers/config.js';

const binaire = binaireCodex();
if (!binaire) throw new Error('Codex CLI introuvable dans PATH');
const proc = spawn(binaire, ['app-server'], { stdio: 'pipe', windowsHide: true });
const lignes = createInterface({ input: proc.stdout });
const attentes = new Map(); let seq = 0;
const envoyer = (m) => proc.stdin.write(JSON.stringify(m) + '\n');
const demander = (method, params) => new Promise((ok, ko) => {
    const id = ++seq;
    const timer = setTimeout(() => { attentes.delete(id); ko(new Error(`Délai : ${method}`)); }, 20_000);
    attentes.set(id, { ok, ko, timer }); envoyer({ id, method, params });
});
const echec = (erreur) => { for (const a of attentes.values()) { clearTimeout(a.timer); a.ko(erreur); } attentes.clear(); };
proc.on('error', echec); proc.on('exit', () => echec(new Error('app-server fermé')));
proc.stdin.on('error', echec); proc.stderr.resume();
lignes.on('line', (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    const a = attentes.get(m.id); if (!a) return;
    clearTimeout(a.timer); attentes.delete(m.id);
    m.error ? a.ko(new Error(m.error.message)) : a.ok(m.result);
});
try {
    await demander('initialize', { clientInfo: { name: 'agentopia_diagnostic', version: '1.0.0' } });
    envoyer({ method: 'initialized' });
    const r = await demander('account/read', { refreshToken: false });
    const historique = await demander('thread/list', { limit: 1, sortKey: 'updated_at', sourceKinds: ['cli', 'vscode', 'appServer', 'exec'], cwd: process.cwd() });
    if (!Array.isArray(historique.data)) throw new Error('Historique Codex incompatible');
    // Ne jamais afficher l'identité, les jetons ou la réponse brute.
    process.stdout.write(`✓ Codex app-server : compte ${r.account ? 'connecté' : 'non connecté'} · inventaire natif opérationnel · aucun modèle appelé\n`);
} finally { lignes.close(); proc.stdin.end(); proc.kill(); }

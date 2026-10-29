import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { uptime } from 'node:os';

export const demarragePoste = () => Date.now() - uptime() * 1000;

export function processusVivant(pid: number, demarrage?: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (demarrage && Math.abs(demarrage - demarragePoste()) >= 10_000) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
// mkdir est atomique entre fenêtres. Un processus vivant conserve toujours son verrou.
export function prendreVerrou(dossier: string): (() => void) | undefined {
    fs.mkdirSync(path.dirname(dossier), { recursive: true });
    const proprietaire = path.join(dossier, 'proprietaire.json');
    const perime = () => {
        try {
            const p = JSON.parse(fs.readFileSync(proprietaire, 'utf8'));
            return !processusVivant(p.pid, p.demarragePoste);
        } catch {
            try { return Date.now() - fs.statSync(dossier).birthtimeMs >= 30_000; } catch { return false; }
        }
    };
    try { fs.mkdirSync(dossier); }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        if (!perime()) return;
        const reprise = path.join(dossier, 'recuperation');
        try { if (Date.now() - fs.statSync(reprise).mtimeMs > 30_000) fs.rmdirSync(reprise); } catch { /* Absente ou encore utilisée. */ }
        try { fs.mkdirSync(reprise); } catch { return; }
        let recuperable = false;
        try {
            // Revalider sous le verrou de récupération : une autre fenêtre a pu le reprendre.
            if (!perime()) return;
            fs.rmSync(proprietaire, { force: true }); recuperable = true;
        } catch { return;
        } finally { try { fs.rmdirSync(reprise); } catch { /* Un autre nettoyage l'a retiré. */ } }
        if (!recuperable) return;
        try { fs.rmdirSync(dossier); } catch { return; }
        try { fs.mkdirSync(dossier); } catch { return; }
    }
    const token = randomUUID();
    fs.writeFileSync(proprietaire, JSON.stringify({ pid: process.pid, token, demarragePoste: demarragePoste() }));
    return () => {
        try { if (JSON.parse(fs.readFileSync(proprietaire, 'utf8')).token !== token) return; fs.unlinkSync(proprietaire); fs.rmdirSync(dossier); } catch { /* Déjà libéré. */ }
    };
}

export function sousVerrou<T>(dossier: string, fn: () => T): T {
    let liberer = prendreVerrou(dossier);
    for (let i = 0; !liberer && i < 10; i++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); liberer = prendreVerrou(dossier); }
    if (!liberer) throw new Error('Une autre opération est en cours. Réessaie dans un instant.');
    try { return fn(); } finally { liberer(); }
}

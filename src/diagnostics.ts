import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { VERSION_AGENTOPIA } from './version.js';

const MAX_FICHIER = 256 * 1024;
const DOSSIER = `${CHEMINS.trace}-diagnostics`;
const lancement = `${Date.now()}-${process.pid}`;
const fichier = path.join(DOSSIER, `${lancement}.jsonl`);
export interface Diagnostic { date: number; version: string; operation: string; code: string; correlation?: string }
const operationSure = (s: string) => /^[a-z][a-z0-9_.-]{0,79}$/.test(s) ? s : 'operation';
function codeErreur(erreur?: unknown): string {
    if (erreur === undefined) return 'OK';
    const e = erreur as { code?: unknown; name?: unknown; message?: unknown };
    const code = typeof e?.code === 'string' ? e.code : '';
    if (/^(E[A-Z0-9_]{2,40}|ERR_[A-Z0-9_]{1,50})$/.test(code)) return code;
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return e.name;
    const message = typeof e?.message === 'string' ? e.message : '';
    if (/time.?out|trop long|délai/i.test(message)) return 'TIMEOUT';
    if (/permission|accès refusé|access denied/i.test(message)) return 'ACCESS_DENIED';
    if (/corrompu|invalid|json/i.test(message)) return 'INVALID_DATA';
    return 'ERROR';
}
function dossierSur(): boolean {
    fs.mkdirSync(DOSSIER, { recursive: true });
    return !fs.lstatSync(DOSSIER).isSymbolicLink() && fs.realpathSync(DOSSIER).toLowerCase() === path.resolve(DOSSIER).toLowerCase();
}
/** Journal volontairement structuré : aucun texte libre, chemin, prompt, clé ou trace SDK. */
export function journaliserDiagnostic(operation: string, erreur?: unknown, correlation?: string): void {
    try {
        if (!dossierSur()) return;
        const d: Diagnostic = { date: Date.now(), version: VERSION_AGENTOPIA, operation: operationSure(operation), code: codeErreur(erreur),
            ...(correlation ? { correlation: createHash('sha256').update(correlation).digest('hex').slice(0, 16) } : {}) };
        try { const s = fs.lstatSync(fichier); if (!s.isFile() || s.isSymbolicLink() || s.nlink > 1 || s.size > MAX_FICHIER) return; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return; }
        fs.appendFileSync(fichier, JSON.stringify(d) + '\n', { mode: 0o600 });
        const anciens = fs.readdirSync(DOSSIER).filter((n) => /^\d+-\d+\.jsonl$/.test(n)).sort().reverse().slice(20);
        for (const nom of anciens) { const cible = path.join(DOSSIER, nom); if (fs.lstatSync(cible).isFile() && !fs.lstatSync(cible).isSymbolicLink()) fs.unlinkSync(cible); }
    } catch { /* Le diagnostic ne doit jamais provoquer un second incident. */ }
}
export function lireDiagnostics(): Diagnostic[] {
    const resultats: Diagnostic[] = [];
    try {
        if (!fs.existsSync(DOSSIER) || !dossierSur()) return [];
        for (const nom of fs.readdirSync(DOSSIER).filter((n) => /^\d+-\d+\.jsonl$/.test(n)).sort().reverse().slice(0, 20)) {
            const p = path.join(DOSSIER, nom), s = fs.lstatSync(p);
            if (!s.isFile() || s.isSymbolicLink() || s.nlink > 1 || s.size > MAX_FICHIER + 1000) continue;
            for (const ligne of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-200)) {
                try {
                    const d = JSON.parse(ligne);
                    if (Number.isFinite(d.date) && /^[\d.a-z-]{1,60}$/i.test(d.version) && operationSure(d.operation) === d.operation
                        && /^(OK|ERROR|TIMEOUT|ACCESS_DENIED|INVALID_DATA|AbortError|TimeoutError|E[A-Z0-9_]{2,50})$/.test(d.code))
                        resultats.push({ date: d.date, version: d.version, operation: d.operation, code: d.code,
                            ...(/^[a-f0-9]{16}$/.test(d.correlation) ? { correlation: d.correlation } : {}) });
                } catch { /* Une ligne incomplète après crash n'empêche pas la lecture. */ }
            }
        }
    } catch { /* Rapport minimal toujours disponible. */ }
    return resultats.sort((a, b) => b.date - a.date).slice(0, 200);
}
export function rapportDiagnostic(etat: { actif: boolean; enPause?: boolean; version?: string } = { actif: false }) {
    return { format: 'agentopia-diagnostic-v1', cree: new Date().toISOString(), version: VERSION_AGENTOPIA,
        systeme: { plateforme: process.platform, architecture: process.arch, node: process.versions.node, bun: process.versions.bun },
        moteur: { actif: !!etat.actif, enPause: !!etat.enPause, version: /^[\d.a-z-]{1,60}$/i.test(etat.version || '') ? etat.version : undefined },
        exclusions: ['conversations', 'commandes utilisateur', 'fichiers projet', 'chemins personnels', 'secrets', 'traces SDK brutes'],
        evenements: lireDiagnostics() };
}
let installe = false;
export function installerDiagnostics(): void {
    if (installe) return; installe = true;
    journaliserDiagnostic('application.demarrage');
    // Monitor conserve le comportement fatal normal de Node, sans avaler l'exception.
    process.on('uncaughtExceptionMonitor', (e) => journaliserDiagnostic('application.exception', e));
}

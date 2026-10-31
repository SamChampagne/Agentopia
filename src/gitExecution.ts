import { spawn, type ChildProcess } from 'node:child_process';
import { citerPowerShell } from './lancementsWindows.js';
import { surPath } from './chemins.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { argumentsGitCompte } from './authGitReseau.js';

export interface OptionsExecution { signal?: AbortSignal; timeoutMs?: number; maxOctets?: number; progression?: (texte: string) => void }
export interface ResultatExecution { ok: boolean; sortie: string; code: number | null }
const operations = new Set<AbortController>();
const contexte = new AsyncLocalStorage<AbortSignal>();
export function dansOperationGit<T>(signal: AbortSignal, action: () => T): T { return contexte.run(signal, action); }
/** Annule uniquement les processus créés par ce module, jamais un PID lu sur disque. */
export function annulerOperationsGit(): void { for (const c of operations) c.abort(); }
export async function executerProcessus(programme: string, args: string[], cwd: string, options: OptionsExecution = {}): Promise<ResultatExecution> {
    const control = new AbortController(); operations.add(control);
    const externe = options.signal || contexte.getStore();
    const signal = externe ? AbortSignal.any([externe, control.signal]) : control.signal;
    try {
        signal.throwIfAborted();
        return await new Promise<ResultatExecution>((resolve, reject) => {
            let fini = false, sorti = false, interrompu = false, sortie = '', octets = 0;
            let enfant: ChildProcess;
            if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(programme)) {
                const texte = `& ${citerPowerShell(programme)} ${args.map(citerPowerShell).join(' ')}; exit $LASTEXITCODE`;
                enfant = spawn(surPath('powershell.exe') || 'powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(texte, 'utf16le').toString('base64')], { cwd, windowsHide: true, stdio: 'pipe', env: { ...process.env, CI: '1', GIT_TERMINAL_PROMPT: '0' } });
            } else enfant = spawn(programme, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe', env: { ...process.env, CI: '1', GIT_TERMINAL_PROMPT: '0' } });
            const finir = (err?: Error, code: number | null = null) => {
                if (fini) return; fini = true; clearTimeout(timer); signal.removeEventListener('abort', annuler);
                enfant.stdin?.destroy(); enfant.stdout?.destroy(); enfant.stderr?.destroy(); enfant.unref();
                if (err) reject(err); else resolve({ ok: code === 0, code, sortie: sortie.trim() });
            };
            const arreter = (raison: string) => {
                if (fini || interrompu) return; interrompu = true;
                if (!enfant.pid || sorti) { finir(new Error(`${raison}. Les fichiers sont conservés ; arrêt des éventuels descendants non confirmé.`)); return; }
                if (process.platform !== 'win32') {
                    try { process.kill(-enfant.pid, 'SIGKILL'); finir(new Error(`${raison}. Opération interrompue ; fichiers conservés.`)); }
                    catch { finir(new Error(`${raison}. Arrêt non confirmé ; vérifie le processus ${enfant.pid}.`)); }
                    return;
                }
                const kill = spawn('taskkill.exe', ['/PID', String(enfant.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                const borne = setTimeout(() => { kill.kill(); finir(new Error(`${raison}. Arrêt non confirmé ; vérifie le processus ${enfant.pid}.`)); }, 5000);
                kill.once('error', () => { clearTimeout(borne); finir(new Error(`${raison}. Arrêt non confirmé ; vérifie le processus ${enfant.pid}.`)); });
                kill.once('exit', (code) => { clearTimeout(borne); finir(new Error(`${raison}. ${code === 0 ? 'Opération interrompue ; fichiers conservés.' : `Arrêt non confirmé ; vérifie le processus ${enfant.pid}.`}`)); });
            };
            const annuler = () => arreter('Opération annulée');
            const timer = setTimeout(() => arreter('Durée maximale atteinte'), options.timeoutMs ?? 30_000);
            signal.addEventListener('abort', annuler, { once: true });
            const lire = (b: Buffer) => {
                octets += b.length;
                if (octets > (options.maxOctets ?? 2 * 1024 * 1024)) { arreter('Sortie maximale atteinte'); return; }
                const texte = b.toString('utf8'); sortie += texte;
                try { options.progression?.(texte); }
                catch { arreter('Écriture du journal impossible'); }
            };
            enfant.stdout?.on('data', lire); enfant.stderr?.on('data', lire);
            enfant.once('error', (e) => finir(e)); enfant.once('exit', () => { sorti = true; });
            enfant.once('close', (code) => { if (!interrompu) finir(undefined, code); });
            if (signal.aborted) annuler();
        });
    } finally { operations.delete(control); }
}
export function gitExecution(args: string[], cwd: string, options: OptionsExecution = {}): Promise<ResultatExecution> {
    return executerProcessus('git', argumentsGitCompte(args), cwd, options);
}
export async function gitVerifieAsync(args: string[], cwd: string, options: OptionsExecution = {}): Promise<string> {
    const r = await gitExecution(args, cwd, options);
    if (!r.ok) throw new Error(r.sortie || `Git a échoué (code ${r.code})`);
    return r.sortie;
}
export async function creerWorktreeIsole(p: { depot: string; base: string; branche: string; dossier: string; signal?: AbortSignal }): Promise<void> {
    await gitVerifieAsync(['worktree', 'add', '-b', p.branche, p.dossier, p.base], p.depot, { signal: p.signal, timeoutMs: 120_000 });
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { binaireCodex } from './config.js';

export class CodexRpc {
    private proc: ChildProcessWithoutNullStreams;
    private lignes;
    private seq = 0;
    private fermee?: Error;
    private attentes = new Map<number, { ok(v: any): void; ko(e: Error): void; timer: NodeJS.Timeout }>();
    constructor(transport?: ChildProcessWithoutNullStreams, private delai = 20_000) {
        const binaire = binaireCodex();
        if (!binaire && !transport) throw new Error('Codex CLI est introuvable');
        this.proc = transport ?? spawn(binaire!, ['app-server'], { stdio: 'pipe', windowsHide: true });
        this.lignes = createInterface({ input: this.proc.stdout });
        this.proc.stderr.resume();
        const echec = () => this.rejeter(new Error('Connexion à Codex interrompue'));
        this.proc.once('error', echec); this.proc.once('exit', echec); this.proc.stdin.on('error', echec);
        this.lignes.on('line', (l) => {
            let m: any; try { m = JSON.parse(l); } catch { return; }
            if (m.method && m.id !== undefined) { this.ecrire({ id: m.id, error: { code: -32601, message: 'Consultation uniquement' } }); return; }
            const a = this.attentes.get(m.id); if (!a) return;
            clearTimeout(a.timer); this.attentes.delete(m.id);
            m.error ? a.ko(new Error(String(m.error.message || 'Erreur Codex'))) : a.ok(m.result);
        });
    }
    private ecrire(m: unknown) { if (!this.proc.stdin.destroyed) this.proc.stdin.write(JSON.stringify(m) + '\n'); }
    private rejeter(e: Error) { this.fermee = e; for (const a of this.attentes.values()) { clearTimeout(a.timer); a.ko(e); } this.attentes.clear(); }
    async initialiser() {
        await this.demander('initialize', { clientInfo: { name: 'agentopia', version: '1.0.0' } });
        this.ecrire({ method: 'initialized' });
    }
    demander(method: string, params: unknown = {}): Promise<any> {
        if (this.fermee) return Promise.reject(this.fermee);
        return new Promise((ok, ko) => {
            const id = ++this.seq;
            const timer = setTimeout(() => { this.attentes.delete(id); ko(new Error(`Codex ne répond pas à ${method}`)); }, this.delai);
            this.attentes.set(id, { ok, ko, timer }); this.ecrire({ id, method, params });
        });
    }
    fermer() { this.rejeter(new Error('Connexion fermée')); this.lignes.close(); this.proc.stdin.end(); this.proc.kill(); }
}

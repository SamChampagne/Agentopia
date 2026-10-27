import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

export interface Processus {
    pid: number;
    ppid: number;
    nom: string;
    exe: string;
    commande: string;
    ram: number;      // octets
    temps: number;    // temps CPU cumulé, en unités de 100 ns
}

export interface Ecoute {
    port: number;
    pid: number;
}

export interface Instantane {
    date: number;
    processus: Map<number, Processus>;
    ecoutes: Ecoute[];
}

// Un seul appel PowerShell pour les processus et les ports en écoute
const SCRIPT = `
$p = Get-CimInstance Win32_Process | ForEach-Object { @{ i=$_.ProcessId; pp=$_.ParentProcessId; n=$_.Name; e=$_.ExecutablePath; c=$_.CommandLine; r=$_.WorkingSetSize; t=$_.KernelModeTime + $_.UserModeTime } }
$l = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -lt 49152 } | ForEach-Object { @{ port=$_.LocalPort; pid=$_.OwningProcess } })
@{ p=@($p); l=$l } | ConvertTo-Json -Compress -Depth 3
`;

export function instantane(): Promise<Instantane> {
    return new Promise((resolve, reject) => {
        const enc = Buffer.from(SCRIPT, 'utf16le').toString('base64');
        const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc]);
        let sortie = '';
        ps.stdout.on('data', (d) => (sortie += d));
        ps.on('error', reject);
        ps.on('close', () => {
            try {
                const brut = JSON.parse(sortie);
                const processus = new Map<number, Processus>();
                for (const x of brut.p) {
                    processus.set(x.i, {
                        pid: x.i, ppid: x.pp, nom: x.n ?? '', exe: x.e ?? '', commande: x.c ?? '',
                        ram: Number(x.r) || 0, temps: Number(x.t) || 0,
                    });
                }
                // Dédoublonne IPv4/IPv6 sur le même port
                const vus = new Set<number>();
                const ecoutes = (brut.l as Ecoute[]).filter((e) => !vus.has(e.port) && vus.add(e.port));
                resolve({ date: Date.now(), processus, ecoutes });
            } catch (err) {
                reject(err);
            }
        });
    });
}

// Le processus + tous ses descendants
export function arbre(snap: Instantane, pid: number): Processus[] {
    const enfants = new Map<number, Processus[]>();
    for (const p of snap.processus.values()) {
        if (!enfants.has(p.ppid)) enfants.set(p.ppid, []);
        enfants.get(p.ppid)!.push(p);
    }
    const resultat: Processus[] = [];
    const pile = [pid];
    while (pile.length) {
        const courant = pile.pop()!;
        const p = snap.processus.get(courant);
        if (!p || resultat.includes(p)) continue;
        resultat.push(p);
        for (const e of enfants.get(courant) ?? []) {
            if (e.pid !== courant) pile.push(e.pid);
        }
    }
    return resultat;
}

// % CPU d'un groupe de processus entre deux instantanés (100 % = toute la machine)
export function cpuGroupe(avant: Instantane | undefined, apres: Instantane, pids: number[]): number {
    if (!avant) return 0;
    let delta = 0;
    for (const pid of pids) {
        const a = avant.processus.get(pid);
        const b = apres.processus.get(pid);
        if (a && b) delta += Math.max(0, b.temps - a.temps);
    }
    const dispo = (apres.date - avant.date) * 10000 * os.cpus().length;
    return dispo > 0 ? (delta / dispo) * 100 : 0;
}

// CPU de la machine entière, mesuré par os.cpus() entre deux appels
let cpuPrecedent = os.cpus();
export function cpuMachine(): number {
    const actuel = os.cpus();
    let total = 0, repos = 0;
    actuel.forEach((c, i) => {
        const p = cpuPrecedent[i];
        const t = (o: os.CpuInfo) => o.times.user + o.times.nice + o.times.sys + o.times.irq + o.times.idle;
        total += t(c) - t(p);
        repos += c.times.idle - p.times.idle;
    });
    cpuPrecedent = actuel;
    return total > 0 ? ((total - repos) / total) * 100 : 0;
}

export interface SessionActive {
    pid: number;
    sessionId: string;
    cwd: string;
    statut: 'idle' | 'busy' | string;
    debut: Date;
    depuisStatut: Date;       // depuis quand la session est dans ce statut
    nom: string;
}

// Claude Code écrit ~/.claude/sessions/<pid>.json pour chaque session ouverte
export function sessionsActives(): SessionActive[] {
    const dossier = path.join(os.homedir(), '.claude', 'sessions');
    if (!fs.existsSync(dossier)) return [];
    const sessions: SessionActive[] = [];
    for (const f of fs.readdirSync(dossier)) {
        if (!/^\d+\.json$/.test(f)) continue;
        try {
            const j = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf-8'));
            process.kill(j.pid, 0);   // lève une erreur si le processus n'existe plus
            sessions.push({
                pid: j.pid, sessionId: j.sessionId, cwd: j.cwd, statut: j.status,
                debut: new Date(j.startedAt), nom: path.basename(j.cwd),
                depuisStatut: new Date(j.statusUpdatedAt ?? j.updatedAt ?? j.startedAt),
            });
        } catch {
            // fichier orphelin (session fermée) ou illisible
        }
    }
    return sessions.sort((a, b) => a.debut.getTime() - b.debut.getTime());
}

export function fermerArbre(pid: number): void {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

export function formatRam(octets: number): string {
    return octets >= 1024 ** 3 ? `${(octets / 1024 ** 3).toFixed(1)} Go` : `${Math.round(octets / 1024 ** 2)} Mo`;
}

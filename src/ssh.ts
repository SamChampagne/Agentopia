import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import * as path from 'path';
import { promises as dns } from 'dns';
import { spawn } from 'child_process';
import { CHEMINS } from './chemins.js';

const DOSSIER_SSH = path.join(os.homedir(), '.ssh');
const CACHE_ACCES = CHEMINS.ssh;

export interface Serveur {
    nom: string;              // alias du ~/.ssh/config, sinon le nom d'hôte
    hote: string;             // HostName
    utilisateur?: string;
    port: number;
    ip?: string;
    noms: Set<string>;        // tous les identifiants qui désignent ce serveur (alias, hôtes, IP)
    configure: boolean;       // présent dans ~/.ssh/config (sinon : seulement known_hosts)
}

export interface UsageProjet {
    dossier: string;          // dossier ~/.claude/projects/<...>
    nombre: number;
    dernier: Date;
}

export interface Acces {
    ok: boolean;
    message: string;
    date: number;
}

// ─── Inventaire des serveurs ─────────────────────────────────────────────────

function lireConfig(): Serveur[] {
    const fichier = path.join(DOSSIER_SSH, 'config');
    if (!fs.existsSync(fichier)) return [];
    const serveurs: Serveur[] = [];
    let courant: Serveur | undefined;
    for (const ligne of fs.readFileSync(fichier, 'utf-8').split(/\r?\n/)) {
        const m = /^\s*(\w+)\s+(.+?)\s*$/.exec(ligne);
        if (!m) continue;
        const [, cle, valeur] = m;
        if (cle.toLowerCase() === 'host') {
            // On ignore les motifs génériques (Host *)
            courant = valeur.includes('*') ? undefined : { nom: valeur, hote: valeur, port: 22, noms: new Set([valeur.toLowerCase()]), configure: true };
            if (courant) serveurs.push(courant);
        } else if (courant) {
            if (cle.toLowerCase() === 'hostname') courant.hote = valeur;
            if (cle.toLowerCase() === 'user') courant.utilisateur = valeur;
            if (cle.toLowerCase() === 'port') courant.port = Number(valeur) || 22;
        }
    }
    serveurs.forEach((s) => s.noms.add(s.hote.toLowerCase()));
    return serveurs;
}

function lireKnownHosts(): string[] {
    const fichier = path.join(DOSSIER_SSH, 'known_hosts');
    if (!fs.existsSync(fichier)) return [];
    const hotes = new Set<string>();
    for (const ligne of fs.readFileSync(fichier, 'utf-8').split(/\r?\n/)) {
        const champ = ligne.split(' ')[0];
        if (!champ || champ.startsWith('|') || champ.startsWith('#')) continue;   // entrées hachées
        champ.split(',').forEach((h) => hotes.add(h.replace(/^\[(.+)\]:\d+$/, '$1').toLowerCase()));
    }
    return [...hotes];
}

const estIp = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h);

async function resoudre(hote: string): Promise<string | undefined> {
    if (estIp(hote)) return hote;
    try {
        const r = await Promise.race([dns.lookup(hote, { family: 4 }), new Promise<never>((_, ko) => setTimeout(() => ko(new Error()), 2000))]);
        return r.address;
    } catch {
        return undefined;
    }
}

// Fusionne ~/.ssh/config et known_hosts ; deux noms qui pointent vers la même IP = même serveur
export async function inventaire(): Promise<Serveur[]> {
    const serveurs = lireConfig();
    await Promise.all(serveurs.map(async (s) => {
        s.ip = await resoudre(s.hote);
        if (s.ip) s.noms.add(s.ip);
    }));
    for (const hote of lireKnownHosts()) {
        if (serveurs.some((s) => s.noms.has(hote))) continue;
        const ip = await resoudre(hote);
        const existant = ip ? serveurs.find((s) => s.ip === ip || s.noms.has(ip)) : undefined;
        if (existant) {
            existant.noms.add(hote);
            continue;
        }
        const court = hote.replace(/^ec2-([\d-]+)\.([a-z0-9-]+)\.compute\.amazonaws\.com$/, 'ec2 $1 ($2)');
        serveurs.push({ nom: court, hote, port: 22, ip, noms: new Set([hote, ...(ip ? [ip] : [])]), configure: false });
    }
    return serveurs;
}

// ─── Usage par projet : les commandes ssh/scp/rsync lancées par Claude ───────

const OPTIONS_AVEC_VALEUR = new Set(['-p', '-i', '-o', '-l', '-J', '-F', '-L', '-R', '-D', '-E', '-S', '-W', '-b', '-c', '-m', '-P', '-e']);

// Extrait les hôtes visés par une ligne de commande shell
export function hotesDansCommande(commande: string): string[] {
    const hotes: string[] = [];
    for (const m of commande.matchAll(/\b(ssh|scp|sftp|rsync)\s+([^|;&\n]*)/g)) {
        const outil = m[1];
        const jetons = m[2].split(/\s+/).filter(Boolean);
        for (let i = 0; i < jetons.length; i++) {
            const j = jetons[i].replace(/^['"]|['"]$/g, '');
            if (j.startsWith('-')) {
                if (OPTIONS_AVEC_VALEUR.has(j)) i++;
                continue;
            }
            if (outil === 'ssh' || outil === 'sftp') {
                hotes.push(j.replace(/^.*@/, '').replace(/:.*$/, '').toLowerCase());
                break;   // ensuite c'est la commande distante
            }
            // scp / rsync : [user@]hote:chemin (on ignore C:\...)
            const distant = /^(?:[^@\s]+@)?([a-zA-Z0-9._-]{2,}):/.exec(j);
            if (distant) hotes.push(distant[1].toLowerCase());
        }
    }
    return hotes;
}

// Scanne les sessions Claude (rg : ~0,5 s pour 500 Mo) et compte les connexions par serveur et par projet
export function usageParServeur(serveurs: Serveur[]): Promise<Map<Serveur, UsageProjet[]>> {
    return new Promise((ok) => {
        const racine = path.join(os.homedir(), '.claude', 'projects');
        const proc = spawn('rg', ['-o', '--no-line-number', '"command":"[^"]*\\b(ssh|scp|sftp|rsync) [^"]{0,300}', racine]);
        let sortie = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.on('error', () => ok(new Map()));
        proc.on('close', () => {
            const resultat = new Map<Serveur, Map<string, UsageProjet>>();
            const mtimes = new Map<string, Date>();
            for (const ligne of sortie.split('\n')) {
                const i = ligne.indexOf('.jsonl:');
                if (i < 0) continue;
                const fichier = ligne.slice(0, i + 6);
                // Les sous-agents sont dans <projet>/<session>/subagents/ : on garde le 1er niveau
                const dossier = path.relative(racine, fichier).split(path.sep)[0];
                if (!mtimes.has(fichier)) {
                    try {
                        mtimes.set(fichier, fs.statSync(fichier).mtime);
                    } catch {
                        continue;
                    }
                }
                const commande = ligne.slice(i + 7).replace(/\\n/g, '\n').replace(/\\"/g, '"');
                for (const hote of hotesDansCommande(commande)) {
                    const serveur = serveurs.find((s) => s.noms.has(hote));
                    if (!serveur) continue;
                    const parProjet = resultat.get(serveur) ?? new Map<string, UsageProjet>();
                    const u = parProjet.get(dossier) ?? { dossier, nombre: 0, dernier: new Date(0) };
                    u.nombre++;
                    if (mtimes.get(fichier)! > u.dernier) u.dernier = mtimes.get(fichier)!;
                    parProjet.set(dossier, u);
                    resultat.set(serveur, parProjet);
                }
            }
            ok(new Map([...resultat].map(([s, m]) => [s, [...m.values()].sort((a, b) => b.dernier.getTime() - a.dernier.getTime())])));
        });
    });
}

// ─── État en direct ──────────────────────────────────────────────────────────

// Le port SSH répond-il ? (simple connexion TCP, aucune authentification)
const DELAI_TCP = 2500;
export function joignable(s: Serveur): Promise<boolean> {
    const delai = DELAI_TCP;
    return new Promise((ok) => {
        const socket = net.connect({ host: s.ip ?? s.hote, port: s.port });
        const fin = (v: boolean) => {
            socket.destroy();
            ok(v);
        };
        socket.setTimeout(delai, () => fin(false));
        socket.once('connect', () => fin(true));
        socket.once('error', () => fin(false));
    });
}

export interface ConnexionActive {
    ip: string;
    pid: number;
    parents: number[];        // chaîne des processus parents (pour retrouver la session Claude)
}

// Connexions SSH établies en ce moment (port distant 22) avec la chaîne des processus parents
// Connexions SSH sortantes vues par netstat (programme natif, très léger) : « ip pid » triés
function connexionsNetstat(): Promise<string> {
    return new Promise((ok) => {
        const p = spawn('netstat', ['-ano', '-p', 'TCP']);
        let sortie = '';
        p.stdout.on('data', (d) => (sortie += d));
        p.on('error', () => ok('?'));
        p.on('close', () => ok(sortie.split(/\r?\n/)
            .map((l) => /^\s*TCP\s+\S+\s+(\S+):22\s+ESTABLISHED\s+(\d+)/i.exec(l))
            .filter((m): m is RegExpExecArray => !!m).map((m) => `${m[1]} ${m[2]}`).sort().join(',')));
    });
}

// Le détail (processus parents, pour savoir quelle session Claude a ouvert la connexion) demande PowerShell :
// on ne le relance que si les connexions ont changé
let derniereEmpreinte = '';
let derniereListe: ConnexionActive[] = [];
export async function connexionsActives(): Promise<ConnexionActive[]> {
    const empreinte = await connexionsNetstat();
    if (empreinte === '') {
        derniereEmpreinte = '';
        return (derniereListe = []);
    }
    if (empreinte !== '?' && empreinte === derniereEmpreinte) return derniereListe;
    derniereEmpreinte = empreinte;
    return (derniereListe = await connexionsDetaillees());
}

function connexionsDetaillees(): Promise<ConnexionActive[]> {
    const script = `
$c = @(Get-NetTCPConnection -State Established -RemotePort 22 -ErrorAction SilentlyContinue)
if (-not $c.Count) { '[]'; exit }
$p = @{}; Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { $p[[int]$_.ProcessId] = [int]$_.ParentProcessId }
@($c | ForEach-Object {
  $chaine = @(); $x = [int]$_.OwningProcess
  for ($i = 0; $i -lt 12 -and $p.ContainsKey($x); $i++) { $x = $p[$x]; $chaine += $x }
  @{ ip = $_.RemoteAddress; pid = [int]$_.OwningProcess; parents = $chaine }
}) | ConvertTo-Json -Compress -Depth 3`;
    return new Promise((ok) => {
        const enc = Buffer.from(script, 'utf16le').toString('base64');
        const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc]);
        let sortie = '';
        ps.stdout.on('data', (d) => (sortie += d));
        ps.on('error', () => ok([]));
        ps.on('close', () => {
            try {
                const brut = JSON.parse(sortie.trim() || '[]');
                ok((Array.isArray(brut) ? brut : [brut]).map((x) => ({ ...x, parents: [].concat(x.parents ?? []) })));
            } catch {
                ok([]);
            }
        });
    });
}

// Claude peut-il s'y connecter seul ? ssh en BatchMode : réussit seulement avec une clé, sans mot de passe
export function testerAcces(s: Serveur): Promise<Acces> {
    return new Promise((ok) => {
        const cible = s.configure ? s.nom : `${s.utilisateur ? s.utilisateur + '@' : ''}${s.hote}`;
        const proc = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=yes', cible, 'exit']);
        let erreurs = '';
        proc.stderr.on('data', (d) => (erreurs += d));
        const minuterie = setTimeout(() => proc.kill(), 12_000);
        proc.on('close', (code) => {
            clearTimeout(minuterie);
            const msg = erreurs.trim().split('\n').pop() ?? '';
            const message = code === 0 ? 'connexion par clé OK'
                : /Permission denied/i.test(msg) ? 'clé refusée (mot de passe requis)'
                    : /timed out|Connection refused|No route|Could not resolve/i.test(msg) ? 'injoignable'
                        : /Host key verification failed/i.test(msg) ? 'empreinte inconnue' : msg.slice(0, 60) || `code ${code}`;
            ok({ ok: code === 0, message, date: Date.now() });
        });
        proc.on('error', () => ok({ ok: false, message: 'ssh introuvable', date: Date.now() }));
    });
}

export function lireAcces(): Record<string, Acces> {
    try {
        return JSON.parse(fs.readFileSync(CACHE_ACCES, 'utf-8'));
    } catch {
        return {};
    }
}

export function sauverAcces(acces: Record<string, Acces>): void {
    fs.writeFileSync(CACHE_ACCES, JSON.stringify(acces, null, 2), 'utf-8');
}

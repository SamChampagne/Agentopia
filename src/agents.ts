import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { CLAUDE } from './claude.js';
import { dossierSessions } from './sessions.js';

// Toutes les sessions Claude actives (onglets interactifs + arrière-plan)

export type Statut = 'travaille' | 'attend' | 'bloquee' | 'terminee';

export interface SessionVue {
    cle: string;                   // id stable pour React
    id?: string;                   // id court d'une session d'arrière-plan (claude attach <id>)
    sessionId: string;
    pid?: number;
    arrierePlan: boolean;
    cwd: string;
    nom: string;                   // dossier du projet
    titre: string;                 // nom de la session
    statut: Statut;
    debut: Date;
    fichier: string;               // transcript .jsonl
    question?: string;             // arrière-plan bloquée : ce que Claude attend de toi (Claude Code l'enregistre)
    suggestion?: string;           // et la réponse qu'il propose
}

interface BrutAgent {
    id?: string;
    pid?: number;
    cwd: string;
    kind: 'interactive' | 'background';
    startedAt: number;
    sessionId: string;
    name?: string;
    status?: string;
    state?: string;
    needs?: string;
    suggestedReply?: string;
}

function statut(a: BrutAgent): Statut {
    if (a.state === 'blocked') return 'bloquee';
    if (a.state === 'done') return 'terminee';
    if (a.status === 'busy' || a.state === 'working' || a.state === 'running') return 'travaille';
    return 'attend';
}

const vue = (a: BrutAgent): SessionVue => ({
    cle: a.sessionId,
    id: a.id,
    sessionId: a.sessionId,
    pid: a.pid,
    arrierePlan: a.kind === 'background',
    cwd: a.cwd,
    nom: path.basename(a.cwd),
    titre: a.name ?? '',
    statut: statut(a),
    debut: new Date(a.startedAt),
    fichier: path.join(dossierSessions(a.cwd), `${a.sessionId}.jsonl`),
    question: a.state === 'blocked' ? a.needs || undefined : undefined,
    suggestion: a.state === 'blocked' ? a.suggestedReply || undefined : undefined,
});

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const DOSSIERS_AGENTS = [path.join(CLAUDE_DIR, 'sessions'), path.join(CLAUDE_DIR, 'jobs')];

const lireJson = (f: string) => {
    try {
        return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch {
        return undefined;
    }
};

const vivant = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
};

// Lecture directe des fichiers de Claude Code (quelques ms) au lieu de lancer `claude agents` (plus d'une seconde
// et un processus Claude complet à chaque fois) : ~/.claude/sessions/<pid>.json pour les sessions interactives,
// ~/.claude/jobs/<id>/state.json pour celles d'arrière-plan. undefined si le format n'est pas reconnu.
function lireFichiersAgents(): SessionVue[] | undefined {
    const [sessions, jobs] = DOSSIERS_AGENTS;
    if (!fs.existsSync(sessions) || !fs.existsSync(jobs)) return undefined;
    const brut: BrutAgent[] = [];
    for (const f of fs.readdirSync(sessions)) {
        if (!/^\d+\.json$/.test(f)) continue;
        const j = lireJson(path.join(sessions, f));
        if (!j?.sessionId || !j.cwd || !j.pid || j.kind === 'background' || !vivant(j.pid)) continue;
        brut.push({ pid: j.pid, cwd: j.cwd, kind: 'interactive', startedAt: j.startedAt, sessionId: j.sessionId, name: j.name, status: j.status });
    }
    for (const id of fs.readdirSync(jobs)) {
        const j = lireJson(path.join(jobs, id, 'state.json'));
        if (!j) continue;
        if (!j.sessionId || !j.cwd || !j.state) return undefined;   // format inconnu : on laisse faire `claude agents`
        brut.push({ id, cwd: j.cwd, kind: 'background', startedAt: Date.parse(j.createdAt) || 0, sessionId: j.sessionId, name: j.name, state: j.state, needs: j.needs, suggestedReply: j.suggestedReply });
    }
    return brut.map(vue).sort((a, b) => a.debut.getTime() - b.debut.getTime());
}

export async function listerAgents(): Promise<SessionVue[]> {
    try {
        const parFichiers = lireFichiersAgents();
        if (parFichiers) return parFichiers;
    } catch {
        // on passe par la commande
    }
    return listerAgentsCommande();
}

export function listerAgentsCommande(): Promise<SessionVue[]> {
    return new Promise((ok) => {
        const proc = spawn(CLAUDE, ['agents', '--json'], { shell: CLAUDE === 'claude' });
        let sortie = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.on('error', () => ok([]));
        proc.on('close', () => {
            try {
                const brut = JSON.parse(sortie) as BrutAgent[];
                ok(brut.map(vue).sort((a, b) => a.debut.getTime() - b.debut.getTime()));
            } catch {
                ok([]);
            }
        });
    });
}

// Le dernier bloc de code (```…```) écrit par Claude, sinon undefined
export function dernierBlocCode(messages: Message[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== 'assistant') continue;
        const blocs = [...messages[i].texte.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
        if (blocs.length) return blocs[blocs.length - 1][1].replace(/\n$/, '');
    }
    return undefined;
}

export function derniereReponse(messages: Message[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant' && messages[i].texte.trim()) return messages[i].texte.trim();
    return undefined;
}

// ─── Transcript ──────────────────────────────────────────────────────────────

export interface Message {
    role: 'user' | 'assistant' | 'outil' | 'resultat';
    texte: string;
    date?: Date;
}

// Résumé d'un appel d'outil : "Bash  npm test", "Edit  App.tsx"…
function resumerOutil(nom: string, entree: Record<string, unknown> = {}): string {
    const v = (k: string) => (typeof entree[k] === 'string' ? (entree[k] as string) : '');
    const detail = v('command') || (v('file_path') && path.basename(v('file_path'))) || v('pattern') || v('description')
        || v('url') || v('query') || v('prompt') || v('skill') || '';
    return `${nom}  ${detail.replace(/\s+/g, ' ')}`.trim();
}

// Lit les octets [debut, fin) du fichier, jusqu'au dernier saut de ligne (une ligne en cours d'écriture attend la prochaine lecture)
function lireLignes(fichier: string, debut: number, fin: number): { texte: string; jusqua: number } {
    const fd = fs.openSync(fichier, 'r');
    try {
        const tampon = Buffer.alloc(fin - debut);
        const lus = fs.readSync(fd, tampon, 0, tampon.length, debut);
        const dernier = tampon.lastIndexOf(0x0a, lus - 1);
        return dernier < 0 ? { texte: '', jusqua: debut } : { texte: tampon.toString('utf-8', 0, dernier), jusqua: debut + dernier + 1 };
    } finally {
        fs.closeSync(fd);
    }
}

// Lecture incrémentale : une session ouverte est relue chaque seconde, seules les lignes ajoutées depuis sont décodées
const transcripts = new Map<string, { jusqua: number; messages: Message[] }>();
const MESSAGES_MAX = 5000;

// Les sessions commencent par un gros contexte (~450 Ko) : on lit assez loin pour garder le début de la conversation
export function lireTranscript(fichier: string, octets = 2_000_000): Message[] {
    const cle = `${octets}|${fichier}`;
    try {
        const taille = fs.statSync(fichier).size;
        const connu = transcripts.get(cle);
        if (connu && taille >= connu.jusqua) {
            if (taille === connu.jusqua) return connu.messages;
            const { texte, jusqua } = lireLignes(fichier, connu.jusqua, taille);
            if (texte) connu.messages = [...connu.messages, ...decoderTranscript(texte)].slice(-MESSAGES_MAX);
            connu.jusqua = jusqua;
            return connu.messages;
        }
        // Première lecture (ou fichier réécrit) : la fin seulement, sans la ligne coupée au début
        const debut = Math.max(0, taille - octets);
        let { texte, jusqua } = lireLignes(fichier, debut, taille);
        if (debut > 0) texte = texte.slice(texte.indexOf('\n') + 1);
        if (transcripts.size > 60) transcripts.clear();
        const messages = decoderTranscript(texte);
        transcripts.set(cle, { jusqua, messages });
        return messages;
    } catch {
        return [];
    }
}

function decoderTranscript(texte: string): Message[] {
    const messages: Message[] = [];
    for (const ligne of texte.split('\n')) {
        if (!ligne.includes('"type":"user"') && !ligne.includes('"type":"assistant"')) continue;
        let o;
        try {
            o = JSON.parse(ligne);
        } catch {
            continue;
        }
        if (o.isMeta || o.isSidechain) continue;
        const date = o.timestamp ? new Date(o.timestamp) : undefined;
        const contenu = o.message?.content;
        if (o.type === 'user') {
            if (typeof contenu === 'string') {
                if (!contenu.startsWith('<')) messages.push({ role: 'user', texte: contenu, date });
                continue;
            }
            for (const bloc of contenu ?? []) {
                if (bloc.type === 'text' && !bloc.text.startsWith('<')) messages.push({ role: 'user', texte: bloc.text, date });
                if (bloc.type === 'image') messages.push({ role: 'user', texte: '[image]', date });
                if (bloc.type === 'tool_result') {
                    const t = typeof bloc.content === 'string' ? bloc.content
                        : (bloc.content ?? []).map((x: { text?: string }) => x.text ?? '').join(' ');
                    messages.push({ role: 'resultat', texte: (bloc.is_error ? '✗ ' : '') + t.trim().split('\n')[0], date });
                }
            }
        } else {
            for (const bloc of contenu ?? []) {
                if (bloc.type === 'text' && bloc.text.trim()) messages.push({ role: 'assistant', texte: bloc.text.trim(), date });
                if (bloc.type === 'tool_use') messages.push({ role: 'outil', texte: resumerOutil(bloc.name, bloc.input), date });
            }
        }
    }
    return messages;
}

export interface Activite {
    dernierUser?: string;
    dernierTexte?: string;
    outil?: string;              // dernier outil appelé, s'il est postérieur au dernier texte
    date?: Date;
}

export function activite(messages: Message[]): Activite {
    const a: Activite = {};
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        a.date ??= m.date;
        if (m.role === 'outil' && !a.outil && !a.dernierTexte) a.outil = m.texte;
        if (m.role === 'assistant' && !a.dernierTexte) a.dernierTexte = m.texte;
        if (m.role === 'user' && m.texte !== '[image]') {
            a.dernierUser = m.texte;
            break;
        }
    }
    return a;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function claude(args: string[], cwd = os.homedir()): Promise<string> {
    return new Promise((ok) => {
        const proc = spawn(CLAUDE, args, { cwd, shell: CLAUDE === 'claude' });
        let sortie = '';
        proc.stdout.on('data', (d) => (sortie += d));
        proc.stderr.on('data', (d) => (sortie += d));
        proc.on('error', (e) => ok(e.message));
        proc.on('close', () => ok(sortie.trim()));
    });
}

export interface OptionsAgent {
    worktree?: string;          // la session travaille dans son propre worktree git (.claude/worktrees/<nom>)
    role?: string;              // consigne ajoutée au prompt système (agent métier)
    permissions?: string;       // acceptEdits, auto, manual…
}

// Lance une session d'arrière-plan ; renvoie son id court (pour claude attach)
export async function lancerArrierePlan(cwd: string, nom: string, prompt?: string, reprendre?: string, options: OptionsAgent = {}): Promise<{ id?: string; sortie: string }> {
    const args = ['--bg', '-n', nom];
    if (reprendre) args.push('--resume', reprendre, '--fork-session');
    if (options.worktree) args.push('-w', options.worktree);
    if (options.role) args.push('--append-system-prompt', options.role);
    if (options.permissions) args.push('--permission-mode', options.permissions);
    if (prompt) args.push(prompt);
    const sortie = await claude(args, cwd);
    return { id: /backgrounded · ([0-9a-f]{6,})/.exec(sortie)?.[1], sortie };
}

export function arreterArrierePlan(id: string): Promise<string> {
    return claude(['stop', id]);
}

// Retire la session de la liste (la conversation reste) ; Claude supprime son worktree quand c'est sans risque
export function retirerArrierePlan(id: string): Promise<string> {
    return claude(['rm', id]);
}

// Le service d'arrière-plan de Claude Code redémarre parfois quelques secondes (« service may be restarting ») :
// ce n'est pas un échec, on réessaie
const PASSAGER = /restarting|try again|ECONNREFUSED|ECONNRESET|EPIPE|timed? ?out|not running/i;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fermer = arrêter puis retirer ; « déjà retirée » compte comme réussi
export async function fermerArrierePlan(id: string): Promise<{ ok: boolean; message: string }> {
    let derniere = '';
    for (let essai = 0; essai < 8; essai++) {
        if (essai) await pause(Math.min(4000, 800 * essai));
        const arret = await arreterArrierePlan(id);
        if (PASSAGER.test(arret)) {
            derniere = arret;
            continue;
        }
        const retrait = await retirerArrierePlan(id);
        if (/removed|no job matching/i.test(retrait)) return { ok: true, message: 'fermée' };
        derniere = retrait;
        if (!PASSAGER.test(retrait)) break;
    }
    return { ok: false, message: derniere.split('\n').find(Boolean) ?? 'impossible de la fermer' };
}

// Envoie un message à une session d'arrière-plan sans l'ouvrir.
// Claude Code ne sait pas injecter un message dans une session qui tourne (il en ferait une copie) :
// on retire le processus d'arrière-plan (la conversation est gardée), puis on la reprend avec le message,
// sous le même id. Vérifié : l'historique est conservé.
// Attention : la reprise peut créer un nouveau fichier de conversation (historique recopié) → nouvel id, renvoyé.
export async function envoyerMessage(s: SessionVue, texte: string): Promise<{ ok: boolean; message: string; id?: string }> {
    if (!s.arrierePlan || !s.id) return { ok: false, message: 'cette session est dans un onglet : écris-y directement, ou « Continuer ici »' };
    if (s.statut === 'travaille') return { ok: false, message: 'Claude est en train de travailler : attends qu\'il ait fini, ou « Rejoindre »' };
    if (s.statut === 'bloquee' && (!s.question || /permission/i.test(s.question))) return { ok: false, message: 'Claude attend une permission : « Rejoindre » pour répondre' };
    // claude rm supprime aussi un éventuel worktree de la session : on ne prend pas ce risque
    if (/[\\/]\.claude[\\/]worktrees[\\/]/i.test(s.cwd)) return { ok: false, message: 'session dans un worktree : utilise « Rejoindre »' };
    const retrait = await claude(['rm', s.id]);
    if (!/removed/i.test(retrait)) return { ok: false, message: retrait.split('\n')[0] || 'impossible de reprendre la session' };
    // -n garde le nom de la session (sinon Claude la renomme d'après le nouveau message)
    const sortie = await claude(['--bg', '-n', s.titre || s.nom, '--resume', s.sessionId, texte], s.cwd);
    const id = /backgrounded · ([0-9a-f]{6,})/.exec(sortie)?.[1];
    if (!id) return { ok: false, message: sortie.split('\n')[0] || 'échec de l\'envoi' };
    return { ok: true, message: 'message envoyé', id };
}

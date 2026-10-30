import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { CLAUDE } from './claude.js';
import { dossierSessions } from './sessions.js';
import { listerIntegrees, dossierIntegre, estIntegree, envoyerIntegree, interrompreIntegree, archiverIntegree } from './sessionsIntegrees.js';
import type { Fournisseur, PermissionAgent } from './providers/types.js';

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
    fournisseur?: Fournisseur;
    integree?: boolean;
    terminalExterne?: boolean;
    permission?: PermissionAgent;
    issue?: 'success' | 'error' | 'cancelled';
    erreur?: string;
    resultat?: string;
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
    for (const id of fs.readdirSync(jobs)) {
        const j = lireJson(path.join(jobs, id, 'state.json'));
        if (!j) continue;
        if (!j.sessionId || !j.cwd || !j.state) return undefined;   // format inconnu : on laisse faire `claude agents`
        brut.push({ id, cwd: j.cwd, kind: 'background', startedAt: Date.parse(j.createdAt) || 0, sessionId: j.sessionId, name: j.name, state: j.state, needs: j.needs, suggestedReply: j.suggestedReply });
    }
    // Une session d'arrière-plan a aussi un processus « interactif » avec le même identifiant : une seule carte
    const enArrierePlan = new Set(brut.map((b) => b.sessionId));
    for (const f of fs.readdirSync(sessions)) {
        if (!/^\d+\.json$/.test(f)) continue;
        const j = lireJson(path.join(sessions, f));
        if (!j?.sessionId || !j.cwd || !j.pid || j.kind === 'background' || enArrierePlan.has(j.sessionId) || !vivant(j.pid)) continue;
        brut.push({ pid: j.pid, cwd: j.cwd, kind: 'interactive', startedAt: j.startedAt, sessionId: j.sessionId, name: j.name, status: j.status });
    }
    return brut.map(vue).sort((a, b) => a.debut.getTime() - b.debut.getTime());
}

export async function listerAgents(): Promise<SessionVue[]> {
    const integrees: SessionVue[] = listerIntegrees().map((s) => ({
        cle: s.id, id: s.id, sessionId: s.id, arrierePlan: true, cwd: s.cwd, nom: path.basename(s.cwd),
        titre: s.titre, statut: s.etat === 'erreur' || s.etat === 'arretee' ? 'attend' : s.etat,
        debut: new Date(s.creee), fichier: path.join(dossierIntegre(s.id), 'conversation.jsonl'),
        fournisseur: s.fournisseur, integree: true, terminalExterne: s.terminalExterne, permission: s.permission, question: s.permission?.titre,
        issue: s.issue, erreur: s.erreur, resultat: s.resultat,
    }));
    try {
        const parFichiers = lireFichiersAgents();
        if (parFichiers) return [...parFichiers, ...integrees];
    } catch {
        // on passe par la commande
    }
    return [...await listerAgentsCommande(), ...integrees];
}

export function listerAgentsCommande(): Promise<SessionVue[]> {
    return new Promise((ok) => {
        const proc = spawn(CLAUDE, ['agents', '--json'], { shell: CLAUDE === 'claude' });
        const delai = setTimeout(() => { proc.kill(); ok([]); }, 5000);
        let sortie = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.on('error', () => { clearTimeout(delai); ok([]); });
        proc.on('close', () => {
            clearTimeout(delai);
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
    id?: string; etat?: 'en_cours' | 'termine' | 'erreur' | 'interrompu';
    commande?: string; fichier?: string; sortie?: string; sortieTronquee?: boolean; dureeMs?: number; codeSortie?: number;
}
function fusionnerMessages(anciens: Message[], ajouts: Message[]): Message[] {
    const resultat = [...anciens];
    const index = new Map(resultat.flatMap((m, i) => m.id ? [[m.id, i] as const] : []));
    for (const m of ajouts) {
        const i = m.id ? index.get(m.id) : undefined;
        if (i !== undefined) resultat[i] = m;
        else { if (m.id) index.set(m.id, resultat.length); resultat.push(m); }
    }
    return resultat.slice(-MESSAGES_MAX);
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

// Seules les lignes complètes ajoutées sont décodées. L'identité et la date du fichier
// distinguent un ajout d'un remplacement (import, réparation ou rotation d'historique).
const transcripts = new Map<string, { jusqua: number; taille: number; modification: number; identite: string; messages: Message[] }>();
const MESSAGES_MAX = 5000;

// Les sessions commencent par un gros contexte (~450 Ko) : on lit assez loin pour garder le début de la conversation
export function lireTranscript(fichier: string, octets = 2_000_000): Message[] {
    const cle = `${octets}|${fichier}`;
    const connu = transcripts.get(cle);
    try {
        const stat = fs.statSync(fichier);
        const taille = stat.size, modification = stat.mtimeMs;
        const identite = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        if (connu && identite === connu.identite && taille >= connu.taille
            && (taille > connu.taille || modification === connu.modification)) {
            if (taille === connu.jusqua) return connu.messages;
            const { texte, jusqua } = lireLignes(fichier, connu.jusqua, taille);
            if (texte) connu.messages = fusionnerMessages(connu.messages, decoderTranscript(texte));
            connu.jusqua = jusqua;
            connu.taille = taille;
            connu.modification = modification;
            return connu.messages;
        }
        // Première lecture (ou fichier réécrit) : la fin seulement, sans la ligne coupée au début
        const debut = Math.max(0, taille - octets);
        let { texte, jusqua } = lireLignes(fichier, debut, taille);
        if (debut > 0) texte = texte.slice(texte.indexOf('\n') + 1);
        if (transcripts.size > 60) transcripts.clear();
        const messages = fusionnerMessages([], decoderTranscript(texte));
        transcripts.set(cle, { jusqua, taille, modification, identite, messages });
        return messages;
    } catch {
        // Un fichier temporairement verrouillé ou absent ne fait pas disparaître le chat.
        return connu?.messages ?? [];
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
        if (o.agentopia?.id && typeof o.agentopia.texte === 'string') {
            messages.push({ ...o.agentopia, date }); continue;
        }
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
                if (bloc.type === 'tool_use') messages.push({ role: 'outil', texte: resumerOutil(bloc.name, bloc.input),
                    commande: bloc.input?.command || (/^(?:"[^"\n]*(?:powershell|pwsh)\.exe"|(?:powershell|pwsh)(?:\.exe)?)\s/i.test(bloc.name) ? bloc.name : undefined), date });
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
    horaires?: number[];         // heures (ms) des derniers messages : le rythme de la carte
    contexte?: number;           // jetons dans le contexte au dernier tour de Claude
}

export function activite(messages: Message[]): Activite {
    const a: Activite = { horaires: messages.slice(-300).flatMap((m) => (m.date ? [m.date.getTime()] : [])) };
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

// Heures de tous les événements d'une session (messages, outils, résultats) sur les 2 dernières heures.
// Cherche seulement « "timestamp":" » dans les octets, sans décoder le JSON : 30 Mo se parcourent en quelques ms,
// assez pour couvrir une heure même quand les sorties d'outils gonflent le transcript. Ensuite, seulement la fin ajoutée.
const MARQUE_DATE = Buffer.from('"timestamp":"');
const horairesConnus = new Map<string, { jusqua: number; horaires: number[] }>();
export function horairesSession(fichier: string, fenetre = 2 * 3600_000): number[] {
    let e = horairesConnus.get(fichier);
    try {
        const taille = fs.statSync(fichier).size;
        if (!e || taille < e.jusqua) e = { jusqua: Math.max(0, taille - 30_000_000), horaires: [] };
        if (taille > e.jusqua) {
            const fd = fs.openSync(fichier, 'r');
            try {
                const octets = Buffer.alloc(taille - e.jusqua);
                const lus = fs.readSync(fd, octets, 0, octets.length, e.jusqua);
                const fin = octets.lastIndexOf(0x0a, lus - 1) + 1;   // une ligne en cours d'écriture attend
                for (let i = octets.indexOf(MARQUE_DATE); i >= 0 && i < fin; i = octets.indexOf(MARQUE_DATE, i + 1)) {
                    const t = Date.parse(octets.toString('latin1', i + MARQUE_DATE.length, i + MARQUE_DATE.length + 24));
                    if (t) e.horaires.push(t);
                }
                e.jusqua += fin;
            } finally {
                fs.closeSync(fd);
            }
        }
        const limite = Date.now() - fenetre;
        if (e.horaires.length && e.horaires[0] < limite) e.horaires = e.horaires.filter((t) => t >= limite);
        if (horairesConnus.size > 80) horairesConnus.clear();
        horairesConnus.set(fichier, e);
    } catch {
        // transcript pas encore créé
    }
    return e?.horaires ?? [];
}

// Activité par minute sur les `minutes` dernières minutes (la plus ancienne d'abord)
export function rythme(horaires: number[] = [], minutes = 10, maintenant = Date.now()): number[] {
    const seaux = new Array(minutes).fill(0);
    for (const h of horaires) {
        const age = Math.floor((maintenant - h) / 60_000);
        if (age >= 0 && age < minutes) seaux[minutes - 1 - age]++;
    }
    return seaux;
}

// Taille du contexte au dernier tour de Claude : entrée + cache lu + cache écrit (lu dans la fin du transcript)
export function contexteSession(fichier: string): number | undefined {
    try {
        const taille = fs.statSync(fichier).size;
        const debut = Math.max(0, taille - 300_000);
        const { texte } = lireLignes(fichier, debut, taille);
        const lignes = texte.split('\n');
        for (let i = lignes.length - 1; i >= 0; i--) {
            const l = lignes[i];
            if (!l.includes('"type":"assistant"') || !l.includes('"usage"') || l.includes('"isSidechain":true')) continue;
            const n = (cle: string) => Number(new RegExp(`"${cle}":(\\d+)`).exec(l)?.[1] ?? 0);
            return n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens');
        }
    } catch {
        // transcript pas encore créé
    }
    return undefined;
}

// Limite de contexte probable : 200 k, ou 1 M quand la session a déjà dépassé 200 k
export const limiteContexte = (jetons: number) => (jetons > 200_000 ? 1_000_000 : 200_000);

// Fichiers que la session a créés ou modifiés (Edit, Write, MultiEdit, NotebookEdit), chemins absolus
export function fichiersModifies(fichier: string): string[] {
    const fichiers = new Set<string>();
    let texte = '';
    try {
        texte = fs.readFileSync(fichier, 'utf-8');
    } catch {
        return [];
    }
    for (const ligne of texte.split('\n')) {
        if (!ligne.includes('"tool_use"') || !/"name":"(Edit|Write|MultiEdit|NotebookEdit)"/.test(ligne)) continue;
        try {
            for (const bloc of JSON.parse(ligne).message?.content ?? []) {
                const chemin = bloc.input?.file_path ?? bloc.input?.notebook_path;
                if (bloc.type === 'tool_use' && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(bloc.name) && typeof chemin === 'string') fichiers.add(path.resolve(chemin));
            }
        } catch {
            // ligne illisible
        }
    }
    return [...fichiers];
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
    if (estIntegree(id)) { interrompreIntegree(id); return Promise.resolve('Interruption demandée'); }
    return claude(['stop', id]);
}

// Retire la session de la liste (la conversation reste) ; Claude supprime son worktree quand c'est sans risque
export function retirerArrierePlan(id: string): Promise<string> {
    if (estIntegree(id)) { archiverIntegree(id); return Promise.resolve('removed · conversation conservée'); }
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
    if (s.integree) {
        try { await envoyerIntegree(s.sessionId, texte); return { ok: true, message: 'message envoyé', id: s.sessionId }; }
        catch (e) { return { ok: false, message: (e as Error).message }; }
    }
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

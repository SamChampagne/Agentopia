import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import { CLAUDE } from './claude.js';
import { CHEMINS } from './chemins.js';
import { chargerConfig } from './config.js';
import { lireDonnees } from './ui/donnees.js';
import { lireEquipes, avancement } from './equipe.js';
import { ilYa } from './ui/Panneau.js';

// Le maître : un Claude toujours ouvert qui gère les sessions à ta place
// (« ferme les sessions finies », « relance mon-projet sur les tests », « où en est l'équipe ? »).
// Un seul processus claude -p reste ouvert (entrée/sortie en flux JSON) : seul le premier message
// paie le démarrage de Claude Code, les suivants répondent en 2 à 3 secondes, et il se souvient
// de la conversation. Il n'a aucun outil : il répond par des commandes Claudetopia, que l'on exécute
// (avec une confirmation pour celles qui arrêtent ou suppriment quelque chose).

export interface Echange {
    question: string;
    reponse?: string;
    commandes?: string[];
    erreur?: string;
    date: number;
}

// Commandes que le maître peut demander (le reste est refusé)
const COMMANDES_MAITRE: Record<string, string> = {
    '/voir <id>': 'ouvrir la conversation d\'une session à l\'écran',
    '/envoyer <sessionId> <message>': 'écrire à une session d\'arrière-plan qui t\'attend (sessionId = l\'identifiant long)',
    '/fermer <id ou pid> --oui': 'fermer une session : arrière-plan (id) = arrêtée et retirée, reprenable plus tard ; onglet (pid) = Claude arrêté dans son onglet',
    '/arreter <id> --oui': 'mettre en pause une session d\'arrière-plan (elle reste dans la liste)',
    '/claude <projet> <consigne>': 'nouvelle session en arrière-plan qui travaille sur la consigne',
    '/onglet <projet>': 'ouvrir Claude dans un onglet',
    '/equipe <projet> -- <objectif>': 'créer une équipe d\'agents (plan puis tâches en parallèle)',
    '/equipe <idEquipe>': 'ouvrir une équipe',
    '/terminal <pwsh|cmd|bash|wsl> <projet>': 'ouvrir un terminal dans un projet',
    '/code <projet>': 'ouvrir dans VS Code',
    '/commit <projet>': 'commit avec message IA',
    '/revue <projet>': 'revue du diff par Claude',
    '/pull <projet>': 'git pull',
    '/section <docker|ssh>': 'afficher / masquer une section de la colonne de gauche',
    '/ssh <serveur>': 'se connecter à un serveur',
    '/git': 'vue Git', '/docker': 'vue Docker', '/projets': 'vue Projets', '/equipe': 'liste des équipes',
};
const AUTORISEES = new Set(Object.keys(COMMANDES_MAITRE).map((c) => c.split(' ')[0]));
export const DESTRUCTRICES = new Set(['/fermer', '/arreter', '/retirer']);

const CONSIGNE = `Tu es le MAÎTRE de Claudetopia, le poste de pilotage des sessions Claude Code de l'utilisateur.
Tu gères ses sessions et projets à sa place. Tu ne fais rien toi-même : tu réponds TOUJOURS et UNIQUEMENT avec ce JSON :
{"reponse": "1 ou 2 phrases courtes en français", "commandes": ["/commande …", …]}

Commandes possibles :
${Object.entries(COMMANDES_MAITRE).map(([c, d]) => `${c} : ${d}`).join('\n')}

Règles :
- Chaque message contient l'ÉTAT à jour (sessions, équipes, projets). N'utilise que les ids et noms qui y figurent.
- Une question d'information (« qu'est-ce qui tourne ? ») : réponds d'après l'ÉTAT, sans commande.
- Demande ambiguë ou session introuvable : pose une question courte, sans commande.
- « Fermer » une session = /fermer (son id si elle est en arrière-plan, son pid si c'est un onglet).
- Ne propose que ce qui est demandé. Dans "reponse", dis ce que tu fais (« Je ferme les 2 sessions finies de mon-projet »).`;

export const maitre = new EventEmitter();
const historique: Echange[] = [];
let proc: ChildProcessWithoutNullStreams | undefined;
let tampon = '';
let attente: ((r: { texte?: string; erreur?: string }) => void) | undefined;
let pret = false;
let enCours = false;
let messages = 0;
let derniereErreur = '';
let projetsEnvoyes = false;     // la liste des projets part avec le premier message de chaque processus

const publier = () => maitre.emit('maj');

export function etatMaitre() {
    return { historique, enCours, pret, erreur: derniereErreur, pid: proc?.pid, enVeille };
}

// ─── Veille : le maître garde ~250 Mo de mémoire ; inutilisé, il s'arrête (il redémarre à la demande) ───
// Moins de 12 Go de RAM : il ne démarre qu'au premier besoin et s'endort après 5 min ; sinon après 30 min.
const PEU_DE_MEMOIRE = os.totalmem() < 12 * 1024 ** 3;
const VEILLE = (chargerConfig().maitre?.veille ?? (PEU_DE_MEMOIRE ? 5 : 30)) * 60_000;
let enVeille = PEU_DE_MEMOIRE;
let derniereUtilisation = Date.now();
setInterval(() => {
    if (proc && !enCours && VEILLE > 0 && Date.now() - derniereUtilisation > VEILLE) {
        enVeille = true;
        proc.removeAllListeners('exit');
        arreterMaitre();
        proc = undefined;
        pret = false;
        publier();
    }
}, 60_000).unref();

function dossierMaitre(): string {
    try {
        fs.mkdirSync(CHEMINS.maitre, { recursive: true });
        return CHEMINS.maitre;
    } catch {
        return os.homedir();
    }
}

function demarrer(): void {
    if (proc) return;
    const modele = chargerConfig().maitre?.modele || 'haiku';
    try {
        proc = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
            '--model', modele, '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--append-system-prompt', CONSIGNE],
        { cwd: dossierMaitre(), shell: CLAUDE === 'claude' }) as ChildProcessWithoutNullStreams;
    } catch (e) {
        derniereErreur = (e as Error).message;
        return;
    }
    process.once('exit', arreterMaitre);
    // Priorité basse : son démarrage (une dizaine de secondes de calcul) ne doit pas ralentir l'interface
    try {
        if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
        // pas grave
    }
    messages = 0;
    projetsEnvoyes = false;
    tampon = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (d: string) => {
        tampon += d;
        const lignes = tampon.split('\n');
        tampon = lignes.pop() ?? '';
        for (const l of lignes) {
            let o;
            try {
                o = JSON.parse(l);
            } catch {
                continue;
            }
            if (o.type === 'result') {
                const r = attente;
                attente = undefined;
                r?.(o.is_error ? { erreur: String(o.result ?? 'erreur') } : { texte: String(o.result ?? '') });
            }
        }
    });
    proc.stderr.on('data', () => undefined);
    const fin = (raison: string) => {
        proc = undefined;
        pret = false;
        const r = attente;
        attente = undefined;
        r?.({ erreur: raison });
        publier();
    };
    proc.on('error', (e) => fin(e.message.includes('ENOENT') ? 'Claude Code introuvable' : e.message));
    proc.on('exit', () => fin('le maître s\'est arrêté (il redémarre à la prochaine demande)'));
}

// Un message à la fois : une demande tapée pendant le démarrage attend sa réponse au lieu de prendre la sienne
let file: Promise<unknown> = Promise.resolve();
function envoyer(texte: string, delai = 90_000): Promise<{ texte?: string; erreur?: string }> {
    const suivant = file.then(() => envoyerMaintenant(texte, delai));
    file = suivant.catch(() => undefined);
    return suivant;
}

function envoyerMaintenant(texte: string, delai: number): Promise<{ texte?: string; erreur?: string }> {
    demarrer();
    if (!proc) return Promise.resolve({ erreur: derniereErreur || 'impossible de démarrer le maître' });
    messages++;
    return new Promise((ok) => {
        const minuterie = setTimeout(() => {
            attente = undefined;
            ok({ erreur: 'pas de réponse du maître' });
        }, delai);
        attente = (r) => {
            clearTimeout(minuterie);
            ok(r);
        };
        proc!.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: texte } }) + '\n');
    });
}

// Au lancement de Claudetopia : le maître démarre en arrière-plan pour que la première demande soit rapide
export async function prechauffer(projets: string[]): Promise<void> {
    if (pret || proc || PEU_DE_MEMOIRE || chargerConfig().maitre?.actif === false) return;
    derniereUtilisation = Date.now();
    enVeille = false;
    const r = await envoyer(`Démarrage. Projets de l'utilisateur : ${projets.join(', ')}\nRéponds {"reponse":"prêt","commandes":[]}`);
    projetsEnvoyes = !r.erreur;
    pret = !r.erreur;
    derniereErreur = r.erreur ?? '';
    publier();
}

export function arreterMaitre(): void {
    proc?.kill();
}

// ─── État envoyé avec chaque demande ─────────────────────────────────────────

function etatTexte(sessionOuverte?: string): string {
    const d = lireDonnees();
    const statuts: Record<string, string> = { travaille: 'travaille', attend: 't\'attend (a fini)', bloquee: 'attend une permission', terminee: 'terminée' };
    const sessions = d.agents.map((a) => {
        const act = d.activites.get(a.sessionId);
        return `- ${a.arrierePlan ? `id=${a.id} sessionId=${a.sessionId} (arrière-plan)` : `onglet pid=${a.pid}`} projet=${a.nom} statut=${statuts[a.statut]}`
            + ` titre="${(a.titre || '').slice(0, 80)}"${act?.date ? ` activité il y a ${ilYa(act.date)}` : ''}${act?.dernierTexte ? ` dernier message="${act.dernierTexte.replace(/\s+/g, ' ').slice(0, 120)}"` : ''}`;
    });
    const equipes = lireEquipes().map((e) => {
        const a = avancement(e);
        return `- idEquipe=${e.id} projet=${e.nomProjet} état=${e.etat} ${a.faites}/${a.total} tâches objectif="${e.objectif.slice(0, 100)}"`;
    });
    return [
        `ÉTAT (${new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })})`,
        `Sessions (${sessions.length}) :`, ...(sessions.length ? sessions : ['- aucune']),
        `Équipes (${equipes.length}) :`, ...(equipes.length ? equipes : ['- aucune']),
        `Session ouverte à l'écran : ${sessionOuverte ?? 'aucune'}`,
        `Serveurs SSH : ${d.serveurs.map((s) => s.nom).join(', ') || 'aucun'}`,
    ].join('\n');
}

function lireReponse(texte: string): { reponse: string; commandes: string[] } {
    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    try {
        const o = JSON.parse(texte.slice(debut, fin + 1));
        return { reponse: String(o.reponse ?? ''), commandes: Array.isArray(o.commandes) ? o.commandes.map(String) : [] };
    } catch {
        return { reponse: texte.trim(), commandes: [] };
    }
}

// Une demande de l'utilisateur. Renvoie les commandes autorisées à exécuter (à confirmer si destructrices).
export async function demanderAuMaitre(question: string, projets: string[], sessionOuverte?: string): Promise<Echange> {
    const echange: Echange = { question, date: Date.now() };
    historique.push(echange);
    if (historique.length > 30) historique.shift();
    enCours = true;
    enVeille = false;
    derniereUtilisation = Date.now();
    publier();
    // Contexte qui grandit à chaque échange : on repart de zéro de temps en temps
    if (messages > 40) arreterMaitre();
    if (!proc) projetsEnvoyes = false;
    const r = await envoyer(`${etatTexte(sessionOuverte)}\n${projetsEnvoyes ? '' : `Projets : ${projets.join(', ')}\n`}\nDEMANDE : ${question}`);
    if (!r.erreur) projetsEnvoyes = true;
    enCours = false;
    if (r.erreur) {
        echange.erreur = r.erreur;
    } else {
        pret = true;
        const { reponse, commandes } = lireReponse(r.texte ?? '');
        echange.reponse = reponse;
        echange.commandes = commandes.filter((c) => AUTORISEES.has(c.trim().split(/\s+/)[0]));
    }
    publier();
    return echange;
}

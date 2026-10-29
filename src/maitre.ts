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
import { fournisseurMaitre, nomMaitre, conseiller, interrompreConseil, validerPlanMaitre, type PlanMaitre } from './conseiller.js';

// Conseil à la demande avec le fournisseur choisi. Le transport Claude CLI reste
// disponible pour les abonnements natifs ; les autres passent par leurs adaptateurs.

export interface Echange {
    question: string;
    reponse?: string;
    commandes?: string[];
    erreur?: string;
    date: number;
    plan?: PlanMaitre;
}

// Commandes que le maître peut demander (le reste est refusé)
const COMMANDES_MAITRE: Record<string, string> = {
    '/voir <id>': 'ouvrir la conversation d\'une session à l\'écran',
    '/envoyer <sessionId> <message>': 'écrire à une session d\'arrière-plan qui t\'attend (sessionId = l\'identifiant long)',
    '/fermer <id ou pid> --oui': 'fermer une session : arrière-plan (id) = arrêtée et retirée, reprenable plus tard ; onglet (pid) = Claude arrêté dans son onglet',
    '/arreter <id> --oui': 'mettre en pause une session d\'arrière-plan (elle reste dans la liste)',
    '/session <projet> <consigne>': 'nouvelle conversation avec l’agent par défaut ou le choix du fournisseur',
    '/claude <projet> <consigne>': 'nouvelle conversation Claude intégrée (API Anthropic)',
    '/codex <projet> <consigne>': 'nouvelle conversation Codex intégrée',
    '/perplexity <projet> <consigne>': 'nouvelle recherche Perplexity intégrée (web uniquement)',
    '/onglet <projet>': 'ouvrir Claude dans un onglet',
    '/equipe <projet> -- <objectif>': 'créer une équipe Claude CLI (plan puis tâches en parallèle)',
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

const CONSIGNE = `Tu es le MAÎTRE d’Agentopia, le poste de pilotage des agents et projets de l'utilisateur. Tu gères les sessions intégrées Codex, Claude et Perplexity ainsi que Claude CLI.
Tu gères ses sessions et projets à sa place. Tu ne fais rien toi-même : tu réponds TOUJOURS et UNIQUEMENT avec ce JSON :
{"reponse": "1 ou 2 phrases courtes en français", "commandes": ["/commande …", …]}

Pour un objectif qui demande une équipe, propose plutôt un plan sans commande :
{"reponse":"Le plan proposé","commandes":[],"plan":{"projet":"nom exact du projet","objectif":"...","taches":[{"titre":"...","fournisseur":"codex","consigne":"...","dependances":[]}]}}
De 1 à 8 tâches, identifiants implicites t1, t2, etc. Fournisseurs : claude, codex, perplexity. Perplexity fait uniquement de la recherche web. Les tâches qui modifient les mêmes fichiers doivent dépendre les unes des autres. L'utilisateur voit le plan et choisit avant le démarrage.

Commandes possibles :
${Object.entries(COMMANDES_MAITRE).map(([c, d]) => `${c} : ${d}`).join('\n')}

Règles :
- Chaque message contient l'ÉTAT à jour (sessions, équipes, projets). N'utilise que les ids et noms qui y figurent.
- Une question d'information (« qu'est-ce qui tourne ? ») : réponds d'après l'ÉTAT, sans commande.
- Demande ambiguë ou session introuvable : pose une question courte, sans commande.
- Nouvelle conversation sans fournisseur nommé : utilise /session. Si un fournisseur est nommé, respecte ce choix. N’affirme jamais qu’un agent voit l’historique d’un autre sans transmission explicite.
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

const publier = () => maitre.emit('maj');

export function etatMaitre() {
    return { historique, enCours, pret, erreur: derniereErreur, pid: proc?.pid, enVeille, fournisseur: nomMaitre(fournisseurMaitre(chargerConfig())) };
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
        arreterMaitre();
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
        { cwd: dossierMaitre(), shell: CLAUDE === 'claude', windowsHide: true }) as ChildProcessWithoutNullStreams;
    } catch (e) {
        derniereErreur = (e as Error).message;
        return;
    }
    if (!process.listeners('exit').includes(arreterMaitre)) process.once('exit', arreterMaitre);
    const courant = proc;
    // Priorité basse : son démarrage (une dizaine de secondes de calcul) ne doit pas ralentir l'interface
    try {
        if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
        // pas grave
    }
    messages = 0;
    tampon = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (d: string) => {
        if (proc !== courant) return;
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
        if (proc !== courant) return;
        proc = undefined;
        pret = false;
        const r = attente;
        attente = undefined;
        r?.({ erreur: raison });
        publier();
    };
    proc.on('error', (e) => fin(e.message.includes('ENOENT') ? 'Claude Code introuvable' : e.message));
    proc.stdin.on('error', (e) => fin(`Connexion au maître interrompue : ${e.message}`));
    proc.on('exit', () => fin('le maître s\'est arrêté (il redémarre à la prochaine demande)'));
}

// Un message à la fois : une demande tapée pendant le démarrage attend sa réponse au lieu de prendre la sienne
let file: Promise<unknown> = Promise.resolve();
function envoyer(texte: string, delai = 90_000): Promise<{ texte?: string; erreur?: string }> {
    const suivant = file.then(() => {
        const f = fournisseurMaitre(chargerConfig());
        if (!f) return { erreur: 'Aucun agent configuré pour le maître · Config → Préparer le poste' };
        return f === 'claude-cli' ? envoyerMaintenant(texte, delai) : conseiller(f, `${CONSIGNE}\n\n${texte}`);
    });
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
            arreterMaitre();
            ok({ erreur: 'pas de réponse du maître' });
        }, delai);
        attente = (r) => {
            clearTimeout(minuterie);
            ok(r);
        };
        proc!.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: texte } }) + '\n');
    });
}

// Au lancement, publier seulement la disponibilité locale, sans génération.
export async function prechauffer(projets: string[]): Promise<void> {
    // Aucun modèle n'est appelé au démarrage. Le premier appel attend une vraie demande.
    pret = !!fournisseurMaitre(chargerConfig());
    enVeille = true;
    publier();
}

export function arreterMaitre(): void {
    const ancien = proc;
    proc = undefined;
    pret = false;
    const r = attente; attente = undefined;
    r?.({ erreur: 'Demande interrompue' });
    ancien?.kill();
    interrompreConseil();
}

// ─── État envoyé avec chaque demande ─────────────────────────────────────────

function etatTexte(sessionOuverte?: string): string {
    const d = lireDonnees();
    const statuts: Record<string, string> = { travaille: 'travaille', attend: 't\'attend (a fini)', bloquee: 'attend une permission', terminee: 'terminée' };
    const sessions = d.agents.map((a) => {
        const act = d.activites.get(a.sessionId);
        return `- ${a.arrierePlan ? `id=${a.id} sessionId=${a.sessionId} (arrière-plan)` : `onglet pid=${a.pid}`} agent=${a.fournisseur ?? 'claude-cli'} projet=${a.nom} statut=${statuts[a.statut]}`
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

function lireReponse(texte: string): { reponse: string; commandes: string[]; plan?: unknown } {
    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    try {
        const o = JSON.parse(texte.slice(debut, fin + 1));
        return { reponse: String(o.reponse ?? ''), commandes: Array.isArray(o.commandes) ? o.commandes.map(String) : [], plan: o.plan };
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
    const contexte = historique.slice(-9, -1).map((e) => `Utilisateur : ${e.question}\nMaître : ${e.reponse || e.erreur || ''}`).join('\n');
    const r = await envoyer(`${etatTexte(sessionOuverte)}\nProjets : ${projets.join(', ')}\n${contexte}\nDEMANDE : ${question}`).catch((e) => ({ erreur: (e as Error).message, texte: undefined }));
    enCours = false;
    if (r.erreur) {
        echange.erreur = r.erreur;
    } else {
        pret = true;
        const { reponse, commandes, plan } = lireReponse(r.texte ?? '');
        echange.reponse = reponse;
        echange.commandes = commandes.filter((c) => AUTORISEES.has(c.trim().split(/\s+/)[0]));
        if (plan) {
            try { echange.plan = validerPlanMaitre(plan, projets); echange.commandes = []; }
            catch (e) { echange.erreur = (e as Error).message; echange.commandes = []; }
        }
    }
    publier();
    return echange;
}

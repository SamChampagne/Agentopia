import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { spawnSync } from 'child_process';
import { CHEMINS } from './chemins.js';
import { chargerConfig } from './config.js';
import { demanderClaude } from './claude.js';
import { SessionVue, lancerArrierePlan, arreterArrierePlan, retirerArrierePlan, lireTranscript } from './agents.js';
import { trouverDepot } from './git.js';
import { toast } from './notifications.js';

// Équipe d'agents sur un projet :
//   1. un chef d'équipe (claude -p, lecture seule) découpe l'objectif en tâches, chacune avec un rôle métier
//   2. chaque tâche devient une session d'arrière-plan dans son propre worktree git, en parallèle
//      (les tâches qui dépendent d'autres attendent, puis récupèrent leur branche)
//   3. quand tout est fait, un intégrateur fusionne les branches dans le dossier du projet
// Les équipes sont gardées dans ~/.claudetopia-equipes.json : elles survivent à un redémarrage.

export interface Role {
    nom: string;
    icone: string;
    couleur: string;
    consigne: string;
}

export const ROLES: Record<string, Role> = {
    architecte: { nom: 'Architecte', icone: '◇', couleur: '#c084fc', consigne: 'Tu es l\'architecte logiciel de l\'équipe : structure, interfaces entre modules, choix techniques. Tu poses des fondations simples que les autres agents pourront suivre.' },
    backend: { nom: 'Dev backend', icone: '▣', couleur: '#60a5fa', consigne: 'Tu es développeur backend : API, logique métier, accès aux données. Code robuste, erreurs gérées, conventions du projet respectées.' },
    frontend: { nom: 'Dev frontend', icone: '▤', couleur: '#f472b6', consigne: 'Tu es développeur frontend : interface, composants, accessibilité, cohérence visuelle avec l\'existant.' },
    data: { nom: 'Données / SQL', icone: '◫', couleur: '#34d399', consigne: 'Tu es spécialiste des données : schéma, requêtes SQL, migrations, performances des requêtes, intégrité des données.' },
    tests: { nom: 'Testeur', icone: '✓', couleur: '#4ade80', consigne: 'Tu es testeur : tu écris des tests utiles (cas normaux, limites, erreurs), tu les lances et tu corriges ce qui échoue.' },
    securite: { nom: 'Sécurité', icone: '!', couleur: '#f87171', consigne: 'Tu es expert sécurité : injections, authentification, secrets, validation des entrées. Tu corriges ce que tu trouves.' },
    doc: { nom: 'Documentation', icone: '≡', couleur: '#facc15', consigne: 'Tu es rédacteur technique : README, commentaires utiles, guides d\'utilisation, clairs et à jour.' },
    devops: { nom: 'DevOps', icone: '◎', couleur: '#fb923c', consigne: 'Tu es DevOps : build, scripts, Docker, CI, configuration de déploiement.' },
    dev: { nom: 'Développeur', icone: '▸', couleur: '#94a3b8', consigne: 'Tu es développeur dans une équipe d\'agents.' },
    integrateur: { nom: 'Intégrateur', icone: '⇄', couleur: '#22d3ee', consigne: 'Tu es l\'intégrateur de l\'équipe : tu fusionnes le travail des autres agents, résous les conflits en gardant l\'intention de chacun, et vérifies que tout compile et que les tests passent.' },
};

export const role = (cle: string): Role => ROLES[cle] ?? ROLES.dev;

export type EtatTache = 'attente' | 'en cours' | 'bloquee' | 'faite' | 'erreur' | 'arretee';

export interface Tache {
    id: string;
    titre: string;
    role: string;
    consigne: string;
    dependances: string[];
    etat: EtatTache;
    agentId?: string;            // id court de la session d'arrière-plan
    sessionId?: string;
    cwd?: string;                // dossier du worktree
    branche?: string;
    resultat?: string;           // résumé final de l'agent, ou l'erreur
    debut?: number;
    fin?: number;
    vuTravailler?: boolean;
    absentDepuis?: number;
}

export type EtatEquipe = 'planification' | 'plan' | 'en cours' | 'prete' | 'integration' | 'finie' | 'erreur';

export interface Equipe {
    id: string;
    projet: string;              // dossier du dépôt git
    nomProjet: string;
    objectif: string;
    resume: string;
    etat: EtatEquipe;
    message?: string;            // explication d'une erreur
    taches: Tache[];
    integrateur?: Tache;
    creee: number;
    archivee?: boolean;
}

export const equipes = new EventEmitter();
let liste: Equipe[] = charger();

function charger(): Equipe[] {
    try {
        return JSON.parse(fs.readFileSync(CHEMINS.equipes, 'utf-8'));
    } catch {
        return [];
    }
}

let ecrit = '';
function sauver(): void {
    try {
        ecrit = JSON.stringify(liste, null, 2);
        fs.writeFileSync(CHEMINS.equipes, ecrit, 'utf-8');
    } catch {
        // disque plein, fichier verrouillé : l'état reste en mémoire
    }
    equipes.emit('maj');
}

// Une autre fenêtre Claudetopia a modifié les équipes : on relit le fichier
let surveillance: fs.FSWatcher | undefined;
export function suivreFichierEquipes(): void {
    if (surveillance) return;
    try {
        if (!fs.existsSync(CHEMINS.equipes)) fs.writeFileSync(CHEMINS.equipes, '[]', 'utf-8');
        surveillance = fs.watch(CHEMINS.equipes, () => {
            let contenu = '';
            try {
                contenu = fs.readFileSync(CHEMINS.equipes, 'utf-8');
                if (contenu === ecrit) return;
                liste = JSON.parse(contenu);
                ecrit = contenu;
                equipes.emit('maj');
            } catch {
                // écriture en cours : le prochain événement relira
            }
        });
        surveillance.on('error', () => undefined);
    } catch {
        // pas de surveillance : chaque fenêtre garde son état
    }
}

export const lireEquipes = (): Equipe[] => liste.filter((e) => !e.archivee);
export const equipeDe = (id: string): Equipe | undefined => liste.find((e) => e.id === id);

// Ids des sessions qui appartiennent à une équipe (pour les regrouper en une seule carte)
export function agentsDesEquipes(): Set<string> {
    const ids = new Set<string>();
    for (const e of lireEquipes()) for (const t of [...e.taches, ...(e.integrateur ? [e.integrateur] : [])]) if (t.agentId) ids.add(t.agentId);
    return ids;
}

export function avancement(e: Equipe): { faites: number; total: number; actives: number; bloquees: number } {
    return {
        faites: e.taches.filter((t) => t.etat === 'faite').length,
        total: e.taches.length,
        actives: e.taches.filter((t) => t.etat === 'en cours').length,
        bloquees: e.taches.filter((t) => t.etat === 'bloquee').length + (e.integrateur?.etat === 'bloquee' ? 1 : 0),
    };
}

// ─── Vérifications ───────────────────────────────────────────────────────────

// Claude refuse de lancer une session d'arrière-plan dans un dossier qu'on n'a jamais accepté
export function estDeConfiance(dossier: string): boolean {
    try {
        const projets = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf-8')).projects ?? {};
        const norme = (s: string) => path.resolve(s).toLowerCase();
        return Object.entries(projets).some(([chemin, p]) => norme(chemin) === norme(dossier) && (p as { hasTrustDialogAccepted?: boolean }).hasTrustDialogAccepted);
    } catch {
        return true;   // on ne sait pas : on laisse Claude répondre
    }
}

const git = (args: string[], cwd: string) => spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout?.trim() ?? '';

// ─── Création et plan ────────────────────────────────────────────────────────

export function creerEquipe(projet: { chemin: string; nom: string }, objectif: string): Equipe {
    const depot = trouverDepot(projet.chemin);
    if (!depot) throw new Error(`${projet.nom} n'est pas un dépôt git : chaque agent travaille dans son propre worktree git`);
    if (!git(['rev-parse', '--verify', 'HEAD'], depot)) throw new Error(`${projet.nom} n'a encore aucun commit : fais un premier commit pour que les agents puissent créer leurs branches`);
    const e: Equipe = {
        id: Math.random().toString(16).slice(2, 6),
        projet: depot, nomProjet: projet.nom, objectif, resume: '', etat: 'planification', taches: [], creee: Date.now(),
    };
    liste.push(e);
    sauver();
    planifier(e);
    return e;
}

function promptChef(e: Equipe): string {
    const roles = Object.entries(ROLES).filter(([k]) => k !== 'integrateur' && k !== 'dev').map(([k, r]) => `${k} (${r.nom})`).join(', ');
    return `Tu es le chef d'une équipe d'agents Claude. Découpe l'objectif ci-dessous en tâches que plusieurs agents réaliseront EN PARALLÈLE dans ce dépôt, chacun dans son propre worktree git (sa propre branche).

OBJECTIF : ${e.objectif}

Explore d'abord rapidement le code (lecture seule) pour faire un plan réaliste et précis.

Règles du plan :
- 2 à 6 tâches. Chacune autonome, vérifiable, faisable par un seul agent.
- Deux tâches sans dépendance entre elles tournent en même temps : elles ne doivent pas modifier les mêmes fichiers. Si c'est inévitable, ajoute une dépendance.
- Une tâche qui a besoin du travail d'une autre la met dans "dependances" (elle démarrera après et récupérera sa branche).
- Rôle de chaque tâche parmi : ${roles}.
- La consigne dit précisément quoi faire, quels fichiers sont concernés et quand la tâche est finie.
- Ne prévois pas de tâche de fusion : un intégrateur s'en charge à la fin.

Réponds UNIQUEMENT avec ce JSON, sans texte autour :
{"resume": "le plan en une phrase", "taches": [{"id": "t1", "titre": "titre court (50 caractères max)", "role": "backend", "consigne": "…", "dependances": []}]}`;
}

function lireJson(texte: string): { resume?: string; taches?: Partial<Tache>[] } {
    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    if (debut < 0 || fin < debut) throw new Error('le chef d\'équipe n\'a pas renvoyé de plan lisible');
    return JSON.parse(texte.slice(debut, fin + 1));
}

export async function planifier(e: Equipe): Promise<void> {
    e.etat = 'planification';
    e.message = undefined;
    e.taches = [];
    sauver();
    try {
        const plan = lireJson(await demanderClaude(promptChef(e), { cwd: e.projet }));
        const taches = (plan.taches ?? []).slice(0, 8);
        if (!taches.length) throw new Error('le plan est vide');
        const ids = new Set(taches.map((t) => String(t.id)));
        e.taches = taches.map((t, i) => ({
            id: String(t.id ?? `t${i + 1}`),
            titre: String(t.titre ?? `Tâche ${i + 1}`).slice(0, 80),
            role: ROLES[String(t.role)] ? String(t.role) : 'dev',
            consigne: String(t.consigne ?? t.titre ?? ''),
            dependances: (Array.isArray(t.dependances) ? t.dependances.map(String) : []).filter((d) => ids.has(d) && d !== String(t.id)),
            etat: 'attente',
        }));
        e.resume = String(plan.resume ?? '');
        e.etat = 'plan';
    } catch (err) {
        e.etat = 'erreur';
        e.message = `Plan impossible : ${(err as Error).message.split('\n')[0]}`;
    }
    sauver();
}

// ─── Exécution ───────────────────────────────────────────────────────────────

export function lancerEquipe(id: string): string | undefined {
    const e = equipeDe(id);
    if (!e) return 'équipe introuvable';
    if (!estDeConfiance(e.projet)) {
        return `Claude n'a jamais été ouvert dans ${e.projet} : lance-le une fois dans un onglet et accepte « Trust this folder », puis relance l'équipe`;
    }
    for (const t of e.taches) if (t.etat === 'arretee' || t.etat === 'erreur') Object.assign(t, { etat: 'attente', agentId: undefined, resultat: undefined, vuTravailler: false, absentDepuis: undefined });
    e.etat = 'en cours';
    e.message = undefined;
    sauver();
    return undefined;
}

function consigneTache(e: Equipe, t: Tache): string {
    const deps = t.dependances.map((d) => e.taches.find((x) => x.id === d)).filter((x): x is Tache => !!x?.branche);
    const autres = e.taches.filter((x) => x !== t).map((x) => `- ${x.id} · ${x.titre} (${role(x.role).nom})`).join('\n');
    return `OBJECTIF DE L'ÉQUIPE : ${e.objectif}

TA TÂCHE (${t.id} · ${t.titre}) :
${t.consigne}
${deps.length ? `\nAvant de commencer, récupère le travail des tâches dont tu dépends :\n${deps.map((d) => `git merge ${d.branche}   (${d.titre})`).join('\n')}\n` : ''}
Les autres agents de l'équipe (en parallèle, chacun sur sa branche) :
${autres || '- aucun'}

Règles :
- Tu travailles dans ton propre worktree git. Limite-toi à ta tâche : ne fais pas le travail des autres.
- Quand tu as fini, vérifie (compilation, tests) si le projet le permet.
- Puis fais UN commit de ton travail sur ta branche (git add -A puis git commit avec un message clair). Ne pousse pas, ne fusionne pas dans la branche principale.
- Termine par un résumé de 3 à 5 lignes : ce que tu as fait, les fichiers touchés, ce qui reste à vérifier.`;
}

function consigneIntegration(e: Equipe): string {
    const branches = e.taches.filter((t) => t.branche).map((t) => `- ${t.branche} : ${t.titre}${t.resultat ? ` — ${t.resultat.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`).join('\n');
    return `OBJECTIF DE L'ÉQUIPE : ${e.objectif}

Les agents ont terminé ; chacun a commité son travail sur sa branche :
${branches}

Ta mission :
1. Fusionne ces branches dans la branche actuelle, une par une (git merge --no-ff <branche>).
2. Résous les conflits en gardant l'intention des deux côtés.
3. Si le projet a une compilation ou des tests, lance-les et corrige ce qui casse, puis commite.
4. Ne pousse pas.
Termine par un résumé : branches fusionnées, conflits résolus, état de la compilation et des tests.`;
}

const enLancement = new Set<Tache>();

async function demarrer(e: Equipe, t: Tache, dansWorktree: boolean): Promise<void> {
    enLancement.add(t);
    t.etat = 'en cours';
    t.debut = Date.now();
    t.vuTravailler = false;
    sauver();
    const r = role(t.role);
    const { id, sortie } = await lancerArrierePlan(
        e.projet,
        `${e.nomProjet} · ${t.titre}`.slice(0, 60),
        dansWorktree ? consigneTache(e, t) : consigneIntegration(e),
        undefined,
        { worktree: dansWorktree ? `equipe-${e.id}-${t.id}` : undefined, role: r.consigne, permissions: chargerConfig().equipe?.permissions || undefined },
    );
    enLancement.delete(t);
    if (id) t.agentId = id;
    else {
        t.etat = 'erreur';
        t.resultat = sortie.split('\n').find(Boolean) ?? 'la session n\'a pas démarré';
    }
    sauver();
}

function dernierTexte(fichier: string): string {
    const messages = lireTranscript(fichier, 400_000);
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i].texte.trim().slice(0, 1500);
    return '';
}

// Met une tâche à jour d'après l'état de sa session ; vrai si quelque chose a changé
function suivre(t: Tache, agents: SessionVue[]): boolean {
    if (!t.agentId || enLancement.has(t) || !['en cours', 'bloquee'].includes(t.etat)) return false;
    const avant = JSON.stringify(t);
    const maintenant = Date.now();
    const a = agents.find((x) => x.id === t.agentId);
    if (!a) {
        t.absentDepuis ??= maintenant;
        if (maintenant - t.absentDepuis > 60_000) {
            t.etat = 'arretee';
            t.resultat = 'la session a été arrêtée ou supprimée';
        }
    } else {
        t.absentDepuis = undefined;
        t.sessionId = a.sessionId;
        t.cwd = a.cwd;
        if (a.statut === 'travaille') {
            t.vuTravailler = true;
            t.etat = 'en cours';
        } else if (a.statut === 'bloquee') {
            t.vuTravailler = true;
            t.etat = 'bloquee';
        } else if (t.vuTravailler || maintenant - (t.debut ?? 0) > 120_000) {
            t.etat = 'faite';
            t.fin = maintenant;
            t.branche = git(['branch', '--show-current'], a.cwd) || undefined;
            t.resultat = dernierTexte(a.fichier);
        }
    }
    return JSON.stringify(t) !== avant;
}

// Appelé à chaque relevé des sessions (toutes les 2,5 s)
export function avancerEquipes(agents: SessionVue[]): void {
    let change = false;
    for (const e of lireEquipes()) {
        if (e.etat === 'en cours') {
            for (const t of e.taches) change = suivre(t, agents) || change;
            const parallele = Math.max(1, chargerConfig().equipe?.parallele || 3);
            let actives = e.taches.filter((t) => t.etat === 'en cours' || t.etat === 'bloquee').length;
            const prete = (t: Tache) => t.etat === 'attente' && t.dependances.every((d) => e.taches.find((x) => x.id === d)?.etat === 'faite');
            for (const t of e.taches.filter(prete)) {
                if (actives >= parallele) break;
                actives++;
                demarrer(e, t, true);
            }
            if (e.taches.every((t) => t.etat === 'faite')) {
                e.etat = 'prete';
                change = true;
                toast(`✓ Équipe ${e.nomProjet} : tout est fait`, 'Ouvre l\'équipe et clique « Intégrer » pour fusionner les branches');
            } else if (!actives && !e.taches.some(prete) && !enLancement.size) {
                e.etat = 'erreur';
                e.message = 'Des tâches ont échoué ou ont été arrêtées : relance-les, ou intègre ce qui est fait';
                change = true;
            }
        } else if (e.etat === 'integration' && e.integrateur) {
            change = suivre(e.integrateur, agents) || change;
            if (e.integrateur.etat === 'faite') {
                e.etat = 'finie';
                change = true;
                toast(`✓ Équipe ${e.nomProjet} : intégration finie`, e.integrateur.resultat?.split('\n')[0] ?? 'Les branches sont fusionnées');
            } else if (e.integrateur.etat === 'erreur' || e.integrateur.etat === 'arretee') {
                e.etat = 'prete';
                e.message = `Intégration interrompue : ${e.integrateur.resultat ?? ''}`;
                change = true;
            }
        }
    }
    if (change) sauver();
}

// Les modifications non commitées du dossier du projet gêneraient la fusion
export function modifsLocales(e: Equipe): number {
    return git(['status', '--porcelain'], e.projet).split('\n').filter(Boolean).length;
}

export async function integrer(id: string): Promise<string | undefined> {
    const e = equipeDe(id);
    if (!e) return 'équipe introuvable';
    if (!e.taches.some((t) => t.branche)) return 'aucune branche à fusionner';
    e.integrateur = { id: 'integration', titre: 'Intégration', role: 'integrateur', consigne: '', dependances: [], etat: 'attente' };
    e.etat = 'integration';
    e.message = undefined;
    await demarrer(e, e.integrateur, false);
    return e.integrateur.etat === 'erreur' ? e.integrateur.resultat : undefined;
}

export async function arreterEquipe(id: string): Promise<void> {
    const e = equipeDe(id);
    if (!e) return;
    const actives = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])].filter((t) => t.agentId && (t.etat === 'en cours' || t.etat === 'bloquee'));
    await Promise.all(actives.map((t) => arreterArrierePlan(t.agentId!)));
    for (const t of actives) {
        t.etat = 'arretee';
        t.resultat = 'arrêtée à ta demande';
    }
    e.etat = e.etat === 'integration' ? 'prete' : 'plan';
    sauver();
}

export function relancerTache(id: string, tache: string): string | undefined {
    const e = equipeDe(id);
    const t = e?.taches.find((x) => x.id === tache);
    if (!e || !t) return 'tâche introuvable';
    Object.assign(t, { etat: 'attente', agentId: undefined, resultat: undefined, vuTravailler: false, absentDepuis: undefined });
    return lancerEquipe(id);
}

export function retirerTache(id: string, tache: string): void {
    const e = equipeDe(id);
    if (!e || e.etat !== 'plan') return;
    e.taches = e.taches.filter((t) => t.id !== tache);
    for (const t of e.taches) t.dependances = t.dependances.filter((d) => d !== tache);
    sauver();
}

// Range l'équipe : les sessions sont retirées (Claude supprime leur worktree quand c'est sans risque) ;
// les branches restent dans le dépôt
export async function terminerEquipe(id: string): Promise<void> {
    const e = equipeDe(id);
    if (!e) return;
    await arreterEquipe(id);
    const sessions = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])].filter((t) => t.agentId);
    await Promise.all(sessions.map((t) => retirerArrierePlan(t.agentId!)));
    e.archivee = true;
    sauver();
}

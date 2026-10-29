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
import { createHash, randomUUID } from 'node:crypto';
import { validerDependances } from './equipePlan.js';
import { FOURNISSEURS, type Fournisseur } from './providers/types.js';
import { disponibilite } from './providers/config.js';
import { RACINE_SESSIONS, creerIntegree, envoyerIntegree, lireIntegree, ecrireAtomique } from './sessionsIntegrees.js';
import { commanderMoteur, localAuMoteur, moteurEnPause } from './moteurClient.js';
import { sousVerrou } from './verrou.js';
import { validerDefinitions, type DefinitionTache } from './modelesEquipes.js';
import { lireStockageEquipes, ecrireStockageEquipes, restaurerStockageEquipes, sauvegardeEquipes } from './stockageEquipes.js';
import { listerIntegrees, interrompreIntegree } from './sessionsIntegrees.js';

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

// Modèles d'équipe : des objectifs prêts à l'emploi (modifiables avant de lancer)
export const MODELES_EQUIPE: { nom: string; objectif: string }[] = [
    { nom: '! Audit de sécurité', objectif: 'Audite la sécurité du projet (secrets dans le code, injections SQL/XSS, authentification et droits, validation des entrées, dépendances vulnérables) et corrige ce qui est trouvé, avec un test pour chaque correction.' },
    { nom: '⇡ Mise à jour des dépendances', objectif: 'Mets à jour les dépendances du projet vers leurs dernières versions compatibles, adapte le code aux changements, et vérifie que la compilation et les tests passent. Liste dans CHANGELOG.md ce qui a changé.' },
    { nom: '✓ Couverture de tests', objectif: 'Augmente la couverture de tests sur les parties critiques du projet (logique métier, API, accès aux données) ; corrige les bugs que les nouveaux tests révèlent.' },
    { nom: '▲ Revue avant mise en production', objectif: 'Prépare une mise en production : revue du code récent (bugs, cas limites), vérification de la configuration et des migrations, gestion des erreurs et des journaux, puis une liste de vérification dans RELEASE.md.' },
    { nom: '≡ Documentation', objectif: 'Documente le projet : README (installation, configuration, commandes), architecture et flux de données, et commentaires utiles sur le code complexe.' },
    { nom: '◎ Performance', objectif: 'Trouve et corrige les problèmes de performance du projet (requêtes lentes ou en boucle, calculs répétés, chargements inutiles), en mesurant avant et après.' },
];

export type EtatTache = 'attente' | 'en cours' | 'bloquee' | 'faite' | 'erreur' | 'arretee';

export interface Tache {
    fournisseur?: Fournisseur;
    tentative?: string;
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
    ecartee?: boolean;           // écartée après lecture du diff : l'intégrateur ne fusionne pas sa branche
}

export type EtatEquipe = 'planification' | 'plan' | 'en cours' | 'prete' | 'integration' | 'finie' | 'erreur';

export interface Equipe {
    mixte?: boolean;
    base?: string;
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
let erreurLecture: string | undefined;
let liste: Equipe[] = [];
try { liste = charger(); } catch { /* L'interface doit permettre la récupération dès le démarrage. */ }
let empreintes = new Map(liste.map((e) => [e.id, JSON.stringify(e)]));
export const erreurStockageEquipes = () => erreurLecture;
export function rechargerEquipes(): void {
    try { liste = charger(); empreintes = new Map(liste.map((e) => [e.id, JSON.stringify(e)])); }
    finally { equipes.emit('maj'); }
}

function charger(): Equipe[] {
    try {
        const lues = lireStockageEquipes(); erreurLecture = undefined; return lues;
    } catch (e) {
        erreurLecture = (e as Error).message; throw e;
    }
}

let ecrit = '';
function sauver(): void {
    try { sousVerrou(`${CHEMINS.equipes}.verrou`, () => {
        // L'interface peut créer un plan pendant que le moteur suit une autre équipe.
        // Écrire seulement nos équipes modifiées conserve celles ajoutées ailleurs.
        const disque = new Map(charger().map((e) => [e.id, e]));
        for (const e of liste) if (JSON.stringify(e) !== empreintes.get(e.id)) disque.set(e.id, e);
        const locales = new Map(liste.map((e) => [e.id, e]));
        const fusion = [...disque.values()].map((e) => JSON.stringify(e) === JSON.stringify(locales.get(e.id)) ? locales.get(e.id)! : e);
        ecrireStockageEquipes(fusion);
        liste = fusion; ecrit = JSON.stringify(liste);
        empreintes = new Map(liste.map((e) => [e.id, JSON.stringify(e)]));
    }); } catch (e) {
        // Une commande échouée ne doit pas réapparaître lors de la prochaine sauvegarde.
        liste = [...empreintes.values()].map((v) => JSON.parse(v));
        equipes.emit('maj'); throw e;
    }
    equipes.emit('maj');
}

// Une autre fenêtre Agentopia a modifié les équipes : on relit le fichier
let surveillance: fs.FSWatcher | undefined;
export function suivreFichierEquipes(): void {
    if (surveillance) return;
    try {
        surveillance = fs.watch(path.dirname(CHEMINS.equipes), (_event, nom) => {
            if (nom && String(nom) !== path.basename(CHEMINS.equipes)) return;
            let contenu = '';
            try {
                contenu = fs.readFileSync(CHEMINS.equipes, 'utf-8');
                if (contenu === ecrit && !erreurLecture) return;
                rechargerEquipes();
                ecrit = contenu;
            } catch {
                try { rechargerEquipes(); } catch { /* Garde le dernier état lisible et affiche l'erreur. */ }
            }
        });
        surveillance.on('error', () => undefined);
        surveillance.unref();
    } catch {
        // pas de surveillance : chaque fenêtre garde son état
    }
}

export async function recupererEquipes(empreinte: string): Promise<string | undefined> {
    if (!localAuMoteur()) return commanderMoteur('recuperer-equipes', undefined, undefined, { empreinte });
    return sousVerrou(`${CHEMINS.equipes}.verrou`, () => {
        let lisible = false;
        try { charger(); lisible = true; } catch { /* Une réparation reste nécessaire. */ }
        if (lisible) throw new Error('Le fichier des équipes est de nouveau lisible. Aucune restauration effectuée.');
        if (sauvegardeEquipes().empreinte !== empreinte) throw new Error('La sauvegarde a changé. Consulte-la de nouveau avant de restaurer.');
        // Une sauvegarde peut être antérieure à une tâche déjà exécutée : aucune reprise automatique.
        fs.mkdirSync(CHEMINS.moteur, { recursive: true });
        ecrireAtomique(path.join(CHEMINS.moteur, 'pause.json'), { date: Date.now() });
        for (const s of listerIntegrees(true)) interrompreIntegree(s.id);
        const copie = restaurerStockageEquipes(empreinte);
        rechargerEquipes(); return copie;
    });
}

export const lireEquipes = (): Equipe[] => liste.filter((e) => !e.archivee);
export const equipeDe = (id: string): Equipe | undefined => liste.find((e) => e.id === id);

export const peutModifierPlan = (e: Equipe): boolean => !!e.mixte && !e.archivee && e.etat === 'plan' && !e.integrateur
    && e.taches.every((t) => t.etat === 'attente' && !t.agentId && !t.cwd && !t.debut);
export const empreintePlan = (e: Equipe): string => createHash('sha256').update(JSON.stringify({ objectif: e.objectif,
    taches: e.taches.map(({ id, titre, fournisseur, consigne, dependances }) => ({ id, titre, fournisseur, consigne, dependances })) })).digest('hex');
export interface ModificationPlan { attendu: string; objectif: string; taches: DefinitionTache[] }
export async function modifierPlan(id: string, modification: ModificationPlan): Promise<string | undefined> {
    if (!localAuMoteur()) return commanderMoteur('modifier-plan', id, undefined, modification);
    const e = equipeDe(id);
    if (!e || !peutModifierPlan(e)) return 'Le plan est modifiable seulement avant le premier lancement';
    if (!modification || empreintePlan(e) !== modification.attendu) return 'Le plan a changé dans une autre fenêtre. Rouvre-le avant de modifier';
    if (typeof modification.objectif !== 'string' || !modification.objectif.trim() || modification.objectif.length > 32_000) return 'Donne un objectif de 1 à 32 000 caractères';
    let definitions: DefinitionTache[];
    try { definitions = validerDefinitions(modification.taches); } catch (err) { return (err as Error).message; }
    e.objectif = modification.objectif.trim();
    e.taches = definitions.map((t, i) => ({ ...t, id: `t${i + 1}`, etat: 'attente', role: FOURNISSEURS[t.fournisseur].code ? 'dev' : 'doc', tentative: randomUUID().slice(0, 8) }));
    e.message = undefined; sauver(); return undefined;
}

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

export function creerEquipeMixte(projet: { chemin: string; nom: string }, objectif: string,
    definitions: { titre: string; fournisseur: Fournisseur; consigne: string; dependances: string[] }[]): Equipe {
    const depot = trouverDepot(projet.chemin);
    if (!depot || !git(['rev-parse', '--verify', 'HEAD'], depot)) throw new Error('Un dépôt Git avec au moins un commit est requis');
    const taches: Tache[] = validerDefinitions(definitions).map((d, i) => ({ ...d, id: `t${i + 1}`, etat: 'attente',
        role: d.fournisseur === 'perplexity' ? 'doc' : 'dev', tentative: randomUUID().slice(0, 8) }));
    validerDependances(taches);
    const e: Equipe = { id: randomUUID().slice(0, 8), mixte: true, base: git(['rev-parse', 'HEAD'], depot), projet: depot, nomProjet: projet.nom,
        objectif, resume: 'Résultats et sources transmis entre tâches ; chaque agent de code a son worktree.',
        etat: 'plan', taches, creee: Date.now() };
    liste.push(e); sauver(); return e;
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
    if (e.mixte) { e.message = 'Ce plan a été défini avec tes fournisseurs. Crée une autre équipe pour changer sa composition.'; sauver(); return; }
    e.etat = 'planification';
    e.message = undefined;
    e.taches = [];
    sauver();
    try {
        const plan = lireJson(await demanderClaude(promptChef(e), { cwd: e.projet }));
        const taches = (plan.taches ?? []).slice(0, 8);
        if (!taches.length) throw new Error('le plan est vide');
        e.taches = taches.map((t, i) => ({
            id: String(t.id ?? `t${i + 1}`),
            titre: String(t.titre ?? `Tâche ${i + 1}`).slice(0, 80),
            role: ROLES[String(t.role)] ? String(t.role) : 'dev',
            consigne: String(t.consigne ?? t.titre ?? ''),
            dependances: Array.isArray(t.dependances) ? t.dependances.map(String) : [],
            etat: 'attente',
        }));
        validerDependances(e.taches);
        e.resume = String(plan.resume ?? '');
        e.etat = 'plan';
    } catch (err) {
        e.etat = 'erreur';
        e.message = `Plan impossible : ${(err as Error).message.split('\n')[0]}`;
    }
    sauver();
}

// ─── Exécution ───────────────────────────────────────────────────────────────

export async function lancerEquipe(id: string): Promise<string | undefined> {
    if (!localAuMoteur()) return commanderMoteur('lancer', id);
    const e = equipeDe(id);
    if (!e || e.archivee) return 'équipe introuvable';
    if (moteurEnPause()) return 'Moteur en pause · Reprends le moteur avant de lancer';
    if (e.etat === 'finie') return 'Cette équipe est déjà intégrée';
    if (e.etat === 'en cours') return undefined;
    if (e.etat === 'integration') return 'L’intégration est déjà en cours';
    try { validerDependances(e.taches); } catch (err) { return (err as Error).message; }
    if (e.mixte) {
        for (const f of new Set(e.taches.map((t) => t.fournisseur!))) {
            const d = disponibilite(f); if (!d.pret) return `${FOURNISSEURS[f].nom} : ${d.texte}`;
        }
        if (modifsLocales(e)) return 'Commite ou range tes modifications locales avant de lancer : les agents partent du dernier commit.';
        // Le projet peut avoir avancé depuis la création du plan. Les reprises gardent leur base.
        if (peutModifierPlan(e)) e.base = gitVerifie(['rev-parse', '--verify', 'HEAD'], e.projet);
    }
    if (!e.mixte && !estDeConfiance(e.projet)) {
        return `Claude n'a jamais été ouvert dans ${e.projet} : lance-le une fois dans un onglet et accepte « Trust this folder », puis relance l'équipe`;
    }
    for (const t of e.taches) if (t.etat === 'arretee' || t.etat === 'erreur') Object.assign(t, { etat: 'attente', agentId: undefined, sessionId: undefined, branche: undefined, cwd: undefined, resultat: undefined, vuTravailler: false, absentDepuis: undefined, tentative: randomUUID().slice(0, 8) });
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
    const branches = e.taches.filter((t) => t.branche && !t.ecartee).map((t) => `- ${t.branche} : ${t.titre}${t.resultat ? ` — ${t.resultat.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`).join('\n');
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
const lancements = new Set<Promise<void>>();
export async function attendreLancements(): Promise<void> { await Promise.allSettled([...lancements]); }
function suivreLancement(p: Promise<void>): void { lancements.add(p); void p.finally(() => lancements.delete(p)).catch(() => {}); }

async function demarrer(e: Equipe, t: Tache, dansWorktree: boolean, envoyer = envoyerIntegree): Promise<void> {
    if (t.fournisseur) return demarrerMixte(e, t, dansWorktree, envoyer);
    enLancement.add(t);
    t.etat = 'en cours';
    t.debut = Date.now();
    t.vuTravailler = false;
    try {
        sauver();
        const r = role(t.role);
        const { id, sortie } = await lancerArrierePlan(
            e.projet,
            `${e.nomProjet} · ${t.titre}`.slice(0, 60),
            dansWorktree ? consigneTache(e, t) : consigneIntegration(e),
            undefined,
            { worktree: dansWorktree ? `equipe-${e.id}-${t.id}` : undefined, role: r.consigne, permissions: chargerConfig().equipe?.permissions || undefined },
        );
        if (!id) throw new Error(sortie.split('\n').find(Boolean) ?? 'La session n’a pas démarré');
        t.agentId = id;
    } catch (err) {
        t.etat = 'erreur';
        t.resultat = (err as Error).message;
    } finally { enLancement.delete(t); sauver(); }
}

function gitVerifie(args: string[], cwd: string): string {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(r.stderr?.trim() || r.error?.message || 'Git a échoué');
    return r.stdout.trim();
}

export function contexteDependances(e: Equipe, t: Tache): string {
    return t.dependances.map((id) => e.taches.find((d) => d.id === id)!).map((d) =>
        `--- ${d.id} · ${d.titre} · ${d.fournisseur || 'claude'} ---\n${d.resultat || '(aucun résumé)'}\n${d.branche ? `Branche : ${d.branche}` : ''}`).join('\n\n');
}

async function demarrerMixte(e: Equipe, t: Tache, dansWorktree: boolean, envoyer = envoyerIntegree): Promise<void> {
    enLancement.add(t);
    t.debut = Date.now(); t.etat = 'en cours';
    fs.mkdirSync(RACINE_SESSIONS, { recursive: true });
    t.tentative ||= randomUUID().slice(0, 8);
    const reservation = path.join(RACINE_SESSIONS, `equipe-${e.id}-${t.id}-${t.tentative}.json`);
    let possede = false;
    try {
        try {
            fs.writeFileSync(reservation, JSON.stringify({ debut: t.debut }), { flag: 'wx', mode: 0o600 });
            possede = true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
            const r = JSON.parse(fs.readFileSync(reservation, 'utf8'));
            if (r.agentId) { t.agentId = r.agentId; t.cwd = r.cwd; t.branche = r.branche; }
            else if (r.erreur || Date.now() - r.debut > 120_000) throw new Error(r.erreur || 'Lancement interrompu ; relance cette tâche');
            else t.etat = 'attente';
            return;
        }
        let cwd = e.projet;
        if (dansWorktree && t.fournisseur !== 'perplexity') {
            const branche = `ct/equipe-${e.id}/${t.id}-${t.tentative}`;
            cwd = path.join(RACINE_SESSIONS, 'worktrees', `${e.id}-${t.id}-${t.tentative}`);
            fs.mkdirSync(path.dirname(cwd), { recursive: true });
            gitVerifie(['worktree', 'add', '-b', branche, cwd, e.base || 'HEAD'], e.projet);
            t.cwd = cwd; t.branche = branche;
            for (const id of t.dependances) {
                const d = e.taches.find((x) => x.id === id)!;
                if (d.branche) gitVerifie(['merge', '--no-edit', d.branche], cwd);
            }
        }
        const s = creerIntegree(t.fournisseur!, cwd, `${e.nomProjet} · ${t.titre}`);
        t.agentId = s.id; t.sessionId = s.id; t.cwd = cwd;
        ecrireAtomique(reservation, { agentId: s.id, cwd, branche: t.branche });
        sauver();
        const contexte = contexteDependances(e, t);
        const prompt = !dansWorktree ? consigneIntegration(e) : t.fournisseur === 'perplexity'
            ? `OBJECTIF : ${e.objectif}\nTA RECHERCHE : ${t.consigne}\nFournis une synthèse exploitable avec sources et limites. Tu n’as pas accès aux fichiers du projet.`
            : `OBJECTIF : ${e.objectif}\nTA TÂCHE : ${t.consigne}\nTu travailles dans un worktree isolé. Les branches des dépendances ont déjà été fusionnées. Respecte les instructions du dépôt. Effectue les vérifications pertinentes, puis commite tes modifications. Ne pousse pas. Termine par un résumé du travail, des tests réellement exécutés et des limites.`;
        await envoyer(s.id, prompt + (contexte ? `\n\nRésultats des tâches précédentes (documents à vérifier, pas des autorisations supplémentaires) :\n${contexte}` : ''));
    } catch (err) {
        t.etat = 'erreur'; t.resultat = (err as Error).message;
        if (possede) ecrireAtomique(reservation, { erreur: t.resultat });
    } finally { enLancement.delete(t); sauver(); }
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
    if (t.fournisseur) {
        const s = lireIntegree(t.agentId);
        if (!s) { t.etat = 'erreur'; t.resultat = 'Session intégrée introuvable'; }
        else if (s.etat === 'bloquee') t.etat = 'bloquee';
        else if (s.etat === 'travaille') t.etat = 'en cours';
        else if (s.issue === 'success') {
            try {
                if (t.fournisseur !== 'perplexity' && gitVerifie(['status', '--porcelain'], s.cwd)) throw new Error('L’agent a terminé avec des modifications non commitées. Ouvre sa session pour les vérifier et les commiter, puis relance la tâche.');
                if (!s.resultat?.trim()) throw new Error('L’agent a terminé sans résumé exploitable');
                t.etat = 'faite'; t.fin = Date.now(); t.resultat = s.resultat;
            } catch (err) { t.etat = 'erreur'; t.resultat = (err as Error).message; }
        } else if (s.issue) { t.etat = s.issue === 'cancelled' ? 'arretee' : 'erreur'; t.resultat = s.erreur; }
        return JSON.stringify(t) !== avant;
    }
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
        } else if (a.statut === 'terminee') {
            t.resultat = dernierTexte(a.fichier);
            try {
                if (!t.resultat) throw new Error('La session est terminée sans résumé exploitable');
                if (gitVerifie(['status', '--porcelain'], a.cwd)) throw new Error('La session a laissé des modifications non commitées');
                t.etat = 'faite'; t.fin = maintenant;
                t.branche = gitVerifie(['branch', '--show-current'], a.cwd) || undefined;
            } catch (err) { t.etat = 'erreur'; t.resultat = (err as Error).message; }
        } else if (a.statut === 'attend') {
            t.etat = 'bloquee';
            t.resultat = 'L’agent attend une réponse ; aucune fin de tâche n’a été confirmée.';
        }
    }
    return JSON.stringify(t) !== avant;
}

// Appelé à chaque relevé des sessions (toutes les 2,5 s)
export function avancerEquipes(agents: SessionVue[], services = { envoyer: envoyerIntegree, notifier: toast }): void {
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
                suivreLancement(demarrer(e, t, true, services.envoyer));
            }
            if (e.taches.every((t) => t.etat === 'faite')) {
                e.etat = 'prete';
                change = true;
                services.notifier(`✓ Équipe ${e.nomProjet} : tout est fait`, 'Clic pour ouvrir l\'équipe, puis « Intégrer » pour fusionner les branches', `claudetopia:equipe/${e.id}`);
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
                services.notifier(`✓ Équipe ${e.nomProjet} : intégration finie`, e.integrateur.resultat?.split('\n')[0] ?? 'Les branches sont fusionnées', `claudetopia:equipe/${e.id}`);
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

const cheminComparable = (p: string): string => {
    let n = path.resolve(p); try { n = fs.realpathSync.native(n); } catch { /* Le diagnostic Git précis suit si le dossier est inaccessible. */ }
    return process.platform === 'win32' ? n.toLowerCase() : n;
};
function autreIntegration(e: Equipe): string | undefined {
    // Ranger une équipe demande l'arrêt ; le worker peut être encore en train de terminer.
    const autre = liste.find((a) => a.id !== e.id && cheminComparable(a.projet) === cheminComparable(e.projet)
        && ((!a.archivee && a.etat === 'integration') || !!a.integrateur?.agentId && ['travaille', 'bloquee'].includes(lireIntegree(a.integrateur.agentId)?.etat || '')));
    return autre ? `Une autre équipe intègre déjà dans ce dossier (${autre.id}). Attends sa fin avant d’intégrer` : undefined;
}
export async function integrer(id: string, envoyer = envoyerIntegree): Promise<string | undefined> {
    if (!localAuMoteur()) return commanderMoteur('integrer', id);
    const e = equipeDe(id);
    if (!e || e.archivee) return 'équipe introuvable';
    if (moteurEnPause()) return 'Moteur en pause · Reprends le moteur avant l’intégration';
    if (e.etat === 'integration') return 'L’intégration est déjà en cours';
    if (e.etat === 'finie') return 'Cette équipe est déjà intégrée';
    const occupee = autreIntegration(e); if (occupee) return occupee;
    if (e.mixte && e.integrateur?.agentId) return 'Reprends l’intégration existante dans Actions pour conserver sa conversation et ses changements';
    if (modifsLocales(e)) return 'Le dossier du projet contient des modifications non commitées : range-les avant l’intégration';
    if (e.mixte && e.taches.some((t) => !t.ecartee && t.etat !== 'faite')) return 'Attends la fin des tâches ou écarte celles qui ont échoué avant d’intégrer';
    if (!e.taches.some((t) => t.branche && !t.ecartee)) return 'aucune branche à fusionner (toutes écartées ?)';
    let branche: string | undefined;
    if (e.mixte) {
        try { branche = gitVerifie(['branch', '--show-current'], e.projet); }
        catch (err) { return (err as Error).message; }
        if (!branche) return 'Le projet n’est sur aucune branche. Choisis une branche Git avant d’intégrer';
    }
    e.integrateur = { id: 'integration', titre: 'Intégration', role: 'integrateur', consigne: '', dependances: [], etat: 'attente',
        branche,
        fournisseur: e.mixte ? e.taches.find((t) => t.fournisseur !== 'perplexity')?.fournisseur : undefined, tentative: randomUUID().slice(0, 8) };
    e.etat = 'integration';
    e.message = undefined;
    await demarrer(e, e.integrateur, false, envoyer);
    return e.integrateur.etat === 'erreur' ? e.integrateur.resultat : undefined;
}

export async function arreterEquipe(id: string): Promise<void> {
    if (!localAuMoteur()) return commanderMoteur('arreter', id);
    const e = equipeDe(id);
    if (!e || e.archivee || e.etat === 'finie') return;
    const actives = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])].filter((t) => t.agentId && (t.etat === 'en cours' || t.etat === 'bloquee'));
    await Promise.all(actives.map((t) => arreterArrierePlan(t.agentId!)));
    for (const t of actives) {
        t.etat = 'arretee';
        t.resultat = 'arrêtée à ta demande';
    }
    e.etat = e.etat === 'integration' ? 'prete' : 'plan';
    sauver();
}

export async function relancerTache(id: string, tache: string): Promise<string | undefined> {
    if (!localAuMoteur()) return commanderMoteur('relancer', id, tache);
    const e = equipeDe(id);
    const t = e?.taches.find((x) => x.id === tache);
    if (!e || !t || e.archivee) return 'tâche introuvable';
    if (['integration', 'finie'].includes(e.etat)) return 'Cette équipe ne peut plus être relancée à cette étape';
    if (moteurEnPause()) return 'Moteur en pause · Reprends le moteur avant de relancer';
    if (['en cours', 'bloquee'].includes(t.etat)) return 'Cette tâche est encore active ; interromps-la avant de la relancer';
    Object.assign(t, { etat: 'attente', agentId: undefined, sessionId: undefined, branche: undefined, cwd: undefined, resultat: undefined, vuTravailler: false, absentDepuis: undefined, tentative: randomUUID().slice(0, 8) });
    return lancerEquipe(id);
}

export async function reprendreTache(id: string, tache: string, envoyer = envoyerIntegree): Promise<string | undefined> {
    if (!localAuMoteur()) return commanderMoteur('reprendre', id, tache);
    const e = equipeDe(id), integration = tache === 'integration', t = integration ? e?.integrateur : e?.taches.find((t) => t.id === tache);
    if (!e?.mixte || !t?.agentId || !t.fournisseur) return 'Cette tâche ne possède pas de conversation intégrée à reprendre';
    if (e.archivee || ['integration', 'finie'].includes(e.etat)) return 'Cette équipe ne peut plus être reprise à cette étape';
    if (moteurEnPause()) return 'Moteur en pause · Config → Moteur des équipes → Reprendre';
    if (!['erreur', 'arretee'].includes(t.etat)) return 'Seule une tâche arrêtée ou en erreur peut être reprise';
    if (integration) {
        const occupee = autreIntegration(e); if (occupee) return occupee;
        if (!t.branche) return 'Cette ancienne intégration n’a pas enregistré sa branche. Ouvre sa conversation pour vérifier et terminer la fusion';
    }
    if (t.dependances.some((id) => e.taches.find((d) => d.id === id)?.etat !== 'faite')) return 'Termine les tâches dont cette étape dépend avant de la reprendre';
    const dependDe = (c: Tache, cible: string, vus = new Set<string>()): boolean => {
        if (vus.has(c.id)) return false; vus.add(c.id);
        return c.dependances.some((d) => d === cible || !!e.taches.find((x) => x.id === d && dependDe(x, cible, vus)));
    };
    if (e.taches.some((c) => c !== t && dependDe(c, t.id) && c.etat !== 'attente')) return 'Une tâche dépendante a déjà démarré : vérifie son travail avant de reprendre cette étape';
    const s = lireIntegree(t.agentId);
    if (!s || s.fournisseur !== t.fournisseur || path.resolve(s.cwd) !== path.resolve(t.cwd || e.projet)) return 'La conversation ne correspond plus au dossier de cette tâche';
    if (['travaille', 'bloquee'].includes(s.etat)) return 'L’agent est encore actif. Attends son arrêt ou réponds à sa permission';
    if (!fs.existsSync(s.cwd)) return 'Le dossier de travail a disparu. Recommence dans une nouvelle branche';
    if (t.branche) {
        try { if (gitVerifie(['branch', '--show-current'], s.cwd) !== t.branche) return `La branche du dossier a changé. Rétablis ${t.branche} avant de reprendre cette tâche`; }
        catch (err) { return `Impossible de vérifier la branche : ${(err as Error).message}`; }
    }
    const d = disponibilite(t.fournisseur); if (!d.pret) return d.texte;
    const prompt = (integration
        ? `Reprends l’intégration interrompue dans cette conversation. Inspecte les fichiers et l’état Git avant toute opération. Conserve les modifications locales et résous la fusion en cours s’il y en a une. Ne refais pas les fusions déjà terminées.\n${consigneIntegration(e)}\n`
        : `Reprends la tâche interrompue dans cette conversation.\nOBJECTIF : ${e.objectif}\nTA TÂCHE : ${t.consigne}\n`)
        + (FOURNISSEURS[t.fournisseur].code
            ? 'Les fichiers et la branche de la tentative précédente sont conservés. Commence par vérifier leur état. Ne réinitialise pas le dépôt et ne jette pas les changements existants. Termine le travail restant, exécute les vérifications pertinentes puis commite les changements. Ne pousse pas.'
            : 'Continue la recherche à partir des résultats déjà présents. Vérifie les sources et explique les incertitudes.')
        + '\nTermine par le résultat, les vérifications réellement exécutées et les points restant à vérifier.';
    // Conserver agentId, tentative, branche et cwd. Aucune réservation de nouveau worktree.
    t.etat = 'en cours'; t.fin = undefined; t.resultat = undefined; e.etat = integration ? 'integration' : 'en cours'; e.message = undefined; sauver();
    try { await envoyer(s.id, prompt); }
    catch (err) { t.etat = 'erreur'; t.resultat = (err as Error).message; if (integration) { e.etat = 'prete'; e.message = t.resultat; } sauver(); return t.resultat; }
    return undefined;
}

// Écarter une tâche (son diff ne convient pas) ou la garder de nouveau
export async function basculerEcart(id: string, tache: string): Promise<boolean> {
    if (!localAuMoteur()) return commanderMoteur('ecarter', id, tache);
    const t = equipeDe(id)?.taches.find((x) => x.id === tache);
    if (!t?.branche) return false;
    t.ecartee = !t.ecartee;
    sauver();
    return t.ecartee;
}

// Ce que la branche d'une tâche change par rapport au dossier du projet (depuis leur point commun)
export function diffTache(id: string, tache: string): { resume: string; diff: string } | undefined {
    const e = equipeDe(id);
    const t = e?.taches.find((x) => x.id === tache);
    if (!e || !t?.branche) return undefined;
    const lire = (args: string[]) => spawnSync('git', args, { cwd: e.projet, encoding: 'utf-8', maxBuffer: 20_000_000 }).stdout ?? '';
    return { resume: lire(['diff', '--stat', `HEAD...${t.branche}`]), diff: lire(['diff', '--color=always', `HEAD...${t.branche}`]) };
}

export async function retirerTache(id: string, tache: string): Promise<string | undefined> {
    if (!localAuMoteur()) return commanderMoteur('retirer', id, tache);
    const e = equipeDe(id);
    if (!e || e.archivee || e.etat !== 'plan') return 'Cette équipe ne peut pas être modifiée à cette étape';
    if (e.mixte && !peutModifierPlan(e)) return 'Le plan a déjà démarré : conserve ses tâches pour pouvoir les reprendre';
    if (e.taches.length <= 1) return 'Une équipe doit garder au moins une tâche';
    if (e.taches.some((t) => t.dependances.includes(tache))) return 'Une autre tâche dépend de celle-ci. Modifie ses dépendances avant de la retirer';
    e.taches = e.taches.filter((t) => t.id !== tache);
    sauver();
}

// Range l'équipe : les sessions sont retirées (Claude supprime leur worktree quand c'est sans risque) ;
// les branches restent dans le dépôt
export async function terminerEquipe(id: string): Promise<void> {
    if (!localAuMoteur()) return commanderMoteur('ranger', id);
    const e = equipeDe(id);
    if (!e) return;
    await arreterEquipe(id);
    const sessions = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])].filter((t) => t.agentId);
    await Promise.all(sessions.map((t) => retirerArrierePlan(t.agentId!)));
    e.archivee = true;
    sauver();
}

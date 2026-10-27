import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chargerConfig, sauverConfig, CHEMIN_CONFIG } from './config.js';
import { Projet, listerProjets, trouverProjet, brancheGit, derniereSessionClaude, etatGit, depuis, correspond } from './projets.js';
import { ouvrirOnglet, executer, lancerDetache } from './lanceurs.js';
import { lancerClaude, reprendreDerniere, choisirSession, nouvelleBranche, nettoyerWorktrees, lancerAvecPrompt } from './actions.js';
import { recents, projetsRecents, puce } from './dashboard.js';
import { instantane, sessionsActives, fermerArbre, formatRam } from './systeme.js';
import { serveursDev } from './serveurs.js';
import { calculerUsage, formatTokens, nomDossierClaude } from './usage.js';
import { demarrerSurveillance, toast } from './notifications.js';
import { demanderClaude, parLignes } from './claude.js';
import { revue, commit } from './gitia.js';
import { journal } from './journal.js';
import { cherche } from './cherche.js';
import { scan } from './scanCommande.js';
import { commandesConfig } from './configCommandes.js';
import { commandesSsh } from './sshGestion.js';
import { ajusterProjets } from './synchro.js';
import { cloner as clonerDepot } from './git.js';
import { afficherServeurs, testerServeurs, ouvrirSsh, serveursDuProjet } from './sshCommandes.js';
import { c } from './theme.js';
import { tableau, titre, ligneMarkdown } from './affichage.js';
import { bus, choisir, confirmer, tache, afficherVue, saisir } from './ui/bus.js';
import { lancerArrierePlan, arreterArrierePlan, retirerArrierePlan, fermerArrierePlan, envoyerMessage } from './agents.js';
import { lireDonnees, rafraichirDocker, oublierAgent, annulerOubli } from './ui/donnees.js';
import { passerLaMain } from './ui/ecran.js';
import { CLAUDE } from './claude.js';

// Donne le terminal à "claude attach" ; Ctrl+Z dans Claude ramène ici
export function rejoindre(id: string): void {
    passerLaMain(CLAUDE, ['attach', id]);
    console.log(c.discret(`De retour · la session ${id} continue en arrière-plan`));
}

export const config = chargerConfig();
let projets = listerProjets(config);
export const getProjets = () => projets;
export const rafraichirProjets = () => {
    projets = listerProjets(config);
    ajusterProjets(projets);
    return projets;
};

let arreterSurveillance: (() => void) | undefined;
// Les notifications viennent maintenant des cartes de session (ui/donnees.ts), qui couvrent aussi
// les sessions d'arrière-plan : on arrête simplement l'ancienne surveillance si elle tournait.
export function demarrerNotifications(): void {
    arreterSurveillance?.();
    arreterSurveillance = undefined;
}

export interface Contexte {
    args: string[];
    reste: string;          // tout après le nom de la commande
    projet?: Projet;        // résolu pour les commandes "projet"
    apresProjet: string;    // texte après l'argument projet
}

export interface Commande {
    nom: string;
    alias?: string[];
    args?: string;          // aide sur les arguments
    projet?: boolean;       // 1er argument = projet (autocomplété, demandé si absent)
    groupe: 'Claude' | 'Projets' | 'Git' | 'Système' | 'Config';
    description: string;
    cache?: boolean;        // commande interne (boutons, clics) : pas dans l'aide ni l'historique
    executer: (ctx: Contexte) => Promise<void> | void;
}

// Remplace les @favori par le texte du prompt favori
function developperPrompts(texte: string): string {
    return texte.replace(/@(\w+)/g, (m, nom) => config.prompts[nom] ?? m);
}

async function demanderProjet(message = 'Projet'): Promise<Projet> {
    const recents = projetsRecents(projets, projets.length).map((r) => r.projet);
    const ordre = [...recents, ...projets.filter((p) => !recents.includes(p))];
    return choisir(message, ordre.map((p) => {
        const branche = brancheGit(p.chemin);
        return { label: `${puce(p.nom)} ${p.nom}`, valeur: p, description: branche ? `⎇ ${branche}` : p.racine };
    }), true);
}

function resoudreProjet(cle: string): Projet | undefined {
    // "." = dossier courant
    if (cle === '.') return { nom: path.basename(process.cwd()), chemin: process.cwd(), racine: '(courant)' };
    // Chemin complet (utilisé par les boutons des cartes de session)
    if (path.isAbsolute(cle) && fs.existsSync(cle)) return { nom: path.basename(cle), chemin: cle, racine: '(chemin)' };
    const trouve = trouverProjet(projets, cle);
    if (!trouve) {
        console.log(c.erreur(`Aucun projet ne correspond à « ${cle} ».`));
        return undefined;
    }
    if (Array.isArray(trouve)) {
        console.log(c.alerte(`Plusieurs projets correspondent à « ${cle} » : `) + trouve.map((p) => p.nom).join(', '));
        return undefined;
    }
    return trouve;
}

// ─── Affichages ──────────────────────────────────────────────────────────────

function afficherProjets(filtre?: string): void {
    const liste = projets.filter((p) => !filtre || correspond(p.nom, filtre));
    const parRacine = new Map<string, Projet[]>();
    liste.forEach((p) => parRacine.set(p.racine, [...(parRacine.get(p.racine) ?? []), p]));
    for (const [racine, ps] of parRacine) {
        console.log(titre(racine === '(extra)' ? 'Autres projets' : racine, ps.length));
        console.log(tableau(ps.map((p) => {
            const branche = brancheGit(p.chemin);
            const session = derniereSessionClaude(p.chemin);
            return [
                c.discret(String(projets.indexOf(p) + 1).padStart(2)),
                `${puce(p.nom)} ${p.nom}`,
                branche ? c.secondaire(`⎇ ${branche}`) : '',
                session ? c.discret(`🤖 ${depuis(session)}`) : '',
            ];
        }), { max: [2, 30, 36] }));
    }
}

function afficherStatus(): void {
    const lignes: string[][] = [];
    for (const p of projets) {
        const etat = etatGit(p.chemin);
        if (!etat) continue;
        const propre = !etat.modifs && !etat.enAvance && !etat.enRetard;
        lignes.push([
            propre ? c.succes('✓') : c.alerte('●'),
            `${puce(p.nom)} ${p.nom}`,
            c.secondaire(etat.branche),
            [etat.modifs ? c.alerte(`✎ ${etat.modifs}`) : '', etat.enAvance ? c.succes(`↑${etat.enAvance}`) : '',
                etat.enRetard ? c.erreur(`↓${etat.enRetard}`) : ''].filter(Boolean).join(' '),
        ]);
    }
    console.log(tableau(lignes, { entetes: ['', 'Projet', 'Branche', 'État'], max: [1, 30, 38], retrait: 0 }));
}

async function afficherPorts(): Promise<void> {
    const snap = await tache('Lecture des processus', () => instantane());
    const serveurs = serveursDev(snap, projets, sessionsActives());
    if (!serveurs.length) {
        console.log(c.discret('Aucun serveur de dev en écoute.'));
        return;
    }
    console.log(tableau(serveurs.map((s) => [
        c.accent(`:${s.port}`), s.projet ? `${puce(s.projet)} ${s.projet}` : c.discret('—'), c.discret(`${s.processus} · pid ${s.pid}`),
    ]), { entetes: ['Port', 'Projet', 'Processus'], retrait: 0 }));
}

async function afficherUsage(): Promise<void> {
    const usage = await tache('Lecture des sessions des 14 derniers jours', () => calculerUsage(14));
    const max = Math.max(...usage.jours.map((j) => j.tokens), 1);
    console.log(titre('Tokens par jour') + c.discret('  entrée + sortie + écriture cache'));
    console.log(tableau(usage.jours.map((j) => [
        c.discret(new Date(j.date + 'T12:00').toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' })),
        c.accent('█'.repeat(Math.round((j.tokens / max) * 36)) || c.discret('·')),
        formatTokens(j.tokens),
    ]), { droite: [2] }));
    console.log(titre('Par projet'));
    console.log(tableau(usage.parProjet.slice(0, 8).map((p) => [nomDossierClaude(p.dossier, projets), formatTokens(p.tokens)]), { droite: [1] }));
    console.log(titre('Par modèle'));
    console.log(tableau(usage.parModele.map((m) => [m.modele, formatTokens(m.tokens)]), { droite: [1] }));
}

function afficherAide(): void {
    const groupes = ['Claude', 'Projets', 'Git', 'Système', 'Config'] as const;
    for (const g of groupes) {
        console.log(titre(g));
        console.log(tableau(COMMANDES.filter((cmd) => cmd.groupe === g).map((cmd) => [
            c.accent(`/${cmd.nom}`) + (cmd.args ? c.discret(` ${cmd.args}`) : ''),
            cmd.description,
        ]), { max: [34] }));
    }
    console.log(titre('Raccourcis'));
    console.log(tableau([
        [c.accent('clic'), 'carte de session → sa conversation · boutons · menus · serveurs · Docker'],
        [c.accent('molette'), 'faire défiler la conversation, la sortie, les cartes'],
        [c.accent('clic droit'), 'actions de ce qui est sous la souris : session, équipe, Docker, serveur, journal · masquer une section'],
        [c.accent('⇅ SFTP'), 'vue SSH → Fichiers, ou /sftp : parcourir un serveur · /ssh-ajouter, /sftp-ajouter pour configurer'],
        [c.accent('Alt+M'), 'parler au maître : il gère tes sessions (fermer, relancer, écrire, créer, résumer) · aussi clic sur sa zone à gauche'],
        [c.accent('Alt+T'), 'ouvrir un terminal : PowerShell, cmd, Git Bash, WSL (aussi « ❯ Terminal » à gauche)'],
        [c.accent('texte libre'), 'conversation ouverte : envoyé à Claude · sinon : nouvelle session Claude ici'],
        [c.accent('Entrée (vide)'), 'conversation ouverte : la rejoindre en plein écran · sinon : menu projet'],
        [c.accent('Ctrl+Z'), 'dans une session rejointe : revenir au CLI (elle continue)'],
        [c.accent('Alt+V'), 'joindre l\'image du presse-papiers'],
        [c.accent('Alt+↑ / Alt+↓'), 'session précédente / suivante · Alt+1…9 : carte n°'],
        [c.accent('Échap'), 'vider la saisie · retirer les images · fermer la conversation'],
        [c.accent('/  ·  @'), 'commandes · prompts favoris (Tab pour compléter)'],
        [c.accent('!commande'), 'exécute dans PowerShell (git, npm…)'],
        [c.accent('?'), 'cette aide (sur une ligne vide)'],
        [c.accent('Ctrl+C ×2'), 'quitter · Maj+glisser pour sélectionner du texte'],
    ], { max: [16] }));
}

// Menu : projet → action
async function menu(projetChoisi?: Projet): Promise<void> {
    const projet = projetChoisi ?? await demanderProjet('Projet');
    const action = await choisir(projet.nom, [
        { label: '✻ Nouvelle session Claude', valeur: 'claude' },
        { label: '▭ Claude dans un onglet', valeur: 'onglet' },
        { label: "◆ Équipe d'agents (plan + tâches en parallèle)", valeur: 'equipe-projet' },
        { label: '★ Claude avec un prompt favori', valeur: 'favori' },
        { label: '↺ Reprendre une session', valeur: 'sessions' },
        { label: '» Continuer la dernière session', valeur: 'reprendre' },
        { label: '⌕ Revue du diff par Claude', valeur: 'revue' },
        { label: '✓ Commit avec message IA', valeur: 'commit' },
        { label: '⎇ Nouvelle branche (worktree)', valeur: 'branche' },
        { label: '− Nettoyer les worktrees', valeur: 'nettoyer' },
        { label: '⇄ Serveurs SSH du projet', valeur: 'serveurs' },
        { label: '◧ VS Code', valeur: 'code' },
        { label: '❯ Onglet PowerShell', valeur: 'tab' },
        { label: '▤ Explorateur', valeur: 'ouvrir' },
        { label: '➜ Aller dans le dossier', valeur: 'go' },
    ], false);
    if (action === 'equipe-projet') return void await COMMANDES.find((x) => x.nom === 'equipe')!.executer({ args: [projet.chemin], reste: projet.chemin, projet, apresProjet: '' });
    const cmd = COMMANDES.find((x) => x.nom === action)!;
    await cmd.executer({ args: [], reste: '', projet, apresProjet: '' });
}

// ─── Registre des commandes ──────────────────────────────────────────────────

export const COMMANDES: Commande[] = [
    // Claude
    {
        nom: 'claude', alias: ['nouvelle'], projet: true, args: '[projet] [prompt|@favori]', groupe: 'Claude',
        description: 'Nouvelle session Claude (arrière-plan : visible et joignable ici)',
        executer: async ({ projet, apresProjet }) => {
            let prompt = developperPrompts(apresProjet);
            if (!prompt && config.lancement === 'fond') {
                const choix = await choisir(`Démarrer ${projet!.nom} avec`, [
                    { label: '✎ Une consigne (Claude travaille, tu suis sur sa carte)', valeur: 'consigne' },
                    { label: '↵ Rien : ouvrir la conversation tout de suite', valeur: 'rien' },
                    ...Object.keys(config.prompts).map((n) => ({ label: `★ @${n}`, valeur: `@${n}`, description: config.prompts[n] })),
                ], false);
                if (choix === 'consigne') prompt = await saisir('Consigne pour Claude');
                else if (choix.startsWith('@')) prompt = config.prompts[choix.slice(1)];
            }
            await lancerClaude(projet!, prompt || undefined, config.lancement);
        },
    },
    {
        nom: 'onglet', projet: true, args: '[projet] [prompt]', groupe: 'Claude',
        description: 'Claude dans un nouvel onglet Windows Terminal',
        executer: ({ projet, apresProjet }) => lancerClaude(projet!, developperPrompts(apresProjet) || undefined, 'onglet'),
    },
    {
        nom: 'envoyer', args: '<sessionId> <texte>', groupe: 'Claude', cache: true,
        description: "Envoyer un message à une session d'arrière-plan",
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.sessionId === args[0]);
            const texte = args.slice(1).join(' ');
            if (!s) return void bus.emit('notice', '✕ Session introuvable');
            const res = await tache(`Envoi à ${s.nom}`, () => envoyerMessage(s, developperPrompts(texte)));
            bus.emit('notice', res.ok ? `✓ ${res.message} à ${s.nom} · Claude répond dans la conversation` : `✕ ${res.message}`);
            // La conversation peut revenir sous un nouvel id : on la rouvre dès qu'elle réapparaît
            if (res.id) bus.emit('selectionner', res.id);
            console.log(res.ok ? c.succes(`→ ${s.nom} : ${texte.slice(0, 80)}`) : c.erreur(res.message));
        },
    },
    {
        nom: 'favori-session', args: '<sessionId>', groupe: 'Claude', cache: true,
        description: 'Envoyer un prompt favori à une session',
        executer: async ({ args }) => {
            const nom = await choisir('Prompt favori à envoyer', Object.entries(config.prompts).map(([n, texte]) => ({
                label: `@${n}`, valeur: n, description: texte,
            })));
            await trouverCommande('envoyer')!.executer({ args: [args[0], ...config.prompts[nom].split(' ')], reste: '', apresProjet: '' });
        },
    },
    {
        nom: 'rejoindre', args: '<id>', groupe: 'Claude', cache: true,
        description: "Entrer dans une session d'arrière-plan",
        executer: ({ args }) => rejoindre(args[0]),
    },
    {
        nom: 'arreter', args: '<id>', groupe: 'Claude', cache: true,
        description: "Arrêter une session d'arrière-plan",
        executer: async ({ args }) => {
            if (!args.includes('--oui') && !await confirmer(`Arrêter la session ${args[0]} ? (la conversation est gardée)`)) return;
            console.log(c.discret(await arreterArrierePlan(args[0])));
        },
    },
    {
        nom: 'copie', args: '<sessionId>', groupe: 'Claude', cache: true,
        description: "Continuer une session d'onglet ici (copie en arrière-plan)",
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.sessionId === args[0]);
            if (!s) return console.log(c.erreur('Session introuvable'));
            const { id, sortie } = await tache('Copie de la conversation en arrière-plan', () => lancerArrierePlan(s.cwd, `${s.nom}-suite`, undefined, s.sessionId));
            if (!id) return console.log(c.erreur(sortie));
            console.log(c.succes(`Copie créée (${id}) : la session d'origine reste dans son onglet`));
            rejoindre(id);
        },
    },
    {
        nom: 'lancement', args: 'fond|onglet', groupe: 'Config',
        description: 'Où /claude ouvre les sessions (fond = joignable ici)',
        executer: ({ args }) => {
            if (args[0] === 'fond' || args[0] === 'onglet') {
                config.lancement = args[0];
                sauverConfig(config);
            }
            console.log(`Nouvelles sessions : ${c.accent(config.lancement === 'fond' ? 'arrière-plan (cartes à gauche, joignables)' : 'onglet Windows Terminal')}`);
        },
    },
    {
        nom: 'sessions', projet: true, args: '[projet]', groupe: 'Claude',
        description: 'Reprendre une ancienne session Claude',
        executer: ({ projet }) => choisirSession(projet!),
    },
    {
        nom: 'reprendre', projet: true, args: '[projet]', groupe: 'Claude',
        description: 'Continuer la dernière session (claude -c)',
        executer: ({ projet }) => reprendreDerniere(projet!),
    },
    {
        nom: 'multi', args: '<p1> <p2> … [-- consigne|@favori]', groupe: 'Claude',
        description: 'Même consigne dans plusieurs projets (une carte par projet)',
        executer: async ({ args }) => {
            const separation = args.indexOf('--');
            const noms = separation >= 0 ? args.slice(0, separation) : args;
            const consigne = separation >= 0 ? developperPrompts(args.slice(separation + 1).join(' ')) : '';
            const cibles = noms.map(resoudreProjet).filter((p): p is Projet => !!p);
            if (!cibles.length) return console.log(c.alerte('Usage : /multi saniplan api-ipg -- @securite'));
            // Sans consigne : un onglet par projet ; avec : des sessions d'arrière-plan qui travaillent en parallèle
            for (const p of cibles) await lancerClaude(p, consigne || undefined, consigne ? 'fond' : 'onglet');
            if (consigne) console.log(c.discret(`${cibles.length} sessions lancées · suis-les sur leurs cartes, une notification arrive quand chacune a fini`));
        },
    },
    {
        nom: 'equipe', alias: ['equipes', 'orchestre'], args: '[projet|nouvelle] [-- objectif]', groupe: 'Claude',
        description: "Équipe d'agents : un plan découpé en tâches, plusieurs Claude en parallèle sur un projet",
        executer: async ({ args }) => {
            const { VueEquipe } = await import('./ui/VueEquipe.js');
            const { creerEquipe, equipeDe } = await import('./equipe.js');
            const React = await import('react');
            const ouvrir = (id?: string) => afficherVue((fermer) => React.createElement(VueEquipe, { fermer, id }));
            const separation = args.indexOf('--');
            const avant = separation >= 0 ? args.slice(0, separation) : args;
            let objectif = separation >= 0 ? developperPrompts(args.slice(separation + 1).join(' ')) : '';
            if (avant[0] && equipeDe(avant[0])) return ouvrir(avant[0]);
            if (!avant.length && !objectif) return ouvrir();
            const cle = avant[0] === 'nouvelle' ? avant[1] : avant[0];
            const projet = cle ? resoudreProjet(cle) : await demanderProjet('Équipe sur quel projet ?');
            if (!projet) return;
            objectif ||= (await saisir(`Objectif de l'équipe sur ${projet.nom} (ce que tu veux obtenir, le chef d'équipe découpe)`)).trim();
            if (!objectif) return;
            let e;
            try {
                e = creerEquipe(projet, objectif);
            } catch (err) {
                return console.log(c.erreur(`✕ ${(err as Error).message}`));
            }
            console.log(c.succes(`◆ Équipe créée sur ${projet.nom} · le chef d'équipe découpe le travail (1 à 3 min), puis tu valides le plan`));
            await ouvrir(e.id);
        },
    },
    {
        nom: 'favori', alias: ['fav'], projet: true, args: '[projet]', groupe: 'Claude',
        description: 'Lancer Claude avec un prompt favori',
        executer: ({ projet }) => lancerAvecPrompt(projet!, config.prompts),
    },
    {
        nom: 'prompts', args: '[add <nom> <texte> | rm <nom>]', groupe: 'Claude',
        description: 'Gérer les prompts favoris (@nom)',
        executer: ({ args }) => {
            if (args[0] === 'add' && args[1] && args.length > 2) {
                config.prompts[args[1]] = args.slice(2).join(' ');
                sauverConfig(config);
                console.log(c.succes(`@${args[1]} enregistré`));
            } else if (args[0] === 'rm' && args[1]) {
                delete config.prompts[args[1]];
                sauverConfig(config);
                console.log(c.succes(`@${args[1]} supprimé`));
            } else {
                console.log(tableau(Object.entries(config.prompts).map(([n, t]) => [c.accent(`@${n}`), t]), { max: [12, 90] }));
            }
        },
    },
    {
        nom: 'ask', args: '<question>', groupe: 'Claude',
        description: 'Question rapide à Claude (ou tape directement ta question)',
        executer: async ({ reste }) => {
            if (!reste) return console.log(c.alerte('Usage : /ask <question>'));
            const flux = parLignes((l) => console.log(ligneMarkdown(l)));
            await tache('Claude réfléchit', () => demanderClaude(developperPrompts(reste), { cwd: process.cwd(), surTexte: flux.pousser }));
            flux.finir();
        },
    },

    // Projets
    {
        nom: 'menu', alias: ['m'], groupe: 'Projets',
        description: 'Choisir un projet puis une action',
        executer: () => menu(),
    },
    {
        nom: 'recents', alias: ['dash', 'accueil'], groupe: 'Projets',
        description: 'Projets récents : activité, branche, état git (cliquables)',
        executer: async () => {
            const { VueRecents } = await import('./ui/VueRecents.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(VueRecents, { fermer }));
        },
    },
    {
        nom: 'actions', projet: true, args: '[projet]', groupe: 'Projets', cache: true,
        description: 'Actions sur un projet',
        executer: ({ projet }) => menu(projet),
    },
    {
        nom: 'panneau', groupe: 'Config',
        description: 'Afficher / masquer le panneau live (sessions + serveurs)',
        executer: () => {
            config.panneau = !config.panneau;
            sauverConfig(config);
            console.log(config.panneau ? c.succes('Panneau affiché') : c.discret('Panneau masqué'));
        },
    },
    {
        nom: 'projets', alias: ['p'], args: '[filtre]', groupe: 'Projets',
        description: 'Tous les projets : branche, état git, dernière session (cliquables)',
        executer: async ({ reste }) => {
            const { VueProjets } = await import('./ui/VueProjets.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(VueProjets, { fermer, filtreInitial: reste }));
        },
    },
    {
        nom: 'liste', args: '[filtre]', groupe: 'Projets', cache: true,
        description: 'Liste des projets en texte',
        executer: ({ reste }) => afficherProjets(reste || undefined),
    },
    {
        nom: 'cloner', args: '<url>', groupe: 'Git',
        description: 'Cloner un dépôt dans un de tes dossiers de projets',
        executer: async ({ args }) => {
            const url = args[0];
            if (!url) return console.log(c.alerte('Usage : /cloner <url du dépôt>'));
            const dossier = config.racines.length === 1 ? config.racines[0] : await choisir(`Où cloner ${url.split('/').pop()} ?`, [
                ...config.racines.filter((r) => fs.existsSync(r)).map((r) => ({ label: r, valeur: r, description: 'dossier de projets' })),
                { label: 'Autre dossier…', valeur: '' },
            ], false);
            const parent = dossier || path.resolve(await saisir('Dossier où cloner', os.homedir()));
            const res = await tache(`git clone dans ${parent}`, () => clonerDepot(url, parent));
            if (!res.ok) return console.log(c.erreur(`✕ ${res.sortie.split('\n').pop()}`));
            // Hors des dossiers de projets : on l'ajoute comme projet isolé pour le suivre
            if (!config.racines.some((r) => r.toLowerCase() === parent.toLowerCase())) {
                config.extras.push(res.chemin);
                sauverConfig(config);
            }
            rafraichirProjets();
            console.log(c.succes(`✓ Cloné dans ${res.chemin} · il apparaît dans tes projets`));
        },
    },
    {
        nom: 'cherche', alias: ['grep', 'rg'], args: '<texte>', groupe: 'Projets',
        description: 'Chercher dans le code de tous les projets',
        executer: ({ reste }) => (reste ? cherche(projets, reste) : console.log(c.alerte('Usage : /cherche <texte>'))),
    },
    {
        nom: 'code', projet: true, args: '[projet]', groupe: 'Projets',
        description: 'Ouvrir dans VS Code',
        executer: ({ projet }) => lancerDetache('code', [projet!.chemin]),
    },
    {
        nom: 'go', projet: true, args: '[projet]', groupe: 'Projets',
        description: 'Aller dans le dossier du projet',
        executer: ({ projet }) => process.chdir(projet!.chemin),
    },
    {
        nom: 'tab', projet: true, args: '[projet]', groupe: 'Projets',
        description: 'Onglet PowerShell dans le projet',
        executer: ({ projet }) => ouvrirOnglet(projet!.chemin, projet!.nom),
    },
    {
        nom: 'terminal', alias: ['term'], args: '[pwsh|powershell|cmd|bash|wsl] [projet]', groupe: 'Système',
        description: 'Ouvrir un terminal (PowerShell, cmd, Git Bash, WSL) dans un projet ou le dossier courant',
        executer: async ({ args }) => {
            const { terminaux, terminal, ouvrirTerminal } = await import('./terminaux.js');
            let t = args[0] ? terminal(args[0]) : undefined;
            const cle = t ? args.slice(1).join(' ') : args.join(' ');
            const projet = cle ? resoudreProjet(cle) : undefined;
            if (cle && !projet) return;
            const dossier = projet?.chemin ?? process.cwd();
            t ??= await choisir(`Terminal dans ${path.basename(dossier)}`, terminaux().map((x) => ({ label: `❯ ${x.nom}`, valeur: x, description: x.exe })), false);
            ouvrirTerminal(t, dossier);
            console.log(c.succes(`${t.nom} ouvert dans ${dossier}`));
        },
    },
    ...(['pwsh', 'powershell', 'cmd', 'bash', 'wsl'] as const).map((cle): Commande => ({
        nom: cle, args: '[projet]', groupe: 'Système', cache: cle === 'powershell',
        description: `Ouvrir ${cle === 'bash' ? 'Git Bash' : cle === 'wsl' ? 'WSL' : cle === 'cmd' ? 'cmd' : 'PowerShell'} dans un projet (ou ici)`,
        executer: ({ args }) => COMMANDES.find((x) => x.nom === 'terminal')!.executer({ args: [cle, ...args], reste: [cle, ...args].join(' '), apresProjet: '' }),
    })),
    {
        nom: 'voir', args: '<id>', groupe: 'Claude', cache: true,
        description: "Ouvrir la conversation d'une session à l'écran",
        executer: ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.id === args[0] || a.sessionId === args[0] || String(a.pid) === args[0]);
            if (!s) return console.log(c.alerte(`Session ${args[0]} introuvable`));
            bus.emit('selectionner', s.id ?? s.sessionId);
        },
    },
    {
        nom: 'installer-claude', groupe: 'Config',
        description: 'Installer (ou mettre à jour) Claude Code, puis se connecter',
        executer: async () => {
            const { verifierClaude } = await import('./etatClaude.js');
            console.log(c.discret('npm install -g @anthropic-ai/claude-code · une à deux minutes…'));
            const code = await tache('Installation de Claude Code', () => executer('npm install -g @anthropic-ai/claude-code', os.homedir(), (l) => l.trim() && console.log(c.discret(l))));
            if (code !== 0) return console.log(c.erreur('✗ L\'installation a échoué (voir ci-dessus). Essaie aussi : irm https://claude.ai/install.ps1 | iex'));
            const etat = await tache('Vérification', verifierClaude);
            if (etat === 'absent') return console.log(c.alerte('Installé, mais introuvable dans le PATH : ferme et relance Claudetopia.'));
            console.log(c.succes('✓ Claude Code est installé'));
            if (etat === 'deconnecte') await COMMANDES.find((x) => x.nom === 'connexion-claude')!.executer({ args: [], reste: '', apresProjet: '' });
        },
    },
    {
        nom: 'connexion-claude', groupe: 'Config', cache: true,
        description: 'Se connecter à son compte Claude',
        executer: async () => {
            const { verifierClaude, lireEtatClaude } = await import('./etatClaude.js');
            console.log(c.discret('Le navigateur s\'ouvre : connecte-toi, puis reviens ici.'));
            // La connexion attend dans le terminal : on lui passe la main, puis l'interface revient
            passerLaMain(CLAUDE, ['auth', 'login']);
            const etat = await tache('Vérification du compte', verifierClaude);
            console.log(etat === 'pret' ? c.succes(`✓ Connecté à Claude${lireEtatClaude().compte ? ` (${lireEtatClaude().compte})` : ''}`) : c.alerte('Toujours pas connecté : recommence avec /connexion-claude'));
        },
    },
    {
        nom: 'fermer', args: '<id|pid> [--oui]', groupe: 'Claude', cache: true,
        description: 'Fermer une session : arrière-plan = arrêtée et retirée (reprenable) · onglet = Claude arrêté',
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.id === args[0] || String(a.pid) === args[0] || a.sessionId === args[0]);
            if (!s) return console.log(c.alerte(`Session ${args[0]} introuvable (déjà fermée ?)`));
            const quoi = `${s.nom}${s.titre ? ` · ${s.titre}` : ''}`;
            const suite = s.arrierePlan ? 'la conversation reste reprenable' : 'Claude s\'arrête dans son onglet';
            if (!args.includes('--oui') && !(await confirmer(`Fermer ${quoi} ? (${suite})`))) return;
            // La carte disparaît tout de suite ; Claude finit de ranger ses fichiers en arrière-plan
            oublierAgent(s.cle);
            if (s.arrierePlan && s.id) {
                const sortie = await tache(`Fermeture de ${s.nom}`, () => fermerArrierePlan(s.id!));
                if (!sortie.ok) {
                    annulerOubli(s.cle);
                    return console.log(c.erreur(`✗ ${quoi} : ${sortie.message}`));
                }
            } else if (s.pid) {
                fermerArbre(s.pid);
            }
            console.log(c.succes(`✓ ${quoi} fermée`));
        },
    },
    {
        nom: 'retirer', args: '<id>', groupe: 'Claude', cache: true,
        description: 'Retirer une session d\'arrière-plan de la liste (la conversation reste reprenable)',
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.id === args[0]);
            if (!s?.id) return console.log(c.alerte('Seules les sessions d\'arrière-plan peuvent être retirées (ferme l\'onglet pour les autres)'));
            if (!args.includes('--oui') && !(await confirmer(`Retirer ${s.nom} · ${s.titre || s.id} ? (la conversation reste dans « Reprendre une session »)`))) return;
            const sortie = await tache(`Retrait de ${s.nom}`, () => retirerArrierePlan(s.id!));
            console.log(/removed/i.test(sortie) ? c.succes(`✓ Session ${s.id} retirée`) : c.erreur(`✗ ${sortie.split('\n')[0]}`));
        },
    },
    {
        nom: 'section', args: '<docker|ssh>', groupe: 'Config', cache: true,
        description: 'Afficher ou masquer une section de la colonne de gauche',
        executer: async ({ args }) => {
            const { basculerSection, sectionMasquee, SECTIONS } = await import('./ui/sections.js');
            const s = args[0] as keyof typeof SECTIONS;
            if (!(s in SECTIONS)) return console.log(c.alerte('Usage : /section docker | ssh'));
            await basculerSection(s);
            console.log(c.discret(`Section ${SECTIONS[s]} ${sectionMasquee(s) ? 'masquée · clic droit dans la colonne de gauche pour la réafficher' : 'affichée'}`));
        },
    },
    {
        nom: 'ouvrir', projet: true, args: '[projet]', groupe: 'Projets',
        description: 'Ouvrir dans l\'Explorateur',
        executer: ({ projet }) => lancerDetache('explorer', [projet!.chemin]),
    },
    {
        nom: 'cd', args: '<dossier>', groupe: 'Projets',
        description: 'Changer de dossier',
        executer: ({ reste }) => process.chdir(reste ? path.resolve(reste) : os.homedir()),
    },

    // Git
    {
        nom: 'jetons', groupe: 'Git',
        description: 'Jetons GitHub / Azure DevOps / GitLab pour voir les pull requests',
        executer: async () => {
            const { AIDE_JETONS, pageJeton, jetonsConfigures, enregistrerJeton, oublierJeton } = await import('./jetons.js');
            const { lireDepots, etatPR } = await import('./git.js');
            type H = keyof typeof AIDE_JETONS;
            const deja = jetonsConfigures();
            const site = await choisir<H>('Pour quel site ?', (Object.keys(AIDE_JETONS) as H[]).map((h) => ({
                label: `${deja.includes(h) ? '✓' : '○'} ${h}`, valeur: h, description: deja.includes(h) ? 'jeton enregistré' : 'aucun jeton',
            })), false);
            const action = await choisir(site, [
                { label: '⧉ Créer un jeton (ouvre la page) puis le coller', valeur: 'creer' },
                { label: '✎ Coller un jeton que j\'ai déjà', valeur: 'coller' },
                ...(deja.includes(site) ? [{ label: '✕ Supprimer le jeton enregistré', valeur: 'oublier' }] : []),
            ], false);
            if (action === 'oublier') {
                oublierJeton(site);
                return console.log(c.succes(`Jeton ${site} supprimé`));
            }
            if (action === 'creer') {
                const remotes = (await import('./synchro.js')).lireSynchro().depots.map((d) => d.remote ?? '').filter(Boolean);
                lancerDetache('start', ['', pageJeton(site, remotes)]);
                console.log(c.discret(`Page ouverte dans le navigateur · ${AIDE_JETONS[site].consigne}`));
            }
            const secret = await saisir(`Colle le jeton ${site} (${AIDE_JETONS[site].consigne})`, '', true);
            if (!enregistrerJeton(site, secret)) return console.log(c.erreur('Impossible de chiffrer le jeton'));
            console.log(c.succes(`Jeton ${site} enregistré (chiffré pour ton compte Windows)`));
            await tache(`Vérification : lecture des pull requests ${site}`, () => lireDepots(projets));
            const etat = etatPR[site];
            if (etat === 'ok') console.log(c.succes(`✓ Le jeton fonctionne · les PR ${site} s'affichent dans la vue Git`));
            else console.log(c.erreur(`✕ ${site} : ${etat ?? 'aucun dépôt de ce site'} · vérifie les droits du jeton (${AIDE_JETONS[site].consigne})`));
        },
    },
    {
        nom: 'git', alias: ['depots', 'repos'], groupe: 'Git',
        description: 'Tous les dépôts : à pousser, à tirer, modifs, pull requests',
        executer: async () => {
            const { VueGit } = await import('./ui/VueGit.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(VueGit, { fermer }));
        },
    },
    {
        nom: 'commit', projet: true, args: '[projet]', groupe: 'Git',
        description: 'Commit avec un message écrit par Claude',
        executer: ({ projet }) => commit(projet!),
    },
    {
        nom: 'revue', alias: ['review'], projet: true, args: '[projet]', groupe: 'Git',
        description: 'Claude relit le diff avant commit',
        executer: ({ projet }) => revue(projet!),
    },
    {
        nom: 'journal', args: '[jour|hier|semaine]', groupe: 'Git',
        description: 'Ce que tu as fait : commits + sessions, résumé IA',
        executer: ({ args }) => journal(projets, args[0] ?? 'jour'),
    },
    {
        nom: 'status', alias: ['st'], groupe: 'Git',
        description: 'État git de tous les projets',
        executer: () => tache('git status sur tous les projets', afficherStatus),
    },
    {
        nom: 'pull', args: '[projet|all]', groupe: 'Git',
        description: 'git pull --ff-only',
        executer: async ({ args }) => {
            const cibles = args[0] === 'all' ? projets.filter((p) => etatGit(p.chemin)) : [args[0] ? resoudreProjet(args[0]) : await demanderProjet()];
            for (const p of cibles) {
                if (!p) continue;
                console.log(`${puce(p.nom)} ${p.nom}`);
                await tache(`git pull · ${p.nom}`, () => executer('git pull --ff-only', p.chemin, (l) => console.log(c.discret('  ' + l))));
            }
        },
    },
    {
        nom: 'branche', projet: true, args: '[projet] [branche] [base]', groupe: 'Git',
        description: 'Nouveau worktree ../Projet-branche + Claude',
        executer: ({ projet, apresProjet }) => {
            const [branche, base] = apresProjet.split(' ').filter(Boolean);
            return nouvelleBranche(projet!, branche, base);
        },
    },
    {
        nom: 'nettoyer', projet: true, args: '[projet]', groupe: 'Git',
        description: 'Supprimer les worktrees mergés',
        executer: ({ projet }) => nettoyerWorktrees(projet!),
    },

    // Système
    {
        nom: 'top', groupe: 'Système',
        description: 'Moniteur live : sessions Claude, CPU/RAM, serveurs, usage',
        executer: async () => {
            const { Moniteur } = await import('./ui/Moniteur.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(Moniteur, { projets, fermer }));
        },
    },
    {
        nom: 'ssh', args: '[serveur | test | liste]', groupe: 'Système',
        description: 'Serveurs SSH : accès de Claude, projets, connexions, Docker',
        executer: async ({ args }) => {
            if (args[0] === 'test') return testerServeurs();
            if (args[0] === 'liste') return afficherServeurs(true);
            if (args[0] && args[0] !== 'vue') return ouvrirSsh(args[0]);
            const { VueServeurs } = await import('./ui/VueServeurs.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(VueServeurs, { fermer, initial: args[1] }));
        },
    },
    {
        nom: 'docker', args: '[distant <serveur>]', groupe: 'Système',
        description: 'Conteneurs Docker (ce poste + serveurs surveillés)',
        executer: async ({ args }) => {
            if (args[0] === 'distant') {
                if (!args[1]) {
                    console.log(config.dockerDistant.length ? `Surveillés : ${config.dockerDistant.join(', ')}` : c.discret('Aucun serveur surveillé · /docker distant <serveur>'));
                    return;
                }
                const actif = config.dockerDistant.includes(args[1]);
                config.dockerDistant = actif ? config.dockerDistant.filter((n) => n !== args[1]) : [...config.dockerDistant, args[1]];
                sauverConfig(config);
                await tache(`Lecture des conteneurs`, rafraichirDocker);
                console.log(actif ? c.discret(`Docker de ${args[1]} n'est plus surveillé`) : c.succes(`Docker de ${args[1]} ajouté à la section Docker`));
                return;
            }
            const { VueDocker } = await import('./ui/VueDocker.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(VueDocker, { fermer }));
        },
    },
    {
        nom: 'serveurs', projet: true, args: '[projet]', groupe: 'Système',
        description: 'Serveurs SSH utilisés par Claude dans ce projet',
        executer: ({ projet }) => serveursDuProjet(projet!),
    },
    {
        nom: 'ports', groupe: 'Système',
        description: 'Serveurs de dev en écoute',
        executer: afficherPorts,
    },
    {
        nom: 'kill', args: '<port>', groupe: 'Système',
        description: 'Arrêter ce qui occupe un port',
        executer: async ({ args }) => {
            const port = Number(args[0]);
            if (!port) return console.log(c.alerte('Usage : /kill <port>'));
            const snap = await tache('Lecture des processus', () => instantane());
            const ecoute = snap.ecoutes.find((e) => e.port === port);
            if (!ecoute) return console.log(c.alerte(`Rien n'écoute sur le port ${port}.`));
            const proc = snap.processus.get(ecoute.pid);
            if (await confirmer(`Arrêter ${proc?.nom ?? '?'} (pid ${ecoute.pid}, ${formatRam(proc?.ram ?? 0)}) sur :${port} ?`)) {
                fermerArbre(ecoute.pid);
                console.log(c.succes(`Port ${port} libéré`));
            }
        },
    },
    {
        nom: 'usage', groupe: 'Système',
        description: 'Tokens Claude par jour, projet, modèle',
        executer: afficherUsage,
    },
    {
        nom: 'notifs', args: '[on|off|test]', groupe: 'Système',
        description: 'Notification quand une session t\'attend',
        executer: ({ args }) => {
            if (args[0] === 'test') return toast('🤖 Claudetopia', 'Les notifications fonctionnent.');
            config.notifications = args[0] !== 'off';
            sauverConfig(config);
            demarrerNotifications();
            console.log(config.notifications ? c.succes('🔔 Notifications activées') : c.discret('🔕 Notifications désactivées'));
        },
    },

    // Config
    {
        nom: 'scan', args: '[filtre]', groupe: 'Config',
        description: 'Scanner le poste : projets, doublons, serveurs SSH, outils',
        executer: ({ reste }) => scan(reste || undefined),
    },
    {
        nom: 'racine', args: 'add|rm <chemin>', groupe: 'Config',
        description: 'Dossiers scannés (sans argument : liste)',
        executer: ({ args }) => gererListe('racines', args),
    },
    {
        nom: 'extra', args: 'add|rm <chemin>', groupe: 'Config',
        description: 'Projets isolés (sans argument : liste)',
        executer: ({ args }) => gererListe('extras', args),
    },
    {
        nom: 'config', alias: ['configuration', 'reglages'], groupe: 'Config',
        description: 'Comptes (Claude, Git, jetons), thème, interface, diagnostic',
        executer: async () => {
            const { VueConfig } = await import('./ui/VueConfig.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(VueConfig, { fermer }));
        },
    },
    ...commandesConfig(config),
    ...commandesSsh(config),
    { nom: 'aide', alias: ['help', '?'], groupe: 'Config', description: 'Cette aide', executer: afficherAide },
    { nom: 'clear', alias: ['cls'], groupe: 'Config', description: 'Effacer l\'écran', executer: () => { /* géré par l'interface */ } },
    { nom: 'exit', alias: ['quit', 'q'], groupe: 'Config', description: 'Quitter', executer: () => { /* géré par l'interface */ } },
];

function gererListe(cle: 'racines' | 'extras', args: string[]): void {
    const [action, ...reste] = args;
    if (!action) {
        config[cle].forEach((r) => console.log(`${fs.existsSync(r) ? c.succes('●') : c.erreur('●')} ${r}`));
        return;
    }
    const absolu = path.resolve(reste.join(' '));
    if (action === 'add') {
        if (!fs.existsSync(absolu)) return console.log(c.erreur(`Dossier introuvable : ${absolu}`));
        if (!config[cle].includes(absolu)) config[cle].push(absolu);
    } else if (action === 'rm') {
        config[cle] = config[cle].filter((r) => r.toLowerCase() !== absolu.toLowerCase());
    } else {
        return console.log(c.alerte('Usage : add|rm <chemin>'));
    }
    sauverConfig(config);
    rafraichirProjets();
    console.log(c.succes(`Config mise à jour`));
}

export function trouverCommande(nom: string): Commande | undefined {
    const n = nom.replace(/^\//, '').toLowerCase();
    return COMMANDES.find((cmd) => cmd.nom === n || cmd.alias?.includes(n));
}

// Programmes lancés directement dans PowerShell même sans "!"
const PROGRAMMES_SHELL = new Set(['git', 'npm', 'npx', 'node', 'pnpm', 'yarn', 'dotnet', 'php', 'composer', 'python', 'pip', 'docker', 'ls', 'dir', 'wt']);

// Point d'entrée : une ligne tapée par l'utilisateur
export async function executerLigne(ligne: string): Promise<void> {
    const texte = ligne.trim();
    if (!texte) return menu();
    if (texte.startsWith('!') || PROGRAMMES_SHELL.has(texte.split(' ')[0].toLowerCase())) {
        const cmd = texte.replace(/^!\s*/, '');
        const code = await executer(cmd, process.cwd(), (l) => console.log(l));
        if (code !== 0) console.log(c.erreur(`code de sortie ${code}`));
        return;
    }
    const [premier, ...args] = texte.split(/\s+/);
    const cmd = trouverCommande(premier);
    if (!cmd) {
        // Pas une commande connue : nouvelle session Claude dans le dossier courant, avec ce texte comme consigne
        const ici = resoudreProjet('.')!;
        return lancerClaude(ici, developperPrompts(texte), config.lancement);
    }
    const reste = texte.slice(premier.length).trim();
    let projet: Projet | undefined;
    let apresProjet = reste;
    if (cmd.projet) {
        if (args[0]) {
            projet = resoudreProjet(args[0]);
            if (!projet) return;
            apresProjet = args.slice(1).join(' ');
        } else {
            projet = await demanderProjet();
        }
    }
    await cmd.executer({ args, reste, projet, apresProjet });
}

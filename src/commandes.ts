import { commandesAssistant } from './assistantCommandes.js';
import { commandesSessions } from './sessionsCommandes.js';
import { commandesMissions } from './missions.js';
import { commandesEquipes } from './equipeCommandes.js';
import { estIntegree } from './sessionsIntegrees.js';
import { ouvrirCodexTerminal } from './terminalCodex.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chargerConfig, sauverConfig, CHEMIN_CONFIG } from './config.js';
import { Projet, listerProjets, trouverProjet, brancheGit, derniereSessionClaude, etatGit, depuis, correspond } from './projets.js';
import { ouvrirOnglet, ouvrirACote, executer, lancerDetache, quotePS } from './lanceurs.js';
import { spawnSync } from 'child_process';
import { lancerClaude, reprendreDerniere, choisirSession, nouvelleBranche, nettoyerWorktrees, lancerAvecPrompt } from './actions.js';
import { recents, projetsRecents, puce } from './dashboard.js';
import { instantane, sessionsActives, fermerArbre, formatRam } from './systeme.js';
import { serveursDev } from './serveurs.js';
import { lireArgument, argumentsCommande, suggestionsCommande } from './ligneCommande.js';
import { calculerUsage, formatTokens, nomDossierClaude } from './usage.js';
import { demarrerSurveillance, toast, jouerSon } from './notifications.js';
import { demanderClaude, parLignes } from './claude.js';
import { revue, commit } from './gitia.js';
import { journal } from './journal.js';
import { cherche } from './cherche.js';
import { scan } from './scanCommande.js';
import { commandesConfig } from './configCommandes.js';
import { commandesSsh } from './sshGestion.js';
import { commandesConnexions } from './connexionsCommandes.js';
import { commandesPlus } from './plus.js';
import { commandesPrCi } from './prci.js';
import { commandesConversation } from './conversationCommandes.js';
import { commandesDiagnostics } from './diagnosticsCommandes.js';
import { commandesRecuperation } from './recuperationCommandes.js';
import { commandesMaintenance } from './maintenanceCommandes.js';
import { commandesTicket } from './ticket.js';
import { commandesModeles } from './modelesSession.js';
import { commandesHistorique } from './historiqueCout.js';
import { commandesGardeFou } from './gardeFou.js';
import { commandesThemeAuto } from './themeAuto.js';
import { commandesSurveillance } from './surveillanceLogs.js';
import { commandesExport } from './exportImport.js';
import { commandesApparence } from './apparence.js';
import { ajusterProjets, synchro } from './synchro.js';
import { cloner as clonerDepot } from './git.js';
import { afficherServeurs, testerServeurs, ouvrirSsh, serveursDuProjet } from './sshCommandes.js';
import { c } from './theme.js';
import { tableau, titre, ligneMarkdown } from './affichage.js';
import { bus, choisir, confirmer, tache, afficherVue, saisir } from './ui/bus.js';
import { SessionVue, lancerArrierePlan, arreterArrierePlan, retirerArrierePlan, fermerArrierePlan, envoyerMessage, fichiersModifies } from './agents.js';
import { lireDonnees, rafraichirDocker, oublierAgent, annulerOubli } from './ui/donnees.js';
import { passerLaMain } from './ui/ecran.js';
import { CLAUDE } from './claude.js';

// Ouvre "claude attach" dans une fenêtre à part (ou à côté, dans la même fenêtre) : l'interface reste affichée ici
export async function rejoindre(id: string, aCote = false): Promise<void> {
    if (estIntegree(id)) {
        const s = lireDonnees().agents.find((x) => x.id === id);
        if (s?.fournisseur === 'codex') return ouvrirCodexTerminal(id, aCote);
        bus.emit('selectionner', id); return;
    }
    const s = lireDonnees().agents.find((x) => x.id === id);
    const dossier = s?.cwd ?? process.cwd();
    const titre = `🤖 ${s?.nom ?? path.basename(dossier)}`;
    const commande = `& ${quotePS(CLAUDE)} attach ${id}`;
    if (aCote && ouvrirACote(dossier, titre, commande)) return void console.log(c.succes(`Session ${id} ouverte à côté · Alt+← / Alt+→ dans Windows Terminal pour passer d'un panneau à l'autre`));
    if (!aCote) ouvrirOnglet(dossier, titre, commande, true);
    console.log(c.succes(`Session ${id} ouverte dans une nouvelle fenêtre`) + (aCote ? c.discret(' (« à côté » demande Windows Terminal)') : ''));
}

// Vues de la nouvelle interface (grille, fichiers chauds) : c'est elle qui les affiche
function ouvrirZone(zone: string): void {
    if (bus.listenerCount('zone')) bus.emit('zone', zone);
    else console.log(c.alerte('Cette vue existe seulement dans la nouvelle interface (Agentopia sous Bun)'));
}

// Ce que la session a modifié : les fichiers qu'elle a édités et qui diffèrent encore de git
async function changements(s: SessionVue): Promise<void> {
    const racine = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: s.cwd, encoding: 'utf-8' }).stdout?.trim();
    if (!racine) return void console.log(c.alerte(`${s.nom} n'est pas un dépôt git`));
    // Seulement les fichiers du dépôt : git refuse tout le status si un chemin est en dehors
    const edites = fichiersModifies(s.fichier).filter((f) => !path.relative(racine, f).startsWith('..') && !path.isAbsolute(path.relative(racine, f)));
    if (!edites.length) return void console.log(c.discret(`${s.nom} n'a modifié aucun fichier dans cette session`));
    const git = (args: string[]) => spawnSync('git', args, { cwd: racine, encoding: 'utf-8', maxBuffer: 20_000_000 }).stdout ?? '';
    const etat = new Map(git(['status', '--porcelain', '-z', '--', ...edites]).split('\0').filter(Boolean)
        .map((l) => [path.resolve(racine, l.slice(3)).toLowerCase(), l.slice(0, 2)]));
    const encore = edites.filter((f) => etat.has(f.toLowerCase()));
    console.log(titre(`Changements de ${s.nom} · ${s.titre || s.id || ''}`) + c.discret(`  ${edites.length} fichier(s) touché(s) · ${encore.length} encore à commiter`));
    for (const f of edites) {
        const code = etat.get(f.toLowerCase());
        const marque = !code ? c.discret('  ✓ commité') : code.includes('?') ? c.succes('  + nouveau') : code.includes('D') ? c.erreur('  − supprimé') : c.alerte('  ~ modifié');
        console.log(`${marque.padEnd(24)} ${path.relative(racine, f)}`);
    }
    if (!encore.length) return;
    console.log();
    const suivis = encore.filter((f) => !etat.get(f.toLowerCase())?.includes('?'));
    git(['diff', '--color=always', 'HEAD', '--', ...suivis]).split('\n').forEach((l) => console.log(l));
    for (const f of encore.filter((x) => etat.get(x.toLowerCase())?.includes('?'))) {
        console.log(c.succes(`+++ nouveau : ${path.relative(racine, f)}`));
        try {
            fs.readFileSync(f, 'utf-8').split('\n').slice(0, 40).forEach((l) => console.log(c.succes(`+${l}`)));
        } catch {
            // illisible (binaire, supprimé entre-temps)
        }
    }
}

export const config = chargerConfig();
let projets = listerProjets(config);
export const getProjets = () => projets;
synchro.on('projets', (liste: Projet[]) => { projets = liste; bus.emit('projets', projets); });
export const rafraichirProjets = () => {
    ajusterProjets(listerProjets(config));
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
    groupe: 'Agents' | 'Claude' | 'Projets' | 'Git' | 'Système' | 'Config';
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
        return { label: `${puce(p.nom)} ${p.nom}`, valeur: p, description: `${p.chemin}${branche ? ` · ⎇ ${branche}` : ''}` };
    }), true);
}

async function resoudreProjet(cle: string): Promise<Projet> {
    // "." = dossier courant
    if (cle === '.') return { nom: path.basename(process.cwd()), chemin: process.cwd(), racine: '(courant)' };
    // Chemin complet (utilisé par les boutons des cartes de session)
    if (path.isAbsolute(cle)) {
        try { if (fs.statSync(cle).isDirectory()) return { nom: path.basename(cle), chemin: cle, racine: '(chemin)' }; } catch { /* Message explicite ci-dessous. */ }
        throw new Error(`Dossier de projet introuvable ou inaccessible : ${cle}`);
    }
    const trouve = trouverProjet(projets, cle);
    if (!trouve) {
        throw new Error(`Aucun projet ne correspond à « ${cle} ». Ouvre /projets pour le choisir.`);
    }
    if (Array.isArray(trouve)) {
        return choisir(`Plusieurs projets correspondent à « ${cle} » · choisis le dossier`, trouve.map((p) => ({ label: p.nom, description: p.chemin, valeur: p })), true);
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
    const groupes = ['Agents', 'Claude', 'Projets', 'Git', 'Système', 'Config'] as const;
    for (const g of groupes) {
        console.log(titre(g === 'Claude' ? 'Outils Claude CLI' : g));
        console.log(tableau(COMMANDES.filter((cmd) => cmd.groupe === g).map((cmd) => [
            c.accent(`/${cmd.nom}`) + (cmd.args ? c.discret(` ${cmd.args}`) : ''),
            cmd.description,
        ]), { max: [34] }));
    }
    console.log(titre('Raccourcis'));
    console.log(tableau([
        [c.accent('clic'), 'carte de session → sa conversation · boutons · menus · serveurs · Docker'],
        [c.accent('molette'), 'faire défiler la conversation, la sortie, les cartes'],
        [c.accent('Espace'), 'dans la saisie vide : la carte des actions (g = Git, s = Sessions, r = Serveurs, d = Docker…)'],
        [c.accent('Alt+S / P / R / D'), 'espaces de la colonne de gauche : Sessions, Projets, SSH, Docker'],
        [c.accent('Ctrl+K'), "palette : chercher et lancer n'importe quoi (« proj com » → Commit · mon-projet)"],
        [c.accent('Ctrl+F'), 'chercher dans la conversation ouverte (Entrée = occurrence suivante)'],
        [c.accent('glisser un fichier'), 'dans la fenêtre : il devient une pièce jointe du message'],
        [c.accent('clic droit'), 'actions de ce qui est sous la souris : session, équipe, Docker, serveur, journal · masquer une section'],
        [c.accent('⇅ SFTP'), 'vue SSH → Fichiers, ou /sftp : parcourir un serveur · /ssh-ajouter, /sftp-ajouter pour configurer'],
        [c.accent('Alt+M'), 'parler au maître : il gère tes sessions (fermer, relancer, écrire, créer, résumer) · aussi clic sur sa zone à gauche'],
        [c.accent('Alt+T'), 'ouvrir un terminal : PowerShell, cmd, Git Bash, WSL (aussi « ❯ Terminal » à gauche)'],
        [c.accent('texte libre'), 'conversation ouverte : envoyé à son agent · sinon : agent par défaut ou choix du fournisseur'],
        [c.accent('Entrée (vide)'), 'conversation ouverte : la rejoindre dans une nouvelle fenêtre · sinon : menu projet'],
        [c.accent('Alt+Tab'), 'depuis une session rejointe : revenir au CLI (elle continue)'],
        [c.accent('Alt+J'), 'conversation ouverte : la rejoindre à côté, dans la même fenêtre Windows Terminal'],
        [c.accent('Alt+Z'), 'mode focus : seulement la conversation et la barre de saisie (encore Alt+Z pour revenir)'],
        [c.accent('Alt+G'), 'grille : jusqu\'à 4 conversations en direct'],
        [c.accent('Alt+H'), 'fichiers chauds : ce que tes sessions modifient, et les conflits'],
        [c.accent('Alt+D'), 'cacher / montrer le diff en direct sous la conversation'],
        [c.accent('Alt+O'), 'globe 3D des serveurs SSH (glisser pour le tourner)'],
        [c.accent('Alt+L'), 'afficher ou résumer les détails des outils dans la conversation'],
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
        { label: '✻ Nouvelle conversation', valeur: 'session' },
        { label: '▭ Claude dans un onglet', valeur: 'onglet' },
        { label: '◆ Équipe guidée ou modèle réutilisable', valeur: 'equipe-projet' },
        { label: '★ Claude avec un prompt favori', valeur: 'favori' },
        { label: '↺ Historique des agents intégrés', valeur: 'historique-agents' },
        { label: '↺ Reprendre une session Claude CLI', valeur: 'sessions' },
        { label: '» Continuer la dernière session Claude CLI', valeur: 'reprendre' },
        { label: '✦ Mission guidée : corriger, développer, analyser', valeur: 'mission' },
        { label: '⌕ Revue du diff par un agent', valeur: 'revue' },
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
        nom: 'claude-cli', projet: true, args: '[projet] [prompt|@favori]', groupe: 'Claude',
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
        nom: 'envoyer', args: '<sessionId> <texte>', groupe: 'Agents', cache: true,
        description: "Envoyer un message à une session d'arrière-plan",
        executer: async ({ args, reste }) => {
            const s = lireDonnees().agents.find((a) => a.sessionId === args[0]);
            const texte = reste ? reste.slice(lireArgument(reste)!.fin).trim() : args.slice(1).join(' ');
            if (!s) throw new Error('Session introuvable ; message non envoyé.');
            const res = await tache(`Envoi à ${s.nom}`, () => envoyerMessage(s, developperPrompts(texte)));
            bus.emit('notice', res.ok ? `✓ ${res.message} à ${s.nom} · réponse dans la conversation` : `✕ ${res.message}`);
            if (!res.ok) throw new Error(res.message);
            // La conversation peut revenir sous un nouvel id : on la rouvre dès qu'elle réapparaît
            if (res.id) bus.emit('selectionner', res.id);
            console.log(res.ok ? c.succes(`→ ${s.nom} : ${texte.slice(0, 80)}`) : c.erreur(res.message));
        },
    },
    {
        nom: 'favori-session', args: '<sessionId>', groupe: 'Agents', cache: true,
        description: 'Envoyer un prompt favori à une session',
        executer: async ({ args }) => {
            const nom = await choisir('Prompt favori à envoyer', Object.entries(config.prompts).map(([n, texte]) => ({
                label: `@${n}`, valeur: n, description: texte,
            })));
            await trouverCommande('envoyer')!.executer({ args: [args[0], ...config.prompts[nom].split(' ')], reste: '', apresProjet: '' });
        },
    },
    {
        nom: 'rejoindre', args: '<id>', groupe: 'Agents', cache: true,
        description: "Entrer dans une session d'arrière-plan",
        executer: async ({ args }) => rejoindre(args[0]),
    },
    {
        nom: 'rejoindre-cote', args: '<id>', groupe: 'Agents', cache: true,
        description: "Ouvrir une session d'arrière-plan à côté, dans la même fenêtre",
        executer: async ({ args }) => rejoindre(args[0], true),
    },
    {
        nom: 'grille', groupe: 'Agents',
        description: 'Plusieurs conversations à la fois, en direct (Alt+G)',
        executer: () => ouvrirZone('grille'),
    },
    {
        nom: 'chauds', alias: ['fichiers'], groupe: 'Agents',
        description: 'Les fichiers que tes sessions modifient en ce moment, et les conflits (Alt+H)',
        executer: () => ouvrirZone('chauds'),
    },
    {
        nom: 'globe', groupe: 'Système',
        description: 'Globe 3D de tes serveurs SSH : qui répond, reliés à ton poste (Alt+O)',
        executer: () => ouvrirZone('globe'),
    },
    {
        nom: 'repondre', args: '<sessionId> [réponse]', groupe: 'Agents', cache: true,
        description: 'Répondre à la question d\'une session bloquée',
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.sessionId === args[0]);
            if (!s) return void bus.emit('notice', '✕ Session introuvable');
            if (s.permission) return trouverCommande('autorisation')!.executer({ args, reste: '', apresProjet: '' });
            const texte = args.slice(1).join(' ') || await saisir(`Réponse à ${s.nom} : ${s.question ?? ''}`.slice(0, 200), s.suggestion ?? '');
            if (!texte.trim()) return;
            await trouverCommande('envoyer')!.executer({ args: [s.sessionId, ...texte.trim().split(' ')], reste: '', apresProjet: '' });
        },
    },
    {
        nom: 'changements', args: '<sessionId>', groupe: 'Agents', cache: true,
        description: 'Fichiers modifiés par une session et leur diff',
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.sessionId === args[0] || a.id === args[0]);
            if (!s) return void bus.emit('notice', '✕ Session introuvable');
            await tache(`Changements de ${s.nom}`, () => changements(s));
        },
    },
    {
        nom: 'arreter', args: '<id>', groupe: 'Agents', cache: true,
        description: "Arrêter une session d'arrière-plan",
        executer: async ({ args }) => {
            if (!args.includes('--oui') && !await confirmer(`Arrêter la session ${args[0]} ? (la conversation est gardée)`)) return;
            console.log(c.discret(await arreterArrierePlan(args[0])));
        },
    },
    {
        nom: 'copie', args: '<sessionId>', groupe: 'Agents', cache: true,
        description: "Continuer une session d'onglet ici (copie en arrière-plan)",
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.sessionId === args[0]);
            if (!s) return console.log(c.erreur('Session introuvable'));
            if (s.integree) return rejoindre(s.id!);
            const { id, sortie } = await tache('Copie de la conversation en arrière-plan', () => lancerArrierePlan(s.cwd, `${s.nom}-suite`, undefined, s.sessionId));
            if (!id) return console.log(c.erreur(sortie));
            console.log(c.succes(`Copie créée (${id}) : la session d'origine reste dans son onglet`));
            await rejoindre(id);
        },
    },
    {
        nom: 'continuer', args: '<sessionId>', groupe: 'Agents', cache: true,
        description: 'Reprendre une session terminée (avec son historique) en arrière-plan',
        executer: async ({ args }) => {
            const s = lireDonnees().agents.find((a) => a.sessionId === args[0]);
            if (!s) return void bus.emit('notice', '✕ Session introuvable');
            if (s.integree) return rejoindre(s.id!);
            const { id, sortie } = await tache(`Reprise de ${s.nom}`, () => lancerArrierePlan(s.cwd, s.titre || s.nom, undefined, s.sessionId));
            if (!id) return console.log(c.erreur(sortie.split('\n')[0] || 'Échec de la reprise'));
            console.log(c.succes(`${s.nom} reprend (${id}) avec tout son historique · écris-lui dans la barre du bas`));
            bus.emit('selectionner', id);
        },
    },
    {
        nom: 'lancement', args: 'fond|onglet', groupe: 'Config',
        description: 'Où /claude-cli ouvre les sessions classiques (fond ou onglet)',
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
            const cibles: Projet[] = [];
            for (const nom of noms) cibles.push(await resoudreProjet(nom));
            if (!cibles.length) return console.log(c.alerte('Usage : /multi saniplan api-ipg -- @securite'));
            // Sans consigne : un onglet par projet ; avec : des sessions d'arrière-plan qui travaillent en parallèle
            for (const p of cibles) await lancerClaude(p, consigne || undefined, consigne ? 'fond' : 'onglet');
            if (consigne) console.log(c.discret(`${cibles.length} sessions lancées · suis-les sur leurs cartes, une notification arrive quand chacune a fini`));
        },
    },
    {
        nom: 'equipe', alias: ['equipes', 'orchestre'], args: '[projet|nouvelle] [-- objectif]', groupe: 'Agents',
        description: 'Voir les équipes ou créer un plan guidé avec les fournisseurs choisis',
        executer: async ({ args }) => {
            const { VueEquipe } = await import('./ui/VueEquipe.js');
            const { equipeDe } = await import('./equipe.js');
            const React = await import('react');
            if (!args.length || equipeDe(args[0])) return afficherVue((fermer) => React.createElement(VueEquipe, { fermer, id: args[0] }));
            const separation = args.indexOf('--');
            const avant = separation >= 0 ? args.slice(0, separation) : args;
            const objectif = separation >= 0 ? developperPrompts(args.slice(separation + 1).join(' ')) : '';
            const cle = avant[0] === 'nouvelle' ? avant[1] : avant[0];
            const projet = cle ? await resoudreProjet(cle) : await demanderProjet('Équipe sur quel projet ?');
            if (projet) await COMMANDES.find((c) => c.nom === 'equipe-mixte')!.executer({ args: [], reste: objectif, apresProjet: objectif, projet });
        },
    },
    {
        nom: 'equipe-cli', args: '[projet|nouvelle] [-- objectif]', groupe: 'Claude',
        description: 'Ancien parcours : plan automatique et équipe Claude CLI',
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
            const projet = cle ? await resoudreProjet(cle) : await demanderProjet('Équipe sur quel projet ?');
            if (!projet) return;
            if (!objectif) {
                const { MODELES_EQUIPE } = await import('./equipe.js');
                const depart = await choisir(`Équipe sur ${projet.nom} : quel objectif ?`, [
                    { label: '✎ Objectif libre', valeur: '', description: 'tu décris ce que tu veux obtenir' },
                    ...MODELES_EQUIPE.map((m) => ({ label: m.nom, valeur: m.objectif, description: m.objectif })),
                ], false);
                objectif = (await saisir(`Objectif de l'équipe sur ${projet.nom} (le chef d'équipe découpe en tâches)`, depart)).trim();
            }
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
        nom: 'prompts', args: '[add <nom> <texte> | rm <nom>]', groupe: 'Agents',
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
            // « defaut » : le premier terminal détecté (PowerShell 7 s'il est là)
            let t = args[0] === 'defaut' ? terminaux()[0] : args[0] ? terminal(args[0]) : undefined;
            const cle = t ? args.slice(1).join(' ') : args.join(' ');
            const projet = cle ? await resoudreProjet(cle) : undefined;
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
        nom: 'voir', args: '<id>', groupe: 'Agents', cache: true,
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
            if (etat === 'absent') return console.log(c.alerte('Installé, mais introuvable dans le PATH : ferme et relance Agentopia.'));
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
            await passerLaMain(CLAUDE, ['auth', 'login']);
            const etat = await tache('Vérification du compte', verifierClaude);
            console.log(etat === 'pret' ? c.succes(`✓ Connecté à Claude${lireEtatClaude().compte ? ` (${lireEtatClaude().compte})` : ''}`) : c.alerte('Toujours pas connecté : recommence avec /connexion-claude'));
        },
    },
    {
        nom: 'fermer', args: '<id|pid> [--oui]', groupe: 'Agents', cache: true,
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
        nom: 'retirer', args: '<id>', groupe: 'Agents', cache: true,
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
        executer: (ctx) => commandesConnexions(config).find((cmd) => cmd.nom === 'connecter')!.executer(ctx),
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
        description: 'Commit avec un message écrit par l’agent choisi',
        executer: ({ projet }) => commit(projet!),
    },
    {
        nom: 'revue', alias: ['review'], projet: true, args: '[projet]', groupe: 'Git',
        description: 'L’agent choisi relit le diff avant commit',
        executer: ({ projet }) => revue(projet!),
    },
    {
        nom: 'journal', alias: ['journee'], args: '[jour|hier|semaine]', groupe: 'Git',
        description: 'Ce que tu as fait : commits, sessions et coût, résumé IA prêt à coller (stand-up, Teams)',
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
            const cibles = args[0] === 'all' ? projets.filter((p) => etatGit(p.chemin)) : [args[0] ? await resoudreProjet(args[0]) : await demanderProjet()];
            for (const p of cibles) {
                if (!p) continue;
                console.log(`${puce(p.nom)} ${p.nom}`);
                const { gitExecution } = await import('./gitExecution.js');
                const r = await tache(`git pull · ${p.nom}`, () => gitExecution(['pull', '--ff-only'], p.chemin, { timeoutMs: 120_000 }));
                console.log(r.ok ? c.discret(r.sortie) : c.erreur(r.sortie));
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
        description: 'Moniteur live : agents, CPU/RAM, serveurs, usage',
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
            if (args[0] === 'test') return toast('🤖 Agentopia', 'Les notifications fonctionnent · clic pour ouvrir les questions', 'claudetopia:questions');
            config.notifications = args[0] !== 'off';
            sauverConfig(config);
            demarrerNotifications();
            console.log(config.notifications ? c.succes('🔔 Notifications activées') : c.discret('🔕 Notifications désactivées'));
        },
    },
    {
        nom: 'veille', args: '[minutes|maintenant]', groupe: 'Système',
        description: 'Écran de veille animé (constellation des sessions) : délai en minutes, 0 pour le couper',
        executer: async ({ args }) => {
            if (args[0] === 'maintenant' || !args[0]) {
                if (bus.listenerCount('veille')) return void bus.emit('veille');
                return void console.log(c.alerte('L\'écran de veille existe seulement dans la nouvelle interface'));
            }
            const minutes = Number(args[0]);
            if (!Number.isFinite(minutes) || minutes < 0) return void console.log(c.erreur('Indique un nombre de minutes (0 pour couper)'));
            config.ecranVeille = minutes;
            sauverConfig(config);
            console.log(minutes ? c.succes(`Écran de veille après ${minutes} min sans clavier ni souris`) : c.discret('Écran de veille coupé'));
        },
    },
    {
        nom: 'sons', args: '[on|off|test]', groupe: 'Système',
        description: 'Petit son quand une session finit (doux) ou a besoin de toi (plus marqué)',
        executer: async ({ args }) => {
            if (args[0] === 'test') {
                jouerSon('fini');
                return void setTimeout(() => jouerSon('alerte'), 1200);
            }
            config.sons = args[0] ? args[0] !== 'off' : config.sons === false;
            sauverConfig(config);
            console.log(config.sons ? c.succes('♪ Sons activés · « /sons test » pour les entendre') : c.discret('♪ Sons coupés (les notifications restent, en silence)'));
            if (config.sons) jouerSon('fini');
        },
    },

    // Config
    {
        nom: 'scan', args: '[filtre]', groupe: 'Config',
        description: 'Rechercher de nouveaux projets ou revoir les projets ignorés',
        executer: async ({ reste }) => { const { ouvrirPreparation } = await import('./preparation.js'); await ouvrirPreparation(config, { rescan: true, filtre: reste || undefined }); },
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
        description: 'Fournisseurs IA, comptes Git, thème, interface et diagnostic',
        executer: async () => {
            const { VueConfig } = await import('./ui/VueConfig.js');
            const React = await import('react');
            await afficherVue((fermer) => React.createElement(VueConfig, { fermer }));
        },
    },
    ...commandesConfig(config),
    ...commandesSsh(config),
    ...commandesConnexions(config),
    ...commandesSessions(config),
    ...commandesMissions(config),
    ...commandesEquipes(),
    ...commandesPlus(config),
    ...commandesPrCi(),
    ...commandesConversation(),
    ...commandesDiagnostics(),
    ...commandesRecuperation(config),
    ...commandesMaintenance(),
    ...commandesTicket(getProjets),
    ...commandesModeles(config, getProjets),
    ...commandesHistorique(getProjets),
    ...commandesGardeFou(config),
    ...commandesThemeAuto(config),
    ...commandesSurveillance(),
    ...commandesExport(config),
    ...commandesApparence(config),
    ...commandesAssistant(config),
    { nom: 'aide', alias: ['help', '?'], groupe: 'Config', description: 'Cette aide', executer: afficherAide },
    { nom: 'clear', alias: ['cls'], groupe: 'Config', description: 'Vider le journal et revenir au cockpit', executer: () => { /* géré par l'interface */ } },
    { nom: 'sorties', groupe: 'Config', description: 'Voir le journal complet des commandes (Échap pour revenir)', executer: () => { /* géré par l'interface */ } },
    { nom: 'avis', groupe: 'Config', description: 'Retrouver les avis et erreurs de ce lancement', executer: async () => {
        const { ouvrirAvis } = await import('./ui/avis.js');
        await ouvrirAvis();
    } },
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
export async function executerLigne(ligne: string, contexte: { dossier?: string } = {}): Promise<void> {
    const texte = ligne.trim();
    const dossier = path.resolve(contexte.dossier || process.cwd());
    if (!texte) return menu();
    if (texte.startsWith('!') || PROGRAMMES_SHELL.has(texte.split(' ')[0].toLowerCase())) {
        const cmd = texte.replace(/^!\s*/, '');
        const code = await executer(cmd, dossier, (l) => console.log(l));
        if (code !== 0) console.log(c.erreur(`code de sortie ${code}`));
        return;
    }
    const premier = texte.split(/\s+/, 1)[0];
    const cmd = trouverCommande(premier);
    if (!cmd) {
        if (premier.startsWith('/')) {
            const proches = suggestionsCommande(premier, COMMANDES.filter((c) => !c.cache).flatMap((c) => [c.nom, ...(c.alias ?? [])]));
            throw new Error(`Commande inconnue : ${premier}.${proches.length ? ` Essaie ${proches.join(', ')}.` : ' Ouvre /aide ou Ctrl+K.'} Aucun agent lancé.`);
        }
        // Même parcours que /session : choix explicite, avec la préférence présélectionnée.
        const ici = await resoudreProjet(dossier);
        return COMMANDES.find((c) => c.nom === 'session')!.executer({ args: [], reste: texte, projet: ici, apresProjet: developperPrompts(texte) });
    }
    const reste = texte.slice(premier.length).trim();
    // Le texte libre après un projet/session est conservé tel quel (citations, code, retours à la ligne).
    const premierArg = lireArgument(reste);
    const args = cmd.projet || cmd.nom === 'envoyer'
        ? premierArg ? [premierArg.valeur, ...reste.slice(premierArg.fin).trim().split(/\s+/).filter(Boolean)] : []
        : argumentsCommande(reste);
    let projet: Projet | undefined;
    let apresProjet = reste;
    if (cmd.projet) {
        if (args[0]) {
            projet = await resoudreProjet(args[0] === '.' ? dossier : args[0]);
            if (!projet) return;
            apresProjet = reste.slice(premierArg!.fin).trim();
        } else {
            projet = await demanderProjet();
        }
    }
    await cmd.executer({ args, reste, projet, apresProjet });
}

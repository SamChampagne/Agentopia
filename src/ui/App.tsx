import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { bus, Demande, Annule, choisir, confirmer } from './bus.js';
import { terminaux } from '../terminaux.js';
import { SECTIONS, Section, sectionMasquee } from './sections.js';
import { arreterEquipe, terminerEquipe } from '../equipe.js';
import { copier } from '../lanceurs.js';
import { appuyer } from './appui.js';
import { noeudA, estGroupe } from './quelleTouche.js';
import { Espace, Detail, ongletsPositions, lignesEspace } from './espaces.js';
import { VueDetail, contenuDetail } from './VueDetail.js';
import { suivreMetriques, metriques } from '../metriques.js';
import { dollars } from '../cout.js';
import { liens } from '../notifications.js';
import { CHEMINS } from '../chemins.js';
import { depotDe } from '../synchro.js';
import { etatClaude, lireEtatClaude, verifierClaude } from '../etatClaude.js';
import { maitre, etatMaitre, prechauffer, demanderAuMaitre, DESTRUCTRICES } from '../maitre.js';
import { Selecteur, Saisie } from './Selecteur.js';
import { Laterale, cartesLaterales, X_TERMINAL } from './Laterale.js';
import { VueJournal, VueSession, BarreHaut, largeurTitre, toutesLesLignes, lignesTranscript } from './Zones.js';
import { Cockpit, sessionAuClic, JOURNAL } from './Cockpit.js';
import { theme as themeCourant, degrade } from '../theme.js';

// Ligne sous la barre du haut : un dégradé fin aux couleurs du thème, calculé une fois par largeur
let cacheLigne = { cle: '', texte: '' };
function ligneDegrade(n: number): string {
    const cle = `${n}|${themeCourant.primaire}|${themeCourant.accent}`;
    if (cacheLigne.cle !== cle) cacheLigne = { cle, texte: degrade('─'.repeat(n), themeCourant.primaire, themeCourant.accent) };
    return cacheLigne.texte;
}
import { useDonnees, demarrerCollecte, rafraichirAgents, lireDonnees } from './donnees.js';
import { serveursLateraux, miseLateraleDe, basculerRepli } from './sections.js';
import { souris, Souris } from './terminal.js';
import { quitterEcran } from './ecran.js';
import { journal, lignesJournal, avecRetrait, vider } from './journal.js';
import { imageDuPressePapiers, joindreImages, fichiersDeposes, EST_IMAGE } from './pressePapiers.js';
import { lateraleADroite, COL_ACTIONS, ActionSession } from './mise.js';
import { disposition } from './disposition.js';
import { calculerMise, miseLaterale, placerBoutons, placerBoutonsLignes, nbRangees, boutonRangee, boutonA, choisirLargeurLaterale, HAUT, CARTE, LATERAL_MIN } from './mise.js';
import { COMMANDES, config, executerLigne, getProjets, rafraichirProjets, trouverCommande } from '../commandes.js';
import { chargerHistorique, ajouterHistorique, sauverConfig } from '../config.js';
import { etatGitAsync, correspond, EtatGit } from '../projets.js';
import { cpuMachine, formatRam } from '../systeme.js';
import { projetsRecents } from '../dashboard.js';
import { Message, SessionVue, lireTranscript } from '../agents.js';
import { theme, couleurProjet, c, fond } from '../theme.js';

const SPINNER = ['✻', '✼', '✽', '✾', '✿', '❀', '✿', '✾', '✽', '✼'];

// Seulement l'essentiel, une icône par vue ; le menu en dernier (il s'ouvre aussi avec Espace et au clic droit).
// Moniteur, Journal, Récents, Aide… sont dans le menu ⋯ (et la palette Ctrl+K)
const BOUTONS = [
    { label: '◉ Live', action: '/global' },
    { label: '▦ Projets', action: '/projets' },
    { label: '◆ Équipes', action: '/equipe' },
    { label: '⎇ Git', action: '/git' },
    { label: '◫ Docker', action: '/docker' },
    { label: '⇄ SSH', action: '/ssh' },
    { label: '◈ Config', action: '/config' },
    { label: '⋯', action: '/menu-principal' },
];
// Liaison vivante : suit les icônes de la barre (/ecran)
const boutonsHautActuels = () => (disposition().icones ? BOUTONS : BOUTONS.map((b) => (b.label === '⋯' ? b : { ...b, label: b.label.split(' ').slice(1).join(' ') })));
export let BOUTONS_HAUT = boutonsHautActuels();
bus.on('disposition', () => {
    BOUTONS_HAUT = boutonsHautActuels();
});

// Nouveau style : toutes les actions de la session dans sa barre, sans menu à part (le texte reste visible)
// La description s'affiche au survol (actions à gauche ou à droite)
export function actionsSession(s: SessionVue): ActionSession[] {
    return [
        { label: '← Retour', action: 'fermer', aide: 'Revenir au cockpit. La session continue de tourner.' },
        s.arrierePlan
            ? { label: '↵ Rejoindre', action: 'rejoindre', aide: 'Ouvrir cette session en plein écran pour lui écrire directement.' }
            : { label: '⑂ Continuer ici', action: 'copie', aide: 'Reprendre cette conversation dans une nouvelle session d’arrière-plan.' },
        { label: '⎘ Copier le code', action: 'copier-code', aide: 'Copier le dernier bloc de code de Claude dans le presse-papiers.' },
        { label: '⎘ Copier la réponse', action: 'copier-reponse', aide: 'Copier la dernière réponse de Claude dans le presse-papiers.' },
        { label: '⌕ Revue du diff', action: 'revue', aide: 'Faire relire par Claude les changements non commités du projet.' },
        { label: '✓ Commit', action: 'commit', aide: 'Commiter les changements avec un message écrit par Claude.' },
        { label: '◧ VS Code', action: 'code', aide: 'Ouvrir le dossier du projet dans VS Code.' },
        { label: '▤ Dossier', action: 'dossier', aide: 'Ouvrir le dossier du projet dans l’explorateur Windows.' },
        ...(terminaux().length ? [{ label: '❯ Terminal', action: 'terminal', aide: 'Ouvrir un terminal dans le dossier du projet.' }] : []),
        ...(s.arrierePlan ? [{ label: '★ Favori', action: 'favori', aide: 'Garder cette session en favori pour la retrouver vite.' }] : []),
        { label: '✕ Fermer la session', action: 'fermer-session', aide: 'Arrêter Claude dans cette session (elle reste reprenable plus tard).' },
    ];
}

function commandeSession(action: string, s: SessionVue): string | undefined {
    if (action === 'copier-reponse') return `/copier-reponse ${s.sessionId}`;
    if (action === 'dossier') return `/ouvrir ${s.cwd}`;
    if (action === 'terminal') return `/terminal ${terminaux()[0]?.cle ?? ''} ${s.cwd}`;
    if (action === 'rejoindre') return `/rejoindre ${s.id}`;
    if (action === 'fermer-session') return `/fermer ${s.id ?? s.pid}`;
    if (action === 'copie') return `/copie ${s.sessionId}`;
    if (action === 'code') return `/code ${s.cwd}`;
    if (action === 'favori') return `/favori-session ${s.sessionId}`;
    if (action === 'revue') return `/revue ${s.cwd}`;
    if (action === 'copier-code') return `/copier-code ${s.sessionId}`;
    if (action === 'commit') return `/commit ${s.cwd}`;
    return undefined;
}

interface Suggestion {
    texte: string;
    label: string;
    description?: string;
    executer: boolean;
}

function calculerSuggestions(saisie: string): Suggestion[] {
    if (!saisie) return [];
    const mots = saisie.split(' ');
    const dernier = mots[mots.length - 1];
    if (dernier.startsWith('@')) {
        return Object.entries(config.prompts)
            .filter(([nom]) => nom.startsWith(dernier.slice(1)))
            .map(([nom, texte]) => ({ texte: [...mots.slice(0, -1), `@${nom} `].join(' '), label: `@${nom}`, description: texte, executer: false }));
    }
    if (mots.length === 1 && saisie.startsWith('/')) {
        const debut = saisie.slice(1).toLowerCase();
        return COMMANDES
            .filter((cmd) => !cmd.cache && (cmd.nom.startsWith(debut) || cmd.alias?.some((a) => a.startsWith(debut))))
            .map((cmd) => ({ texte: `/${cmd.nom} `, label: `/${cmd.nom}` + (cmd.args ? ` ${cmd.args}` : ''), description: cmd.description, executer: true }));
    }
    const cmd = trouverCommande(mots[0]);
    if (cmd?.projet && mots.length === 2 && dernier !== '.') {
        const projets = getProjets();
        const recents = projetsRecents(projets, projets.length).map((r) => r.projet);
        return [...recents, ...projets.filter((p) => !recents.includes(p))]
            .filter((p) => !dernier || correspond(p.nom, dernier))
            .filter((p) => p.nom.toLowerCase() !== dernier.toLowerCase())
            .map((p) => ({ texte: `${mots[0]} ${p.nom} `, label: p.nom, description: p.racine, executer: true }));
    }
    return [];
}

interface Statut {
    cwd: string;
    git?: EtatGit;
    cpu: number;
}
// L'état git du dossier courant vient de la synchro (déjà en mémoire, à jour en direct) ; git status seulement sinon
// Dossier hors des projets suivis : git status au plus toutes les 30 s
const gitHorsSynchro = new Map<string, { date: number; git?: EtatGit }>();
async function gitDe(dossier: string): Promise<EtatGit | undefined> {
    const d = depotDe(dossier);
    if (d) return { branche: d.branche, modifs: d.modifs, enAvance: d.avance, enRetard: d.retard };
    const connu = gitHorsSynchro.get(dossier);
    if (connu && Date.now() - connu.date < 30_000) return connu.git;
    const git = await etatGitAsync(dossier);
    gitHorsSynchro.set(dossier, { date: Date.now(), git });
    return git;
}
const lireStatutAsync = async (): Promise<Statut> => ({ cwd: process.cwd(), git: await gitDe(process.cwd()), cpu: Math.round(cpuMachine()) });

// Ne change l'état (donc ne redessine) que si la valeur a vraiment changé
const siChange = <T,>(nouveau: T) => (ancien: T) => (JSON.stringify(ancien) === JSON.stringify(nouveau) ? ancien : nouveau);

// Transcript relu seulement s'il a changé sur le disque
let transcriptConnu = { fichier: '', cle: '' };
function transcriptModifie(fichier: string): boolean {
    let cle = '';
    try {
        const st = fs.statSync(fichier);
        cle = `${st.mtimeMs}:${st.size}`;
    } catch {
        // pas encore créé
    }
    if (transcriptConnu.fichier === fichier && transcriptConnu.cle === cle) return false;
    transcriptConnu = { fichier, cle };
    return true;
}

// La session ouverte survit au remontage de l'interface (après claude attach)
let selectionMemo: string | undefined;
const debutApp = Date.now();

export function App({ commandeInitiale, auDemarrage }: { commandeInitiale?: string; auDemarrage?: string }) {
    const { stdout } = useStdout();
    const [taille, setTaille] = useState({ c: stdout.columns || 110, r: stdout.rows || 34 });
    const m = calculerMise(taille.c, taille.r);
    const donnees = useDonnees();
    const [, setVersionJournal] = useState(0);
    const [saisie, setSaisie] = useState('');
    const [cleSaisie, setCleSaisie] = useState(0);
    const [demande, setDemande] = useState<Demande>();
    const [tache, setTache] = useState<string>();
    const [occupe, setOccupe] = useState(false);
    const [historique] = useState(() => chargerHistorique());
    const [posHistorique, setPosHistorique] = useState(-1);
    const [indexSugg, setIndexSugg] = useState(0);
    const [ctrlC, setCtrlC] = useState(0);
    // La branche git arrive juste après le premier affichage (git status ne bloque pas le démarrage)
    const [statut, setStatut] = useState<Statut>(() => ({ cwd: process.cwd(), cpu: 0 }));
    useEffect(() => void lireStatutAsync().then(setStatut), []);
    const [selection, setSelectionEtat] = useState<string | undefined>(selectionMemo);
    // Mode maître : ce qui est tapé en bas va au maître (clic sur sa zone à gauche, ou Alt+M)
    const [modeMaitre, setModeMaitre] = useState(false);
    const [espace, setEspaceEtat] = useState<Espace>('sessions');
    const [detail, setDetailEtat] = useState<Detail>();
    const [survol, setSurvol] = useState<string>();
    const [pleinEcran, setPleinEcran] = useState(false);
    // « Quelle touche ? » ouvert : le chemin des lettres déjà tapées ('' = la racine)
    const [quelleTouche, setQuelleTouche] = useState<string>();
    const setEspace = (e: Espace) => {
        setEspaceEtat(e);
        setDecalage(0);
    };
    // Une conversation et un panneau de détail se remplacent l'un l'autre dans la zone principale
    const ouvrirDetail = (dt?: Detail) => {
        setDetailEtat(dt);
        if (dt) {
            selectionMemo = undefined;
            setSelectionEtat(undefined);
        }
    };
    // Bouton du haut de la vue ouverte (reste allumé tant qu'elle est ouverte)
    const [vueActive, setVueActive] = useState<string>();
    const [, setVersionMaitre] = useState(0);
    const [messages, setMessages] = useState<Message[]>([]);
    const [defilement, setDefilement] = useState(0);
    // Le cockpit est l'accueil ; le journal complet s'ouvre pour un long résultat, un clic ou /journal
    const [journalOuvert, setJournalOuvert] = useState(false);
    // Disposition de l'écran (/ecran) : tout l'écran se redessine quand elle change
    const [, setVersionDisposition] = useState(0);
    useEffect(() => {
        const f = () => setVersionDisposition((v) => v + 1);
        bus.on('disposition', f);
        return () => void bus.off('disposition', f);
    }, []);
    // Entre le lancement d'une commande et l'arrivée de sa vue, l'écran précédent reste affiché :
    // sans ça le cockpit apparaît une fraction de seconde avant chaque vue
    const attenteVue = useRef(0);
    const dernierPrincipal = useRef<React.ReactNode>(null);
    const cibleDefilement = useRef(0);
    const animDefilement = useRef<NodeJS.Timeout>();
    const defilementActuel = useRef(0);
    defilementActuel.current = defilement;
    function glisserVers(cible: number) {
        cibleDefilement.current = Math.max(0, cible);
        if (animDefilement.current) return;
        animDefilement.current = setInterval(() => {
            const reste = cibleDefilement.current - defilementActuel.current;
            if (Math.abs(reste) <= 1) {
                clearInterval(animDefilement.current);
                animDefilement.current = undefined;
                return setDefilement(cibleDefilement.current);
            }
            setDefilement((d) => d + Math.ceil(Math.abs(reste) / 2) * Math.sign(reste));
        }, 16);
    }
    const [decalage, setDecalage] = useState(0);
    const [tic, setTic] = useState(0);
    const [images, setImages] = useState<string[]>([]);
    const [heure, setHeure] = useState(new Date());
    const [notice, setNotice] = useState<string>();          // message bref au-dessus de la saisie (envoi réussi…)
    const [aSelectionner, setASelectionner] = useState<string>();   // id d'une session qui vient d'être lancée

    // ─── Reprendre là où on en était : la conversation ouverte et la vue affichée ───
    const sansReprise = !!process.env.CLAUDETOPIA_SANS_REPRISE;   // tests : ni lecture ni écriture
    useEffect(() => {
        if (sansReprise) return;
        const t = setTimeout(() => {
            try {
                fs.writeFileSync(CHEMINS.etat, JSON.stringify({ session: selection, vue: demande?.type === 'vue' ? vueActive : undefined }), 'utf-8');
            } catch {
                // pas grave
            }
        }, 400);
        return () => clearTimeout(t);
    }, [selection, demande, vueActive]);
    const [, setVersionMetriques] = useState(0);
    const regardeServeurs = detail?.type === 'serveur';
    useEffect(() => {
        if (!regardeServeurs) return;
        const f = () => setVersionMetriques((v) => v + 1);
        metriques.on('maj', f);
        const arreter = suivreMetriques(() => lireDonnees().serveurs);
        return () => {
            metriques.off('maj', f);
            arreter();
        };
    }, [regardeServeurs]);
    const repris = useRef(false);
    useEffect(() => {
        if (repris.current || commandeInitiale || auDemarrage || sansReprise) return;
        // On attend que les sessions soient lues (ou 4 s), puis on rouvre une seule fois
        if (!donnees.agents.length && Date.now() - debutApp < 4000) return;
        repris.current = true;
        let etat: { session?: string; vue?: string } = {};
        try {
            etat = JSON.parse(fs.readFileSync(CHEMINS.etat, 'utf-8'));
        } catch {
            return;
        }
        if (etat.session && donnees.agents.some((a) => a.cle === etat.session)) setSelection(etat.session);
        else if (etat.vue) {
            setVueActive(etat.vue);
            void lancer(etat.vue, false, true);
        }
    }, [donnees.agents]);

    const setSelection = (cle?: string) => {
        if (cle) setDetailEtat(undefined);
        selectionMemo = cle;
        setSelectionEtat(cle);
        setDefilement(0);
    };
    const session = donnees.agents.find((a) => a.cle === selection);

    // Une session vient d'être lancée : on l'ouvre dès que sa carte apparaît (quelques secondes)
    useEffect(() => {
        const nouvelle = aSelectionner && donnees.agents.find((a) => a.id === aSelectionner || a.sessionId === aSelectionner);
        if (nouvelle) {
            setSelection(nouvelle.cle);
            setASelectionner(undefined);
        }
    }, [donnees.agents, aSelectionner]);

    // Abonnements : taille, journal, demandes, tâches, horloges
    useEffect(() => {
        demarrerCollecte();
        const surResize = () => setTaille({ c: stdout.columns || 110, r: stdout.rows || 34 });
        const surJournal = () => setVersionJournal((v) => v + 1);
        const surDemande = (d?: Demande) => {
            attenteVue.current = 0;
            setDemande(d);
        };
        const surTache = (t?: string) => setTache(t);
        stdout.on('resize', surResize);
        journal.on('maj', surJournal);
        bus.on('demande', surDemande);
        bus.on('tache', surTache);
        let minuterieNotice: NodeJS.Timeout | undefined;
        const surNotice = (t: string) => {
            setNotice(t);
            clearTimeout(minuterieNotice);
            minuterieNotice = setTimeout(() => setNotice(undefined), 6000);
        };
        const surSelection = (id: string) => setASelectionner(id);
        bus.on('notice', surNotice);
        bus.on('selectionner', surSelection);
        // Une vue (ex. Git) demande une commande : on la lance une fois la vue fermée et la commande en cours finie
        const surLancer = async (commandes: string | string[]) => {
            for (const commande of ([] as string[]).concat(commandes)) {
                // La vue qui demande vient de se fermer : on attend juste la fin de sa commande (quelques ms)
                for (let i = 0; i < 100 && (etatRef.current.occupe || etatRef.current.demande); i++) await new Promise((r) => setTimeout(r, 16));
                await etatRef.current.lancer(commande, false, true);
            }
        };
        bus.on('lancer', surLancer);
        const idStatut = setInterval(async () => {
            const s = await lireStatutAsync();
            setStatut(siChange(s));
        }, 3000);
        // Une seule horloge pour tout l'écran (une image par battement, pas une par composant) :
        // toutes les 800 ms si quelque chose s'anime (✻ qui tourne), sinon chaque seconde pour le cockpit (CPU, compteurs)
        let idTic: NodeJS.Timeout;
        const battement = () => {
            const { tache, donnees: d, demande: dm, session: s, contenuOuvert, journalOuvert: j } = etatRef.current;
            const anime = !!tache || d.agents.some((a) => a.statut === 'travaille')
                || d.equipes.some((e) => ['planification', 'en cours', 'integration'].includes(e.etat)) || etatMaitre().enCours;
            if (anime || (!dm && !s && !contenuOuvert && !j)) setTic((t) => t + 1);
            idTic = setTimeout(battement, anime ? 800 : 1000);
        };
        idTic = setTimeout(battement, 800);
        const idHeure = setInterval(() => setHeure(new Date()), 30_000);
        // Clic sur une notification Windows : claudetopia:session/<id>, claudetopia:equipe/<id>, claudetopia:questions
        const surLien = (lien: string) => {
            const [quoi, id] = lien.replace(/^claudetopia:\/*/i, '').replace(/\/$/, '').split('/');
            if (quoi === 'session' && id) bus.emit('selectionner', id);
            else if (quoi === 'equipe' && id) void etatRef.current.lancer(`/equipe ${id}`, false, true);
            else if (quoi === 'questions') void etatRef.current.lancer('/questions', false, true);
            else if (quoi === 'surveillances') void etatRef.current.lancer('/surveillances', false, true);
        };
        liens.on('demande', surLien);
        const surPleinEcran = (v: boolean) => setPleinEcran(v);
        bus.on('plein-ecran', surPleinEcran);
        const surDetail = (dt: Detail) => setTimeout(() => etatRef.current.ouvrirDetail(dt), 50);
        bus.on('detail', surDetail);
        const surMaitre = () => setVersionMaitre((v) => v + 1);
        maitre.on('maj', surMaitre);
        // Le maître démarre en arrière-plan : sa première réponse sera rapide
        // Claude Code installé et connecté ? Sinon la zone du maître le dit et propose de corriger.
        // Le maître ne démarre que quand Claude est prêt.
        const surClaude = (etat: string) => {
            surMaitre();
            if (etat === 'pret') setTimeout(() => void prechauffer(getProjets().map((p) => p.nom)), 3000);
            else if (etat === 'absent') console.log(c.alerte('! Claude Code n\'est pas installé : clique « installer » à gauche, ou tape /installer-claude'));
            else if (etat === 'deconnecte') console.log(c.alerte('! Tu n\'es pas connecté à Claude : clique « se connecter » à gauche, ou tape /connexion-claude'));
        };
        etatClaude.on('maj', surClaude);
        const idMaitre = setTimeout(() => void verifierClaude(), 300);
        // Une fois par lancement : s'il y a des connexions à régler, on le dit (sans insister)
        const idConnexions = setTimeout(async () => {
            const { etatConnexions } = await import('../connexions.js');
            const aRegler = (await etatConnexions()).filter((x) => x.etat === 'manque' || x.etat === 'avert');
            if (aRegler.length) bus.emit('notice', `⚿ ${aRegler.length} connexion${aRegler.length > 1 ? 's' : ''} à régler (${aRegler.slice(0, 3).map((x) => x.nom).join(', ')}) · /connexions`);
        }, 20_000);
        if (commandeInitiale) lancer(commandeInitiale, true);
        else if (auDemarrage) lancer(auDemarrage);
        return () => {
            stdout.off('resize', surResize);
            journal.off('maj', surJournal);
            bus.off('demande', surDemande);
            bus.off('tache', surTache);
            bus.off('notice', surNotice);
            bus.off('selectionner', surSelection);
            bus.off('lancer', surLancer);
            clearInterval(idStatut);
            clearTimeout(idTic);
            clearInterval(idHeure);
            clearTimeout(idMaitre);
            clearTimeout(idConnexions);
            maitre.off('maj', surMaitre);
            etatClaude.off('maj', surClaude);
            liens.off('demande', surLien);
            bus.off('plein-ecran', surPleinEcran);
            bus.off('detail', surDetail);
        };
    }, []);

    // Conversation de la session ouverte, relue en continu
    useEffect(() => {
        if (!session) return setMessages([]);
        transcriptConnu = { fichier: '', cle: '' };
        const lire = () => {
            if (transcriptModifie(session.fichier)) setMessages(lireTranscript(session.fichier));
        };
        lire();
        const id = setInterval(lire, 1000);
        return () => clearInterval(id);
    }, [session?.fichier]);

    const [gitSession, setGitSession] = useState<EtatGit>();
    useEffect(() => {
        if (!session) return setGitSession(undefined);
        let actif = true;
        const lire = async () => {
            const g = await gitDe(session.cwd);
            if (actif) setGitSession(siChange(g));
        };
        lire();
        const id = setInterval(lire, 3000);
        return () => {
            actif = false;
            clearInterval(id);
        };
    }, [session?.cwd]);

    // ─── Ctrl+F : chercher dans la conversation ouverte ───
    // La barre du bas devient le champ de recherche ; Entrée = occurrence suivante (en remontant le temps)
    const [recherche, setRecherche] = useState(false);
    const [occurrence, setOccurrence] = useState(0);
    const trouvees = useMemo(() => {
        if (!recherche || !session || saisie.trim().length < 2) return [];
        const terme = saisie.trim().toLowerCase();
        const lignes = toutesLesLignes(lignesTranscript(messages, m.principal - 2), m.principal - 2);
        const indices: number[] = [];
        lignes.forEach((l, i) => l.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase().includes(terme) && indices.push(i));
        return indices.reverse().map((i) => lignes.length - i);   // distance depuis la fin, la plus récente d'abord
    }, [recherche, saisie, messages, m.principal, session?.cle]);
    useEffect(() => setOccurrence(0), [saisie, recherche]);
    useEffect(() => {
        if (!trouvees.length) return;
        const depuisLaFin = trouvees[occurrence % trouvees.length];
        setDefilement(Math.max(0, depuisLaFin - Math.floor((m.corps - 3) / 2)));
    }, [trouvees, occurrence]);
    useEffect(() => {
        if (!session) setRecherche(false);
    }, [session?.cle]);

    const suggestions = useMemo(() => (recherche ? [] : calculerSuggestions(saisie)), [saisie, recherche]);
    const sugg = Math.min(indexSugg, Math.max(0, suggestions.length - 1));
    const nbSugg = Math.min(8, suggestions.length);

    const boutonsHaut = placerBoutons(BOUTONS_HAUT, largeurTitre());
    // Actions de la conversation : en colonne (gauche/droite), en rangées en haut, ou cachées (/ecran)
    const posActions = disposition().actions;
    const actionsS = session ? actionsSession(session) : [];
    const boutonsS = !session || posActions !== 'haut' ? [] : placerBoutonsLignes(actionsS, m.lateral, m.principal - 1, 2);
    // Colonne d'actions : quelle action est à cette position (x relatif à la zone principale)
    const actionColonne = (xz: number, by: number): ActionSession | undefined => {
        if (!session || (posActions !== 'gauche' && posActions !== 'droite')) return undefined;
        const dedans = posActions === 'gauche' ? xz < COL_ACTIONS - 1 : xz > m.principal - COL_ACTIONS;
        return dedans ? actionsS[by - 3] : undefined;
    };

    function quitter() {
        quitterEcran();
        process.exit(0);
    }

    // silencieux : lancé par un clic, un menu, une vue ou le maître. La commande « /… » n'est ni affichée
    // dans le journal ni gardée dans l'historique : on ne voit que son résultat
    async function lancer(ligne: string, puisQuitter = false, silencieux = false) {
        let texte = ligne.trim();
        const cmd = trouverCommande(texte.split(' ')[0]);
        if (cmd?.nom === 'exit') return quitter();
        if (cmd?.nom === 'clear') {
            setJournalOuvert(false);
            return vider();
        }
        if (cmd?.nom === 'sorties') {
            setSelection(undefined);
            setDefilement(0);
            return setJournalOuvert(true);
        }
        const avant = lignesJournal().length;
        attenteVue.current = Date.now();
        if (texte && !cmd?.cache && !silencieux) {
            historique.unshift(texte);
            ajouterHistorique(texte);
        }
        // Une commande ordinaire affiche son résultat dans le journal : on referme la session ouverte
        if (!cmd?.cache) setSelection(undefined);
        if (images.length) {
            texte = joindreImages(texte, images);
            setImages([]);
        }
        if (!silencieux) console.log(`\n${c.accent('❯')} ${ligne.trim() || c.discret('(menu)')}`);
        setDefilement(0);
        setOccupe(true);
        try {
            await (silencieux ? executerLigne(texte) : avecRetrait(() => executerLigne(texte)));
        } catch (err) {
            if (err instanceof Annule) {
                if (!silencieux) console.log(c.discret('Annulé'));
            }
            else console.log(c.erreur(`✗ ${(err as Error).message}`));
        } finally {
            rafraichirProjets();
            rafraichirAgents();   // une session fermée, lancée ou relancée : sa carte suit tout de suite
            lireStatutAsync().then((s) => setStatut(siChange(s)));
            attenteVue.current = 0;
            setOccupe(false);
            // Un résultat trop long pour « Dernières sorties » s'ouvre en entier (Échap ramène au cockpit)
            if (lignesJournal().length - avant > 8) setJournalOuvert(true);
            if (puisQuitter) setTimeout(quitter, 300);
        }
    }

    // Saisie : un fichier glissé dans la fenêtre (son chemin collé) devient une pièce jointe « [fichier 2: rapport.pdf] »
    function surSaisie(v: string) {
        const ajout = v.length > saisie.length + 3 && v.startsWith(saisie) ? v.slice(saisie.length) : '';
        const fichiers = ajout && !recherche ? fichiersDeposes(ajout) : undefined;
        if (fichiers) {
            const debut = images.length;
            setImages([...images, ...fichiers]);
            const etiquettes = fichiers.map((f, i) => (EST_IMAGE.test(f) ? `[image ${debut + i + 1}]` : `[fichier ${debut + i + 1}: ${path.basename(f)}]`));
            return remplacer(`${saisie}${saisie && !saisie.endsWith(' ') ? ' ' : ''}${etiquettes.join(' ')} `);
        }
        setSaisie(v);
        setIndexSugg(0);
    }

    function remplacer(texte: string) {
        setSaisie(texte);
        setCleSaisie((k) => k + 1);
        setIndexSugg(0);
    }

    function soumettre(valeur: string) {
        if (recherche) return setOccurrence((o) => o + 1);
        const s = suggestions[sugg];
        if (s) {
            if (s.executer) {
                setSaisie('');
                lancer(s.texte);
            } else {
                remplacer(s.texte);
            }
            return;
        }
        // Entrée sur une ligne vide avec une session d'arrière-plan ouverte : on la rejoint
        if (!valeur.trim() && session?.arrierePlan) {
            lancer(`/rejoindre ${session.id}`, false, true);
            return;
        }
        setSaisie('');
        setPosHistorique(-1);
        // Mode maître : le texte est une demande au maître (les commandes / et ! restent des commandes)
        if (modeMaitre && valeur.trim() && !/^[/!]/.test(valeur.trim())) {
            void parlerAuMaitre(valeur.trim());
            return;
        }
        // Une conversation est ouverte et ce n'est ni une commande ni du shell : le texte lui est envoyé
        if (session && valeur.trim() && !/^[/!]/.test(valeur.trim())) {
            console.log(`\n${c.accent('❯')} ${valeur.trim()} ${c.discret(`→ ${session.nom}`)}`);
            lancer(`/envoyer ${session.sessionId} ${valeur.trim()}`, false, true);
            return;
        }
        lancer(valeur);
    }

    // Où part le texte tapé : affiché au-dessus de la barre de saisie
    // ─── Raccourcis du moment (barre du bas) ─────────────────────────────────
    function raccourcis(): [string, string][] {
        if (quelleTouche !== undefined) return [['lettre', 'choisir'], ['⌫', 'remonter'], ['Échap', 'fermer']];
        if (demande?.type === 'choix') return [['↑↓', 'choisir'], ['Entrée', 'valider'], ['Échap', 'annuler']];
        if (demande?.type === 'saisie') return [['Entrée', 'valider'], ['Échap', 'annuler']];
        if (demande?.type === 'vue') return [['clic', 'choisir'], ['Entrée', 'ouvrir'], ['Échap', 'fermer']];
        if (recherche) return [['Entrée', 'suivante'], ['Échap', 'fermer']];
        if (modeMaitre) return [['Entrée', 'envoyer'], ['Échap', 'revenir']];
        if (session) return [['Entrée', 'rejoindre'], ['Ctrl+F', 'chercher'], ['clic droit', 'actions'], ['Échap', 'retour']];
        return [['Espace', 'actions'], ['Ctrl+K', 'chercher'], ['Alt+M', 'maître'], ['?', 'aide']];
    }

    // ─── Le maître ───────────────────────────────────────────────────────────
    // Sa réponse s'affiche dans sa zone (à gauche) et dans le journal ; ses commandes passent par lancer(),
    // comme si tu les tapais, après une seule confirmation si elles arrêtent ou suppriment quelque chose
    const decrire = (cmd: string) => {
        const [nom, id] = cmd.split(/\s+/);
        const s = donnees.agents.find((a) => a.id === id || a.sessionId === id || String(a.pid) === id);
        const verbe = nom === '/arreter' ? 'mettre en pause' : nom === '/fermer' ? 'fermer' : 'supprimer';
        return `${verbe} ${s ? `${s.nom} (${s.titre || s.id || 'onglet'})` : id}`;
    };
    async function parlerAuMaitre(texte: string) {
        if (etatMaitre().enCours) return void bus.emit('notice', '◈ le maître réfléchit encore : attends sa réponse');
        const e = await demanderAuMaitre(texte, getProjets().map((p) => p.nom), session?.id ?? session?.sessionId);
        console.log(`\n${c.violet('◈')} ${texte}`);
        if (e.erreur) return console.log(c.erreur(`  ✕ ${e.erreur}`));
        console.log(`  ${e.reponse}`);
        const commandes = e.commandes ?? [];
        const destructrices = commandes.filter((x) => DESTRUCTRICES.has(x.split(/\s+/)[0]));
        if (destructrices.length && !(await confirmer(`◈ Le maître va ${destructrices.map(decrire).join(', ')} : d'accord ?`))) {
            return console.log(c.discret('  annulé'));
        }
        for (const commande of commandes) {
            // Une commande déjà en cours (tapée par toi) : on attend qu'elle finisse
            while (etatRef.current.occupe || etatRef.current.demande) await new Promise((r) => setTimeout(r, 200));
            const avecOui = DESTRUCTRICES.has(commande.split(/\s+/)[0]) && !commande.includes('--oui') ? `${commande} --oui` : commande;
            await etatRef.current.lancer(avecOui, false, true);
        }
    }

    function destination(): { texte: string; couleur: string } {
        const t = saisie.trim();
        if (t.startsWith('/')) return { texte: 'commande du CLI', couleur: 'gray' };
        if (recherche) {
            const n = trouvees.length;
            return { texte: `⌕ chercher dans la conversation : ${t.length < 2 ? 'tape au moins 2 lettres' : n ? `${(occurrence % n) + 1}/${n} · Entrée = suivante` : 'aucun résultat'} · Échap fermer`, couleur: theme.secondaire };
        }
        if (t.startsWith('!')) return { texte: `commande PowerShell dans ${path.basename(statut.cwd)}`, couleur: theme.accent };
        if (modeMaitre) {
            return etatMaitre().enCours
                ? { texte: '◈ le maître réfléchit… attends sa réponse', couleur: '#a78bfa' }
                : { texte: '◈ au maître : il gère tes sessions (fermer, relancer, écrire, créer, résumer…) · Échap pour revenir', couleur: '#a78bfa' };
        }
        if (session) {
            if (!session.arrierePlan) return { texte: `${session.nom} tourne dans un onglet : écris-y, ou clique « ⑂ Continuer ici » pour lui écrire d'ici`, couleur: '#facc15' };
            if (session.statut === 'travaille') return { texte: `${session.nom} travaille : attends qu'il ait fini pour lui écrire, ou Entrée pour le rejoindre`, couleur: '#facc15' };
            if (session.statut === 'bloquee') return { texte: `${session.nom} attend une permission : Entrée pour le rejoindre et répondre`, couleur: '#fb923c' };
            return { texte: `↳ envoyé à la conversation ${session.nom} (${session.titre || session.id})${t ? '' : ' · Entrée vide = la rejoindre'}`, couleur: couleurProjet(session.nom) };
        }
        return { texte: `↳ nouvelle session Claude dans ${path.basename(statut.cwd)} · Ctrl+K pour tout le reste`, couleur: fond.discret };
    }

    function ouvrirCarte(index: number) {
        const carte = cartesLaterales(donnees)[index];
        if (carte?.type === 'equipe') return void lancer(`/equipe ${carte.e.id}`, false, true);
        const s = carte?.s;
        if (s) setSelection(s.cle === selection ? undefined : s.cle);
    }

    // ─── Souris ──────────────────────────────────────────────────────────────
    // Redimensionnement de la colonne de gauche (souris ou Alt+← / Alt+→), mémorisé dans la config
    const glisser = useRef(false);
    function redimensionner(largeur: number, sauver: boolean) {
        const n = Math.max(LATERAL_MIN, Math.min(m.largeur - 50, largeur));
        choisirLargeurLaterale(n);
        setTaille((t) => ({ ...t }));   // force le recalcul de la mise en page
        if (sauver) {
            config.largeurLaterale = n;
            sauverConfig(config);
        }
    }

    // ─── Clic droit ──────────────────────────────────────────────────────────
    type Article = { label: string; valeur: string | (() => unknown); description?: string };
    const ici = (dossier: string): Article[] => terminaux().map((t) => ({ label: `❯ ${t.nom} ici`, valeur: `/terminal ${t.cle} ${dossier}` }));
    const sectionsArticles = (): Article[] => (Object.keys(SECTIONS) as Section[]).map((s) => ({
        label: sectionMasquee(s) ? `+ Afficher la section ${SECTIONS[s]}` : `− Masquer la section ${SECTIONS[s]}`, valeur: `/section ${s}`,
    }));
    const general = (): Article[] => [
        { label: '◈ Parler au maître (Alt+M)', valeur: () => setModeMaitre(true) },
        { label: '⚿ Connexions (comptes, serveurs, outils)', valeur: '/connexions' },
        { label: '+ Nouvelle session Claude', valeur: '/nouvelle' },
        { label: '◆ Nouvelle équipe d\'agents', valeur: '/equipe nouvelle' },
        ...ici(statut.cwd),
    ];

    function menuSession(s: SessionVue): { titre: string; articles: Article[] } {
        return {
            titre: `● ${s.nom} · ${s.titre || (s.arrierePlan ? s.id : 'onglet')}`,
            articles: [
                { label: '↵ Ouvrir la conversation', valeur: () => setSelection(s.cle) },
                ...(s.arrierePlan
                    ? [{ label: '⤢ Rejoindre (plein écran)', valeur: `/rejoindre ${s.id}` }, { label: '★ Mettre en favori', valeur: `/favori-session ${s.sessionId}` }]
                    : [{ label: '⑂ Continuer ici', valeur: `/copie ${s.sessionId}` }]),
                { label: '⎘ Copier le dernier bloc de code', valeur: `/copier-code ${s.sessionId}` },
                { label: '⎘ Copier la dernière réponse', valeur: `/copier-reponse ${s.sessionId}` },
                { label: '⌕ Revue du diff', valeur: `/revue ${s.cwd}` },
                { label: '✓ Commit avec message IA', valeur: `/commit ${s.cwd}` },
                { label: '◧ VS Code', valeur: `/code ${s.cwd}` },
                { label: '▤ Explorateur', valeur: `/ouvrir ${s.cwd}` },
                ...ici(s.cwd),
                { label: '✕ Fermer la session', valeur: `/fermer ${s.id ?? s.pid}`, description: s.arrierePlan ? 'arrêtée et retirée (reprenable plus tard)' : 'arrête Claude dans son onglet' },
            ],
        };
    }

    // Ce qu'il y a sous la souris (mêmes zones que le clic gauche)
    function menuPour(x: number, by: number): { titre: string; articles: Article[] } {
        if (by < 0) return { titre: 'Claudetopia', articles: general() };
        if (x < m.lateral) {
            const ml = miseLateraleDe(m.corps, donnees);
            const cartes = cartesLaterales(donnees);
            const debut = Math.max(0, Math.min(decalage, cartes.length - ml.nbCartes));
            const carte = by >= 1 && by < ml.ligneNouvelle ? cartes[debut + Math.floor((by - 1) / CARTE)] : undefined;
            if (carte?.type === 'session') return menuSession(carte.s);
            if (carte?.type === 'equipe') {
                const e = carte.e;
                return {
                    titre: `◆ Équipe ${e.nomProjet} · ${e.objectif}`,
                    articles: [
                        { label: '◆ Ouvrir l\'équipe', valeur: `/equipe ${e.id}` },
                        ...ici(e.projet),
                        { label: '◧ VS Code', valeur: `/code ${e.projet}` },
                        { label: '■ Arrêter les agents', valeur: () => arreterEquipe(e.id) },
                        { label: '− Supprimer l\'équipe', valeur: async () => (await confirmer(`Ranger l'équipe ${e.nomProjet} ? Les agents sont arrêtés et retirés, leurs branches restent.`)) && terminerEquipe(e.id), description: 'les branches restent dans le dépôt' },
                    ],
                };
            }
            const iServeur = by - ml.ligneServeurs - 1;
            if (ml.afficheServeurs && by >= ml.ligneServeurs) {
                const s = serveursLateraux(donnees)[iServeur];
                return {
                    titre: s ? `Serveur ${s.nom}` : 'Serveurs SSH',
                    articles: [
                        ...(s ? [{ label: `⇄ Se connecter à ${s.nom}`, valeur: `/ssh ${s.nom}` }, { label: '⇅ Fichiers (SFTP)', valeur: `/sftp ${s.configure ? s.nom : ''}` }, { label: '≡ Détails du serveur', valeur: `/ssh vue ${s.nom}` }] : []),
                        { label: '+ Ajouter un serveur', valeur: '/ssh-ajouter' },
                        { label: '⇄ Tous les serveurs', valeur: '/ssh' },
                        { label: '− Masquer la section Serveurs SSH', valeur: '/section ssh' },
                    ],
                };
            }
            if (ml.afficheDocker && by >= ml.ligneDocker && by <= ml.ligneDocker + ml.nbDocker) {
                return { titre: 'Docker', articles: [{ label: '▣ Ouvrir la vue Docker', valeur: '/docker' }, { label: '− Masquer la section Docker', valeur: '/section docker' }] };
            }
            return { titre: 'Colonne de gauche', articles: general() };
        }
        if (session) return menuSession(session);
        return {
            titre: 'Journal',
            articles: [
                { label: '⎘ Copier le journal', valeur: () => copier(lignesJournal().join('\n').replace(/\x1b\[[0-9;]*m/g, '')) },
                { label: '− Effacer le journal', valeur: '/clear' },
                ...general(),
            ],
        };
    }

    async function ouvrirMenu({ titre, articles }: { titre: string; articles: Article[] }) {
        let choix: Article['valeur'];
        try {
            choix = await choisir(titre, articles.map((a) => ({ label: a.label, valeur: a.valeur, description: a.description })), false);
        } catch {
            return;   // Échap ou clic ailleurs
        }
        if (typeof choix === 'string') await etatRef.current.lancer(choix, false, true);
        else await choix();
    }

    // Panneau de détail ouvert (projet, serveur, conteneur) : son contenu et la place de ses boutons
    const contenuOuvert = detail ? contenuDetail(detail, donnees, getProjets()) : undefined;
    const boutonsD = contenuOuvert ? placerBoutons(contenuOuvert.boutons, m.lateral + 1) : [];

    function cibleSurvol(x: number, y: number): string | undefined {
        if (y === 0) {
            const b = boutonA(boutonsHaut, x);
            return b ? `haut:${b.action}` : undefined;
        }
        const by = y - HAUT;
        if (by < 0 || by >= m.corps) return undefined;
        if (!pleinEcran && x < m.lateral - 1) {
            if (by === 0) {
                const o = ongletsPositions().find((t) => x >= t.x - 1 && x <= t.x + t.largeur);
                return o ? `onglet:${o.cle}` : undefined;
            }
            if (espace !== 'sessions') {
                const lignes = lignesEspace(espace, donnees, getProjets());
                const debutListe = Math.max(0, Math.min(decalage, lignes.length - (m.corps - 1)));
                const l = lignes[debutListe + by - 1];
                return l && !l.titre ? l.cle : undefined;
            }
            const ml = miseLateraleDe(m.corps, donnees);
            if (by >= 1 && by < ml.ligneNouvelle && (by - 1) % CARTE < CARTE - 1) {
                const cartes = cartesLaterales(donnees);
                const debut = Math.max(0, Math.min(decalage, cartes.length - ml.nbCartes));
                const c2 = cartes[debut + Math.floor((by - 1) / CARTE)];
                return c2?.type === 'session' ? `carte:${c2.s.cle}` : undefined;
            }
            return undefined;
        }
        if (demande) return undefined;
        const ac = actionColonne(x - m.lateral, by);
        if (ac) return `session:${ac.action}`;
        if (session && by >= 1 && by <= nbRangees(boutonsS)) {
            const b = boutonRangee(boutonsS, x, by - 1);
            return b ? `session:${b.action}` : undefined;
        }
        if (by === 1 && contenuOuvert) {
            const b = boutonA(boutonsD, x);
            return b ? `detail:${b.action}` : undefined;
        }
        return undefined;
    }

    // Le gestionnaire souris est installé une fois : il lit toujours l'état et les fonctions du dernier rendu
    const courant = { m, demande, occupe, session, suggestions, nbSugg, sugg, boutonsHaut, boutonsS, decalage, donnees, tache, lancer, ouvrirCarte, remplacer, setSelection, redimensionner, menuPour, ouvrirMenu, setModeMaitre, setVueActive, glisserVers, cibleDefilement, animDefilement, defilementActuel, espace, setEspace, ouvrirDetail, contenuOuvert, boutonsD, setSurvol, survol, cibleSurvol, pleinEcran, journalOuvert, actionColonne };
    const etatRef = useRef(courant);
    etatRef.current = courant;

    useEffect(() => {
        const surSouris = (evenement: Souris) => {
            let e = evenement;
            const { m, demande, occupe, session, suggestions, nbSugg, sugg, boutonsHaut, boutonsS, decalage, donnees, espace, setEspace, ouvrirDetail, contenuOuvert, boutonsD,
                lancer, ouvrirCarte, remplacer, setSelection, redimensionner, menuPour, ouvrirMenu, setModeMaitre, setVueActive } = etatRef.current;
            const libre = !demande && !occupe;
            const by = e.y - HAUT;
            const molette = (e.bouton === 'molette-haut' ? 1 : e.bouton === 'molette-bas' ? -1 : 0) * (e.crans ?? 1);

            // Colonne des sessions à droite : on ramène les positions du corps à « colonne à gauche, zone principale
            // à droite », la disposition pour laquelle tout le reste est écrit
            const divise = !etatRef.current.pleinEcran && m.lateral > 0;
            const xBrut = e.x;
            if (divise && lateraleADroite() && by >= 0 && by < m.corps) e = { ...e, x: e.x >= m.principal ? Math.max(0, e.x - m.principal - 1) : e.x + m.lateral };   // -1 : la ligne verticale est à gauche de la colonne

            // Survol : seulement quand ce qui est sous la souris change
            if (e.survol) {
                const id = etatRef.current.cibleSurvol(e.x, e.y);
                if (id !== etatRef.current.survol) etatRef.current.setSurvol(id);
                return;
            }
            // Glisser la ligne verticale entre la colonne des sessions et la zone principale
            const largeurVoulue = lateraleADroite() ? m.largeur - xBrut : xBrut + 1;
            if (e.glisse) {
                if (glisser.current) redimensionner(largeurVoulue, false);
                return;
            }
            if (glisser.current && !e.appui) {
                glisser.current = false;
                redimensionner(largeurVoulue, true);
                return;
            }
            const ligneVerticale = lateraleADroite() ? m.principal : m.lateral - 1;
            if (divise && e.appui && e.bouton === 'gauche' && by >= 0 && by < m.corps && Math.abs(xBrut - ligneVerticale) <= 1) {
                glisser.current = true;
                return;
            }

            // Un menu (ou le moniteur) est ouvert et on clique ailleurs (barre du haut, colonne de gauche) :
            // on le ferme, puis on rejoue le clic une fois la commande annulée
            const lateral = etatRef.current.pleinEcran ? 0 : m.lateral;   // plein écran : pas de colonne de gauche
            const ailleurs = e.y === 0 || (by >= 0 && by < m.corps && e.x < lateral);
            if (demande && e.appui && ((e.bouton === 'gauche' && ailleurs) || e.bouton === 'droit')) {
                if (demande.type === 'vue') demande.resoudre();
                else demande.resoudre(undefined);
                setTimeout(() => souris.emit('souris', evenement), 150);
                return;
            }

            // Clic droit : les actions de ce qui est sous la souris
            if (e.appui && e.bouton === 'droit') {
                if (!occupe) void ouvrirMenu(menuPour(e.x, by));
                return;
            }

            if (e.y === 0 && e.appui && e.bouton === 'gauche') {
                const b = boutonA(boutonsHaut, e.x);
                if (b && libre) {
                    appuyer(`haut:${b.action}`);
                    setVueActive(b.action);
                    lancer(b.action, false, true);
                }
                return;
            }
            if (by < 0 || by >= m.corps) return;

            if (e.x < lateral) {
                if (!e.appui && !molette) return;
                // Ligne 0 : les onglets des espaces ; tout à droite, les sessions qui attendent (« ? N »)
                if (by === 0) {
                    if (!e.appui || e.bouton !== 'gauche') return;
                    const o = ongletsPositions().find((x) => e.x >= x.x - 1 && e.x <= x.x + x.largeur);
                    if (o) return setEspace(o.cle);
                    if (e.x >= m.lateral - 6 && libre) return void lancer('/questions', false, true);
                    return;
                }
                if (espace !== 'sessions') {
                    const lignes = lignesEspace(espace, donnees, getProjets());
                    const debutListe = Math.max(0, Math.min(decalage, lignes.length - (m.corps - 1)));
                    if (molette) return setDecalage(Math.max(0, Math.min(debutListe - molette * 2, lignes.length - (m.corps - 1))));
                    if (e.bouton !== 'gauche') return;
                    const l = lignes[debutListe + by - 1];
                    if (l?.detail) return ouvrirDetail(l.detail);
                    if (l?.commande && libre) return void lancer(l.commande, false, true);
                    return;
                }
                const ml = miseLateraleDe(m.corps, donnees);
                if (molette) {
                    setDecalage((d) => Math.max(0, Math.min(d - molette, cartesLaterales(donnees).length - ml.nbCartes)));
                    return;
                }
                if (e.bouton !== 'gauche') return;
                const debut = Math.max(0, Math.min(decalage, cartesLaterales(donnees).length - ml.nbCartes));
                if (by >= 1 && by < ml.ligneNouvelle) return ouvrirCarte(debut + Math.floor((by - 1) / CARTE));
                if (by === ml.ligneNouvelle && libre) return void lancer(e.x >= X_TERMINAL - 1 ? '/terminal' : '/nouvelle', false, true);
                if (ml.hauteurMaitre >= 2 && by >= ml.ligneMaitre && by < ml.ligneMaitre + ml.hauteurMaitre) {
                    const claude = lireEtatClaude().etat;
                    if (claude === 'absent' && libre) return void lancer('/installer-claude', false, true);
                    if (claude === 'deconnecte' && libre) return void lancer('/connexion-claude', false, true);
                    return setModeMaitre((v) => !v);
                }
                // En-tête Docker ou Serveurs SSH : replier / déplier
                if (ml.afficheDocker && by === ml.ligneDocker) return void basculerRepli('docker').then(() => setTaille((t) => ({ ...t })));
                if (ml.afficheServeurs && by === ml.ligneServeurs) return void basculerRepli('ssh').then(() => setTaille((t) => ({ ...t })));
                const iServeur = by - ml.ligneServeurs - 1;
                if (ml.afficheServeurs && iServeur >= 0 && iServeur < ml.nbServeurs) return ouvrirDetail({ type: 'serveur', cle: serveursLateraux(donnees)[iServeur].nom });
                // Lignes Docker : ouvre la vue Docker
                if (ml.nbDocker && by > ml.ligneDocker && by <= ml.ligneDocker + ml.nbDocker && libre) return void lancer('/docker', false, true);
                return;
            }

            if (demande?.type === 'vue') {
                if (molette) bus.emit('molette-vue', molette);
                else if (e.appui && e.bouton === 'gauche') bus.emit('clic-vue', { x: e.x - lateral, y: by });
                return;
            }
            if (molette) {
                // Pendant un glissement, on part de la cible (les crans s'additionnent), sinon de la position actuelle
                const depart = etatRef.current.animDefilement.current ? etatRef.current.cibleDefilement.current : etatRef.current.defilementActuel.current;
                etatRef.current.glisserVers(depart + molette * 3);
                return;
            }
            if (!e.appui || e.bouton !== 'gauche') return;
            if (demande?.type === 'choix') return void bus.emit('clic-selecteur', by);
            if (nbSugg && by >= m.corps - nbSugg) {
                const s = suggestions[Math.max(0, Math.min(sugg - 3, suggestions.length - 8)) + by - (m.corps - nbSugg)];
                if (s) {
                    setSaisie('');
                    if (s.executer) lancer(s.texte);
                    else remplacer(s.texte);
                }
                return;
            }
            if (!session && contenuOuvert && by === 1) {
                const b = boutonA(boutonsD, e.x);
                if (!b) return;
                appuyer(`detail:${b.action}`);
                if (b.action === 'retour') return ouvrirDetail(undefined);
                if (libre) lancer(b.action, false, true);
                return;
            }
            if (!session && !contenuOuvert && !demande && !etatRef.current.journalOuvert) {
                const cible = sessionAuClic(e.x - lateral, by);
                if (cible === JOURNAL) {
                    setDefilement(0);
                    return setJournalOuvert(true);
                }
                if (cible) return void bus.emit('selectionner', cible);
            }
            const ac = session ? etatRef.current.actionColonne(e.x - lateral, by) : undefined;
            const surBouton = session && by >= 1 && by <= nbRangees(boutonsS);
            if (session && (ac || surBouton)) {
                const b = ac ?? boutonRangee(boutonsS, e.x, by - 1);
                if (!b) return;
                if (b.action === 'fermer') {
                    appuyer('session:fermer');
                    return setSelection(undefined);
                }
                const cmd = commandeSession(b.action, session);
                if (cmd && libre) {
                    appuyer(`session:${b.action}`);
                    lancer(cmd, false, true);
                }
            }
        };
        souris.on('souris', surSouris);
        return () => {
            souris.off('souris', surSouris);
        };
    }, []);

    // ─── Clavier ─────────────────────────────────────────────────────────────
    useInput((input, key) => {
        if (quelleTouche !== undefined) {
            if (key.escape) return setQuelleTouche(undefined);
            if (key.backspace || key.delete) return setQuelleTouche(quelleTouche ? quelleTouche.slice(0, -1) : undefined);
            const enfant = noeudA(quelleTouche).enfants[input];
            if (!enfant) return;
            if (estGroupe(enfant)) return setQuelleTouche(quelleTouche + input);
            setQuelleTouche(undefined);
            if (enfant.commande.startsWith('espace:')) return setEspace(enfant.commande.slice(7) as Espace);
            if (enfant.commande === 'maitre') return setModeMaitre(true);
            return void lancer(enfant.commande, false, true);
        }
        if (input === ' ' && !saisie.trim() && !demande && !occupe && !recherche && !modeMaitre && !modeShell) {
            remplacer('');
            return setQuelleTouche('');
        }
        if (key.ctrl && input === 'c') {
            if (saisie) return setSaisie('');
            if (Date.now() - ctrlC < 1500) return quitter();
            return setCtrlC(Date.now());
        }
        if (demande || occupe) return;
        // Alt+V : image du presse-papiers
        if (key.meta && input === 'v') {
            const chemin = imageDuPressePapiers();
            if (!chemin) {
                console.log(c.alerte('Pas d\'image dans le presse-papiers'));
                return remplacer(saisie);
            }
            const n = images.length + 1;
            setImages([...images, chemin]);
            return remplacer(`${saisie}${saisie && !saisie.endsWith(' ') ? ' ' : ''}[image ${n}] `);
        }
        // Ctrl+F : chercher dans la conversation ouverte
        if (key.ctrl && input === 'f' && session) {
            setRecherche(true);
            return setSaisie('');
        }
        // Ctrl+K : la palette (chercher et lancer n'importe quoi)
        if (key.ctrl && input === 'k') return void lancer('/palette', false, true);
        // Alt+T : ouvrir un terminal (PowerShell, cmd, Git Bash…)
        if (key.meta && input === 't') return void lancer('/terminal', false, true);
        // Alt+S / P / R / D : espaces Sessions, Projets, seRveurs SSH, Docker
        if (key.meta && ['s', 'p'].includes(input)) return setEspace(input === 's' ? 'sessions' : 'projets');
        // Alt+M : parler au maître (ou revenir)
        if (key.meta && input === 'm') return setModeMaitre((v) => !v);
        // Alt+1..9 : ouvrir la carte N
        if (key.meta && /^[1-9]$/.test(input)) return ouvrirCarte(decalage + Number(input) - 1);
        // « ? » sur une ligne vide : l'aide (on retire le « ? » que la saisie vient d'insérer)
        if (input === '?' && !saisie) {
            remplacer('');
            return void lancer('/aide', false, true);
        }
        if (key.meta && (key.leftArrow || key.rightArrow)) return redimensionner(m.lateral + (key.rightArrow ? 2 : -2), true);
        if (key.meta && (key.upArrow || key.downArrow) && donnees.agents.length) {
            const i = donnees.agents.findIndex((a) => a.cle === selection);
            const j = i < 0 ? 0 : (i + (key.downArrow ? 1 : -1) + donnees.agents.length) % donnees.agents.length;
            return setSelection(donnees.agents[j].cle);
        }
        if (key.pageUp) return setDefilement((d) => d + Math.max(5, m.corps - 4));
        if (key.pageDown) return setDefilement((d) => Math.max(0, d - Math.max(5, m.corps - 4)));
        if (key.tab && suggestions[sugg]) return remplacer(suggestions[sugg].texte);
        if (key.escape && recherche) {
            setRecherche(false);
            return setSaisie('');
        }
        if (key.escape) {
            if (saisie) return setSaisie('');
            if (images.length) return setImages([]);
            if (modeMaitre) return setModeMaitre(false);
            if (journalOuvert && !detail && !selection) return setJournalOuvert(false);
            if (detail) return ouvrirDetail(undefined);
            if (selection) return setSelection(undefined);
            return;
        }
        if (suggestions.length) {
            if (key.upArrow) setIndexSugg((sugg - 1 + suggestions.length) % suggestions.length);
            if (key.downArrow) setIndexSugg((sugg + 1) % suggestions.length);
            return;
        }
        if (key.upArrow && historique.length) {
            const pos = Math.min(historique.length - 1, posHistorique + 1);
            setPosHistorique(pos);
            remplacer(historique[pos]);
        }
        if (key.downArrow) {
            const pos = posHistorique - 1;
            setPosHistorique(Math.max(-1, pos));
            remplacer(pos >= 0 ? historique[pos] : '');
        }
    });

    // ─── Rendu ───────────────────────────────────────────────────────────────
    const groupeQT = quelleTouche !== undefined ? noeudA(quelleTouche) : undefined;
    const entreesQT = groupeQT ? Object.entries(groupeQT.enfants) : [];
    const colonnesQT = Math.max(1, Math.floor((m.principal - 4) / 30));
    const hauteurQT = groupeQT ? Math.ceil(entreesQT.length / colonnesQT) + 2 : 0;
    const hauteurPrincipale = m.corps - nbSugg - hauteurQT;
    const debutSugg = Math.max(0, Math.min(sugg - 3, suggestions.length - 8));
    const modeShell = saisie.startsWith('!');
    const ram = os.totalmem() - os.freemem();
    const nomCwd = path.basename(statut.cwd);
    const ssh = donnees.connexions.length;

    let principal;
    if (demande?.type === 'choix') {
        principal = <Selecteur key={demande.message} message={demande.message} choix={demande.choix} recherche={demande.recherche} multiple={demande.multiple} onFin={demande.resoudre} />;
    } else if (demande?.type === 'saisie') {
        principal = <Saisie message={demande.message} defaut={demande.defaut} masque={demande.masque} onFin={demande.resoudre} />;
    } else if (demande?.type === 'vue') {
        principal = demande.rendu(demande.resoudre);
    } else if (session) {
        principal = <VueSession s={session} messages={messages} boutons={boutonsS} largeur={m.principal} hauteur={hauteurPrincipale} defilement={defilement} git={gitSession} surligne={recherche ? saisie.trim() : undefined} cout={donnees.cout.parSession[session.sessionId]} survol={survol}
            colonne={posActions === 'gauche' || posActions === 'droite' ? { cote: posActions, liste: actionsS } : undefined} ecart={2} />;
    } else {
        principal = contenuOuvert
            ? <VueDetail contenu={contenuOuvert} boutons={boutonsD.map((b) => ({ ...b, x: b.x - m.lateral }))} largeur={m.principal} hauteur={hauteurPrincipale} survol={survol} />
            : journalOuvert
                ? (
                    <Box flexDirection="column">
                        <Box height={1} flexShrink={0} paddingLeft={1}>
                            <Text bold color={theme.accent}>{'▤ JOURNAL '}<Text color={fond.discret}>Échap pour revenir au cockpit · molette pour défiler · /clear pour vider</Text></Text>
                        </Box>
                        <VueJournal lignes={lignesJournal()} largeur={m.principal} hauteur={hauteurPrincipale - 1} defilement={defilement} />
                    </Box>
                )
                : <Cockpit d={donnees} largeur={m.principal} hauteur={hauteurPrincipale} />;
    }
    const surCockpit = !demande && !session && !contenuOuvert && !journalOuvert;
    if (surCockpit && attenteVue.current && Date.now() - attenteVue.current < 1500 && dernierPrincipal.current) principal = dernierPrincipal.current;
    else dernierPrincipal.current = principal;

    // Colonne des sessions : à gauche (par défaut), à droite ou cachée (/ecran)
    const aDroite = lateraleADroite();
    const laterale = (
        <Laterale donnees={donnees} largeur={m.lateral} hauteur={m.corps} selection={selection} decalage={decalage} tic={tic} maitre={etatMaitre()} modeMaitre={modeMaitre} claude={lireEtatClaude().etat}
            espace={espace} survol={survol} ouvert={detail ? `${detail.type}:${detail.cle}` : undefined} projets={getProjets()} cote={aDroite ? 'droite' : 'gauche'} />
    );
    return (
        <Box flexDirection="column" width={m.largeur} height={m.hauteur} overflow="hidden">
            <BarreHaut boutons={boutonsHaut} largeur={m.largeur} vueActive={demande?.type === 'vue' ? vueActive : undefined} survol={survol}
                droite={`${config.prenom || os.userInfo().username} · ${heure.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`} />
            <Box height={1} flexShrink={0}><Text>{ligneDegrade(m.largeur)}</Text></Box>
            <Box height={m.corps} flexShrink={0} overflow="hidden">
                {!pleinEcran && m.lateral > 0 && !aDroite && laterale}
                <Box flexDirection="column" width={pleinEcran ? m.largeur : m.principal} height={m.corps}>
                    <Box height={hauteurPrincipale} flexDirection="column" overflow="hidden">{principal}</Box>
                    {groupeQT && (
                        <Box flexDirection="column" height={hauteurQT} flexShrink={0} borderStyle="round" borderColor={theme.accent} paddingX={1} borderBottom={false} borderLeft={false} borderRight={false}>
                            <Box height={1}><Text color={theme.accent} bold>{`␣ ${quelleTouche ? quelleTouche.split('').join(' ') + ' · ' : ''}${groupeQT.nom}`}</Text><Text color={fond.discret}>{'   lettre = choisir · ⌫ remonter · Échap fermer'}</Text></Box>
                            {Array.from({ length: hauteurQT - 2 }, (_, ligne) => (
                                <Box key={ligne} height={1}>
                                    {entreesQT.slice(ligne * colonnesQT, ligne * colonnesQT + colonnesQT).map(([t, n]) => (
                                        <Box key={t} width={30} flexShrink={0}>
                                            <Text wrap="truncate-end"><Text color={theme.accent} bold>{` ${t} `}</Text><Text color={estGroupe(n) ? theme.secondaire : fond.texte}>{` ${n.nom}${estGroupe(n) ? ' ›' : ''}`}</Text></Text>
                                        </Box>
                                    ))}
                                </Box>
                            ))}
                        </Box>
                    )}
                    {nbSugg > 0 && (
                        <Box flexDirection="column" height={nbSugg} paddingX={1}>
                            {suggestions.slice(debutSugg, debutSugg + 8).map((s, i) => {
                                const actif = debutSugg + i === sugg;
                                return (
                                    <Text key={s.label} wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                                        <Text color={actif ? theme.accent : theme.secondaire} bold={actif}>{s.label.padEnd(30) + ' '}</Text>
                                        <Text color="gray">{s.description}</Text>
                                    </Text>
                                );
                            })}
                        </Box>
                    )}
                </Box>
                {!pleinEcran && m.lateral > 0 && aDroite && laterale}
            </Box>
            <Box height={1} flexShrink={0} paddingX={2} width={m.largeur} overflow="hidden">
                {notice
                    ? <Text color={notice.startsWith('✕') ? '#f87171' : notice.startsWith('!') ? '#fb923c' : '#4ade80'} wrap="truncate-end">{notice}</Text>
                    : !demande && !occupe && <Text color={destination().couleur} wrap="truncate-end">{destination().texte}</Text>}
            </Box>
            <Box borderStyle="round" borderColor={modeShell ? theme.accent : modeMaitre ? '#a78bfa' : recherche ? theme.secondaire : fond.bordure} paddingX={1}
                width={m.largeur} height={3} flexShrink={0} overflow="hidden">
                {demande || occupe
                    ? <Text color="gray">{occupe && !demande ? 'commande en cours…' : 'réponds dans la zone ci-dessus'}</Text>
                    : (
                        <>
                            {!modeShell && <Text color={theme.primaire}>❯ </Text>}
                            <TextInput
                                key={cleSaisie}
                                focus={quelleTouche === undefined}
                                value={saisie}
                                onChange={surSaisie}
                                onSubmit={soumettre}
                                placeholder={session?.arrierePlan
                                    ? `Entrée pour rejoindre ${session.nom} · Échap pour fermer`
                                    : 'Tape / pour les commandes, une question pour Claude, ou Entrée pour le menu'}
                            />
                        </>
                    )}
            </Box>
            <Box justifyContent="space-between" paddingX={1} width={m.largeur} height={1} flexShrink={0} overflow="hidden">
                <Box flexShrink={1} overflow="hidden">
                    {tache
                        ? <Text wrap="truncate-end"><Text color={theme.accent}>{SPINNER[tic % SPINNER.length]} </Text>{tache}…</Text>
                        : ctrlC && Date.now() - ctrlC < 1500
                            ? <Text color="gray">Ctrl+C encore pour quitter</Text>
                            : (
                                <Text wrap="truncate-end">
                                    <Text color={couleurProjet(nomCwd)}>● </Text>
                                    <Text bold>{nomCwd}</Text>
                                    {statut.git && <Text color={theme.secondaire}> ⎇ {statut.git.branche}</Text>}
                                    {statut.git && (statut.git.modifs ? <Text color="#facc15"> ✎{statut.git.modifs}</Text> : <Text color="#4ade80"> ✓</Text>)}
                                    {images.length ? <Text color={theme.accent}>{`  ⊕ ${images.length} image${images.length > 1 ? 's' : ''} (Échap pour retirer)`}</Text> : null}
                                </Text>
                            )}
                </Box>
                <Box flexShrink={0}>
                    <Text color="gray">
                        {ssh ? <Text color={theme.accent}>⇄ {ssh} SSH · </Text> : null}
                        {donnees.cout.total > 0 ? (
                            <Text color={(config.budgetJour ?? 0) > 0 && donnees.cout.total >= (config.budgetJour ?? 0) ? '#fb923c' : 'gray'}>
                                {`≈ ${dollars(donnees.cout.total)} auj.${config.budgetJour ? ` / ${dollars(config.budgetJour)}` : ''} · `}
                            </Text>
                        ) : null}
                        {`CPU ${statut.cpu.toFixed(0)}% · RAM ${Math.round((ram / os.totalmem()) * 100)}%   `}
                        {/* Les 3-4 raccourcis utiles là, maintenant (le reste : ? et Ctrl+K) */}
                        {raccourcis().map(([touche, quoi], i) => (
                            <Text key={i}><Text color={theme.secondaire}>{touche}</Text><Text color={fond.discret}>{` ${quoi}${i < raccourcis().length - 1 ? '  ' : ''}`}</Text></Text>
                        ))}
                    </Text>
                </Box>
            </Box>
        </Box>
    );
}

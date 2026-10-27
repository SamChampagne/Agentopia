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
import { depotDe } from '../synchro.js';
import { etatClaude, lireEtatClaude, verifierClaude } from '../etatClaude.js';
import { maitre, etatMaitre, prechauffer, demanderAuMaitre, DESTRUCTRICES } from '../maitre.js';
import { Selecteur, Saisie } from './Selecteur.js';
import { Laterale, cartesLaterales, X_TERMINAL } from './Laterale.js';
import { VueJournal, VueSession, BarreHaut, largeurTitre } from './Zones.js';
import { useDonnees, demarrerCollecte, rafraichirAgents } from './donnees.js';
import { serveursLateraux, miseLateraleDe, basculerRepli } from './sections.js';
import { souris, Souris } from './terminal.js';
import { quitterEcran } from './ecran.js';
import { journal, lignesJournal, avecRetrait, vider } from './journal.js';
import { imageDuPressePapiers, joindreImages } from './pressePapiers.js';
import { calculerMise, miseLaterale, placerBoutons, boutonA, choisirLargeurLaterale, HAUT, CARTE, LATERAL_MIN } from './mise.js';
import { COMMANDES, config, executerLigne, getProjets, rafraichirProjets, trouverCommande } from '../commandes.js';
import { chargerHistorique, ajouterHistorique, sauverConfig } from '../config.js';
import { etatGitAsync, correspond, EtatGit } from '../projets.js';
import { cpuMachine, formatRam } from '../systeme.js';
import { projetsRecents } from '../dashboard.js';
import { Message, SessionVue, lireTranscript } from '../agents.js';
import { theme, couleurProjet, c } from '../theme.js';

const SPINNER = ['✻', '✼', '✽', '✾', '✿', '❀', '✿', '✾', '✽', '✼'];

export const BOUTONS_HAUT = [
    { label: '☰ Menu', action: '' },
    { label: 'Projets', action: '/projets' },
    { label: 'Équipes', action: '/equipe' },
    { label: 'Moniteur', action: '/top' },
    { label: 'Git', action: '/git' },
    { label: 'Docker', action: '/docker' },
    { label: 'SSH', action: '/ssh' },
    { label: 'Journal', action: '/journal' },
    { label: 'Récents', action: '/recents' },
    { label: 'Config', action: '/config' },
    { label: 'Aide', action: '/aide' },
];

// Boutons de la conversation ouverte. Revue et Commit agissent sur le projet de la session.
function boutonsSession(s: SessionVue) {
    const projet = [{ label: '⌕ Revue', action: 'revue' }, { label: '✓ Commit', action: 'commit' }, { label: '◧ VS Code', action: 'code' }];
    return s.arrierePlan
        ? [{ label: '← Retour', action: 'fermer' }, { label: '↵ Rejoindre', action: 'rejoindre' }, { label: '★ Favori', action: 'favori' }, ...projet, { label: '✕ Fermer la session', action: 'fermer-session' }]
        : [{ label: '← Retour', action: 'fermer' }, { label: '⑂ Continuer ici', action: 'copie' }, ...projet, { label: '✕ Fermer la session', action: 'fermer-session' }];
}

function commandeSession(action: string, s: SessionVue): string | undefined {
    if (action === 'rejoindre') return `/rejoindre ${s.id}`;
    if (action === 'fermer-session') return `/fermer ${s.id ?? s.pid}`;
    if (action === 'copie') return `/copie ${s.sessionId}`;
    if (action === 'code') return `/code ${s.cwd}`;
    if (action === 'favori') return `/favori-session ${s.sessionId}`;
    if (action === 'revue') return `/revue ${s.cwd}`;
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
    // Bouton du haut de la vue ouverte (reste allumé tant qu'elle est ouverte)
    const [vueActive, setVueActive] = useState<string>();
    const [, setVersionMaitre] = useState(0);
    const [messages, setMessages] = useState<Message[]>([]);
    const [defilement, setDefilement] = useState(0);
    const [decalage, setDecalage] = useState(0);
    const [tic, setTic] = useState(0);
    const [images, setImages] = useState<string[]>([]);
    const [heure, setHeure] = useState(new Date());
    const [notice, setNotice] = useState<string>();          // message bref au-dessus de la saisie (envoi réussi…)
    const [aSelectionner, setASelectionner] = useState<string>();   // id d'une session qui vient d'être lancée

    const setSelection = (cle?: string) => {
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
        const surDemande = (d?: Demande) => setDemande(d);
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
        // Animation (✻ qui tourne) : on ne redessine que si quelque chose bouge vraiment
        const idTic = setInterval(() => {
            if (etatRef.current.tache || etatRef.current.donnees.agents.some((a) => a.statut === 'travaille')
                || etatRef.current.donnees.equipes.some((e) => ['planification', 'en cours', 'integration'].includes(e.etat))
                || etatMaitre().enCours) setTic((t) => t + 1);
        }, 800);
        const idHeure = setInterval(() => setHeure(new Date()), 30_000);
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
            clearInterval(idTic);
            clearInterval(idHeure);
            clearTimeout(idMaitre);
            maitre.off('maj', surMaitre);
            etatClaude.off('maj', surClaude);
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

    const suggestions = useMemo(() => calculerSuggestions(saisie), [saisie]);
    const sugg = Math.min(indexSugg, Math.max(0, suggestions.length - 1));
    const nbSugg = Math.min(8, suggestions.length);

    const boutonsHaut = placerBoutons(BOUTONS_HAUT, largeurTitre());
    const boutonsS = session ? placerBoutons(boutonsSession(session), m.lateral) : [];

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
        if (cmd?.nom === 'clear') return vider();
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
            setOccupe(false);
            if (puisQuitter) setTimeout(quitter, 300);
        }
    }

    function remplacer(texte: string) {
        setSaisie(texte);
        setCleSaisie((k) => k + 1);
        setIndexSugg(0);
    }

    function soumettre(valeur: string) {
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
        return { texte: `↳ démarre une nouvelle session Claude dans ${path.basename(statut.cwd)} (en arrière-plan) · /ask pour une question rapide`, couleur: theme.primaire };
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
        { label: '+ Nouvelle session Claude', valeur: '/nouvelle' },
        { label: '◆ Nouvelle équipe d\'agents', valeur: '/equipe nouvelle' },
        ...ici(statut.cwd),
        ...sectionsArticles(),
    ];

    function menuSession(s: SessionVue): { titre: string; articles: Article[] } {
        return {
            titre: `● ${s.nom} · ${s.titre || (s.arrierePlan ? s.id : 'onglet')}`,
            articles: [
                { label: '↵ Ouvrir la conversation', valeur: () => setSelection(s.cle) },
                ...(s.arrierePlan
                    ? [{ label: '⤢ Rejoindre (plein écran)', valeur: `/rejoindre ${s.id}` }, { label: '★ Mettre en favori', valeur: `/favori-session ${s.sessionId}` }]
                    : [{ label: '⑂ Continuer ici', valeur: `/copie ${s.sessionId}` }]),
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

    // Le gestionnaire souris est installé une fois : il lit toujours l'état et les fonctions du dernier rendu
    const courant = { m, demande, occupe, session, suggestions, nbSugg, sugg, boutonsHaut, boutonsS, decalage, donnees, tache, lancer, ouvrirCarte, remplacer, setSelection, redimensionner, menuPour, ouvrirMenu, setModeMaitre, setVueActive };
    const etatRef = useRef(courant);
    etatRef.current = courant;

    useEffect(() => {
        const surSouris = (e: Souris) => {
            const { m, demande, occupe, session, suggestions, nbSugg, sugg, boutonsHaut, boutonsS, decalage, donnees,
                lancer, ouvrirCarte, remplacer, setSelection, redimensionner, menuPour, ouvrirMenu, setModeMaitre, setVueActive } = etatRef.current;
            const libre = !demande && !occupe;
            const by = e.y - HAUT;
            const molette = (e.bouton === 'molette-haut' ? 1 : e.bouton === 'molette-bas' ? -1 : 0) * (e.crans ?? 1);

            // Glisser la ligne verticale entre la colonne de gauche et la zone principale
            if (e.glisse) {
                if (glisser.current) redimensionner(e.x + 1, false);
                return;
            }
            if (glisser.current && !e.appui) {
                glisser.current = false;
                redimensionner(e.x + 1, true);
                return;
            }
            if (e.appui && e.bouton === 'gauche' && by >= 0 && by < m.corps && Math.abs(e.x - (m.lateral - 1)) <= 1) {
                glisser.current = true;
                return;
            }

            // Un menu (ou le moniteur) est ouvert et on clique ailleurs (barre du haut, colonne de gauche) :
            // on le ferme, puis on rejoue le clic une fois la commande annulée
            const ailleurs = e.y === 0 || (by >= 0 && by < m.corps && e.x < m.lateral);
            if (demande && e.appui && ((e.bouton === 'gauche' && ailleurs) || e.bouton === 'droit')) {
                if (demande.type === 'vue') demande.resoudre();
                else demande.resoudre(undefined);
                setTimeout(() => souris.emit('souris', e), 150);
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

            if (e.x < m.lateral) {
                const ml = miseLateraleDe(m.corps, donnees);
                if (molette) {
                    setDecalage((d) => Math.max(0, Math.min(d - molette, cartesLaterales(donnees).length - ml.nbCartes)));
                    return;
                }
                if (!e.appui || e.bouton !== 'gauche') return;
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
                if (iServeur >= 0 && iServeur < ml.nbServeurs && libre) {
                    return void lancer(`/ssh vue ${serveursLateraux(donnees)[iServeur].nom}`, false, true);
                }
                // Section Docker (titre ou lignes) : ouvre la vue Docker
                if (ml.nbDocker && by > ml.ligneDocker && by <= ml.ligneDocker + ml.nbDocker && libre) return void lancer('/docker', false, true);
                return;
            }

            if (demande?.type === 'vue') {
                if (molette) bus.emit('molette-vue', molette);
                else if (e.appui && e.bouton === 'gauche') bus.emit('clic-vue', { x: e.x - m.lateral, y: by });
                return;
            }
            if (molette) {
                setDefilement((d) => Math.max(0, d + molette * 3));
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
            if (session && by === 1) {
                const b = boutonA(boutonsS, e.x);
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
        // Alt+T : ouvrir un terminal (PowerShell, cmd, Git Bash…)
        if (key.meta && input === 't') return void lancer('/terminal', false, true);
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
        if (key.escape) {
            if (saisie) return setSaisie('');
            if (images.length) return setImages([]);
            if (modeMaitre) return setModeMaitre(false);
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
    const hauteurPrincipale = m.corps - nbSugg;
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
        principal = <VueSession s={session} messages={messages} boutons={boutonsS} largeur={m.principal} hauteur={hauteurPrincipale} defilement={defilement} git={gitSession} />;
    } else {
        principal = <VueJournal lignes={lignesJournal()} largeur={m.principal} hauteur={hauteurPrincipale} defilement={defilement} />;
    }

    return (
        <Box flexDirection="column" width={m.largeur} height={m.hauteur} overflow="hidden">
            <BarreHaut boutons={boutonsHaut} largeur={m.largeur} vueActive={demande?.type === 'vue' ? vueActive : undefined}
                droite={`${config.prenom || os.userInfo().username} · ${heure.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`} />
            <Box height={1} flexShrink={0}><Text color="#334155">{'─'.repeat(m.largeur)}</Text></Box>
            <Box height={m.corps} flexShrink={0} overflow="hidden">
                <Laterale donnees={donnees} largeur={m.lateral} hauteur={m.corps} selection={selection} decalage={decalage} tic={tic} maitre={etatMaitre()} modeMaitre={modeMaitre} claude={lireEtatClaude().etat} />
                <Box flexDirection="column" width={m.principal} height={m.corps}>
                    <Box height={hauteurPrincipale} flexDirection="column" overflow="hidden">{principal}</Box>
                    {nbSugg > 0 && (
                        <Box flexDirection="column" height={nbSugg} paddingX={1}>
                            {suggestions.slice(debutSugg, debutSugg + 8).map((s, i) => {
                                const actif = debutSugg + i === sugg;
                                return (
                                    <Text key={s.label} wrap="truncate-end" backgroundColor={actif ? '#1e293b' : undefined}>
                                        <Text color={actif ? theme.accent : theme.secondaire} bold={actif}>{s.label.padEnd(30) + ' '}</Text>
                                        <Text color="gray">{s.description}</Text>
                                    </Text>
                                );
                            })}
                        </Box>
                    )}
                </Box>
            </Box>
            <Box height={1} flexShrink={0} paddingX={2} width={m.largeur} overflow="hidden">
                {notice
                    ? <Text color={notice.startsWith('✕') ? '#f87171' : notice.startsWith('!') ? '#fb923c' : '#4ade80'} wrap="truncate-end">{notice}</Text>
                    : !demande && !occupe && <Text color={destination().couleur} wrap="truncate-end">{destination().texte}</Text>}
            </Box>
            <Box borderStyle="round" borderColor={modeShell ? theme.accent : session ? couleurProjet(session.nom) : 'gray'} paddingX={1}
                width={m.largeur} height={3} flexShrink={0} overflow="hidden">
                {demande || occupe
                    ? <Text color="gray">{occupe && !demande ? 'commande en cours…' : 'réponds dans la zone ci-dessus'}</Text>
                    : (
                        <>
                            {!modeShell && <Text color={theme.primaire}>❯ </Text>}
                            <TextInput
                                key={cleSaisie}
                                value={saisie}
                                onChange={(v) => { setSaisie(v); setIndexSugg(0); }}
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
                        {`CPU ${statut.cpu.toFixed(0)}% · RAM ${formatRam(ram)}/${formatRam(os.totalmem())} · Alt+V image`}
                    </Text>
                </Box>
            </Box>
        </Box>
    );
}

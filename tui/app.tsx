import { proposerPlan } from '../dist/conseiller.js';
import { indicationNouvelleSession, nomAgentSession } from '../dist/ui/identiteSession.js';
import { preparationAReprendre } from '../dist/preparation.js';
import { installerDiagnostics } from '../dist/diagnostics.js';
// Agentopia sous OpenTUI : même style que l'interface Ink, avec les mêmes données et les mêmes commandes.
// Lancer : bun tui/app.tsx   (Ctrl+C pour quitter)
import * as fs from 'fs';
import * as path from 'path';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createCliRenderer, TextRenderable } from '@opentui/core';
import { createRoot, extend, useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
import { Ansi } from './ansi.tsx';
import { GRAS } from './style.ts';
import { Colonne } from './colonne.tsx';
import { Conversation } from './conversation.tsx';
import { Choix, Saisie, VueNonMigree } from './dialogues.tsx';
import { VUES } from './vues/index.ts';
import { Detail } from './detail.tsx';
import { activerEntreeVT, restaurerConsole } from './console.ts';
import { Garde } from './garde.tsx';
import { disposition } from '../dist/ui/disposition.js';
import { Barre } from './barre.tsx';
import { useBrouillon } from './brouillons.ts';
import { destinationBrouillon } from '../dist/ui/brouillons.js';
import { HistoriqueSaisie } from '../dist/ui/historiqueSaisie.js';
import { retirerPiecesJointes, verifierPiecesJointes } from '../dist/ui/piecesJointes.js';
import { CollageImage, type LireImage } from '../dist/ui/collageImage.js';
import { historiqueAvis } from '../dist/ui/avis.js';
import { contexteSaisie } from '../dist/ui/contexteSaisie.js';
import { dossierContexte, hauteurComposeur } from '../dist/ui/contexteProjet.js';
import { Journal } from './journal.tsx';
import { QuelleTouche } from './quelleTouche.tsx';
import { Accueil, Mascotte } from './accueil.tsx';
import { Grille } from './grille.tsx';
import { Chauds } from './chauds.tsx';
import { Veille } from './veille.tsx';
import { Globe } from './globe.tsx';
import { Transition } from './transition.tsx';

type Zone = 'grille' | 'chauds' | 'globe';
import { Menu, general, menuSession, menuJournal } from './menus.ts';
import { demarrerCollecte, lireDonnees, surMajDonnees, rafraichirAgents } from '../dist/ui/donnees.js';
import { lignesCockpit, JOURNAL } from '../dist/ui/Cockpit.js';
import { bus, Annule, choisir, confirmer } from '../dist/ui/bus.js';
import { noeudA, estGroupe } from '../dist/ui/quelleTouche.js';
import { maitre, etatMaitre, prechauffer, demanderAuMaitre, DESTRUCTRICES } from '../dist/maitre.js';
import { etatClaude, lireEtatClaude, verifierClaude } from '../dist/etatClaude.js';
import { journal, lignesJournal, avecRetrait, vider, capturerConsole } from '../dist/ui/journal.js';
import { definirPassage } from '../dist/ui/ecran.js';
import { calculerSuggestions, commandeSession } from '../dist/ui/saisie.js';
import { executerLigne, trouverCommande, rafraichirProjets, getProjets, config, demarrerNotifications } from '../dist/commandes.js';
import { CHEMINS } from '../dist/chemins.js';
import { liens } from '../dist/notifications.js';
import { joindreImages, fichiersDeposes, EST_IMAGE } from '../dist/ui/pressePapiers.js';
import { chargerConfig, chargerHistorique, ajouterHistorique, sauverConfig, premierLancement, etatRecuperationConfig } from '../dist/config.js';
import { theme, fond, couleurProjet, degrade, c } from '../dist/theme.js';

// Texte non sélectionnable par défaut : un clic un peu glissé surlignait une partie du libellé cliqué.
// Ce qu'on veut pouvoir copier (conversation, journal, détail) le demande avec « selectable »
class Texte extends TextRenderable {
    constructor(ctx: any, options: any) {
        super(ctx, { ...options, selectable: options?.selectable ?? false });
    }
}
extend({ text: Texte } as any);

const BOUTONS = [
    { label: '◉ Live', action: '/global' }, { label: '▦ Projets', action: '/projets' }, { label: '◆ Équipes', action: '/equipe' },
    { label: '⎇ Git', action: '/git' }, { label: '◫ Docker', action: '/docker' }, { label: '⇄ SSH', action: '/ssh' },
    { label: '◈ Config', action: '/config' }, { label: '⋯', action: '/menu-principal' },
];
const SPINNER = ['✻', '✼', '✽', '✾', '✿', '❀', '✿', '✾', '✽', '✼'];
const historique: string[] = chargerHistorique();

function useVersion(abonner: (f: () => void) => () => void) {
    const [, setV] = useState(0);
    useEffect(() => abonner(() => setV((v) => v + 1)), []);
}
const surJournal = (f: () => void) => {
    journal.on('maj', f);
    return () => void journal.off('maj', f);
};
const surMaitre = (f: () => void) => {
    maitre.on('maj', f);
    etatClaude.on('maj', f);
    return () => {
        maitre.off('maj', f);
        etatClaude.off('maj', f);
    };
};
const droit = (e: any) => e?.button === 2;
// Disposition de l'écran (/ecran) : tout l'écran se redessine quand elle change
const surDisposition = (f: () => void) => {
    bus.on('disposition', f);
    return () => void bus.off('disposition', f);
};

const debutApp = Date.now();
// Tests : ni lecture ni écriture de l'état (lu à l'usage : les tests le règlent après les imports)
const sansReprise = () => !!process.env.CLAUDETOPIA_SANS_REPRISE;
const LATERAL_MIN = 28;

// commandeInitiale : « sp commit saniplan » (lancée puis on quitte) · auDemarrage : l'assistant au premier lancement
// accueil : l'écran d'accueil animé, quelques secondes au lancement
export function App({ quitter, commandeInitiale, auDemarrage, accueil = false, lireImage }: { quitter: () => void; commandeInitiale?: string; auDemarrage?: string; accueil?: boolean; lireImage?: LireImage }) {
    const [splash, setSplash] = useState(accueil);
    useEffect(() => {
        if (!splash) return;
        const t = setTimeout(() => setSplash(false), 3500);
        return () => clearTimeout(t);
    }, []);
    // Mode focus (Alt+Z) : seulement la zone principale et la barre de saisie
    const [focus, setFocus] = useState(false);
    // Vues de la zone principale propres à cette interface : grille de conversations (Alt+G), fichiers chauds (Alt+H)
    const [vueZone, setVueZone] = useState<Zone>();
    // Diff en direct sous la conversation (Alt+D pour le cacher)
    const [diffDirect, setDiffDirect] = useState(true);
    // Écran de veille : après quelques minutes sans clavier ni souris
    const [veille, setVeille] = useState(false);
    const derniereActivite = useRef(Date.now());
    const activite = () => {
        derniereActivite.current = Date.now();
    };
    useEffect(() => {
        const t = setInterval(() => {
            const minutes = chargerConfig().ecranVeille ?? 5;
            if (minutes > 0 && !sansReprise() && Date.now() - derniereActivite.current > minutes * 60_000) setVeille(true);
        }, 10_000);
        return () => clearInterval(t);
    }, []);
    const reveiller = () => {
        activite();
        setVeille(false);
    };
    useVersion(surMajDonnees);
    useVersion(surJournal);
    useVersion(surMaitre);
    useVersion(surDisposition);
    const disp = disposition();
    const d = lireDonnees();
    const { width, height } = useTerminalDimensions();
    const renderer = useRenderer();
    const [selection, setSelectionEtat] = useState<string>();
    // Panneau de détail (projet, serveur, conteneur) : il remplace la conversation dans la zone principale, et inversement
    const [detail, setDetailEtat] = useState<any>();
    const setSelection = (cle?: string) => {
        if (cle) {
            setDetailEtat(undefined);
            setVueZone(undefined);
            setModeMaitre(false);
        }
        setRecherche(false);
        setSelectionEtat(cle);
    };
    const ouvrirDetail = (dt?: any) => {
        if (dt) {
            setSelectionEtat(undefined);
            setVueZone(undefined);
        }
        setDetailEtat(dt);
    };
    // Grille ou fichiers chauds : remplace la conversation ou le détail ouvert
    const ouvrirZone = (v: Zone) => {
        setSelectionEtat(undefined);
        setDetailEtat(undefined);
        setVueZone(v);
    };
    // Plein écran (vue globale) : la colonne de gauche disparaît le temps de la vue
    const [pleinEcran, setPleinEcran] = useState(false);
    const [aSelectionner, setASelectionner] = useState<string>();
    const [espace, setEspace] = useState('sessions');
    const [demande, setDemande] = useState<any>();
    const [tache, setTache] = useState<string>();
    const [notice, setNotice] = useState<string>();
    const [occupe, setOccupe] = useState(false);
    const [journalOuvert, setJournalOuvert] = useState(false);
    const [modeMaitre, setModeMaitre] = useState(false);
    const [recherche, setRecherche] = useState(false);
    const destination = destinationBrouillon(selection, modeMaitre, recherche);
    const { texte: valeur, images, setTexte: setValeurEtat, setImages, carnet } = useBrouillon(destination);
    const [collage] = useState(() => new CollageImage(carnet, lireImage));
    const collageEnCours = useSyncExternalStore(collage.abonner, collage.lire);
    const avis = useSyncExternalStore(historiqueAvis.abonner, historiqueAvis.lire);
    useEffect(() => () => collage.fermer(), [collage]);
    // Valeur réelle de la barre, à jour à chaque frappe : le clavier la lit (l'état React peut avoir une frappe de retard)
    const valeurRef = useRef('');
    valeurRef.current = valeur;
    const setValeur = (v: string) => {
        valeurRef.current = v;
        setValeurEtat(v);
    };
    const [cle, setCle] = useState(0);
    const [indexSugg, setIndexSugg] = useState(0);
    const historiqueSaisie = useRef(new HistoriqueSaisie());
    const [survolHaut, setSurvolHaut] = useState<string>();
    const [projets, setProjets] = useState(() => getProjets());
    useEffect(() => { const maj = () => setProjets(getProjets()); bus.on('projets', maj); return () => { bus.off('projets', maj); }; }, []);
    const [quelleTouche, setQuelleTouche] = useState<string>();
    const ctrlC = useRef(0);
    // La vue affichée (la commande qui l'a ouverte) : gardée pour la rouvrir au prochain lancement
    const [vueActive, setVueActive] = useState<string>();
    const commandeCourante = useRef<string>();
    // Le temps qu'une commande lancée d'un clic ou d'un menu ouvre sa vue, on garde l'écran d'avant :
    // sinon le cockpit apparaît une fraction de seconde entre les deux (500 ms au plus)
    const [fige, setFige] = useState(false);
    const zoneAvant = useRef<any>();
    const cleAvant = useRef('cockpit');
    // Un clic passe d'une vue à l'autre : la fin de l'ancienne commande ne doit pas dégeler l'écran avant que la nouvelle démarre
    const changement = useRef(false);
    const minuterieFige = useRef<ReturnType<typeof setTimeout>>();
    const figer = (oui: boolean) => {
        clearTimeout(minuterieFige.current);
        setFige(oui);
        if (oui) minuterieFige.current = setTimeout(() => setFige(false), 500);
    };
    // Ctrl+F : chercher dans la conversation ouverte (Entrée = occurrence suivante, en remontant le temps)
    const [occurrence, setOccurrence] = useState(0);
    const [trouvees, setTrouvees] = useState(0);
    // Images et fichiers joints (Alt+V, ou glissés dans la fenêtre) : envoyés avec le texte
    // Largeur de la colonne (0 = automatique) : Alt+←/→ ou glisser sa bordure, gardée dans la config
    const [largeurCol, setLargeurCol] = useState<number>(() => chargerConfig().largeurLaterale || 0);
    useEffect(() => { setCle((k) => k + 1); setIndexSugg(0); historiqueSaisie.current.reinitialiser(); }, [destination]);
    const glisse = useRef(false);

    // Une seule horloge : 800 ms si quelque chose s'anime, sinon 1 s (comme l'interface Ink)
    const anime = !!tache || d.agents.some((a: any) => a.statut === 'travaille');
    const [tic, setTic] = useState(0);
    useEffect(() => {
        const t = setTimeout(() => setTic((x) => x + 1), anime ? 800 : 1000);
        return () => clearTimeout(t);
    }, [tic, anime]);

    const session = d.agents.find((a: any) => a.cle === selection);
    const libre = !demande && !occupe;
    const suggestions = recherche ? [] : calculerSuggestions(valeur);
    const sugg = Math.min(indexSugg, Math.max(0, suggestions.length - 1));

    const remplacer = (texte: string) => {
        historiqueSaisie.current.reinitialiser();
        setValeur(texte);
        setCle((k) => k + 1);
        setIndexSugg(0);
    };

    // silencieux : lancé par un clic, une action ou une vue ; la commande n'est ni affichée ni gardée dans l'historique
    async function lancer(ligne: string, silencieux = false, puisQuitter = false) {
        let texte = ligne.trim();
        const contexte = { dossier: dossierContexte(session, detail) };
        const cmd = trouverCommande(texte.split(' ')[0]);
        if (cmd?.nom === 'exit') return quitter();
        if (cmd?.nom === 'clear') {
            setJournalOuvert(false);
            return vider();
        }
        if (cmd?.nom === 'sorties') {
            setSelection(undefined);
            return setJournalOuvert(true);
        }
        const avant = lignesJournal().length;
        if (silencieux) figer(true);
        if (texte && !cmd?.cache && !silencieux) {
            historique.unshift(texte);
            ajouterHistorique(texte);
        }
        // Une commande ordinaire affiche son résultat dans le journal : on referme la conversation ouverte
        if (!cmd?.cache && cmd?.nom !== 'avis') setSelection(undefined);
        if (!silencieux) console.log(`\n${c.accent('❯')} ${ligne.trim() || c.discret('(menu)')}`);
        commandeCourante.current = texte.split(' ')[0] === '/ssh' && texte.split(' ')[1] === 'vue' ? texte : texte.split(' ').slice(0, 2).join(' ');
        occupeRef.current = true;
        setOccupe(true);
        try {
            await (silencieux ? executerLigne(texte, contexte) : avecRetrait(() => executerLigne(texte, contexte)));
            return true;
        } catch (err) {
            if (err instanceof Annule || (err as Error)?.name === 'Annule') {
                if (!silencieux) console.log(c.discret('Annulé'));
            } else {
                historiqueAvis.ajouter(`Commande ${cmd?.nom ?? texte.split(' ')[0]} : ${(err as Error).message}`);
                console.log(c.erreur(`✗ ${(err as Error).message}`));
            }
            return false;
        } finally {
            if (!process.env.CLAUDETOPIA_TEST_UI) { rafraichirProjets(); rafraichirAgents(); }
            occupeRef.current = false;
            setOccupe(false);
            if (!changement.current) figer(false);
            // Un résultat trop long pour « Dernières sorties » s'ouvre en entier (Échap ramène au cockpit)
            if (lignesJournal().length - avant > 8) setJournalOuvert(true);
            if (puisQuitter) setTimeout(quitter, 300);
        }
    }
    const lancerRef = useRef(lancer);
    lancerRef.current = lancer;
    // État courant lu depuis les clics (une fermeture peut avoir changé l'état depuis le rendu)
    const demandeRef = useRef<any>();
    demandeRef.current = demande;
    const occupeRef = useRef(false);
    occupeRef.current = occupe;
    // Ferme ce qui est ouvert (vue, ou choix et saisie annulés), puis attend que sa commande soit finie
    async function fermerOuvert(): Promise<boolean> {
        const dm = demandeRef.current;
        if (dm?.type === 'vue') dm.resoudre();
        else if (dm) dm.resoudre(undefined);
        for (let i = 0; i < 100 && (occupeRef.current || demandeRef.current); i++) await new Promise((r) => setTimeout(r, 16));
        return !occupeRef.current && !demandeRef.current;
    }
    // Un clic (barre du haut, colonne) passe d'une vue à l'autre ; si une commande tourne encore, on le dit
    async function ouvrirDepuisClic(cmd: string) {
        figer(true);
        changement.current = true;
        const ferme = await fermerOuvert();
        changement.current = false;
        if (!ferme) return void (figer(false), bus.emit('notice', `Une commande est encore en cours (${commandeCourante.current ?? '…'}) : attends qu'elle finisse`));
        void lancerRef.current(cmd, true);
    }
    // Choisir une carte referme la vue ouverte : sinon la conversation resterait cachée derrière
    const choisirCarte = (cle?: string) => {
        if (cle && demandeRef.current?.type === 'vue') demandeRef.current.resoudre();
        setSelection(cle);
    };
    const ouvrirDetailRef = useRef(ouvrirDetail);
    ouvrirDetailRef.current = ouvrirDetail;

    async function gererPieces() {
        if (demandeRef.current || occupeRef.current) return;
        const cible = destination;
        const pieces = carnet.lire(cible).images;
        if (!pieces.length) return void bus.emit('notice', 'Aucune pièce jointe dans ce brouillon · Alt+V pour ajouter une image.');
        try {
            const choix = await choisir('Pièces jointes du brouillon', [
                ...pieces.map((fichier, i) => ({ label: `Retirer ${i + 1} · ${path.basename(fichier)}`, valeur: i, description: fichier })),
                { label: 'Retirer toutes les pièces jointes', valeur: -1 },
            ], pieces.length > 8, 'Le texte du message est conservé. Échap pour revenir sans modification.');
            const actuel = carnet.lire(cible);
            const indices = choix === -1 ? actuel.images.map((_, i) => i) : [actuel.images.indexOf(pieces[choix])];
            carnet.ecrire(cible, retirerPiecesJointes(actuel, indices));
            setCle((k) => k + 1);
            bus.emit('notice', choix === -1 ? 'Pièces jointes retirées · texte conservé.' : 'Pièce jointe retirée · texte conservé.');
        } catch (e) { if (!(e instanceof Annule)) bus.emit('notice', (e as Error).message); }
    }

    async function ouvrirListeSessions() {
        if (!await fermerOuvert()) return void bus.emit('notice', 'Attends la fin de la commande en cours.');
        try {
            const id = await choisir('Sessions ouvertes', [
                ...lireDonnees().agents.map((s: any) => ({ label: `${nomAgentSession(s)} · ${s.nom} · ${s.titre || s.id}`, valeur: s.cle })),
                { label: '+ Session · choisir l’agent', valeur: 'nouvelle-session' },
            ], true);
            if (id === 'nouvelle-session') void lancer('/session', true);
            else setSelection(id);
        } catch (e) { if (!(e instanceof Annule)) bus.emit('notice', (e as Error).message); }
    }

    function soumettre(v: string) {
        if (recherche) return setOccurrence((o) => o + 1);
        if (collage.lire().destination === destination && !/^[/!]/.test(v.trim())) return void bus.emit('notice', 'Ajout de l’image en cours · ton message est conservé.');
        // Le verrou est synchrone : deux touches Entrée peuvent arriver avant le prochain rendu React.
        if (occupeRef.current) return void bus.emit('notice', 'Commande en cours · ton brouillon est conservé.');
        if (modeMaitre && etatMaitre().enCours && !/^[/!]/.test(v.trim())) return void bus.emit('notice', 'Le maître réfléchit encore · ton brouillon est conservé.');
        if (session?.terminalExterne && !modeMaitre) {
            bus.emit('notice', 'Écris dans le terminal Codex. Ferme Codex pour reprendre ici · brouillon conservé.');
            return;
        }
        if (modeMaitre && images.length && !/^[/!]/.test(v.trim())) {
            bus.emit('notice', 'Le maître reçoit du texte · Alt+I pour retirer les pièces jointes, ou envoie-les à une session.');
            return;
        }
        if (!modeMaitre && session?.fournisseur === 'perplexity' && images.length && !/^[/!]/.test(v.trim())) {
            bus.emit('notice', 'Perplexity reçoit du texte et des liens web · Alt+I pour retirer les pièces jointes.');
            return;
        }
        if (!modeMaitre && session?.integree && v.trim() && !/^[/!]/.test(v.trim()) && ['travaille', 'bloquee'].includes(session.statut)) {
            bus.emit('notice', session.permission ? 'Réponds à la demande de l’agent · ton brouillon est conservé' : 'L’agent travaille encore · ton brouillon est conservé');
            return;
        }
        const s = suggestions[sugg];
        if (s) {
            if (s.executer) {
                remplacer('');
                void lancer(s.texte);
            } else remplacer(s.texte);
            return;
        }
        // Entrée sur une ligne vide avec une session d'arrière-plan ouverte : on la rejoint
        if (!v.trim() && session?.integree) return void (session.permission && lancer(`/autorisation ${session.id}`, true));
        if (!v.trim() && session?.arrierePlan) return void lancer(`/rejoindre ${session.id}`, true);
        const ancien = { texte: v, images: [...images] };
        const estMessage = !/^[/!]/.test(v.trim());
        if (estMessage) {
            try { verifierPiecesJointes(images); }
            catch (e) { bus.emit('notice', (e as Error).message); return; }
        }
        const message = estMessage ? joindreImages(v.trim(), images) : v;
        remplacer('');
        if (estMessage) setImages([]);
        const envoyer = async (ligne: string, silencieux = false) => {
            if (await lancer(ligne, silencieux) === false) {
                carnet.restaurer(destination, ancien);
                bus.emit('notice', 'Envoi non effectué · brouillon restauré dans sa conversation.');
            }
        };
        // Mode maître : le texte est une demande au maître (les commandes / et ! restent des commandes)
        if (modeMaitre && v.trim() && estMessage) {
            const cible = destination;
            void parlerAuMaitre(v.trim()).catch((e) => {
                if (!(e instanceof Annule)) {
                    historiqueAvis.ajouter(`Maître : ${(e as Error).message}`);
                    console.log(c.erreur(`  ✕ ${(e as Error).message}`));
                }
                return false;
            }).then((ok) => {
                if (!ok) {
                    carnet.restaurer(cible, ancien);
                    bus.emit('notice', 'Demande au maître non effectuée · brouillon restauré.');
                }
            });
            return;
        }
        // Une conversation est ouverte et ce n'est ni une commande ni du shell : le texte lui est envoyé
        if (session && v.trim() && !/^[/!]/.test(v.trim())) {
            console.log(`\n${c.accent('❯')} ${v.trim()} ${c.discret(`→ ${session.nom}`)}`);
            return void envoyer(`/envoyer ${session.sessionId} ${message}`, true);
        }
        void envoyer(message);
    }

    // Un fichier glissé dans la fenêtre : son chemin est collé dans la barre, il devient une pièce jointe
    function surSaisie(v: string) {
        historiqueSaisie.current.reinitialiser();
        if (recherche) setOccurrence(0);
        const avant = valeurRef.current;
        const ajout = v.length > avant.length + 3 && v.startsWith(avant) ? v.slice(avant.length) : '';
        const fichiers = ajout && !recherche ? fichiersDeposes(ajout) : undefined;
        if (fichiers) {
            const debut = images.length;
            setImages([...images, ...fichiers]);
            const etiquettes = fichiers.map((f: string, i: number) => (EST_IMAGE.test(f) ? `[image ${debut + i + 1}]` : `[fichier ${debut + i + 1}: ${path.basename(f)}]`));
            return remplacer(`${avant}${avant && !avant.endsWith(' ') ? ' ' : ''}${etiquettes.join(' ')} `);
        }
        setValeur(v);
        setIndexSugg(0);
    }

    // Largeur de la colonne : bornée, appliquée tout de suite, gardée dans la config si demandé
    const redimensionner = (n: number, sauver: boolean) => {
        const l = Math.max(LATERAL_MIN, Math.min(width - 50, Math.round(n)));
        setLargeurCol(l);
        if (sauver) {
            config.largeurLaterale = l;
            sauverConfig(config);
        }
    };

    function agir(action: string) {
        if (action === 'fermer') return setSelection(undefined);
        const cmd = session && commandeSession(action, session);
        if (cmd && libre) void lancer(cmd, true);
    }

    // Clic droit : un menu selon ce qui est sous la souris ; l'article choisi est une commande ou une action de l'interface
    async function ouvrirMenu({ titre, articles }: Menu) {
        let choix: any;
        try {
            choix = await choisir(titre, articles.map((a) => ({ label: a.label, valeur: a.valeur, description: a.description })), false);
        } catch {
            return;   // Échap
        }
        if (typeof choix === 'string') await lancer(choix, true);
        else await choix();
    }
    const parler = () => setModeMaitre(true);

    // Le maître : sa réponse s'affiche dans sa zone et dans le journal ; ses commandes passent par lancer(),
    // après une seule confirmation si elles arrêtent ou suppriment quelque chose
    const decrire = (cmd: string) => {
        const [nom, id] = cmd.split(/\s+/);
        const s = lireDonnees().agents.find((a: any) => a.id === id || a.sessionId === id || String(a.pid) === id);
        const verbe = nom === '/arreter' ? 'mettre en pause' : nom === '/fermer' ? 'fermer' : 'supprimer';
        return `${verbe} ${s ? `${s.nom} (${s.titre || s.id || 'onglet'})` : id}`;
    };
    async function parlerAuMaitre(texte: string): Promise<boolean> {
        if (etatMaitre().enCours) return false;
        let e;
        try { e = await demanderAuMaitre(texte, getProjets().map((p: any) => p.nom), session?.id ?? session?.sessionId); }
        catch (err) { historiqueAvis.ajouter(`Maître : ${(err as Error).message}`); console.log(c.erreur(`  ✕ ${(err as Error).message}`)); return false; }
        console.log(`\n${c.violet('◈')} ${texte}`);
        if (e.erreur) { historiqueAvis.ajouter(`Maître : ${e.erreur}`); console.log(c.erreur(`  ✕ ${e.erreur}`)); return false; }
        console.log(`  ${e.reponse}`);
        if (e.plan) {
            try { await proposerPlan(e.plan); } catch (err) { if ((err as Error).name !== 'Annule') console.log(c.erreur((err as Error).message)); }
            return true;
        }
        const commandes: string[] = e.commandes ?? [];
        const destructrices = commandes.filter((x) => DESTRUCTRICES.has(x.split(/\s+/)[0]));
        if (destructrices.length && !(await confirmer(`◈ Le maître va ${destructrices.map(decrire).join(', ')} : d'accord ?`))) {
            console.log(c.discret('  annulé'));
            return true;
        }
        for (const commande of commandes) {
            const avecOui = DESTRUCTRICES.has(commande.split(/\s+/)[0]) && !commande.includes('--oui') ? `${commande} --oui` : commande;
            await lancerRef.current(avecOui, true);
        }
        return true;
    }
    // Préparation visuelle seulement, aucun appel à un modèle au démarrage.
    useEffect(() => {
        if (process.env.CLAUDETOPIA_TEST_UI) return;
        void prechauffer(getProjets().map((p: any) => p.nom));
    }, []);
    useEffect(() => {
        const recuperation = etatRecuperationConfig();
        if (!recuperation) return;
        const t = setTimeout(() => bus.emit('notice', `${recuperation.message} · /diagnostic`), 0);
        return () => clearTimeout(t);
    }, []);

    // ─── Reprendre là où on en était : la conversation ouverte ou la vue affichée ───
    const repris = useRef(false);
    const [etatInitial] = useState<{ session?: string; vue?: string }>(() => {
        if (sansReprise()) return {};
        try { return JSON.parse(fs.readFileSync(CHEMINS.etat, 'utf-8')); } catch { return {}; }
    });
    useEffect(() => {
        if (sansReprise()) return;
        const t = setTimeout(() => {
            if (!repris.current && !commandeInitiale && !auDemarrage) return;
            try {
                fs.writeFileSync(CHEMINS.etat, JSON.stringify({ session: selection, vue: demande?.type === 'vue' ? vueActive : undefined }), 'utf-8');
            } catch {
                // pas grave
            }
        }, 400);
        return () => clearTimeout(t);
    }, [selection, demande, vueActive]);
    useEffect(() => {
        if (repris.current || commandeInitiale || auDemarrage || sansReprise()) return;
        // On attend que les sessions soient lues (ou 4 s), puis on rouvre une seule fois
        if (!d.agents.length && Date.now() - debutApp < 4000) return;
        repris.current = true;
        const etat = etatInitial;
        if (etat.session && d.agents.some((a: any) => a.cle === etat.session)) setSelection(etat.session);
        else if (etat.vue) void lancer(etat.vue, true);
    });

    // Au lancement : la commande demandée (puis on quitte), ou l'assistant la première fois ;
    // une fois par lancement, on signale les connexions à régler (sans insister)
    useEffect(() => {
        // Au lancement, seulement une vraie commande : un texte inconnu (ex. un argument transformé en chemin par
        // Git Bash, « /status » → « C:/Program Files/Git/status ») partirait sinon à Claude comme une nouvelle session
        const inconnue = commandeInitiale && !trouverCommande(commandeInitiale.trim().split(' ')[0]);
        if (inconnue) {
            console.log(c.erreur(`✗ « ${commandeInitiale} » n'est pas une commande Agentopia : rien n'est lancé`));
            setTimeout(quitter, 1500);
        }
        else if (commandeInitiale) void lancerRef.current(commandeInitiale, false, true);
        else if (auDemarrage) void lancerRef.current(auDemarrage);
        if (process.env.CLAUDETOPIA_TEST_UI) return;
        const t = setTimeout(async () => {
            const { etatConnexions } = await import('../dist/connexions.js');
            const aRegler = (await etatConnexions()).filter((x: any) => x.etat === 'manque' || x.etat === 'avert');
            if (aRegler.length) bus.emit('notice', `⚿ ${aRegler.length} connexion${aRegler.length > 1 ? 's' : ''} à régler (${aRegler.slice(0, 3).map((x: any) => x.nom).join(', ')}) · /connexions`);
        }, 20_000);
        return () => clearTimeout(t);
    }, []);

    // « Quelle touche ? » : une lettre descend dans un groupe ou lance l'action
    function toucheQT(t: string) {
        const enfant = noeudA(quelleTouche ?? '').enfants[t];
        if (!enfant) return;
        if (estGroupe(enfant)) return setQuelleTouche((quelleTouche ?? '') + t);
        setQuelleTouche(undefined);
        if (enfant.commande.startsWith('espace:')) return setEspace(enfant.commande.slice(7));
        if (enfant.commande === 'maitre') return setModeMaitre(true);
        void lancer(enfant.commande, true);
    }

    // Ce que les commandes demandent à l'interface (bus.ts)
    useEffect(() => {
        let minuterie: ReturnType<typeof setTimeout> | undefined;
        const surDemande = (x?: any) => {
            // Un menu ou un choix se ferme mais sa commande continue (elle ouvre souvent une vue ensuite) : on fige
            if (x) figer(false);
            else if (occupeRef.current) figer(true);
            if (x?.type === 'vue') setVueActive(commandeCourante.current);
            else if (!x) setVueActive(undefined);
            setDemande(x);
        };
        // Clic sur une notification Windows : claudetopia:session/<id>, claudetopia:equipe/<id>, claudetopia:questions
        const surLien = (lien: string) => {
            const [quoi, id] = lien.replace(/^claudetopia:\/*/i, '').replace(/\/$/, '').split('/');
            if (quoi === 'session' && id) bus.emit('selectionner', id);
            else if (quoi === 'equipe' && id) void lancerRef.current(`/equipe ${id}`, true);
            else if (quoi === 'questions') void lancerRef.current('/questions', true);
            else if (quoi === 'surveillances') void lancerRef.current('/surveillances', true);
        };
        liens.on('demande', surLien);
        const surTache = (t?: string) => setTache(t);
        const surNotice = (t: string) => {
            historiqueAvis.ajouter(t);
            setNotice(t);
            clearTimeout(minuterie);
            minuterie = setTimeout(() => setNotice(undefined), 6000);
        };
        const surSelection = (id: string) => setASelectionner(id);
        const surDetail = (dt: any) => setTimeout(() => ouvrirDetailRef.current(dt), 50);
        const surPleinEcran = (v: boolean) => setPleinEcran(v);
        const surZone = (v: Zone) => ouvrirZone(v);
        bus.on('zone', surZone);
        // /veille maintenant : un peu plus tard, sinon la touche Entrée qui l'a lancée la referme aussitôt
        const surVeille = () => setTimeout(() => setVeille(true), 400);
        bus.on('veille', surVeille);
        bus.on('detail', surDetail);
        bus.on('plein-ecran', surPleinEcran);
        const surLancer = async (commandes: string | string[]) => {
            for (const commande of ([] as string[]).concat(commandes)) await lancerRef.current(commande, true);
        };
        bus.on('demande', surDemande);
        bus.on('tache', surTache);
        bus.on('notice', surNotice);
        bus.on('selectionner', surSelection);
        bus.on('lancer', surLancer);
        return () => {
            bus.off('demande', surDemande);
            bus.off('tache', surTache);
            bus.off('notice', surNotice);
            bus.off('selectionner', surSelection);
            liens.off('demande', surLien);
            bus.off('zone', surZone);
            bus.off('veille', surVeille);
            bus.off('detail', surDetail);
            bus.off('plein-ecran', surPleinEcran);
            bus.off('lancer', surLancer);
        };
    }, []);
    // Une session vient d'être lancée : on l'ouvre dès que sa carte apparaît
    useEffect(() => {
        const s = aSelectionner && d.agents.find((a: any) => a.id === aSelectionner || a.sessionId === aSelectionner);
        if (s) {
            setSelection(s.cle);
            setASelectionner(undefined);
        }
    });

    useKeyboard((k) => {
        // Les événements natifs du textarea peuvent précéder sa notification React.
        // Lire le contenu réel évite qu’un espace tapé vite ouvre les raccourcis.
        const champ = renderer.currentFocusedRenderable as { plainText?: string } | null;
        if (!demande && typeof champ?.plainText === 'string') valeurRef.current = champ.plainText;
        // Ctrl+C : vide la saisie ; deux fois de suite pour quitter
        if (k.ctrl && k.name === 'c') {
            if (valeurRef.current) return remplacer('');
            if (Date.now() - ctrlC.current < 1500) return quitter();
            ctrlC.current = Date.now();
            return void bus.emit('notice', 'Ctrl+C encore une fois pour quitter');
        }
        activite();
        // Écran de veille : la touche réveille seulement (la barre garde ce qui y était écrit)
        if (veille) {
            const avant = valeurRef.current;
            return void setTimeout(() => (setVeille(false), remplacer(avant)), 0);
        }
        if (splash) return void setTimeout(() => (setSplash(false), remplacer('')), 0);
        if (demande) return;   // les dialogues gèrent leurs touches
        if (quelleTouche !== undefined) {
            if (k.name === 'escape') return setQuelleTouche(undefined);
            if (k.name === 'backspace') return setQuelleTouche(quelleTouche ? quelleTouche.slice(0, -1) : undefined);
            if (k.sequence?.length === 1) toucheQT(k.sequence);
            return;
        }
        const alt = k.meta || k.option;
        // Le champ reçoit aussi la touche (Espace, ?) : on le vide une fois qu'il l'a traitée
        const viderApres = () => setTimeout(() => remplacer(''), 0);
        if (k.name === 'space' && !valeurRef.current.trim() && !occupe && !modeMaitre) {
            viderApres();
            return setQuelleTouche('');
        }
        if (k.sequence === '?' && !valeurRef.current.trim()) {
            viderApres();
            return void lancer('/aide', true);
        }
        if (recherche && k.name === 'escape') {
            setRecherche(false);
            return;
        }
        if (occupe) return;
        if (alt && k.name === 'n') { k.preventDefault(); return void lancer('/avis', true); }
        if (alt && k.name === 'i' && !recherche) { k.preventDefault(); return void gererPieces(); }
        if (alt && k.name === 'a' && session) { k.preventDefault(); return void ouvrirMenu(menuSession(session, () => undefined)); }
        if (k.ctrl && k.name === 'f' && session) {
            setRecherche(true);
            setOccurrence(0);
            return;
        }
        if (recherche && (k.name === 'up' || k.name === 'down')) {
            k.preventDefault();
            return setOccurrence((o) => (o + (k.name === 'up' ? 1 : Math.max(1, trouvees) - 1)) % Math.max(1, trouvees));
        }
        // Alt+V : l'image du presse-papiers devient une pièce jointe
        if (alt && k.name === 'v' && !recherche) {
            k.preventDefault();
            if (collage.lire().destination) return void bus.emit('notice', 'Une image est déjà en cours d’ajout · attends sa fin.');
            return void collage.coller(destination, modeMaitre ? 'maître' : session?.nom ?? 'nouvelle conversation');
        }
        if (alt && (k.name === 'left' || k.name === 'right')) return redimensionner(lateral + (k.name === 'right' ? 2 : -2), true);
        if (k.ctrl && k.name === 'k') return void lancer('/palette', true);
        if (alt && k.name === 'm') return setModeMaitre((v) => !v);
        if (alt && k.name === 't') return void lancer('/terminal', true);
        if (alt && k.name === 'z') {
            setFocus((v) => !v);
            return void bus.emit('notice', focus ? 'Mode focus désactivé' : '◎ Mode focus · Alt+Z pour tout réafficher');
        }
        if (alt && k.name === 'j') {
            if (session?.arrierePlan) return void lancer(`/rejoindre-cote ${session.id}`, true);
            return void bus.emit('notice', 'Alt+J : ouvre d\'abord une session d\'arrière-plan (clic sur sa carte)');
        }
        if (alt && (k.name === 'g' || k.name === 'h' || k.name === 'o')) {
            const v: Zone = k.name === 'g' ? 'grille' : k.name === 'h' ? 'chauds' : 'globe';
            return vueZone === v ? setVueZone(undefined) : ouvrirZone(v);
        }
        if (alt && k.name === 'd') {
            setDiffDirect((v) => !v);
            return void bus.emit('notice', diffDirect ? 'Diff en direct caché · Alt+D pour le réafficher' : '✎ Diff en direct affiché sous la conversation');
        }
        if (alt && (k.name === 's' || k.name === 'p')) return setEspace(k.name === 's' ? 'sessions' : 'projets');
        if (alt && /^[1-9]$/.test(k.name)) {
            const s = d.agents[Number(k.name) - 1];
            return s && setSelection(s.cle === selection ? undefined : s.cle);
        }
        if (k.name === 'escape') {
            if (modeMaitre) return setModeMaitre(false);
            if (valeurRef.current) return remplacer('');
            if (session) return setSelection(undefined);
            if (detail) return ouvrirDetail(undefined);
            if (vueZone) return setVueZone(undefined);
            if (journalOuvert) return setJournalOuvert(false);
            return;
        }
        if (k.name === 'tab' && suggestions[sugg]) return remplacer(suggestions[sugg].texte);
        if ((k.name === 'up' || k.name === 'down') && !valeurRef.current.includes('\n')) {
            const sens = k.name === 'up' ? -1 : 1;
            if (suggestions.length && !historiqueSaisie.current.enCours) return setIndexSugg(Math.max(0, Math.min(Math.min(8, suggestions.length) - 1, sugg + sens)));
            // Historique : ↑ remonte, ↓ redescend
            setValeur(historiqueSaisie.current.parcourir(k.name, valeurRef.current, historique));
            setCle((x) => x + 1);
        }
    });

    function indication(): { texte: string; couleur: string } {
        const contexte = contexteSaisie(demande, vueActive, quelleTouche !== undefined);
        if (contexte) return { texte: contexte, couleur: theme.secondaire };
        if (recherche) {
            const t = valeur.trim();
            return { texte: `⌕ chercher : ${t.length < 2 ? 'tape au moins 2 lettres' : trouvees ? `${(occurrence % trouvees) + 1}/${trouvees} · Entrée / ↑ ↓ parcourir` : 'aucun résultat'} · Échap fermer`, couleur: theme.secondaire };
        }
        if (tache) return { texte: `${SPINNER[tic % SPINNER.length]} ${tache}…`, couleur: theme.accent };
        if (collageEnCours.destination === destination) return { texte: 'Ajout de l’image en cours · tu peux continuer à écrire', couleur: theme.accent };
        if (notice) return { texte: notice, couleur: theme.secondaire };
        if (occupe) return { texte: 'commande en cours…', couleur: 'gray' };
        const t = valeur.trim();
        if (images.length && !t.startsWith('/')) return { texte: `${session ? `${nomAgentSession(session)} · ${session.nom} · ${session.titre || session.id}` : indicationNouvelleSession(config.fournisseurDefaut)} · 📎 ${images.length} pièce(s) jointe(s)`, couleur: theme.accent };
        if (t.startsWith('/')) return { texte: 'commande du CLI', couleur: 'gray' };
        if (modeMaitre) {
            return etatMaitre().enCours
                ? { texte: '◈ le maître réfléchit… attends sa réponse', couleur: '#a78bfa' }
                : { texte: '◈ au maître : il gère tes sessions (fermer, relancer, écrire, créer, résumer…) · Échap pour revenir', couleur: '#a78bfa' };
        }
        if (t.startsWith('!')) return { texte: `PowerShell · ${dossierContexte(session, detail)}`, couleur: theme.accent };
        if (session) {
            if (session.integree) {
                if (session.terminalExterne) return { texte: 'Même conversation contrôlée dans le terminal Codex · ferme Codex pour reprendre ici · brouillon conservé', couleur: theme.secondaire };
                if (session.permission) return { texte: `${nomAgentSession(session)} attend ta décision · Entrée vide ou « Répondre à l’agent » · brouillon conservé`, couleur: '#fb923c' };
                if (session.statut === 'travaille') return { texte: `${nomAgentSession(session)} travaille · prépare ton prochain message, il restera en brouillon · Interrompre pour arrêter`, couleur: theme.secondaire };
                return { texte: `↳ ${nomAgentSession(session)} · ${session.nom} · ${session.titre || session.id} · Entrée pour envoyer${session.erreur ? ' · dernier tour interrompu ou en erreur' : ''}`, couleur: couleurProjet(session.nom) };
            }
            if (!session.arrierePlan) return { texte: `${session.nom} tourne dans un onglet : écris-y, ou « ⑂ Continuer ici » pour lui écrire d'ici`, couleur: '#facc15' };
            if (session.statut === 'travaille') return { texte: `${session.nom} travaille : attends qu'il ait fini pour lui écrire, ou Entrée pour le rejoindre`, couleur: '#facc15' };
            if (session.statut === 'bloquee' && session.question && !/permission/i.test(session.question)) {
                return { texte: `${session.nom} te demande : ${session.question} · écris ta réponse ici${session.suggestion ? `, ou « ✓ » sur sa carte` : ''}`, couleur: '#fb923c' };
            }
            if (session.statut === 'bloquee') return { texte: `${session.nom} attend une permission : Entrée pour le rejoindre (Alt+J : à côté)`, couleur: '#fb923c' };
            return { texte: `↳ envoyé à la conversation ${session.nom} (${session.titre || session.id})${t ? '' : ' · Entrée vide = la rejoindre'}`, couleur: couleurProjet(session.nom) };
        }
        return { texte: `↳ ${indicationNouvelleSession(config.fournisseurDefaut)} · ${path.basename(dossierContexte(session, detail))}`, couleur: fond.discret };
    }

    const compact = width < 100;
    const colonneVisible = !pleinEcran && !focus && disp.laterale !== 'cachee' && !(compact && session);
    // En mode focus, la barre du haut disparaît aussi : la zone principale commence à la première ligne
    const haut = focus ? 0 : 2;
    const lateral = !colonneVisible ? 0
        : largeurCol ? Math.max(LATERAL_MIN, Math.min(width - 50, largeurCol)) : Math.max(32, Math.min(56, Math.floor(width / 3)));
    const principal = width - lateral;
    // Début de la zone principale (pour le clic dans le cockpit) : après la colonne si elle est à gauche
    const debutZone = disp.laterale === 'gauche' ? lateral : 0;
    const nbSugg = Math.min(8, suggestions.length);
    const barreDansChat = !!session && !demande && !detail && !modeMaitre;
    const hauteurRaccourcis = quelleTouche !== undefined ? 2 + Math.ceil(Object.keys(noeudA(quelleTouche).enfants).length / 3) : 0;
    const corps = Math.max(1, height - haut - hauteurRaccourcis - (barreDansChat ? 0 : 3 + hauteurComposeur(valeur) + nbSugg + (!recherche && images.length ? 1 : 0)));
    // Une seule saisie montée : mêmes brouillons, commandes et recherche dans les deux emplacements.
    const saisie = <>
        <Barre key={destination} valeur={valeur} cle={cle} setValeur={surSaisie} soumettre={soumettre} suggestions={recherche ? [] : suggestions} indexSugg={sugg}
            choisirSugg={(i) => (suggestions[i]?.executer ? (remplacer(''), void lancer(suggestions[i].texte)) : remplacer(suggestions[i].texte))}
            indication={indication()} actif={!demande && quelleTouche === undefined && (!session?.terminalExterne || recherche || modeMaitre)}
            pieces={recherche ? [] : images} gererPieces={() => void gererPieces()}
            avis={{ nombre: avis.filter((a) => !a.lu).length, actif: !demande && !occupe, ouvrir: () => void lancer('/avis', true) }}
            raisonPause={!demande && session?.terminalExterne && !recherche && !modeMaitre ? 'Lecture seule : cette conversation est ouverte dans le terminal Codex.' : undefined}
            placeholder={recherche ? 'Rechercher dans les messages · Entrée / ↑ ↓ pour parcourir' : barreDansChat ? `Écrire à ${nomAgentSession(session)} · Entrée pour envoyer` : undefined} maitre={modeMaitre} />
    </>;

    let zone;
    if (demande?.type === 'choix') zone = <Choix d={demande} hauteur={corps} />;
    else if (demande?.type === 'saisie') zone = <box flexGrow={1} flexDirection="column"><Saisie d={demande} /></box>;
    else if (demande?.type === 'vue') {
        // La commande décrit sa vue Ink (composant + paramètres) : on affiche notre version si elle existe
        const el = demande.rendu(demande.resoudre);
        const Vue = VUES[el?.type?.name];
        zone = Vue ? <Garde key={el.type.name} nom={el.type.name}><Vue {...el.props} /></Garde> : <VueNonMigree d={demande} />;
    }
    else if (detail) zone = <Detail key={`${detail.type}:${detail.cle}`} detail={detail} d={d} projets={projets} fermer={() => ouvrirDetail(undefined)} lancer={(cmd) => libre && lancer(cmd, true)} />;
    else if (session) {
        zone = (
            <box flexGrow={1} onMouseDown={(e: any) => droit(e) && ouvrirMenu(menuSession(session, () => undefined))}>
                <Conversation key={session.cle} s={session} largeur={principal} cout={d.cout.parSession[session.sessionId]} agir={agir} position={compact ? 'cachees' : disp.actions} rechercheActive={recherche}
                    recherche={recherche ? valeur.trim() : ''} occurrence={occurrence} surTrouvees={setTrouvees} diff={diffDirect} saisie={barreDansChat ? saisie : undefined}
                    navigationActive={!modeMaitre && quelleTouche === undefined} compact={compact} menuActions={() => void ouvrirMenu(menuSession(session, () => undefined))} />
            </box>
        );
    } else if (vueZone === 'grille') zone = <Grille d={d} largeur={principal} hauteur={corps} tic={tic} ouvrir={setSelection} />;
    else if (vueZone === 'chauds') zone = <Chauds d={d} largeur={principal} tic={tic} ouvrir={setSelection} />;
    else if (vueZone === 'globe') zone = <Globe d={d} largeur={principal} hauteur={corps} ouvrir={(s: any) => ouvrirDetail({ type: 'serveur', cle: s.nom })} />;
    else if (journalOuvert) zone = <box flexGrow={1} onMouseDown={(e: any) => droit(e) && ouvrirMenu(menuJournal(parler))}><Journal /></box>;
    else {
        const cockpit = lignesCockpit(d, principal - 1, corps);
        zone = (
            <box flexGrow={1} flexDirection="column" paddingLeft={1}
                onMouseDown={(e: any) => {
                    if (droit(e)) return void ouvrirMenu({ titre: 'Agentopia', articles: general(parler) });
                    const cible = cockpit.cible(e.x - debutZone - 1, e.y - haut);
                    if (cible === JOURNAL) setJournalOuvert(true);
                    else if (cible) setSelection(cible);
                }}>
                {cockpit.lignes.slice(0, corps - 1).map((l: string, i: number) => <Ansi key={i} texte={l} />)}
                <text fg={fond.discret}>{'  clic sur « À faire » pour ouvrir la session · sur « Dernières sorties » pour le journal complet'}</text>
            </box>
        );
    }

    // Une commande lancée d'un clic n'a pas encore ouvert sa vue : l'écran d'avant reste
    // La clé de ce qui est affiché : quand elle change, la nouvelle vue arrive en transition
    let cleZone = demande?.type === 'vue' ? `vue:${vueActive}` : demande ? `${demande.type}:${demande.message ?? ''}`
        : detail ? `detail:${detail.type}:${detail.cle}` : session ? `session:${session.cle}` : vueZone ? `zone:${vueZone}` : journalOuvert ? 'journal' : 'cockpit';
    // Une conversation contient maintenant un champ actif : ne jamais figer son ancien brouillon ni ses callbacks.
    if (fige && !demande && zoneAvant.current && !barreDansChat && !cleAvant.current.startsWith('session:')) {
        zone = zoneAvant.current;
        cleZone = cleAvant.current;
    } else {
        zoneAvant.current = zone;
        cleAvant.current = cleZone;
    }
    zone = <Transition cle={cleZone}>{zone}</Transition>;

    if (splash) return <Accueil largeur={width} hauteur={height} d={d} fermer={() => setSplash(false)} />;
    if (veille) return <Veille largeur={width} hauteur={height} d={d} reveiller={reveiller} />;
    const humeur = Mascotte.etat(d);

    return (
        <box width={width} height={height} flexDirection="column" backgroundColor="#0c0c0c" onMouseMove={activite} onMouseDown={activite}>
            {!focus && <box height={1} flexShrink={0} flexDirection="row" onMouseDown={(e: any) => droit(e) && ouvrirMenu({ titre: 'Agentopia', articles: general(parler) })}>
                <Ansi texte={degrade(' ✻ ' + (chargerConfig().banniere || 'AGENTOPIA').toUpperCase() + ' ')} />
                {(compact ? [{ label: 'Live', action: '/global' }, { label: 'Sessions', action: 'sessions-compactes' }, { label: 'Projets', action: '/projets' }, { label: '⋯', action: '/menu-principal' }] : BOUTONS).map((b) => (
                    <text key={b.action} onMouseOver={() => setSurvolHaut(b.action)} onMouseOut={() => setSurvolHaut(undefined)}
                        onMouseDown={() => b.action === 'sessions-compactes' ? void ouvrirListeSessions() : void ouvrirDepuisClic(b.action)}
                        fg={survolHaut === b.action ? fond.texte : fond.eteint} attributes={survolHaut === b.action ? GRAS : 0}>
                        {/* Icônes cachées (/ecran) : seulement les noms */}
                        {`  ${compact || disp.icones || b.label === '⋯' ? b.label : b.label.split(' ').slice(1).join(' ')} `}
                    </text>
                ))}
                <box flexGrow={1} />
                {/* La mascotte : l'humeur des sessions d'un coup d'œil (masquée si l'écran est étroit) */}
                {width >= 110 && <text fg={humeur.couleur}>{`${Mascotte.visage(d, tic)} ${humeur.texte} `}</text>}
            </box>}
            {!focus && <box height={1} flexShrink={0}><Ansi texte={degrade('─'.repeat(width))} /></box>}
            <box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" flexDirection="row">
                {disp.laterale === 'droite' && zone}
                {colonneVisible && <Colonne d={d} largeur={lateral} cote={disp.laterale}
                    bord={{
                        debut: (e: any) => {
                            const x = disp.laterale === 'droite' ? width - lateral : lateral - 1;
                            if (e.button === 0 && Math.abs(e.x - x) <= 1) glisse.current = true;
                        },
                        glisser: (e: any) => glisse.current && redimensionner(disp.laterale === 'droite' ? width - e.x : e.x + 1, false),
                        fin: () => {
                            if (!glisse.current) return;
                            glisse.current = false;
                            redimensionner(lateral, true);
                        },
                    }} selection={selection} choisir={choisirCarte} tic={tic} espace={espace} setEspace={setEspace}
                    projets={projets} lancer={(cmd: string) => void ouvrirDepuisClic(cmd)} ouvrirMenu={ouvrirMenu} detail={detail}
                    ouvrirDetail={(dt: any) => {
                        if (demandeRef.current?.type === 'vue') demandeRef.current.resoudre();
                        ouvrirDetail(dt);
                    }}
                    maitre={{ etat: etatMaitre(), actif: modeMaitre, claude: lireEtatClaude().etat, basculer: () => setModeMaitre((v) => !v) }}
                    grille={{ actif: vueZone === 'grille', basculer: () => (vueZone === 'grille' ? setVueZone(undefined) : ouvrirZone('grille')) }} />}
                {disp.laterale !== 'droite' && zone}
            </box>
            {quelleTouche !== undefined && <QuelleTouche chemin={quelleTouche} choisir={toucheQT} />}
            {!barreDansChat && saisie}
        </box>
    );
}

if (import.meta.main) {
    installerDiagnostics();
    // « sp commit saniplan » : exécute la commande dans l'interface puis quitte
    const commandeInitiale = process.argv.slice(2).join(' ').trim() || undefined;
    // Première fois sur ce poste : l'assistant demande l'essentiel ; juste après l'installation (CLAUDETOPIA_SCAN) : le scan du poste
    const auDemarrage = premierLancement || preparationAReprendre() ? '/preparer' : process.env.CLAUDETOPIA_SCAN ? '/scan' : undefined;
    // Le vrai point d'entrée peut aussi être exercé dans un terminal de test,
    // sans lancer la collecte du poste, le moteur ou la maintenance du bureau.
    if (process.env.CLAUDETOPIA_TEST_UI !== '1') {
        demarrerCollecte();
        if (!commandeInitiale) demarrerNotifications();
        const { remplacerAncienRaccourci, prechargerBureau } = await import('../dist/configCommandes.js');
        setTimeout(remplacerAncienRaccourci, 3000);
        setTimeout(prechargerBureau, 3500);
        // Notifications cliquables : le lien claudetopia: ouvre la session concernée
        setTimeout(() => void import('../dist/notifications.js').then((n: any) => n.surveillerLiens()), 2000);
        // Terminaux installés détectés en avance : le premier clic droit s'ouvre sans attendre
        setTimeout(() => void import('../dist/terminaux.js').then((t: any) => t.terminaux()), 2500);
        process.on('exit', () => void import('../dist/maitre.js').then((m: any) => m.arreterMaitre()));
    }
    const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, enableMouseMovement: true, consoleMode: 'disabled', openConsoleOnError: false, autoFocus: false });
    // Tout ce que les commandes écrivent va au journal (affiché dans « Dernières sorties » et /sorties)
    capturerConsole();
    // Windows : clics et molette (entrée VT de la console), noté dans le journal
    const etatConsole = activerEntreeVT();
    if (etatConsole) console.log(c.discret(etatConsole));
    process.on('exit', restaurerConsole);
    // claude attach, ssh, connexion : on rend le terminal au programme, puis on le reprend
    definirPassage(async () => {
        await renderer.suspend();
        process.stdout.write('\x1b[2J\x1b[H');
    }, async () => {
        await renderer.resume();
        activerEntreeVT();
    });
    const quitter = () => {
        renderer.destroy();
        restaurerConsole();
        process.exit(0);
    };
    createRoot(renderer).render(<App quitter={quitter} commandeInitiale={commandeInitiale} auDemarrage={auDemarrage} accueil={!commandeInitiale && !auDemarrage} />);
}

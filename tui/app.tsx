// Claudetopia sous OpenTUI : même style que l'interface Ink, avec les mêmes données et les mêmes commandes.
// Lancer : bun tui/app.tsx   (Ctrl+C pour quitter)
import * as fs from 'fs';
import * as path from 'path';
import { useEffect, useRef, useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
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
import { Journal } from './journal.tsx';
import { QuelleTouche } from './quelleTouche.tsx';
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
import { imageDuPressePapiers, joindreImages, fichiersDeposes, EST_IMAGE } from '../dist/ui/pressePapiers.js';
import { chargerConfig, chargerHistorique, ajouterHistorique, sauverConfig, premierLancement } from '../dist/config.js';
import { theme, fond, couleurProjet, degrade, c } from '../dist/theme.js';

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
export function App({ quitter, commandeInitiale, auDemarrage }: { quitter: () => void; commandeInitiale?: string; auDemarrage?: string }) {
    useVersion(surMajDonnees);
    useVersion(surJournal);
    useVersion(surMaitre);
    useVersion(surDisposition);
    const disp = disposition();
    const d = lireDonnees();
    const { width, height } = useTerminalDimensions();
    const [selection, setSelectionEtat] = useState<string>();
    // Panneau de détail (projet, serveur, conteneur) : il remplace la conversation dans la zone principale, et inversement
    const [detail, setDetailEtat] = useState<any>();
    const setSelection = (cle?: string) => {
        if (cle) setDetailEtat(undefined);
        setSelectionEtat(cle);
    };
    const ouvrirDetail = (dt?: any) => {
        if (dt) setSelectionEtat(undefined);
        setDetailEtat(dt);
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
    const [valeur, setValeurEtat] = useState('');
    // Valeur réelle de la barre, à jour à chaque frappe : le clavier la lit (l'état React peut avoir une frappe de retard)
    const valeurRef = useRef('');
    const setValeur = (v: string) => {
        valeurRef.current = v;
        setValeurEtat(v);
    };
    const [cle, setCle] = useState(0);
    const [indexSugg, setIndexSugg] = useState(0);
    const posHistorique = useRef(-1);
    const [survolHaut, setSurvolHaut] = useState<string>();
    const [projets] = useState(() => getProjets());
    const [quelleTouche, setQuelleTouche] = useState<string>();
    const [modeMaitre, setModeMaitre] = useState(false);
    const ctrlC = useRef(0);
    // La vue affichée (la commande qui l'a ouverte) : gardée pour la rouvrir au prochain lancement
    const [vueActive, setVueActive] = useState<string>();
    const commandeCourante = useRef<string>();
    // Ctrl+F : chercher dans la conversation ouverte (Entrée = occurrence suivante, en remontant le temps)
    const [recherche, setRecherche] = useState(false);
    const [occurrence, setOccurrence] = useState(0);
    const [trouvees, setTrouvees] = useState(0);
    // Images et fichiers joints (Alt+V, ou glissés dans la fenêtre) : envoyés avec le texte
    const [images, setImages] = useState<string[]>([]);
    // Largeur de la colonne (0 = automatique) : Alt+←/→ ou glisser sa bordure, gardée dans la config
    const [largeurCol, setLargeurCol] = useState<number>(() => chargerConfig().largeurLaterale || 0);
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
    const suggestions = calculerSuggestions(valeur);
    const sugg = Math.min(indexSugg, Math.max(0, suggestions.length - 1));

    const remplacer = (texte: string) => {
        setValeur(texte);
        setCle((k) => k + 1);
        setIndexSugg(0);
    };

    // silencieux : lancé par un clic, une action ou une vue ; la commande n'est ni affichée ni gardée dans l'historique
    async function lancer(ligne: string, silencieux = false, puisQuitter = false) {
        let texte = ligne.trim();
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
        if (texte && !cmd?.cache && !silencieux) {
            historique.unshift(texte);
            ajouterHistorique(texte);
        }
        // Une commande ordinaire affiche son résultat dans le journal : on referme la conversation ouverte
        if (!cmd?.cache) setSelection(undefined);
        if (images.length) {
            texte = joindreImages(texte, images);
            setImages([]);
        }
        if (!silencieux) console.log(`\n${c.accent('❯')} ${ligne.trim() || c.discret('(menu)')}`);
        commandeCourante.current = texte.split(' ')[0] === '/ssh' && texte.split(' ')[1] === 'vue' ? texte : texte.split(' ').slice(0, 2).join(' ');
        setOccupe(true);
        try {
            await (silencieux ? executerLigne(texte) : avecRetrait(() => executerLigne(texte)));
        } catch (err) {
            if (err instanceof Annule || (err as Error)?.name === 'Annule') {
                if (!silencieux) console.log(c.discret('Annulé'));
            } else console.log(c.erreur(`✗ ${(err as Error).message}`));
        } finally {
            rafraichirProjets();
            rafraichirAgents();
            setOccupe(false);
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
        if (!(await fermerOuvert())) return void bus.emit('notice', `Une commande est encore en cours (${commandeCourante.current ?? '…'}) : attends qu'elle finisse`);
        void lancerRef.current(cmd, true);
    }
    // Choisir une carte referme la vue ouverte : sinon la conversation resterait cachée derrière
    const choisirCarte = (cle?: string) => {
        if (cle && demandeRef.current?.type === 'vue') demandeRef.current.resoudre();
        setSelection(cle);
    };
    const ouvrirDetailRef = useRef(ouvrirDetail);
    ouvrirDetailRef.current = ouvrirDetail;

    function soumettre(v: string) {
        if (recherche) return setOccurrence((o) => o + 1);
        const s = suggestions[sugg];
        if (s) {
            if (s.executer) {
                remplacer('');
                void lancer(s.texte);
            } else remplacer(s.texte);
            return;
        }
        // Entrée sur une ligne vide avec une session d'arrière-plan ouverte : on la rejoint
        if (!v.trim() && session?.arrierePlan) return void lancer(`/rejoindre ${session.id}`, true);
        remplacer('');
        posHistorique.current = -1;
        // Mode maître : le texte est une demande au maître (les commandes / et ! restent des commandes)
        if (modeMaitre && v.trim() && !/^[/!]/.test(v.trim())) return void parlerAuMaitre(v.trim());
        // Une conversation est ouverte et ce n'est ni une commande ni du shell : le texte lui est envoyé
        if (session && v.trim() && !/^[/!]/.test(v.trim())) {
            console.log(`\n${c.accent('❯')} ${v.trim()} ${c.discret(`→ ${session.nom}`)}`);
            return void lancer(`/envoyer ${session.sessionId} ${v.trim()}`, true);
        }
        void lancer(v);
    }

    // Un fichier glissé dans la fenêtre : son chemin est collé dans la barre, il devient une pièce jointe
    function surSaisie(v: string) {
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
    async function parlerAuMaitre(texte: string) {
        if (etatMaitre().enCours) return void bus.emit('notice', '◈ le maître réfléchit encore : attends sa réponse');
        const e = await demanderAuMaitre(texte, getProjets().map((p: any) => p.nom), session?.id ?? session?.sessionId);
        console.log(`\n${c.violet('◈')} ${texte}`);
        if (e.erreur) return console.log(c.erreur(`  ✕ ${e.erreur}`));
        console.log(`  ${e.reponse}`);
        const commandes: string[] = e.commandes ?? [];
        const destructrices = commandes.filter((x) => DESTRUCTRICES.has(x.split(/\s+/)[0]));
        if (destructrices.length && !(await confirmer(`◈ Le maître va ${destructrices.map(decrire).join(', ')} : d'accord ?`))) {
            return console.log(c.discret('  annulé'));
        }
        for (const commande of commandes) {
            const avecOui = DESTRUCTRICES.has(commande.split(/\s+/)[0]) && !commande.includes('--oui') ? `${commande} --oui` : commande;
            await lancerRef.current(avecOui, true);
        }
    }
    // Claude prêt : le maître se prépare en fond (comme l'interface Ink)
    useEffect(() => {
        const surClaude = (etat: string) => {
            if (etat === 'pret') setTimeout(() => void prechauffer(getProjets().map((p: any) => p.nom)), 3000);
        };
        etatClaude.on('maj', surClaude);
        const t = setTimeout(() => void verifierClaude(), 300);
        return () => {
            etatClaude.off('maj', surClaude);
            clearTimeout(t);
        };
    }, []);

    // ─── Reprendre là où on en était : la conversation ouverte ou la vue affichée ───
    useEffect(() => {
        if (sansReprise()) return;
        const t = setTimeout(() => {
            try {
                fs.writeFileSync(CHEMINS.etat, JSON.stringify({ session: selection, vue: demande?.type === 'vue' ? vueActive : undefined }), 'utf-8');
            } catch {
                // pas grave
            }
        }, 400);
        return () => clearTimeout(t);
    }, [selection, demande, vueActive]);
    const repris = useRef(false);
    useEffect(() => {
        if (repris.current || commandeInitiale || auDemarrage || sansReprise()) return;
        // On attend que les sessions soient lues (ou 4 s), puis on rouvre une seule fois
        if (!d.agents.length && Date.now() - debutApp < 4000) return;
        repris.current = true;
        let etat: { session?: string; vue?: string } = {};
        try {
            etat = JSON.parse(fs.readFileSync(CHEMINS.etat, 'utf-8'));
        } catch {
            return;
        }
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
            console.log(c.erreur(`✗ « ${commandeInitiale} » n'est pas une commande Claudetopia : rien n'est lancé`));
            setTimeout(quitter, 1500);
        }
        else if (commandeInitiale) void lancerRef.current(commandeInitiale, false, true);
        else if (auDemarrage) void lancerRef.current(auDemarrage);
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
            setNotice(t);
            clearTimeout(minuterie);
            minuterie = setTimeout(() => setNotice(undefined), 6000);
        };
        const surSelection = (id: string) => setASelectionner(id);
        const surDetail = (dt: any) => setTimeout(() => ouvrirDetailRef.current(dt), 50);
        const surPleinEcran = (v: boolean) => setPleinEcran(v);
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
        // Ctrl+C : vide la saisie ; deux fois de suite pour quitter
        if (k.ctrl && k.name === 'c') {
            if (valeurRef.current) return remplacer('');
            if (Date.now() - ctrlC.current < 1500) return quitter();
            ctrlC.current = Date.now();
            return void bus.emit('notice', 'Ctrl+C encore une fois pour quitter');
        }
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
            return remplacer('');
        }
        if (occupe) return;
        if (k.ctrl && k.name === 'f' && session) {
            setRecherche(true);
            setOccurrence(0);
            return remplacer('');
        }
        // Alt+V : l'image du presse-papiers devient une pièce jointe
        if (alt && k.name === 'v') {
            const chemin = imageDuPressePapiers();
            if (!chemin) return void bus.emit('notice', 'Pas d\'image dans le presse-papiers');
            setImages([...images, chemin]);
            const v = valeurRef.current;
            return remplacer(`${v}${v && !v.endsWith(' ') ? ' ' : ''}[image ${images.length + 1}] `);
        }
        if (alt && (k.name === 'left' || k.name === 'right')) return redimensionner(lateral + (k.name === 'right' ? 2 : -2), true);
        if (k.ctrl && k.name === 'k') return void lancer('/palette', true);
        if (alt && k.name === 'm') return setModeMaitre((v) => !v);
        if (alt && k.name === 't') return void lancer('/terminal', true);
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
            if (journalOuvert) return setJournalOuvert(false);
            return;
        }
        if (k.name === 'tab' && suggestions[sugg]) return remplacer(suggestions[sugg].texte);
        if (k.name === 'up' || k.name === 'down') {
            const sens = k.name === 'up' ? -1 : 1;
            if (suggestions.length) return setIndexSugg(Math.max(0, Math.min(Math.min(8, suggestions.length) - 1, sugg + sens)));
            // Historique : ↑ remonte, ↓ redescend
            const p = Math.max(-1, Math.min(historique.length - 1, posHistorique.current - sens));
            posHistorique.current = p;
            setValeur(p < 0 ? '' : historique[p]);
            setCle((x) => x + 1);
        }
    });

    function indication(): { texte: string; couleur: string } {
        if (tache) return { texte: `${SPINNER[tic % SPINNER.length]} ${tache}…`, couleur: theme.accent };
        if (notice) return { texte: notice, couleur: theme.secondaire };
        if (occupe) return { texte: 'commande en cours…', couleur: 'gray' };
        const t = valeur.trim();
        if (recherche) {
            return { texte: `⌕ chercher dans la conversation : ${t.length < 2 ? 'tape au moins 2 lettres' : trouvees ? `${(occurrence % trouvees) + 1}/${trouvees} · Entrée = suivante` : 'aucun résultat'} · Échap fermer`, couleur: theme.secondaire };
        }
        if (images.length && !t.startsWith('/')) return { texte: `📎 ${images.length} pièce(s) jointe(s) envoyée(s) avec le texte`, couleur: theme.accent };
        if (t.startsWith('/')) return { texte: 'commande du CLI', couleur: 'gray' };
        if (modeMaitre) {
            return etatMaitre().enCours
                ? { texte: '◈ le maître réfléchit… attends sa réponse', couleur: '#a78bfa' }
                : { texte: '◈ au maître : il gère tes sessions (fermer, relancer, écrire, créer, résumer…) · Échap pour revenir', couleur: '#a78bfa' };
        }
        if (t.startsWith('!')) return { texte: `commande PowerShell dans ${path.basename(process.cwd())}`, couleur: theme.accent };
        if (session) {
            if (!session.arrierePlan) return { texte: `${session.nom} tourne dans un onglet : écris-y, ou « ⑂ Continuer ici » pour lui écrire d'ici`, couleur: '#facc15' };
            if (session.statut === 'travaille') return { texte: `${session.nom} travaille : attends qu'il ait fini pour lui écrire, ou Entrée pour le rejoindre`, couleur: '#facc15' };
            if (session.statut === 'bloquee') return { texte: `${session.nom} attend une permission : Entrée pour le rejoindre et répondre`, couleur: '#fb923c' };
            return { texte: `↳ envoyé à la conversation ${session.nom} (${session.titre || session.id})${t ? '' : ' · Entrée vide = la rejoindre'}`, couleur: couleurProjet(session.nom) };
        }
        return { texte: `↳ nouvelle session Claude dans ${path.basename(process.cwd())} · Ctrl+K pour tout le reste`, couleur: fond.discret };
    }

    const colonneVisible = !pleinEcran && disp.laterale !== 'cachee';
    const lateral = !colonneVisible ? 0
        : largeurCol ? Math.max(LATERAL_MIN, Math.min(width - 50, largeurCol)) : Math.max(32, Math.min(56, Math.floor(width / 3)));
    const principal = width - lateral;
    // Début de la zone principale (pour le clic dans le cockpit) : après la colonne si elle est à gauche
    const debutZone = disp.laterale === 'gauche' ? lateral : 0;
    const nbSugg = Math.min(8, suggestions.length);
    const corps = height - 2 - 4 - nbSugg - (quelleTouche !== undefined ? 2 + Math.ceil(Object.keys(noeudA(quelleTouche).enfants).length / 3) : 0);

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
                <Conversation s={session} largeur={principal} cout={d.cout.parSession[session.sessionId]} agir={agir} position={disp.actions}
                    recherche={recherche ? valeur.trim() : ''} occurrence={occurrence} surTrouvees={setTrouvees} />
            </box>
        );
    } else if (journalOuvert) zone = <box flexGrow={1} onMouseDown={(e: any) => droit(e) && ouvrirMenu(menuJournal(parler))}><Journal /></box>;
    else {
        const cockpit = lignesCockpit(d, principal - 1, corps);
        zone = (
            <box flexGrow={1} flexDirection="column" paddingLeft={1}
                onMouseDown={(e: any) => {
                    if (droit(e)) return void ouvrirMenu({ titre: 'Claudetopia', articles: general(parler) });
                    const cible = cockpit.cible(e.x - debutZone - 1, e.y - 2);
                    if (cible === JOURNAL) setJournalOuvert(true);
                    else if (cible) setSelection(cible);
                }}>
                {cockpit.lignes.slice(0, corps - 1).map((l: string, i: number) => <Ansi key={i} texte={l} />)}
                <text fg={fond.discret}>{'  clic sur « À faire » pour ouvrir la session · sur « Dernières sorties » pour le journal complet'}</text>
            </box>
        );
    }

    return (
        <box width={width} height={height} flexDirection="column" backgroundColor="#0c0c0c">
            <box height={1} flexShrink={0} flexDirection="row" onMouseDown={(e: any) => droit(e) && ouvrirMenu({ titre: 'Claudetopia', articles: general(parler) })}>
                <Ansi texte={degrade(' ✻ ' + (chargerConfig().banniere || 'CLAUDETOPIA').toUpperCase() + ' ')} />
                {BOUTONS.map((b) => (
                    <text key={b.action} onMouseOver={() => setSurvolHaut(b.action)} onMouseOut={() => setSurvolHaut(undefined)}
                        onMouseDown={() => void ouvrirDepuisClic(b.action)}
                        fg={survolHaut === b.action ? fond.texte : fond.eteint} attributes={survolHaut === b.action ? GRAS : 0}>
                        {/* Icônes cachées (/ecran) : seulement les noms */}
                        {`  ${disp.icones || b.label === '⋯' ? b.label : b.label.split(' ').slice(1).join(' ')} `}
                    </text>
                ))}
            </box>
            <box height={1} flexShrink={0}><Ansi texte={degrade('─'.repeat(width))} /></box>
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
                    maitre={{ etat: etatMaitre(), actif: modeMaitre, claude: lireEtatClaude().etat, basculer: () => setModeMaitre((v) => !v) }} />}
                {disp.laterale !== 'droite' && zone}
            </box>
            {quelleTouche !== undefined && <QuelleTouche chemin={quelleTouche} choisir={toucheQT} />}
            <Barre valeur={valeur} cle={cle} setValeur={surSaisie} soumettre={soumettre} suggestions={recherche ? [] : suggestions} indexSugg={sugg}
                choisirSugg={(i) => (suggestions[i]?.executer ? (remplacer(''), void lancer(suggestions[i].texte)) : remplacer(suggestions[i].texte))}
                indication={indication()} actif={!demande && quelleTouche === undefined} maitre={modeMaitre} />
        </box>
    );
}

if (import.meta.main) {
    // « sp commit saniplan » : exécute la commande dans l'interface puis quitte
    const commandeInitiale = process.argv.slice(2).join(' ').trim() || undefined;
    // Première fois sur ce poste : l'assistant demande l'essentiel
    const auDemarrage = premierLancement ? '/bienvenue' : undefined;
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
    const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, enableMouseMovement: true, consoleMode: 'disabled', autoFocus: false });
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
    createRoot(renderer).render(<App quitter={quitter} commandeInitiale={commandeInitiale} auDemarrage={auDemarrage} />);
}

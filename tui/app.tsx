// Claudetopia sous OpenTUI : même style que l'interface Ink, avec les mêmes données et les mêmes commandes.
// Lancer : bun tui/app.tsx   (Ctrl+C pour quitter)
import * as path from 'path';
import { useEffect, useRef, useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { Ansi } from './ansi.tsx';
import { GRAS } from './style.ts';
import { Colonne } from './colonne.tsx';
import { Conversation } from './conversation.tsx';
import { Choix, Saisie, VueNonMigree } from './dialogues.tsx';
import { Barre } from './barre.tsx';
import { Journal } from './journal.tsx';
import { demarrerCollecte, lireDonnees, surMajDonnees, rafraichirAgents } from '../dist/ui/donnees.js';
import { lignesCockpit, JOURNAL } from '../dist/ui/Cockpit.js';
import { bus, Annule } from '../dist/ui/bus.js';
import { journal, lignesJournal, avecRetrait, vider, capturerConsole } from '../dist/ui/journal.js';
import { definirPassage } from '../dist/ui/ecran.js';
import { calculerSuggestions, commandeSession } from '../dist/ui/saisie.js';
import { executerLigne, trouverCommande, rafraichirProjets, getProjets } from '../dist/commandes.js';
import { chargerConfig, chargerHistorique, ajouterHistorique } from '../dist/config.js';
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

export function App({ quitter }: { quitter: () => void }) {
    useVersion(surMajDonnees);
    useVersion(surJournal);
    const d = lireDonnees();
    const { width, height } = useTerminalDimensions();
    const [selection, setSelection] = useState<string>();
    const [aSelectionner, setASelectionner] = useState<string>();
    const [espace, setEspace] = useState('sessions');
    const [demande, setDemande] = useState<any>();
    const [tache, setTache] = useState<string>();
    const [notice, setNotice] = useState<string>();
    const [occupe, setOccupe] = useState(false);
    const [journalOuvert, setJournalOuvert] = useState(false);
    const [valeur, setValeur] = useState('');
    const [cle, setCle] = useState(0);
    const [indexSugg, setIndexSugg] = useState(0);
    const posHistorique = useRef(-1);
    const [survolHaut, setSurvolHaut] = useState<string>();
    const [projets] = useState(() => getProjets());

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
    async function lancer(ligne: string, silencieux = false) {
        const texte = ligne.trim();
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
        if (!silencieux) console.log(`\n${c.accent('❯')} ${texte || c.discret('(menu)')}`);
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
        }
    }
    const lancerRef = useRef(lancer);
    lancerRef.current = lancer;

    function soumettre(v: string) {
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
        // Une conversation est ouverte et ce n'est ni une commande ni du shell : le texte lui est envoyé
        if (session && v.trim() && !/^[/!]/.test(v.trim())) {
            console.log(`\n${c.accent('❯')} ${v.trim()} ${c.discret(`→ ${session.nom}`)}`);
            return void lancer(`/envoyer ${session.sessionId} ${v.trim()}`, true);
        }
        void lancer(v);
    }

    function agir(action: string) {
        if (action === 'fermer') return setSelection(undefined);
        const cmd = session && commandeSession(action, session);
        if (cmd && libre) void lancer(cmd, true);
    }

    // Ce que les commandes demandent à l'interface (bus.ts)
    useEffect(() => {
        let minuterie: ReturnType<typeof setTimeout> | undefined;
        const surDemande = (x?: any) => setDemande(x);
        const surTache = (t?: string) => setTache(t);
        const surNotice = (t: string) => {
            setNotice(t);
            clearTimeout(minuterie);
            minuterie = setTimeout(() => setNotice(undefined), 6000);
        };
        const surSelection = (id: string) => setASelectionner(id);
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
        if (demande) return;   // les dialogues gèrent leurs touches
        if (k.name === 'escape') {
            if (valeur) return remplacer('');
            if (session) return setSelection(undefined);
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
        if (t.startsWith('/')) return { texte: 'commande du CLI', couleur: 'gray' };
        if (t.startsWith('!')) return { texte: `commande PowerShell dans ${path.basename(process.cwd())}`, couleur: theme.accent };
        if (session) {
            if (!session.arrierePlan) return { texte: `${session.nom} tourne dans un onglet : écris-y, ou « ⑂ Continuer ici » pour lui écrire d'ici`, couleur: '#facc15' };
            if (session.statut === 'travaille') return { texte: `${session.nom} travaille : attends qu'il ait fini pour lui écrire, ou Entrée pour le rejoindre`, couleur: '#facc15' };
            if (session.statut === 'bloquee') return { texte: `${session.nom} attend une permission : Entrée pour le rejoindre et répondre`, couleur: '#fb923c' };
            return { texte: `↳ envoyé à la conversation ${session.nom} (${session.titre || session.id})${t ? '' : ' · Entrée vide = la rejoindre'}`, couleur: couleurProjet(session.nom) };
        }
        return { texte: `↳ nouvelle session Claude dans ${path.basename(process.cwd())} · Ctrl+K pour tout le reste`, couleur: fond.discret };
    }

    const lateral = Math.max(32, Math.min(56, Math.floor(width / 3)));
    const principal = width - lateral;
    const nbSugg = Math.min(8, suggestions.length);
    const corps = height - 2 - 4 - nbSugg;

    let zone;
    if (demande?.type === 'choix') zone = <Choix d={demande} hauteur={corps} />;
    else if (demande?.type === 'saisie') zone = <box flexGrow={1} flexDirection="column"><Saisie d={demande} /></box>;
    else if (demande?.type === 'vue') zone = <VueNonMigree d={demande} />;
    else if (session) zone = <Conversation s={session} largeur={principal} cout={d.cout.parSession[session.sessionId]} agir={agir} />;
    else if (journalOuvert) zone = <Journal />;
    else {
        const cockpit = lignesCockpit(d, principal - 1, corps);
        zone = (
            <box flexGrow={1} flexDirection="column" paddingLeft={1}
                onMouseDown={(e: any) => {
                    const cible = cockpit.cible(e.x - lateral - 1, e.y - 2);
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
            <box height={1} flexDirection="row">
                <Ansi texte={degrade(' ✻ ' + (chargerConfig().banniere || 'CLAUDETOPIA').toUpperCase() + ' ')} />
                {BOUTONS.map((b) => (
                    <text key={b.action} onMouseOver={() => setSurvolHaut(b.action)} onMouseOut={() => setSurvolHaut(undefined)}
                        onMouseDown={() => libre && lancer(b.action, true)}
                        fg={survolHaut === b.action ? fond.texte : fond.eteint} attributes={survolHaut === b.action ? GRAS : 0}>{`  ${b.label} `}</text>
                ))}
            </box>
            <Ansi texte={degrade('─'.repeat(width))} />
            <box flexGrow={1} flexDirection="row">
                <Colonne d={d} largeur={lateral} selection={selection} choisir={setSelection} tic={tic} espace={espace} setEspace={setEspace}
                    projets={projets} lancer={(cmd: string) => libre && lancer(cmd, true)} />
                {zone}
            </box>
            <Barre valeur={valeur} cle={cle} setValeur={(v) => {
                setValeur(v);
                setIndexSugg(0);
            }} soumettre={soumettre} suggestions={suggestions} indexSugg={sugg}
                choisirSugg={(i) => (suggestions[i]?.executer ? (remplacer(''), void lancer(suggestions[i].texte)) : remplacer(suggestions[i].texte))}
                indication={indication()} actif={!demande} />
        </box>
    );
}

if (import.meta.main) {
    demarrerCollecte();
    const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true, enableMouseMovement: true, consoleMode: 'disabled' });
    // Tout ce que les commandes écrivent va au journal (affiché dans « Dernières sorties » et /sorties)
    capturerConsole();
    // claude attach, ssh, connexion : on rend le terminal au programme, puis on le reprend
    definirPassage(async () => {
        await renderer.suspend();
        process.stdout.write('\x1b[2J\x1b[H');
    }, async () => {
        await renderer.resume();
    });
    const quitter = () => {
        renderer.destroy();
        process.exit(0);
    };
    createRoot(renderer).render(<App quitter={quitter} />);
}

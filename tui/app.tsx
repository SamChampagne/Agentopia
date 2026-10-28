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
import { VUES } from './vues/index.ts';
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
const surMaitre = (f: () => void) => {
    maitre.on('maj', f);
    etatClaude.on('maj', f);
    return () => {
        maitre.off('maj', f);
        etatClaude.off('maj', f);
    };
};
const droit = (e: any) => e?.button === 2;

export function App({ quitter }: { quitter: () => void }) {
    useVersion(surMajDonnees);
    useVersion(surJournal);
    useVersion(surMaitre);
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
    const [quelleTouche, setQuelleTouche] = useState<string>();
    const [modeMaitre, setModeMaitre] = useState(false);
    const ctrlC = useRef(0);

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
        // Mode maître : le texte est une demande au maître (les commandes / et ! restent des commandes)
        if (modeMaitre && v.trim() && !/^[/!]/.test(v.trim())) return void parlerAuMaitre(v.trim());
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
        // Ctrl+C : vide la saisie ; deux fois de suite pour quitter
        if (k.ctrl && k.name === 'c') {
            if (valeur) return remplacer('');
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
        if (k.name === 'space' && !valeur.trim() && !occupe && !modeMaitre) {
            remplacer('');
            return setQuelleTouche('');
        }
        if (k.sequence === '?' && !valeur.trim()) {
            remplacer('');
            return void lancer('/aide', true);
        }
        if (occupe) return;
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

    const lateral = Math.max(32, Math.min(56, Math.floor(width / 3)));
    const principal = width - lateral;
    const nbSugg = Math.min(8, suggestions.length);
    const corps = height - 2 - 4 - nbSugg - (quelleTouche !== undefined ? 2 + Math.ceil(Object.keys(noeudA(quelleTouche).enfants).length / 3) : 0);

    let zone;
    if (demande?.type === 'choix') zone = <Choix d={demande} hauteur={corps} />;
    else if (demande?.type === 'saisie') zone = <box flexGrow={1} flexDirection="column"><Saisie d={demande} /></box>;
    else if (demande?.type === 'vue') {
        // La commande décrit sa vue Ink (composant + paramètres) : on affiche notre version si elle existe
        const el = demande.rendu(demande.resoudre);
        const Vue = VUES[el?.type?.name];
        zone = Vue ? <Vue key={el.type.name} {...el.props} /> : <VueNonMigree d={demande} />;
    }
    else if (session) {
        zone = (
            <box flexGrow={1} onMouseDown={(e: any) => droit(e) && ouvrirMenu(menuSession(session, () => undefined))}>
                <Conversation s={session} largeur={principal} cout={d.cout.parSession[session.sessionId]} agir={agir} />
            </box>
        );
    } else if (journalOuvert) zone = <box flexGrow={1} onMouseDown={(e: any) => droit(e) && ouvrirMenu(menuJournal(parler))}><Journal /></box>;
    else {
        const cockpit = lignesCockpit(d, principal - 1, corps);
        zone = (
            <box flexGrow={1} flexDirection="column" paddingLeft={1}
                onMouseDown={(e: any) => {
                    if (droit(e)) return void ouvrirMenu({ titre: 'Claudetopia', articles: general(parler) });
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
            <box height={1} flexDirection="row" onMouseDown={(e: any) => droit(e) && ouvrirMenu({ titre: 'Claudetopia', articles: general(parler) })}>
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
                    projets={projets} lancer={(cmd: string) => libre && lancer(cmd, true)} ouvrirMenu={ouvrirMenu}
                    maitre={{ etat: etatMaitre(), actif: modeMaitre, claude: lireEtatClaude().etat, basculer: () => setModeMaitre((v) => !v) }} />
                {zone}
            </box>
            {quelleTouche !== undefined && <QuelleTouche chemin={quelleTouche} choisir={toucheQT} />}
            <Barre valeur={valeur} cle={cle} setValeur={(v) => {
                setValeur(v);
                setIndexSugg(0);
            }} soumettre={soumettre} suggestions={suggestions} indexSugg={sugg}
                choisirSugg={(i) => (suggestions[i]?.executer ? (remplacer(''), void lancer(suggestions[i].texte)) : remplacer(suggestions[i].texte))}
                indication={indication()} actif={!demande && quelleTouche === undefined} maitre={modeMaitre} />
        </box>
    );
}

if (import.meta.main) {
    demarrerCollecte();
    const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, enableMouseMovement: true, consoleMode: 'disabled' });
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

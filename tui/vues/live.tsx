import { useEffect, useRef, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { GRAS, ANIM, une, couper } from '../style.ts';
import { useDonnees } from '../donnees.ts';
import { Toile, RenduToile } from '../toile.tsx';
import { grandsChiffres } from '../chiffres.ts';
import { bus } from '../../dist/ui/bus.js';
import { decrireConnexion, lireDonnees } from '../../dist/ui/donnees.js';
import { serveursPertinents } from '../../dist/ui/Panneau.js';
import { etatEquipe, enPause } from '../../dist/ui/Laterale.js';
import { metriques, metriquesDe, suivreMetriques } from '../../dist/metriques.js';
import { avancement } from '../../dist/equipe.js';
import { rythme } from '../../dist/agents.js';
import { dollars } from '../../dist/cout.js';
import { theme, couleurProjet, fond, melange } from '../../dist/theme.js';

// Vue globale, en direct : un centre de contrôle.
// En haut, les grands chiffres ; puis le pouls de toutes les sessions sur la dernière heure ;
// en bas, les sessions en cartes interactives (courbe d'activité, contexte, actions), les serveurs en cartes à jauges, Docker et les équipes.
// Plein écran (la colonne de gauche disparaît) ; un clic ouvre la conversation ou le panneau de détail.

const NOIR = '#0c0c0c';
const VERT = '#4ade80', JAUNE = '#facc15', ORANGE = '#fb923c', ROUGE = '#f87171';
const STATUTS: Record<string, { t: string; c: string }> = { travaille: { t: 'travaille', c: VERT }, attend: { t: 't’attend', c: JAUNE }, bloquee: { t: 'bloquée', c: ORANGE }, terminee: { t: 'terminée', c: 'gray' } };

// Un grand nombre lisible (police 3 × 5 en demi-blocs, 3 lignes)
function GrandNombre({ n, couleur }: { n: string; couleur: string }) {
    return (
        <box flexDirection="column">
            {grandsChiffres(n).map((l, i) => <text key={i} fg={couleur} wrapMode="none">{l}</text>)}
        </box>
    );
}

// Une tuile : un titre discret, un grand nombre, une ligne d'explication ; le bord prend la couleur de ce qu'elle annonce
// extra : deux lignes à droite du grand nombre (qui travaille, quels serveurs…)
function Tuile({ titre, n, suite = '', sous, couleur, vif, largeur, extra = [] }: {
    titre: string; n: string; suite?: string; sous: string; couleur: string; vif?: boolean; largeur: number; extra?: { t: string; c?: string }[][];
}) {
    return (
        <box width={largeur} height={7} border borderStyle="rounded" borderColor={vif ? couleur : melange(NOIR, couleur, 0.45)} flexDirection="column" paddingLeft={1}>
            <text fg={fond.eteint} wrapMode="none" truncate>{titre}</text>
            <box flexDirection="row">
                <box flexShrink={0}><GrandNombre n={n} couleur={couleur} /></box>
                {/* L'unité ($) en face de la ligne du bas des chiffres */}
                {suite && <box flexShrink={0} flexDirection="column"><text> </text><text> </text><text fg={couleur} attributes={GRAS}>{` ${suite}`}</text></box>}
                {/* Le détail seulement s'il reste au moins 12 colonnes à côté du nombre */}
                {largeur - grandsChiffres(n)[0].length - (suite ? suite.length + 1 : 0) - 6 >= 12 && (
                    <box flexDirection="column" flexGrow={1} paddingLeft={2} overflow="hidden">
                        {extra.slice(0, 3).map((l, i) => <text key={i} wrapMode="none" truncate>{l.map((m, k) => <span key={k} fg={m.c}>{m.t}</span>)}</text>)}
                    </box>
                )}
            </box>
            <text fg={vif ? couleur : fond.discret} wrapMode="none">{couper(sous, largeur - 4)}</text>
        </box>
    );
}

// Le pouls : l'activité de toutes les sessions, minute par minute, sur la dernière heure (courbe pleine en braille)
function Pouls({ d, largeur, hauteur, tic }: { d: any; largeur: number; hauteur: number; tic: number }) {
    const minutes = 60;
    const total = new Array(minutes).fill(0);
    for (const a of d.activites.values()) rythme(a?.horaires, minutes).forEach((v: number, i: number) => (total[i] += v));
    const toile = new Toile(Math.max(20, largeur), hauteur);
    const max = Math.max(4, ...total);
    const valeur = (x: number) => {
        // Interpolation entre deux minutes : une courbe douce plutôt que des marches
        const p = (x / (toile.largeurPx - 1)) * (minutes - 1);
        const i = Math.floor(p), f = p - i;
        return (total[i] * (1 - f) + (total[Math.min(minutes - 1, i + 1)] ?? 0) * f) / max;
    };
    for (let x = 0; x < toile.largeurPx; x++) {
        const v = valeur(x);
        // Rien cette minute-là : seulement une ligne de base en pointillé
        if (v <= 0.001) {
            if (x % 4 === 0) toile.point(x, toile.hauteurPx - 1, fond.bordure, 0);
            continue;
        }
        const haut = Math.min(toile.hauteurPx - 2, Math.round((1 - v) * (toile.hauteurPx - 1)));
        for (let y = toile.hauteurPx - 1; y >= haut; y--) {
            // Plein en bas, plus clair vers le sommet ; la crête en couleur d'accent
            const crete = y === haut;
            toile.point(x, y, crete ? theme.accent : melange(NOIR, theme.primaire, 0.25 + 0.5 * (1 - y / toile.hauteurPx)), crete ? 2 : 1);
        }
    }
    // Le « maintenant » pulse au bout de la courbe
    const yFin = Math.round((1 - valeur(toile.largeurPx - 1)) * (toile.hauteurPx - 1));
    for (let dy = -1; dy <= 1; dy++) toile.point(toile.largeurPx - 1 - (tic % 2), yFin + dy, '#ffffff', 3);
    const parMinute = total[minutes - 1];
    return (
        <box flexDirection="column" flexShrink={0}>
            <box height={1} flexDirection="row">
                <text fg={theme.primaire} attributes={GRAS} flexGrow={1}>{' POULS · activité de toutes les sessions, dernière heure'}</text>
                <text fg="gray">{`${parMinute} message${parMinute > 1 ? 's' : ''} cette minute · pic ${Math.max(...total)}/min `}</text>
            </box>
            <box paddingLeft={1}><RenduToile toile={toile} /></box>
            <box height={1} flexDirection="row" paddingLeft={1}>
                <text fg={fond.discret} flexGrow={1}>−60 min</text>
                <text fg={fond.discret} flexGrow={1}>−30 min</text>
                <text fg={theme.accent}>maintenant </text>
            </box>
        </box>
    );
}

// Une jauge horizontale colorée selon le niveau
function Jauge({ nom, pct, largeur }: { nom: string; pct?: number; largeur: number }) {
    if (pct === undefined) return <text flexShrink={0} wrapMode="none" fg={fond.discret}>{`${nom} ${'·'.repeat(largeur)}  ? `}</text>;
    const plein = Math.round((Math.min(100, pct) / 100) * largeur);
    const c = pct > 85 ? ROUGE : pct > 65 ? JAUNE : VERT;
    return <text flexShrink={0} wrapMode="none"><span fg="gray">{`${nom} `}</span><span fg={c}>{'▰'.repeat(plein)}</span><span fg={fond.bordure}>{'▱'.repeat(largeur - plein)}</span><span fg={c}>{` ${String(Math.round(pct)).padStart(3)}% `}</span></text>;
}

// Courbe d'activité d'une session (30 dernières minutes), pleine, en braille, aux couleurs du projet
function Activite({ horaires, largeur, hauteur, couleur, vif }: { horaires?: number[]; largeur: number; hauteur: number; couleur: string; vif: boolean }) {
    const toile = new Toile(largeur, hauteur);
    const minutes = 30;
    const valeurs = rythme(horaires, minutes);
    const max = Math.max(3, ...valeurs);
    for (let x = 0; x < toile.largeurPx; x++) {
        const p = (x / (toile.largeurPx - 1)) * (minutes - 1);
        const i = Math.floor(p), f = p - i;
        const v = (valeurs[i] * (1 - f) + (valeurs[Math.min(minutes - 1, i + 1)] ?? 0) * f) / max;
        if (v <= 0.001) {
            if (x % 4 === 0) toile.point(x, toile.hauteurPx - 1, fond.bordure, 0);
            continue;
        }
        const haut = Math.min(toile.hauteurPx - 2, Math.round((1 - v) * (toile.hauteurPx - 1)));
        for (let y = toile.hauteurPx - 1; y >= haut; y--) toile.point(x, y, y === haut ? (vif ? '#ffffff' : couleur) : melange(NOIR, couleur, 0.35 + 0.4 * (1 - y / toile.hauteurPx)), y === haut ? 2 : 1);
    }
    return <RenduToile toile={toile} />;
}

// Une session en carte : son état, sa courbe d'activité, son contexte, ce qu'elle fait ;
// au survol ou à la sélection (flèches), ses actions apparaissent en bas
function CarteSession({ s, a, cout, largeur, tic, choisie, survolee, agir, survoler }: {
    s: any; a: any; cout?: number; largeur: number; tic: number; choisie: boolean; survolee: boolean; agir: (action: string) => void; survoler: (oui: boolean) => void;
}) {
    const [bouton, setBouton] = useState<string>();
    const st = STATUTS[s.statut] ?? STATUTS.terminee;
    const projet = couleurProjet(s.nom);
    const travaille = s.statut === 'travaille', bloquee = s.statut === 'bloquee';
    // Le bord : accent si choisie, pulse aux couleurs du projet si elle travaille, orange qui clignote si elle t'attend
    const bord = choisie || survolee ? theme.accent : bloquee ? (tic % 2 ? ORANGE : '#7c2d12') : travaille ? (tic % 2 ? projet : melange(NOIR, projet, 0.5)) : melange(NOIR, projet, 0.4);
    const iw = largeur - 4;
    const action = s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : une(a?.dernierTexte ?? s.titre ?? 'pas encore d’activité');
    const ctx = a?.contexte;
    const limite = ctx ? (ctx > 200_000 ? 1_000_000 : 200_000) : 0;
    const part = ctx ? Math.min(1, ctx / limite) : 0;
    const lc = Math.max(4, Math.min(12, iw - 24));
    const repondable = bloquee && s.arrierePlan && s.question && !/permission/i.test(s.question);
    const boutons = [
        { cle: 'ouvrir', t: ' ↵ Ouvrir ' },
        ...(repondable ? [{ cle: 'repondre', t: ' ✎ Répondre ' }] : []),
        ...(s.arrierePlan ? [{ cle: 'cote', t: ' ⫿ À côté ' }] : []),
        { cle: 'changements', t: ' ± Diff ' },
    ];
    const depuis = a?.date ? Math.round((Date.now() - a.date.getTime()) / 60_000) : undefined;
    return (
        <box width={largeur} height={9} flexShrink={0} border borderStyle="rounded" borderColor={bord} flexDirection="column" paddingLeft={1} paddingRight={1}
            backgroundColor={choisie ? '#111827' : undefined}
            onMouseOver={() => survoler(true)} onMouseOut={() => survoler(false)} onMouseDown={() => agir('ouvrir')}>
            <box height={1} flexDirection="row">
                <text flexShrink={0} fg={st.c}>{travaille ? `${ANIM[tic % ANIM.length]} ` : bloquee ? '! ' : '○ '}</text>
                <text flexGrow={1} fg={projet} attributes={GRAS} wrapMode="none" truncate>{s.nom}</text>
                <text flexShrink={0} fg={st.c} attributes={bloquee ? GRAS : 0}>{` ${st.t}`}</text>
            </box>
            <text fg={fond.eteint} wrapMode="none">{couper(`${s.titre || s.id || ''} · ${s.arrierePlan ? 'arrière-plan' : 'onglet'}${cout ? ` · ${dollars(cout)}` : ''}`, iw)}</text>
            <Activite horaires={a?.horaires} largeur={iw} hauteur={2} couleur={projet} vif={travaille && tic % 2 === 0} />
            <text wrapMode="none">
                <span fg="gray">ctx </span>
                <span fg={part > 0.8 ? ROUGE : part > 0.5 ? JAUNE : VERT}>{'▰'.repeat(Math.round(part * lc))}</span>
                <span fg={fond.bordure}>{'▱'.repeat(lc - Math.round(part * lc))}</span>
                <span fg="gray">{ctx ? ` ${Math.round(ctx / 1000)}k` : ' ?'}</span>
                <span fg={fond.discret}>{depuis === undefined ? '' : depuis < 1 ? '  · à l’instant' : `  · il y a ${depuis} min`}</span>
            </text>
            <text fg={s.question ? '#fdba74' : '#cbd5e1'} wrapMode="none">{couper(action, iw)}</text>
            {/* Les actions : visibles quand la carte est survolée ou choisie au clavier */}
            {choisie || survolee ? (
                <box height={1} flexDirection="row" columnGap={1}>
                    {boutons.map((b) => (
                        <text key={b.cle} flexShrink={0} fg={bouton === b.cle ? NOIR : theme.accent} bg={bouton === b.cle ? theme.accent : undefined} attributes={GRAS}
                            onMouseOver={() => setBouton(b.cle)} onMouseOut={() => setBouton(undefined)}
                            onMouseDown={(e: any) => {
                                e?.stopPropagation?.();
                                agir(b.cle);
                            }}>{b.t}</text>
                    ))}
                </box>
            ) : (
                <text fg={a?.dernierUser ? theme.secondaire : fond.discret} wrapMode="none">{couper(a?.dernierUser ? `❯ ${une(a.dernierUser)}` : 'survole pour les actions', iw)}</text>
            )}
        </box>
    );
}

export function VueGlobale({ fermer }: { fermer: () => void }) {
    const { width, height } = useTerminalDimensions();
    const d = useDonnees();
    const [, setV] = useState(0);
    const [survol, setSurvol] = useState<string>();
    const tic = Math.floor(Date.now() / 800);
    useEffect(() => {
        bus.emit('plein-ecran', true);
        const f = () => setV((v) => v + 1);
        metriques.on('maj', f);
        // Les relevés des serveurs tournent tant que la vue est ouverte ; l'horloge fait avancer les animations
        const arreter = suivreMetriques(() => lireDonnees().serveurs);
        const horloge = setInterval(f, 800);
        return () => {
            bus.emit('plein-ecran', false);
            metriques.off('maj', f);
            arreter();
            clearInterval(horloge);
        };
    }, []);
    // Flèches : choisir une carte · Entrée : l'ouvrir · j : à côté · d : ses changements
    const [choix, setChoix] = useState(-1);
    const ordre = useRef<any[]>([]);
    const parLigne = useRef(1);
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        const n = ordre.current.length;
        if (!n) return;
        const pas = k.name === 'right' ? 1 : k.name === 'left' ? -1 : k.name === 'down' ? parLigne.current : k.name === 'up' ? -parLigne.current : 0;
        if (pas) return setChoix((c) => (c < 0 ? 0 : Math.max(0, Math.min(n - 1, c + pas))));
        const s = ordre.current[choix];
        if (!s) return;
        if (k.name === 'return') agirSession(s, 'ouvrir');
        else if (k.sequence === 'j') agirSession(s, 'cote');
        else if (k.sequence === 'd') agirSession(s, 'changements');
        else if (k.sequence === 'r') agirSession(s, 'repondre');
    });
    // Une action de carte : ouvrir la conversation ici, ou lancer la commande après avoir refermé la vue
    const agirSession = (s: any, action: string) => {
        if (action === 'ouvrir') return ouvrirSession(s.cle);
        const cmd = action === 'cote' ? (s.arrierePlan ? `/rejoindre-cote ${s.id}` : undefined)
            : action === 'changements' ? `/changements ${s.sessionId}` : action === 'repondre' ? `/repondre ${s.sessionId}` : undefined;
        if (!cmd) return;
        fermer();
        setTimeout(() => bus.emit('lancer', cmd), 50);
    };
    const ouvrirSession = (cle: string) => {
        fermer();
        bus.emit('selectionner', cle);
    };
    const ouvrirDetail = (detail: any) => {
        fermer();
        bus.emit('detail', detail);
    };
    const survoler = (cle: string) => ({ onMouseOver: () => setSurvol(cle), onMouseOut: () => setSurvol(undefined) });

    // ─── Les chiffres ───
    const sessions = d.agents.filter((s: any) => s.statut !== 'terminee' && !enPause(s, d.activites.get(s.sessionId)));
    const travaillent = sessions.filter((s: any) => s.statut === 'travaille').length;
    const attendent = sessions.filter((s: any) => s.statut === 'bloquee' || s.statut === 'attend').length;
    const bloquees = sessions.filter((s: any) => s.statut === 'bloquee').length;
    const serveurs = serveursPertinents(d);
    const repondent = serveurs.filter((s: any) => d.joignables.get(s)).length;
    const enMarche = d.docker.reduce((n: number, h: any) => n + h.conteneurs.filter((c: any) => c.enMarche).length, 0);
    const conteneurs = d.docker.reduce((n: number, h: any) => n + h.conteneurs.length, 0);
    const [entier, centimes] = (d.cout.total ?? 0).toFixed(2).split('.');
    const largeur = width - 2;
    const nbTuiles = largeur >= 110 ? 5 : 3;
    const lt = Math.floor(largeur / nbTuiles);
    // Les serveurs pas encore testés ne comptent ni comme répondant ni comme muets
    const testes = serveurs.filter((s: any) => d.joignables.get(s) !== undefined).length;
    const muets = testes - repondent;
    const noms = (liste: any[], couleur: (s: any) => string) => liste.slice(0, 3).map((s: any) => [{ t: '● ', c: couleurProjet(s.nom) }, { t: couper(s.titre || s.nom, 24), c: couleur(s) }]);
    const coutsTries = Object.entries(d.cout.parSession as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const tuiles = [
        <Tuile key="t" titre="AU TRAVAIL" n={String(travaillent)} sous={travaillent ? `${ANIM[tic % ANIM.length]} Claude écrit en ce moment` : 'tout est calme'} couleur={VERT} vif={travaillent > 0} largeur={lt}
            extra={noms(sessions.filter((s: any) => s.statut === 'travaille'), () => '#cbd5e1')} />,
        <Tuile key="a" titre="T’ATTENDENT" n={String(attendent)} sous={bloquees ? `! ${bloquees} bloquée${bloquees > 1 ? 's' : ''}, à toi de jouer` : attendent ? 'ont fini, à toi de répondre' : 'personne ne t’attend'}
            couleur={bloquees ? ORANGE : JAUNE} vif={!!bloquees && tic % 2 === 0} largeur={lt}
            extra={noms(sessions.filter((s: any) => s.statut === 'bloquee' || s.statut === 'attend'), (s) => (s.statut === 'bloquee' ? ORANGE : '#cbd5e1'))} />,
        <Tuile key="c" titre="COÛT DU JOUR" n={`${entier},${centimes}`} suite="$" sous={`${(d.cout.jetons / 1000).toFixed(0)} k jetons (équiv. API)`} couleur={theme.accent} largeur={lt}
            extra={coutsTries.map(([id, cout]) => {
                const s = d.agents.find((a: any) => a.sessionId === id);
                return [{ t: `${dollars(cout).padStart(8)} `, c: 'gray' }, { t: couper(s ? s.nom : 'session fermée', 18), c: s ? couleurProjet(s.nom) : fond.discret }];
            })} />,
        <Tuile key="s" titre="SERVEURS" n={`${repondent}/${serveurs.length}`}
            sous={testes < serveurs.length && !muets ? 'test en cours…' : muets ? `${muets} ne répond${muets > 1 ? 'ent' : ''} pas` : 'tous répondent'}
            couleur={muets ? ROUGE : theme.secondaire} vif={muets > 0 && tic % 2 === 0} largeur={lt}
            extra={[serveurs.slice(0, 8).map((s: any) => {
                const ok = d.joignables.get(s);
                return { t: ok === undefined ? '○ ' : '● ', c: ok === undefined ? 'gray' : ok ? VERT : ROUGE };
            })]} />,
        <Tuile key="d" titre="CONTENEURS" n={`${enMarche}/${conteneurs}`} sous={d.docker.some((h: any) => h.erreur) ? 'Docker indisponible quelque part' : 'en marche'} couleur={theme.primaire} largeur={lt}
            extra={d.docker.slice(0, 2).map((h: any) => [{ t: `${h.serveur ? h.nom : 'ce poste'} `, c: '#cbd5e1' }, { t: h.erreur ? 'indisponible' : `${h.conteneurs.filter((c: any) => c.enMarche).length}/${h.conteneurs.length}`, c: h.erreur ? ROUGE : 'gray' }])} />,
    ].slice(0, nbTuiles);

    // ─── Les sessions : des cartes, autant par rangée que la largeur le permet ───
    const deuxColonnes = largeur >= 130;
    const lg = deuxColonnes ? Math.floor(largeur * 0.62) : largeur;
    const ld = largeur - lg - 2;
    const actives = sessions;
    // Au moins 38 colonnes par carte ; avec peu de sessions, elles s'élargissent pour remplir la rangée
    const nbParLigne = Math.max(1, Math.min(Math.floor(lg / 38), actives.length));
    const lc = Math.floor(lg / nbParLigne);
    ordre.current = actives;
    parLigne.current = nbParLigne;
    const cartesSessions = actives.map((s: any, i: number) => (
        <CarteSession key={s.cle} s={s} a={d.activites.get(s.sessionId)} cout={d.cout.parSession[s.sessionId]} largeur={lc} tic={tic}
            choisie={i === choix} survolee={survol === s.cle} survoler={(oui) => setSurvol(oui ? s.cle : undefined)}
            agir={(action) => agirSession(s, action)} />
    ));

    // ─── Les serveurs : une carte à jauges chacun ───
    const connexions = d.connexions.map((cx: any) => decrireConnexion(cx, d));
    const cartesServeurs = serveurs.map((s: any) => {
        const ok = d.joignables.get(s);
        const m = metriquesDe(s.nom);
        const connecte = connexions.filter((x: any) => x.serveur === s).length;
        const charge = m && !m.erreur && m.charge !== undefined ? Math.min(100, (m.charge / (m.coeurs || 1)) * 100) : undefined;
        const cle = `srv:${s.nom}`;
        const lj = Math.max(4, Math.min(14, Math.floor((ld - 3 - 3 * 13) / 3)));
        return (
            <box key={s.nom} flexDirection="column" flexShrink={0} backgroundColor={survol === cle ? fond.selection : undefined} {...survoler(cle)} onMouseDown={() => ouvrirDetail({ type: 'serveur', cle: s.nom })}>
                <text truncate>
                    <span fg={ok === undefined ? 'gray' : ok ? VERT : ROUGE}>{ok === false && tic % 2 ? ' ◌ ' : ' ● '}</span>
                    <span fg={fond.texte} attributes={GRAS}>{couper(s.nom, 22)}</span>
                    <span fg={fond.discret}>{`  ${s.ip ?? s.hote}${m?.depuis ? ` · ${m.depuis}` : ''}`}</span>
                    {connecte > 0 && <span fg={theme.accent}>{`  ⇄ ${connecte}`}</span>}
                </text>
                {m && !m.erreur
                    ? <box flexDirection="row" paddingLeft={3}><Jauge nom="CPU" pct={charge} largeur={lj} /><Jauge nom="RAM" pct={m.memoire} largeur={lj} /><Jauge nom="disque" pct={m.disque} largeur={lj} /></box>
                    : <text fg={fond.discret}>{`   ${m?.erreur ?? (d.acces[s.nom]?.ok ? 'relevé en cours…' : 'pas de clé SSH : relevés indisponibles')}`}</text>}
            </box>
        );
    });

    // ─── Docker et équipes : des pastilles ───
    const pastillesDocker = d.docker.flatMap((h: any) => (h.erreur ? [] : h.conteneurs.filter((c: any) => c.enMarche).map((c: any) => ({ h, c }))));
    const equipes = d.equipes;

    const colonneDroite = (
        <box flexDirection="column" width={deuxColonnes ? ld : undefined} flexShrink={0}>
            <text fg={theme.primaire} attributes={GRAS}>{` SERVEURS SSH (${serveurs.length})`}</text>
            {cartesServeurs}
            {!serveurs.length && <text fg={fond.discret}>   aucun serveur · /ssh-ajouter</text>}
            <text> </text>
            <text fg={theme.primaire} attributes={GRAS}>{` DOCKER (${enMarche} en marche)`}</text>
            <box flexDirection="row" flexWrap="wrap" paddingLeft={1}>
                {pastillesDocker.map(({ h, c }: any) => {
                    const cle = `dk:${h.nom}|${c.id}`;
                    return (
                        <text key={cle} {...survoler(cle)} onMouseDown={() => ouvrirDetail({ type: 'conteneur', cle: `${h.nom}|${c.id}` })}
                            bg={survol === cle ? fond.selection : fond.panneau} fg={c.sante === 'unhealthy' ? JAUNE : VERT}>
                            {` ● ${couper(c.nom, 20)}${c.cpu ? ` ${c.cpu}` : ''} `}
                        </text>
                    );
                })}
                {!pastillesDocker.length && <text fg={fond.discret}>{d.docker.find((h: any) => h.erreur)?.erreur ?? 'aucun conteneur en marche'}</text>}
            </box>
            {equipes.length > 0 && <text> </text>}
            {equipes.length > 0 && <text fg={theme.primaire} attributes={GRAS}>{` ÉQUIPES (${equipes.length})`}</text>}
            {equipes.map((e: any) => {
                const av = avancement(e);
                const et = etatEquipe(e, tic);
                const lb = 20;
                const plein = av.total ? Math.round((av.faites / av.total) * lb) : 0;
                return (
                    <text key={e.id} truncate>
                        <span fg="#c084fc">{' ◆ '}</span><span fg={fond.texte} attributes={GRAS}>{couper(e.nomProjet, 18).padEnd(19)}</span>
                        <span fg="#a78bfa">{'━'.repeat(plein)}</span><span fg={fond.bordure}>{'─'.repeat(lb - plein)}</span>
                        <span fg="gray">{` ${av.faites}/${av.total} `}</span><span fg={et.couleur}>{et.texte}</span>
                    </text>
                );
            })}
        </box>
    );

    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <box height={1} flexDirection="row" paddingRight={1}>
                <text flexGrow={1}><span fg={theme.accent} attributes={GRAS}>{`${tic % 2 ? '◉' : '○'} VUE GLOBALE `}</span><span fg={fond.discret}>en direct · clic pour ouvrir · Échap pour revenir</span></text>
                <text fg="gray">{new Date().toTimeString().slice(0, 8)}</text>
            </box>
            <box flexDirection="row" flexShrink={0}>{tuiles}</box>
            <Pouls d={d} largeur={largeur - 2} hauteur={height >= 50 ? 8 : height >= 40 ? 6 : 4} tic={tic} />
            <box height={1} border={['bottom']} borderColor={fond.bordure} />
            <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                <box flexDirection={deuxColonnes ? 'row' : 'column'}>
                    <box flexDirection="column" width={deuxColonnes ? lg : undefined} flexShrink={0} marginRight={deuxColonnes ? 2 : 0}>
                        <box flexDirection="row">
                            <text fg={theme.primaire} attributes={GRAS}>{` SESSIONS (${cartesSessions.length})`.padEnd(16)}</text>
                            <text fg={fond.discret}>courbe : 30 dernières min · flèches pour choisir, Entrée ouvrir, j à côté, d changements</text>
                        </box>
                        <box flexDirection="row" flexWrap="wrap">{cartesSessions}</box>
                        {!cartesSessions.length && <text fg={fond.discret}>   aucune session active</text>}
                        {!deuxColonnes && <text> </text>}
                    </box>
                    {colonneDroite}
                </box>
            </scrollbox>
        </box>
    );
}

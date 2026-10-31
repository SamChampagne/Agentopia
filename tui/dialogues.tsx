import { useRef, useState } from 'react';
import { useKeyboard, usePaste } from '@opentui/react';
import { GRAS } from './style.ts';
import { morceauxAnsi } from './ansi.tsx';
import { theme, fond } from '../dist/theme.js';

// Ce que les commandes demandent (bus.ts) : un choix dans une liste, une saisie, ou une vue plein écran.
// Échap annule partout (la commande reçoit « Annulé »).

const imprimable = (k: any) => !k.ctrl && !k.meta && k.sequence?.length === 1 && k.sequence >= ' ';

const sansCouleur = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const demandes = new WeakMap<object, number>();
let prochainDialogue = 0;
function cleDemande(d: object): number {
    if (!demandes.has(d)) demandes.set(d, ++prochainDialogue);
    return demandes.get(d)!;
}
// Deux demandes successives peuvent être rendues dans la même trame React.
// Leur sélection, filtre et saisie doivent pourtant repartir de leurs propres valeurs.
export function Choix(props: { d: any; hauteur: number }) {
    return <ContenuChoix key={cleDemande(props.d)} {...props} />;
}
function ContenuChoix({ d, hauteur }: { d: any; hauteur: number }) {
    const detail = useRef<any>();
    const [filtre, setFiltre] = useState('');
    const [index, setIndex] = useState(0);
    const [coches, setCoches] = useState<Set<number>>(() => new Set(d.choix.flatMap((c: any, i: number) => (c.coche ? [i] : []))));
    const indexClavier = useRef(0), filtreClavier = useRef(''), cochesClavier = useRef(coches);
    const [survol, setSurvol] = useState<number>();
    const visibles: { c: any; i: number }[] = d.choix.map((c: any, i: number) => ({ c, i }))
        .filter(({ c }: any) => !filtre || sansCouleur(`${c.label} ${c.description ?? ''}`).toLowerCase().includes(filtre.toLowerCase()));
    const courant = Math.min(index, Math.max(0, visibles.length - 1));
    const basculer = (i: number) => {
        const n = new Set(cochesClavier.current);
        if (n.has(i)) n.delete(i); else n.add(i);
        cochesClavier.current = n; setCoches(n);
    };
    const visiblesClavier = () => d.choix.map((c: any, i: number) => ({ c, i }))
        .filter(({ c }: any) => !filtreClavier.current || sansCouleur(`${c.label} ${c.description ?? ''}`).toLowerCase().includes(filtreClavier.current.toLowerCase()));
    const deplacer = (i: number) => { indexClavier.current = i; setIndex(i); };
    const filtrer = (f: string) => { filtreClavier.current = f; setFiltre(f); deplacer(0); };
    const valider = (pos = indexClavier.current) => {
        if (d.multiple) return d.resoudre(d.choix.filter((_: any, i: number) => cochesClavier.current.has(i)).map((c: any) => c.valeur));
        const liste = visiblesClavier(), choix = liste[Math.min(pos, Math.max(0, liste.length - 1))];
        if (choix) d.resoudre(choix.c.valeur);
    };
    useKeyboard((k) => {
        if (d.detail && (k.name === 'pageup' || k.name === 'pagedown')) return detail.current?.scrollBy(k.name === 'pageup' ? -5 : 5);
        if (k.name === 'escape') return d.resoudre(undefined);
        if (k.name === 'up') return deplacer(Math.max(0, indexClavier.current - 1));
        if (k.name === 'down') return deplacer(Math.max(0, Math.min(visiblesClavier().length - 1, indexClavier.current + 1)));
        if (k.name === 'return') return valider();
        if (d.multiple && k.name === 'space') { const choix = visiblesClavier()[indexClavier.current]; if (choix) basculer(choix.i); return; }
        if (d.recherche) {
            if (k.name === 'backspace') return filtrer(filtreClavier.current.slice(0, -1));
            if (imprimable(k)) {
                return filtrer(filtreClavier.current + k.sequence);
            }
        }
    });
    const hauteurDetail = d.detail ? Math.max(3, Math.floor((hauteur - 7) / 2)) : 0;
    const place = Math.max(3, hauteur - 4 - (d.recherche ? 1 : 0) - (d.detail ? hauteurDetail + 1 : 0));
    const debut = Math.max(0, Math.min(courant - Math.floor(place / 2), visibles.length - place));
    return (
        <box flexGrow={1} flexDirection="column" border borderStyle="rounded" borderColor={theme.primaire} paddingLeft={1} paddingRight={1}>
            <text fg={theme.primaire} attributes={GRAS}>{d.message}</text>
            {d.detail && <>
                <scrollbox ref={detail} height={hauteurDetail} scrollY><text wrapMode="word" selectable>{d.detail}</text></scrollbox>
                <text fg={fond.discret}>Détail de l’action · molette ou Page ↑/↓ pour tout lire</text>
            </>}
            {d.recherche && <text><span fg={theme.accent}>⌕ </span><span>{filtre}</span><span fg={fond.discret}>{filtre ? '' : 'tape pour filtrer'}</span></text>}
            {visibles.slice(debut, debut + place).map(({ c, i }, k) => {
                const pos = debut + k;
                const actif = pos === courant || survol === pos;
                return (
                    <box key={i} height={1} flexDirection="row" backgroundColor={pos === courant ? fond.selection : undefined}
                        onMouseOver={() => setSurvol(pos)} onMouseOut={() => setSurvol(undefined)}
                        onMouseDown={() => (d.multiple ? basculer(i) : valider(pos))}>
                        <text fg={actif ? theme.accent : 'gray'}>{pos === courant ? '❯ ' : '  '}</text>
                        {d.multiple && <text fg={coches.has(i) ? '#4ade80' : fond.discret}>{coches.has(i) ? '◉ ' : '○ '}</text>}
                        <text fg={actif ? theme.accent : fond.texte} truncate flexShrink={0} maxWidth="70%">
                            {/* Un libellé peut être coloré par chalk (la pastille d'un projet) */}
                            {morceauxAnsi(c.label).map((m, j) => <span key={j} fg={m.fg} bg={m.bg} attributes={m.attributs}>{m.t}</span>)}
                        </text>
                        {c.description && <text fg={fond.discret} truncate flexGrow={1}>{`  ${c.description}`}</text>}
                    </box>
                );
            })}
            {!visibles.length && <text fg="gray">  aucun résultat</text>}
            <text fg={fond.discret}>{d.multiple ? '↑↓ choisir · Espace cocher · Entrée valider · Échap annuler' : '↑↓ choisir · Entrée ou clic valider · Échap annuler'}</text>
        </box>
    );
}

// Saisie d'un texte ; masquée (jetons, mots de passe) : on n'affiche que des •
export function Saisie(props: { d: any }) {
    return <ContenuSaisie key={cleDemande(props.d)} {...props} />;
}
function ContenuSaisie({ d }: { d: any }) {
    const [v, setV] = useState<string>(d.defaut ?? '');
    const valeur = useRef<string>(d.defaut ?? '');
    const changer = (texte: string) => { valeur.current = texte; setV(texte); };
    useKeyboard((k) => {
        if (k.name === 'escape') return d.resoudre(undefined);
        if (k.name === 'return') return d.resoudre(valeur.current);
        if (!d.masque) return;   // le champ <input> gère la frappe lui-même
        if (k.name === 'backspace') return changer(valeur.current.slice(0, -1));
        if (imprimable(k)) changer(valeur.current + k.sequence);
    });
    usePaste((e: any) => {
        if (d.masque) changer(valeur.current + (e?.text ?? String(e ?? '')).replace(/[\r\n]/g, ''));
    });
    return (
        <box flexDirection="column" border borderStyle="rounded" borderColor={theme.primaire} paddingLeft={1} paddingRight={1}>
            <text fg={theme.primaire} attributes={GRAS}>{d.message}</text>
            <box height={1} flexDirection="row">
                <text fg={theme.accent}>❯ </text>
                {d.masque ? <text>{'•'.repeat(v.length)}</text> : <input flexGrow={1} focused value={v} onInput={changer} />}
            </box>
            <text fg={fond.discret}>Entrée valider · Échap annuler</text>
        </box>
    );
}

// Vues plein écran de l'interface actuelle (Config, Git, Docker…) : pas encore passées à OpenTUI
export function VueNonMigree({ d }: { d: any }) {
    useKeyboard((k) => {
        if (k.name === 'escape' || k.name === 'return') d.resoudre();
    });
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} onMouseDown={() => d.resoudre()}>
            <text fg="#facc15" attributes={GRAS}>Cette vue n’est pas encore passée à la nouvelle interface</text>
            <text fg={fond.discret}>Elle viendra dans une prochaine étape ; en attendant, l’interface actuelle (Agentopia) l’affiche.</text>
            <text> </text>
            <text fg={fond.discret}>Échap, Entrée ou clic pour revenir</text>
        </box>
    );
}

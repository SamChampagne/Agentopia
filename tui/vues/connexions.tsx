import { useEffect, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS, couper } from '../style.ts';
import { Titre } from './commun.tsx';
import { bus } from '../../dist/ui/bus.js';
import { etatConnexions } from '../../dist/connexions.js';
import { theme, fond } from '../../dist/theme.js';

// Centre de connexions : tout ce qui se connecte, son état, et un clic pour le régler
const SYMBOLES: Record<string, { s: string; couleur: string }> = {
    ok: { s: '✓', couleur: '#4ade80' }, avert: { s: '!', couleur: '#facc15' }, manque: { s: '✕', couleur: '#f87171' },
    neutre: { s: '○', couleur: fond.eteint }, verification: { s: '…', couleur: fond.eteint },
};
// Ces commandes ouvrent une vue : on n'y revient pas ensuite (les autres rouvrent ce centre une fois finies)
const VUES = new Set(['/ssh', '/docker', '/sftp']);
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);

export function VueConnexions({ fermer }: { fermer: () => void }) {
    const [elements, setElements] = useState<any[]>();
    const [index, setIndex] = useState(-1);
    const [survol, setSurvol] = useState<number>();
    useEffect(() => {
        let actif = true;
        etatConnexions().then((e: any[]) => actif && setElements(e)).catch(() => actif && setElements([]));
        return () => void (actif = false);
    }, []);
    const lignes: any[] = [];
    for (const e of elements ?? []) {
        if (lignes.at(-1)?.type !== 'element' || lignes.at(-1).e.groupe !== e.groupe) lignes.push({ type: 'groupe', texte: e.groupe });
        lignes.push({ type: 'element', e });
    }
    const choisissables = lignes.map((l, i) => (l.type === 'element' && l.e.commande ? i : -1)).filter((i) => i >= 0);
    // Au départ, on se place sur la première chose à régler
    const premierAFaire = lignes.findIndex((l) => l.type === 'element' && (l.e.etat === 'manque' || l.e.etat === 'avert'));
    const courant = choisissables.includes(index) ? index : (premierAFaire >= 0 ? premierAFaire : choisissables[0]);
    const aFaire = (elements ?? []).filter((e) => e.etat === 'manque' || e.etat === 'avert').length;
    const prets = (elements ?? []).filter((e) => e.etat === 'ok').length;
    const activer = (i: number) => {
        const l = lignes[i];
        if (l?.type !== 'element' || !l.e.commande) return;
        fermer();
        bus.emit('lancer', VUES.has(l.e.commande) ? l.e.commande : [l.e.commande, '/connexions']);
    };
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        const p = choisissables.indexOf(courant);
        if (k.name === 'up') setIndex(choisissables[Math.max(0, p - 1)]);
        if (k.name === 'down') setIndex(choisissables[Math.min(choisissables.length - 1, p + 1)]);
        if (k.name === 'return') activer(courant);
    });
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="⚿ CONNEXIONS" droite={!elements ? 'vérification…' : `${prets} prêt${prets > 1 ? 's' : ''}${aFaire ? ` · ${aFaire} à régler` : ' · tout est connecté'}`} />
            <text fg="gray"> clic ou Entrée = régler · tout est chiffré ou stocké sur ce poste seulement · Échap fermer</text>
            {!elements && <text fg="gray">  Vérification de Claude, Git, des comptes en ligne, des serveurs et des outils…</text>}
            <scrollbox flexGrow={1} scrollY>
                {lignes.map((l, i) => {
                    if (l.type === 'groupe') return <text key={i} fg={theme.primaire} attributes={GRAS}>{` ${l.texte}`}</text>;
                    const actif = i === courant;
                    const sym = SYMBOLES[l.e.etat] ?? SYMBOLES.neutre;
                    return (
                        <box key={i} height={1} flexDirection="row" backgroundColor={actif ? fond.selection : survol === i ? fond.panneau : undefined}
                            onMouseOver={() => setSurvol(i)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => activer(i)}>
                            <text fg={actif ? theme.accent : 'gray'}>{actif ? ' ❯ ' : '   '}</text>
                            <text fg={sym.couleur}>{`${sym.s} `}</text>
                            <text width={22} attributes={actif ? GRAS : 0} truncate>{colonne(l.e.nom, 22)}</text>
                            <text flexGrow={1} fg={l.e.etat === 'ok' ? theme.secondaire : sym.couleur} truncate>{l.e.detail}</text>
                            <text fg={l.e.etat === 'manque' || l.e.etat === 'avert' || actif ? theme.accent : fond.discret}>{l.e.action ? ` ${l.e.action} › ` : ''}</text>
                        </box>
                    );
                })}
            </scrollbox>
        </box>
    );
}

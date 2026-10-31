import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { historiqueAvis, heureAvis, texteAvis, type HistoriqueAvis, type Avis } from '../../dist/ui/avis.js';
import { copier } from '../../dist/lanceurs.js';
import { theme, fond } from '../../dist/theme.js';
import { Titre, Boutons } from './commun.tsx';

export function VueAvis({ fermer, historique = historiqueAvis, copierTexte = copier }: {
    fermer: () => void; historique?: HistoriqueAvis; copierTexte?: (texte: string) => void | Promise<void>;
}) {
    const liste = useSyncExternalStore(historique.abonner, historique.lire);
    const [choix, setChoix] = useState<number | undefined>(() => historique.lire()[0]?.id);
    const [detail, setDetail] = useState<Avis>();
    const [retour, setRetour] = useState('');
    const defilement = useRef<ScrollBoxRenderable | null>(null);
    const courant = detail ?? liste.find((a) => a.id === choix) ?? liste[0];
    const index = Math.max(0, liste.findIndex((a) => a.id === courant?.id));
    useEffect(() => { historique.marquerLus(); }, [historique]);
    useEffect(() => { if (detail === undefined && courant) defilement.current?.scrollChildIntoView(`avis-${courant.id}`); }, [courant?.id, detail]);
    const ouvrir = (id = courant?.id) => { const avis = liste.find((a) => a.id === id); if (avis) { setChoix(avis.id); setDetail(avis); setRetour(''); } };
    const revenir = () => { if (detail !== undefined) { setDetail(undefined); setRetour(''); } else fermer(); };
    const copierCourant = async () => {
        if (!courant) return;
        try { await copierTexte(texteAvis(courant)); setRetour('Copie demandée · texte complet.'); }
        catch (e) { setRetour(`Copie impossible : ${(e as Error).message}`); }
    };
    useKeyboard((k) => {
        if (k.name === 'escape') { k.preventDefault(); return revenir(); }
        if (k.sequence === 'q' && !k.ctrl && !k.meta) return fermer();
        if (k.sequence === 'c' && !k.ctrl && !k.meta) return void copierCourant();
        if (detail !== undefined) {
            if (k.name === 'up' || k.name === 'down') defilement.current?.scrollBy(k.name === 'up' ? -1 : 1);
            if (k.name === 'pageup' || k.name === 'pagedown') defilement.current?.scrollBy((k.name === 'pageup' ? -1 : 1) * Math.max(1, (defilement.current?.viewport.height ?? 8) - 1));
            if (k.name === 'home') defilement.current?.scrollTo(0);
            if (k.name === 'end') defilement.current?.scrollTo(defilement.current.scrollHeight);
            return;
        }
        if (k.name === 'up') setChoix(liste[Math.max(0, index - 1)]?.id);
        if (k.name === 'down') setChoix(liste[Math.min(liste.length - 1, index + 1)]?.id);
        if (k.name === 'home') setChoix(liste[0]?.id);
        if (k.name === 'end') setChoix(liste.at(-1)?.id);
        if (k.name === 'return') ouvrir();
    });
    return <box flexGrow={1} flexShrink={1} minHeight={0} minWidth={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <Titre texte="AVIS ET ERREURS" droite={`${liste.length} / 100`} />
        <Boutons boutons={[{ label: detail === undefined ? '← Fermer' : '← Liste', action: 'retour' }, { label: 'Copier (c)', action: 'copier' },
            ...(detail === undefined && courant ? [{ label: 'Lire (Entrée)', action: 'lire' }] : [])]}
            agir={(action) => action === 'retour' ? revenir() : action === 'copier' ? void copierCourant() : ouvrir()} />
        <text height={1} flexShrink={0} fg={fond.discret} truncate>{detail === undefined ? '↑↓ choisir · Entrée détail · c copier · Échap fermer' : '↑↓ / Pg↑ Pg↓ défiler · c copier · Échap liste'}</text>
        <scrollbox key={detail === undefined ? 'liste' : `detail-${detail.id}`} ref={defilement} flexGrow={1} flexShrink={1} minHeight={0} scrollY>
            {!liste.length && <text wrapMode="word" fg={fond.discret}>Aucun avis pour ce lancement. Les prochains messages resteront consultables ici jusqu’à la fermeture de l’app.</text>}
            {detail !== undefined && courant ? <text wrapMode="word" selectable>{texteAvis(courant)}</text> : liste.map((avis) => <box key={avis.id} id={`avis-${avis.id}`} height={1} flexShrink={0}
                backgroundColor={avis.id === courant?.id ? fond.selection : undefined} onMouseDown={() => ouvrir(avis.id)}>
                <text truncate fg={avis.id === courant?.id ? theme.accent : fond.texte}>{`${avis.id === courant?.id ? '❯' : ' '} ${heureAvis(avis.derniereDate)}${avis.repetitions > 1 ? ` ×${avis.repetitions}` : ''} · ${avis.texte.replace(/\s+/g, ' ')}`}</text>
            </box>)}
        </scrollbox>
        <text height={1} flexShrink={0} fg={retour.startsWith('Copie impossible') ? '#facc15' : fond.discret} truncate>{retour || 'Mémoire de ce lancement seulement · aucune sauvegarde sur disque'}</text>
    </box>;
}

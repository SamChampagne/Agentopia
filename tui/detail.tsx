import { useEffect, useState } from 'react';
import { GRAS } from './style.ts';
import { Boutons } from './vues/commun.tsx';
import { contenuDetail } from '../dist/ui/VueDetail.js';
import { metriques, suivreMetriques } from '../dist/metriques.js';
import { lireDonnees } from '../dist/ui/donnees.js';
import { fond } from '../dist/theme.js';

// Panneau de détail d'un projet, d'un serveur ou d'un conteneur, dans la zone principale (même contenu que l'interface Ink)
export function Detail({ detail, d, projets, fermer, lancer }: { detail: any; d: any; projets: any[]; fermer: () => void; lancer: (cmd: string) => void }) {
    const [, setV] = useState(0);
    // Un serveur : ses relevés (charge, mémoire, disque) tournent tant que le panneau est ouvert
    useEffect(() => {
        if (detail.type !== 'serveur') return;
        const f = () => setV((v) => v + 1);
        metriques.on('maj', f);
        const arreter = suivreMetriques(() => lireDonnees().serveurs);
        return () => {
            metriques.off('maj', f);
            arreter();
        };
    }, [detail.type, detail.cle]);
    const contenu = contenuDetail(detail, d, projets);
    if (!contenu) return <box flexGrow={1} paddingLeft={1}><text fg="gray">Introuvable (retiré entre-temps ?) · Échap pour revenir</text></box>;
    const morceaux = (l: any[]) => l.map((m, k) => <span key={k} fg={m.c} attributes={m.gras ? GRAS : 0}>{m.t || ' '}</span>);
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <text truncate>{morceaux(contenu.titre)}</text>
            <Boutons boutons={contenu.boutons} agir={(a) => (a === 'retour' ? fermer() : lancer(a))} />
            <box height={1} border={['bottom']} borderColor={fond.bordure} />
            <scrollbox flexGrow={1} scrollY>
                {contenu.lignes.map((l: any[], i: number) => <text key={i} truncate selectable>{morceaux(l)}</text>)}
            </scrollbox>
        </box>
    );
}

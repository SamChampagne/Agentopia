import { useEffect, useRef, type ReactNode } from 'react';

// Transition entre deux vues de la zone principale : la nouvelle glisse un peu depuis la droite en apparaissant (fondu).
// L'animation agit directement sur la boîte (opacité, décalage), sans redessiner React à chaque image : elle ne coûte presque rien.

const DUREE = 200;        // ms
const DECALAGE = 5;       // colonnes

export function Transition({ cle, children }: { cle: string; children: ReactNode }) {
    const boite = useRef<any>();
    useEffect(() => {
        const b = boite.current;
        if (!b) return;
        const debut = performance.now();
        let minuterie: ReturnType<typeof setTimeout>;
        const image = () => {
            const p = Math.min(1, (performance.now() - debut) / DUREE);
            const e = 1 - (1 - p) ** 3;       // rapide au début, doux à la fin
            b.opacity = 0.2 + 0.8 * e;
            b.translateX = Math.round((1 - e) * DECALAGE);
            b.requestRender?.();
            if (p < 1) minuterie = setTimeout(image, 16);
        };
        image();
        return () => {
            clearTimeout(minuterie);
            b.opacity = 1;
            b.translateX = 0;
        };
    }, [cle]);
    return <box ref={boite} flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" overflow="hidden">{children}</box>;
}

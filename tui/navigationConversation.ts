import { useEffect, useRef, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';

// Le suivi natif se suspend quand on remonte. On expose un retour explicite au
// dernier message, sans toucher au texte saisi ni détourner Début/Fin du champ.
export function useNavigationConversation(actif: boolean) {
    const defilement = useRef<ScrollBoxRenderable | null>(null);
    const [enHistorique, setEnHistorique] = useState(false);
    const retourEnBas = () => {
        const boite = defilement.current;
        if (boite) boite.scrollTo(boite.scrollHeight);
    };
    useEffect(() => {
        const barre = defilement.current?.verticalScrollBar;
        if (!barre) return;
        const actualiser = () => setEnHistorique(barre.scrollPosition < Math.max(0, barre.scrollSize - barre.viewportSize));
        barre.on('change', actualiser);
        actualiser();
        return () => { barre.off('change', actualiser); };
    }, []);
    useKeyboard((k) => {
        const boite = defilement.current;
        if (!actif || k.defaultPrevented || !boite) return;
        if (k.name === 'pageup' || k.name === 'pagedown') {
            k.preventDefault();
            boite.scrollBy((k.name === 'pageup' ? -1 : 1) * Math.max(1, boite.viewport.height - 2));
        } else if ((k.meta || k.option) && (k.name === 'home' || k.name === 'end')) {
            k.preventDefault();
            if (k.name === 'home') boite.scrollTo(0);
            else retourEnBas();
        }
    });
    return { defilement, enHistorique, retourEnBas };
}

import { EventEmitter } from 'events';
import { useEffect, useState } from 'react';

// Retour visuel d'un clic : le bouton s'allume ~150 ms, on sent que le clic est pris avant même que la vue change

const appui = new EventEmitter();
let actif: string | undefined;
let minuterie: NodeJS.Timeout | undefined;

export function appuyer(cle: string): void {
    actif = cle;
    appui.emit('maj');
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
        actif = undefined;
        appui.emit('maj');
    }, 150);
}

export function useAppui(): string | undefined {
    const [, setV] = useState(0);
    useEffect(() => {
        const f = () => setV((v) => v + 1);
        appui.on('maj', f);
        return () => {
            appui.off('maj', f);
        };
    }, []);
    return actif;
}

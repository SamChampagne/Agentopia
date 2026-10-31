import { useEffect, useState, useSyncExternalStore } from 'react';
import { CarnetBrouillons } from './brouillons.js';
import { bus } from './bus.js';

// Ink utilise React 18 ; OpenTUI possède le même adaptateur avec son React 19.
export function useBrouillon(destination: string) {
    const [carnet] = useState(() => new CarnetBrouillons(undefined, () => bus.emit('notice', 'Brouillon conservé en mémoire ; sauvegarde sur disque impossible.')));
    const brouillon = useSyncExternalStore(carnet.abonner, () => carnet.lire(destination));
    useEffect(() => {
        process.on('exit', carnet.sauver);
        return () => { carnet.sauver(); process.off('exit', carnet.sauver); };
    }, [carnet]);
    return { ...brouillon, carnet,
        setTexte: (texte: string) => carnet.ecrire(destination, { texte }),
        setImages: (images: string[]) => carnet.ecrire(destination, { images }),
    };
}

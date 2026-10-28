import { useEffect, useState } from 'react';
import { lireDonnees, surMajDonnees } from '../dist/ui/donnees.js';

// Les données de l'appli (sessions, docker, serveurs…) ; le composant se redessine à chaque mise à jour
export function useDonnees(): any {
    const [, setV] = useState(0);
    useEffect(() => surMajDonnees(() => setV((v) => v + 1)), []);
    return lireDonnees();
}

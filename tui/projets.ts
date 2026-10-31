import { useSyncExternalStore } from 'react';
import { getProjets } from '../dist/commandes.js';
import { bus } from '../dist/ui/bus.js';

const abonner = (maj: () => void) => { bus.on('projets', maj); return () => { bus.off('projets', maj); }; };
export const useProjets = () => useSyncExternalStore(abonner, getProjets);

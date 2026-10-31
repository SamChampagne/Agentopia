import { useSyncExternalStore } from 'react';
import { getProjets } from '../commandes.js';
import { bus } from './bus.js';

const abonner = (maj: () => void) => { bus.on('projets', maj); return () => { bus.off('projets', maj); }; };
export const useProjets = () => useSyncExternalStore(abonner, getProjets);

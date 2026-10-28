import { Config, chargerConfig, sauverConfig } from '../config.js';
import { bus } from './bus.js';

// Disposition de l'écran : où va chaque chose, ce qui est caché.
// Réglée dans /ecran ; tout le reste (clics, survol, mise en page) lit ces valeurs ici.

export type Cote = 'gauche' | 'droite';
export interface Disposition {
    laterale: Cote | 'cachee';                       // colonne des sessions
    actions: Cote | 'haut' | 'cachees';              // actions de la conversation ouverte
    icones: boolean;                                 // icônes dans la barre du haut
    cockpitMasques: string[];                        // panneaux du cockpit cachés (clés de PANNEAUX_COCKPIT)
}

export const DISPOSITION_DEFAUT: Disposition = { laterale: 'gauche', actions: 'gauche', icones: true, cockpitMasques: [] };

export const PANNEAUX_COCKPIT = [
    { cle: 'sessions', nom: 'Tuile Sessions Claude' },
    { cle: 'poste', nom: 'Tuile Ce poste (CPU, RAM)' },
    { cle: 'cout', nom: 'Tuile Coût du jour' },
    { cle: 'infra', nom: 'Tuile Infra (Docker, SSH)' },
    { cle: 'afaire', nom: 'Panneau À faire' },
    { cle: 'sorties', nom: 'Panneau Dernières sorties' },
    { cle: 'raccourcis', nom: 'Panneau Raccourcis' },
    { cle: 'direct', nom: 'Panneau En direct (CPU, RAM)' },
] as const;

let actuelle: Disposition = { ...DISPOSITION_DEFAUT, ...chargerConfig().ecran };
export const disposition = (): Disposition => actuelle;
export const panneauVisible = (cle: string) => !actuelle.cockpitMasques.includes(cle);

// config : la copie partagée des commandes (sinon un autre réglage sauvé plus tard effacerait celui-ci)
export function changerDisposition(modif: Partial<Disposition>, config: Config): void {
    actuelle = { ...actuelle, ...modif };
    config.ecran = { ...actuelle };
    sauverConfig(config);
    bus.emit('disposition', actuelle);
}

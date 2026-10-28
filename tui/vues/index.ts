import { VueConfig } from './config.tsx';
import { VueDocker } from './docker.tsx';
import { VueServeurs } from './ssh.tsx';

// Vues déjà passées à OpenTUI, par nom du composant Ink que la commande demande (afficherVue).
// Une commande ouvre toujours sa vue de la même façon : l'interface choisit sa version de la vue.
export const VUES: Record<string, (props: any) => any> = {
    VueConfig,
    VueDocker,
    VueServeurs,
};

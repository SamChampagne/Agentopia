import { VueConfig } from './config.tsx';
import { VueDocker } from './docker.tsx';
import { VueServeurs } from './ssh.tsx';
import { VueGit } from './git.tsx';
import { VueProjets } from './projets.tsx';
import { VueGlobale } from './live.tsx';
import { VueEquipe } from './equipe.tsx';
import { VueConnexions } from './connexions.tsx';
import { VueRecents } from './recents.tsx';
import { VueQuestions } from './questions.tsx';
import { VueSftp } from './sftp.tsx';
import { VueEcran } from './ecran.tsx';
import { Moniteur } from './moniteur.tsx';

// Vues passées à OpenTUI, par nom du composant Ink que la commande demande (afficherVue).
// Une commande ouvre toujours sa vue de la même façon : l'interface choisit sa version de la vue.
export const VUES: Record<string, (props: any) => any> = {
    VueConfig, VueDocker, VueServeurs, VueGit, VueProjets, VueGlobale, VueEquipe,
    VueConnexions, VueRecents, VueQuestions, VueSftp, VueEcran, Moniteur,
};

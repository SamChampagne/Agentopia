import { render, Instance } from 'ink';
import { App } from './ui/App.js';
import { entree, desactiver } from './ui/terminal.js';
import { sortie } from './ui/sortie.js';
import { definirCycle, demarrerEcran } from './ui/ecran.js';
import { capturerConsole } from './ui/journal.js';
import { demarrerNotifications } from './commandes.js';
import { premierLancement, chargerConfig } from './config.js';
import { choisirLargeurLaterale, choisirTailleCartes } from './ui/mise.js';
import './chemins.js';
import { remplacerAncienRaccourci } from './configCommandes.js';

// "sp commit saniplan" : exécute la commande dans l'interface puis quitte
const commandeInitiale = process.argv.slice(2).join(' ').trim() || undefined;
// Première fois : l'assistant de scan configure les projets
let auDemarrage = premierLancement ? '/scan' : undefined;

capturerConsole();
choisirLargeurLaterale(chargerConfig().largeurLaterale);
choisirTailleCartes(!!chargerConfig().cartesDetaillees);
if (!commandeInitiale) demarrerNotifications();
// Premier lancement après le changement de nom : le raccourci « CLI Perso » devient « Claudetopia »
setTimeout(remplacerAncienRaccourci, 3000);
// Notifications cliquables : le lien claudetopia: ouvre la session concernée
// (le lien lui-même s'active dans le centre de connexions)
setTimeout(() => void import('./notifications.js').then((n) => n.surveillerLiens()), 2000);
process.on('exit', () => void import('./maitre.js').then((m) => m.arreterMaitre()));
// Terminaux installés détectés en avance : le premier clic droit s'ouvre sans attendre
setTimeout(() => void import('./terminaux.js').then((t) => t.terminaux()), 2500);

let instance: Instance | undefined;
definirCycle(
    () => {
        instance = render(<App commandeInitiale={commandeInitiale} auDemarrage={auDemarrage} />, {
            stdin: entree as unknown as NodeJS.ReadStream,
            stdout: sortie,
            exitOnCtrlC: false,
            patchConsole: false,
        });
        auDemarrage = undefined;   // l'assistant ne se relance pas après un "claude attach"
    },
    () => {
        instance?.unmount();
        instance = undefined;
    },
);

// Quoi qu'il arrive, on rend au terminal son état normal (souris, écran)
process.on('exit', desactiver);
demarrerEcran();

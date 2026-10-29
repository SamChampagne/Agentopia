import type { Commande } from './commandes.js';
import type { Config } from './config.js';

// /ecran : disposition de l'écran (où vont les sessions et les actions, ce qui est caché), avec aperçu
// /preparer : détection du poste et connexion des fournisseurs choisis.

export function commandesAssistant(config: Config): Commande[] {
    const ouvrirEcran = async () => {
        const { VueEcran } = await import('./ui/VueEcran.js');
        const React = await import('react');
        const { afficherVue } = await import('./ui/bus.js');
        await afficherVue((fermer) => React.createElement(VueEcran, { fermer, config }));
    };
    return [
        {
            nom: 'ecran', alias: ['disposition'], groupe: 'Config',
            description: 'Disposition de l’écran : où vont les sessions et les actions, ce qui est caché (avec aperçu)',
            executer: ouvrirEcran,
        },
        {
            nom: 'preparer', alias: ['bienvenue', 'assistant'], groupe: 'Config',
            description: 'Préparer le poste automatiquement, ou reprendre une étape interrompue',
            executer: async () => {
                const { preparerPoste } = await import('./preparation.js');
                await preparerPoste(config);
            },
        },
    ];
}

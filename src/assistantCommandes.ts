import * as os from 'os';
import type { Commande } from './commandes.js';
import { Config, sauverConfig } from './config.js';
import { choisir, saisir, confirmer } from './ui/bus.js';
import { PALETTES, appliquerTheme, nomPalette, c } from './theme.js';

// /ecran : disposition de l'écran (où vont les sessions et les actions, ce qui est caché), avec aperçu
// /bienvenue : l'assistant du premier lancement sur un poste (prénom, disposition, thème, sessions, projets, connexions)

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
            nom: 'bienvenue', alias: ['assistant'], groupe: 'Config',
            description: 'Assistant de configuration du poste (prénom, disposition, thème, sessions, projets, connexions)',
            executer: async () => {
                const { executerLigne } = await import('./commandes.js');
                // Chaque étape peut être passée avec Échap : on garde la valeur actuelle
                const etape = async (fn: () => Promise<unknown>) => {
                    try {
                        await fn();
                    } catch (err) {
                        if ((err as Error).name !== 'Annule') throw err;
                    }
                };
                await etape(async () => {
                    config.prenom = (await saisir('1/6 · Bienvenue dans Claudetopia ! Ton prénom', config.prenom || os.userInfo().username)).trim() || config.prenom;
                    sauverConfig(config);
                });
                await etape(async () => {
                    if (await confirmer('2/6 · Régler la disposition de l’écran maintenant ? (sessions à gauche ou à droite, actions, panneaux du cockpit) · plus tard : Config')) await ouvrirEcran();
                });
                await etape(async () => {
                    const nom = await choisir(`3/6 · Couleurs (actuelles : ${nomPalette()})`, Object.entries(PALETTES).map(([n, p]) => ({
                        label: n, valeur: n, description: `${p.primaire} · ${p.secondaire} · ${p.accent}`,
                    })), false);
                    appliquerTheme(PALETTES[nom]);
                    config.theme = { ...PALETTES[nom] };
                    sauverConfig(config);
                });
                await etape(async () => {
                    config.lancement = await choisir('4/6 · Où ouvrir les nouvelles sessions Claude ?', [
                        { label: 'En arrière-plan (conseillé)', valeur: 'fond' as const, description: 'une carte dans la colonne des sessions, tu les suis toutes d’ici et tu rejoins celle que tu veux' },
                        { label: 'Dans un onglet du terminal', valeur: 'onglet' as const, description: 'chaque session dans son propre onglet Windows Terminal' },
                    ], false);
                    sauverConfig(config);
                });
                await etape(async () => {
                    if (await confirmer('5/6 · Chercher tes projets sur ce poste maintenant ? (dossiers de code, serveurs SSH, outils)')) await executerLigne('/scan');
                });
                await etape(async () => {
                    if (await confirmer('6/6 · Vérifier les connexions (compte Claude, Git, GitHub/Azure DevOps, SSH) ?')) await executerLigne('/connexions');
                });
                console.log(c.succes(`Tout est prêt${config.prenom ? `, ${config.prenom}` : ''} · /bienvenue pour refaire l’assistant, Config → Disposition de l’écran pour tout placer`));
            },
        },
    ];
}

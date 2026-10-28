import * as fs from 'fs';
import * as path from 'path';
import type { Commande } from './commandes.js';
import { Config, sauverConfig } from './config.js';
import { RACINE_CLI, creerRaccourci } from './configCommandes.js';
import { PALETTES, appliquerTheme, c } from './theme.js';
import { choisir, confirmer } from './ui/bus.js';

// Profil Windows Terminal « Claudetopia » : jeu de couleurs, police, transparence acrylique, marges, effet rétro.
// Ajouté par un « fragment » (fichier à part que Windows Terminal lit au démarrage) : les réglages de
// l'utilisateur ne sont pas touchés, et /apparence retirer l'enlève.

const FRAGMENT = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows Terminal', 'Fragments', 'Claudetopia', 'claudetopia.json');
const GUID = '{7e6c2b1e-1c5a-4d4e-9a5e-c1a0d70b1a01}';

type Schema = Record<string, string>;
const couleurs = (fond: string, texte: string, curseur: string, selection: string, c16: string[]): Schema => ({
    background: fond, foreground: texte, cursorColor: curseur, selectionBackground: selection,
    ...Object.fromEntries(['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white',
        'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'].map((k, i) => [k, c16[i]])),
});

// Jeux de couleurs populaires (valeurs publiées par chaque projet)
const SCHEMAS: Record<string, Schema> = {
    'Catppuccin': couleurs('#1E1E2E', '#CDD6F4', '#F5E0DC', '#585B70', ['#45475A', '#F38BA8', '#A6E3A1', '#F9E2AF', '#89B4FA', '#F5C2E7', '#94E2D5', '#BAC2DE', '#585B70', '#F38BA8', '#A6E3A1', '#F9E2AF', '#89B4FA', '#F5C2E7', '#94E2D5', '#A6ADC8']),
    'Tokyo Night': couleurs('#1A1B26', '#C0CAF5', '#C0CAF5', '#33467C', ['#15161E', '#F7768E', '#9ECE6A', '#E0AF68', '#7AA2F7', '#BB9AF7', '#7DCFFF', '#A9B1D6', '#414868', '#F7768E', '#9ECE6A', '#E0AF68', '#7AA2F7', '#BB9AF7', '#7DCFFF', '#C0CAF5']),
    'Dracula': couleurs('#282A36', '#F8F8F2', '#F8F8F2', '#44475A', ['#21222C', '#FF5555', '#50FA7B', '#F1FA8C', '#BD93F9', '#FF79C6', '#8BE9FD', '#F8F8F2', '#6272A4', '#FF6E6E', '#69FF94', '#FFFFA5', '#D6ACFF', '#FF92DF', '#A4FFFF', '#FFFFFF']),
    'Nord': couleurs('#2E3440', '#D8DEE9', '#D8DEE9', '#434C5E', ['#3B4252', '#BF616A', '#A3BE8C', '#EBCB8B', '#81A1C1', '#B48EAD', '#88C0D0', '#E5E9F0', '#4C566A', '#BF616A', '#A3BE8C', '#EBCB8B', '#81A1C1', '#B48EAD', '#8FBCBB', '#ECEFF4']),
    'Gruvbox': couleurs('#282828', '#EBDBB2', '#EBDBB2', '#504945', ['#282828', '#CC241D', '#98971A', '#D79921', '#458588', '#B16286', '#689D6A', '#A89984', '#928374', '#FB4934', '#B8BB26', '#FABD2F', '#83A598', '#D3869B', '#8EC07C', '#EBDBB2']),
};

export const profilInstalle = () => fs.existsSync(FRAGMENT);

export function commandesApparence(config: Config): Commande[] {
    return [{
        nom: 'apparence', args: '[retirer]', groupe: 'Config',
        description: 'Profil Windows Terminal « Claudetopia » : couleurs, police, transparence, effet rétro',
        executer: async ({ args }) => {
            if (!process.env.LOCALAPPDATA) return console.log(c.alerte('Windows Terminal introuvable sur ce poste'));
            if (args[0] === 'retirer') {
                fs.rmSync(path.dirname(FRAGMENT), { recursive: true, force: true });
                creerRaccourci();
                return console.log(c.succes('Profil Claudetopia retiré de Windows Terminal · le raccourci ouvre de nouveau le profil par défaut'));
            }
            const schema = await choisir('Couleurs du terminal', Object.keys(SCHEMAS).map((n) => ({
                label: n, valeur: n, description: `fond ${SCHEMAS[n].background} · ${n === 'Catppuccin' ? 'doux, pastel' : n === 'Tokyo Night' ? 'bleu nuit' : n === 'Dracula' ? 'violet contrasté' : n === 'Nord' ? 'bleu glacier' : 'chaud, rétro'}`,
            })), false);
            const opacite = await choisir('Transparence', [
                { label: 'Légère (acrylique, 90 %)', valeur: 90 },
                { label: 'Forte (acrylique, 75 %)', valeur: 75 },
                { label: 'Aucune', valeur: 100 },
            ], false);
            const retro = await choisir('Effet rétro (lignes d\'écran cathodique, lueur)', [
                { label: 'Non', valeur: false },
                { label: 'Oui', valeur: true },
            ], false);
            if (!await confirmer(`Ajouter le profil « Claudetopia » à Windows Terminal (fichier à part, tes réglages ne changent pas) et faire ouvrir ce profil par le raccourci du bureau ?`)) return;
            const nomSchema = `Claudetopia ${schema}`;
            const fragment = {
                profiles: [{
                    guid: GUID,
                    name: 'Claudetopia',
                    commandline: `cmd.exe /k "${path.join(RACINE_CLI, 'Claudetopia.bat')}"`,
                    startingDirectory: RACINE_CLI,
                    colorScheme: nomSchema,
                    font: { face: 'Cascadia Code', size: 11 },
                    opacity: opacite,
                    useAcrylic: opacite < 100,
                    padding: '8, 6',
                    cursorShape: 'bar',
                    tabTitle: 'Claudetopia',
                    suppressApplicationTitle: true,
                    'experimental.retroTerminalEffect': retro,
                }],
                schemes: [{ name: nomSchema, ...SCHEMAS[schema] }],
            };
            fs.mkdirSync(path.dirname(FRAGMENT), { recursive: true });
            fs.writeFileSync(FRAGMENT, JSON.stringify(fragment, null, 2), 'utf-8');
            // Les couleurs de l'interface suivent celles du terminal
            if (PALETTES[schema]) {
                appliquerTheme(PALETTES[schema]);
                config.theme = { ...PALETTES[schema] };
                sauverConfig(config);
            }
            const r = creerRaccourci();
            console.log(c.succes(`✓ Profil « Claudetopia » ajouté (${schema}${opacite < 100 ? `, acrylique ${opacite} %` : ''}${retro ? ', effet rétro' : ''})`));
            console.log(r.ok ? c.discret('Ferme cette fenêtre et rouvre Claudetopia avec le raccourci du bureau pour voir le résultat.') : c.alerte(`Raccourci : ${r.message}`));
        },
    }];
}

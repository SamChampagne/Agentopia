import { spawnSync } from 'child_process';
import type { Commande } from './commandes.js';
import { Config, chargerConfig, sauverConfig } from './config.js';
import { PALETTES, appliquerTheme, theme, c } from './theme.js';
import { bus, choisir } from './ui/bus.js';

// Thème automatique : une palette le jour et une plus douce le soir (18 h → 7 h),
// ou selon le mode clair / sombre de Windows. Seules les couleurs d'accent changent : le fond reste sombre.

const SOIR_DEBUT = 18, SOIR_FIN = 7;

// Windows en mode clair pour les applications ? (registre de l'utilisateur ; undefined si illisible)
function windowsClair(): boolean | undefined {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { encoding: 'utf-8', windowsHide: true });
    const v = /AppsUseLightTheme\s+REG_DWORD\s+0x(\d+)/.exec(r.stdout ?? '')?.[1];
    return v === undefined ? undefined : v !== '0';
}

// La palette qui devrait être affichée maintenant (undefined : pas de thème automatique)
export function paletteDuMoment(config = chargerConfig(), heure = new Date().getHours()): string | undefined {
    const t = config.themeAuto;
    if (!t) return undefined;
    if (t.mode === 'windows') {
        const clair = windowsClair();
        return clair === undefined ? undefined : clair ? t.jour : t.soir;
    }
    return heure >= SOIR_DEBUT || heure < SOIR_FIN ? t.soir : t.jour;
}

// Appelé chaque minute : change la palette quand le moment change (l'écran se redessine)
export function appliquerThemeAuto(): void {
    const nom = paletteDuMoment();
    const p = nom && PALETTES[nom];
    if (!p || (p.primaire === theme.primaire && p.accent === theme.accent && p.secondaire === theme.secondaire)) return;
    appliquerTheme(p);
    bus.emit('disposition');
}

export function commandesThemeAuto(config: Config): Commande[] {
    return [{
        nom: 'theme-auto', groupe: 'Config',
        description: 'Palette qui change le soir, ou qui suit le mode clair / sombre de Windows',
        executer: async () => {
            const mode = await choisir<'heure' | 'windows' | 'non'>('Thème automatique', [
                { label: '◐ Selon l\'heure', valeur: 'heure', description: `une palette le jour, une plus douce de ${SOIR_DEBUT} h à ${SOIR_FIN} h` },
                { label: '◑ Selon Windows', valeur: 'windows', description: 'suit le mode clair / sombre des applications Windows' },
                { label: '○ Désactiver', valeur: 'non', description: 'revenir à ton thème (/theme)' },
            ], false);
            if (mode === 'non') {
                delete config.themeAuto;
                sauverConfig(config);
                appliquerTheme(config.theme);
                bus.emit('disposition');
                return void console.log(c.succes('Thème automatique désactivé'));
            }
            const palettes = (titre: string, defaut: string) => choisir(titre, Object.keys(PALETTES).sort((a) => (a === defaut ? -1 : 0)).map((n) => ({ label: n, valeur: n })), false);
            const jour = await palettes(mode === 'heure' ? 'Palette du jour' : 'Palette quand Windows est en mode clair', 'Océan');
            const soir = await palettes(mode === 'heure' ? 'Palette du soir' : 'Palette quand Windows est en mode sombre', 'Catppuccin');
            config.themeAuto = { mode, jour, soir };
            sauverConfig(config);
            appliquerThemeAuto();
            console.log(c.succes(`Thème automatique : ${jour} ${mode === 'heure' ? 'le jour' : 'en mode clair'}, ${soir} ${mode === 'heure' ? 'le soir' : 'en mode sombre'} · maintenant : ${paletteDuMoment(config)}`));
        },
    }];
}

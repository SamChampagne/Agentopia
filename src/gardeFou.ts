import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Commande } from './commandes.js';
import { Config, sauverConfig } from './config.js';
import { RACINE_CLI } from './configCommandes.js';
import { inventaire } from './ssh.js';
import { choisir, choisirPlusieurs, confirmer, saisir, tache } from './ui/bus.js';
import { c } from './theme.js';

// Garde-fou : un hook de Claude Code (outils/garde-fou.mjs) qui oblige les sessions à demander la permission
// avant de pousser sur une branche protégée ou de se connecter à un serveur marqué « prod ».
// Ajouté à ~/.claude/settings.json (copie de sauvegarde à côté), retiré par /garde-fou retirer.

const REGLAGES = path.join(os.homedir(), '.claude', 'settings.json');
const SCRIPT = path.join(RACINE_CLI, 'outils', 'garde-fou.mjs').replace(/\\/g, '/');
const COMMANDE = `node "${SCRIPT}"`;

type Reglages = { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]> };

function lireReglages(): Reglages {
    try {
        return JSON.parse(fs.readFileSync(REGLAGES, 'utf-8'));
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw new Error(`~/.claude/settings.json illisible : ${(e as Error).message}`);
    }
}

function ecrireReglages(r: Reglages): void {
    if (fs.existsSync(REGLAGES)) fs.copyFileSync(REGLAGES, `${REGLAGES}.avant-garde-fou`);
    fs.mkdirSync(path.dirname(REGLAGES), { recursive: true });
    fs.writeFileSync(REGLAGES, JSON.stringify(r, null, 2) + '\n', 'utf-8');
}

const estLeNotre = (h: { command: string }) => h.command.includes('garde-fou.mjs');
export const hookInstalle = () => !!lireReglages().hooks?.PreToolUse?.some((g) => g.hooks.some(estLeNotre));

function installer(): void {
    const r = lireReglages();
    r.hooks ??= {};
    r.hooks.PreToolUse = (r.hooks.PreToolUse ?? []).map((g) => ({ ...g, hooks: g.hooks.filter((h) => !estLeNotre(h)) })).filter((g) => g.hooks.length);
    r.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: COMMANDE, timeout: 10 }] });
    ecrireReglages(r);
}

function retirer(): void {
    const r = lireReglages();
    if (!r.hooks?.PreToolUse) return;
    r.hooks.PreToolUse = r.hooks.PreToolUse.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !estLeNotre(h)) })).filter((g) => g.hooks.length);
    if (!r.hooks.PreToolUse.length) delete r.hooks.PreToolUse;
    if (!Object.keys(r.hooks).length) delete r.hooks;
    ecrireReglages(r);
}

function etat(config: Config): void {
    const g = config.gardeFou;
    console.log(c.primaire('Garde-fou') + c.discret(hookInstalle() ? '  ● actif dans Claude Code' : '  ○ pas installé'));
    console.log(`  Branches protégées : ${g?.branches.length ? c.secondaire(g.branches.join(', ')) : c.discret('aucune')}`);
    console.log(`  Serveurs de prod   : ${g?.serveurs.length ? c.secondaire(g.serveurs.join(', ')) : c.discret('aucun')}`);
    console.log(c.discret('  Une session qui veut pousser sur ces branches ou se connecter à ces serveurs doit te demander la permission :'));
    console.log(c.discret('  sa carte passe en « bloquée », Entrée pour la rejoindre et confirmer (ou refuser).'));
}

export function commandesGardeFou(config: Config): Commande[] {
    return [{
        nom: 'garde-fou', alias: ['prod'], args: '[retirer]', groupe: 'Config',
        description: 'Confirmation obligatoire avant un push sur main ou une connexion à un serveur de prod',
        executer: async ({ args }) => {
            if (args[0] === 'retirer') {
                retirer();
                return void console.log(c.succes('Garde-fou retiré de Claude Code (tes réglages de branches et serveurs sont gardés)'));
            }
            etat(config);
            const action = await choisir('Garde-fou', [
                { label: '⚙ Choisir les branches et les serveurs de prod', valeur: 'regler' },
                ...(hookInstalle() ? [{ label: '✕ Retirer le garde-fou', valeur: 'retirer' }] : [{ label: '✓ Activer dans Claude Code', valeur: 'installer' }]),
            ], false);
            if (action === 'retirer') {
                retirer();
                return void console.log(c.succes('Garde-fou retiré'));
            }
            if (action === 'regler') {
                const actuel = config.gardeFou ?? { branches: ['main', 'master'], serveurs: [] };
                const branches = (await saisir('Branches protégées (séparées par des virgules)', actuel.branches.join(', '))).split(',').map((b) => b.trim()).filter(Boolean);
                const serveurs = await tache('Lecture des serveurs SSH', () => inventaire());
                const choisis = serveurs.length ? await choisirPlusieurs('Serveurs de prod', serveurs.map((s) => ({
                    label: s.nom, valeur: s, description: s.hote, coche: [...s.noms].some((n) => actuel.serveurs.includes(n.toLowerCase())),
                }))) : [];
                // Tous les noms qui désignent ces serveurs (alias, hôte, IP) : la session peut utiliser n'importe lequel
                config.gardeFou = { branches, serveurs: [...new Set(choisis.flatMap((s) => [...s.noms].map((n) => n.toLowerCase())))] };
                sauverConfig(config);
                console.log(c.succes(`Enregistré · ${branches.length} branche(s), ${choisis.length} serveur(s) de prod`));
                if (hookInstalle() || !await confirmer('Activer le garde-fou dans Claude Code maintenant ?')) return;
            }
            config.gardeFou ??= { branches: ['main', 'master'], serveurs: [] };
            sauverConfig(config);
            installer();
            console.log(c.succes('✓ Garde-fou actif pour les nouvelles sessions Claude (copie de tes réglages : ~/.claude/settings.json.avant-garde-fou)'));
        },
    }];
}

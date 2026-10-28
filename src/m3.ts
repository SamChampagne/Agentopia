import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import type { Commande } from './commandes.js';
import { Config } from './config.js';
import { surPath } from './chemins.js';
import { lancerDetache } from './lanceurs.js';
import { lancerClaude } from './actions.js';
import { choisir, confirmer, saisir, tache } from './ui/bus.js';
import { c } from './theme.js';

// Infor M3 : l'analyseur de scripts H5 (matrice d'impact Excel) et les skills de documentation M3

// Le dossier du skill h5-analyzer : celui de la config, sinon les emplacements habituels
function dossierAnalyseur(config: Config): string | undefined {
    return [config.analyseurH5, path.join(os.homedir(), 'SamTravail', '.claude', 'skills', 'h5-analyzer'), path.join(os.homedir(), '.claude', 'skills', 'h5-analyzer')]
        .find((d): d is string => !!d && fs.existsSync(path.join(d, 'scripts', 'parse_scripts.py')));
}

const PYTHON = () => (surPath('python') ? 'python' : 'py');

// Lance un script Python ; ses messages (stderr) s'affichent au fur et à mesure
function python(script: string, args: string[]): Promise<number> {
    return new Promise((ok) => {
        const proc = spawn(PYTHON(), [script, ...args], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        let reste = '';
        const lire = (d: Buffer) => {
            const lignes = (reste + d.toString('utf-8')).split(/\r?\n/);
            reste = lignes.pop()!;
            lignes.filter(Boolean).forEach((l) => console.log(`  ${c.discret(l)}`));
        };
        proc.stdout.on('data', lire);
        proc.stderr.on('data', lire);
        proc.on('error', (e) => {
            console.log(c.erreur(`✗ Python introuvable : ${e.message}`));
            ok(1);
        });
        proc.on('close', (code) => {
            if (reste) console.log(`  ${c.discret(reste)}`);
            ok(code ?? 1);
        });
    });
}

async function analyser(config: Config, cible: string): Promise<void> {
    const dossier = dossierAnalyseur(config);
    if (!dossier) return void console.log(c.erreur('✗ Analyseur H5 introuvable · indique son dossier dans la config (« analyseurH5 »)'));
    const source = path.resolve((cible || await saisir('ZIP ou dossier de scripts .ts H5')).trim().replace(/^["']|["']$/g, ''));
    if (!fs.existsSync(source)) return void console.log(c.erreur(`✗ Introuvable : ${source}`));
    const json = path.join(os.tmpdir(), 'claudetopia-h5', `${path.parse(source).name}.json`);
    fs.mkdirSync(path.dirname(json), { recursive: true });
    const excel = path.join(path.dirname(source), `${path.parse(source).name}_matrice_impact.xlsx`);
    console.log(c.primaire(`Analyse des scripts H5 · ${source}`));
    if (await tache('Extraction des scripts', () => python(path.join(dossier, 'scripts', 'parse_scripts.py'), [source, json])) !== 0) {
        return void console.log(c.erreur('✗ L\'extraction a échoué (voir ci-dessus)'));
    }
    // L'Excel a besoin d'openpyxl : on propose de l'installer s'il manque
    if (spawnSync(PYTHON(), ['-c', 'import openpyxl']).status !== 0) {
        if (!await confirmer('Le module Python openpyxl (pour écrire l\'Excel) n\'est pas installé : l\'installer maintenant ?')) return;
        if (await tache('Installation d\'openpyxl', () => python('-m', ['pip', 'install', '--user', 'openpyxl'])) !== 0) {
            return void console.log(c.erreur('✗ Installation impossible · essaie : python -m pip install --user openpyxl'));
        }
    }
    if (await tache('Génération de l\'Excel', () => python(path.join(dossier, 'scripts', 'build_excel.py'), [json, excel])) !== 0) {
        return void console.log(c.erreur('✗ La génération de l\'Excel a échoué (voir ci-dessus)'));
    }
    console.log(c.succes(`✓ Matrice d'impact : ${excel}`));
    lancerDetache('explorer', [excel]);
}

const SKILLS_M3: { label: string; skill: string; description: string }[] = [
    { label: '✎ Documenter un problème M3', skill: 'anthropic-skills:m3-doc-probleme', description: 'fiche de problème / solution' },
    { label: '✎ Rédiger un problème M3', skill: 'anthropic-skills:m3-redaction-probleme', description: 'rédaction structurée d\'un incident' },
    { label: '▤ Documentation technique Infor', skill: 'anthropic-skills:infor-doc-technique', description: 'doc technique du projet' },
];

export function commandesM3(config: Config): Commande[] {
    return [
        {
            nom: 'analyze', alias: ['analyser', 'h5'], args: '[zip|dossier]', groupe: 'Projets',
            description: 'Analyser des scripts H5 (M3) et ouvrir la matrice d\'impact Excel',
            executer: ({ reste }) => analyser(config, reste),
        },
        {
            nom: 'm3-doc', projet: true, args: '[projet]', groupe: 'Projets',
            description: 'Lancer un skill de documentation M3 sur le projet (session d\'arrière-plan)',
            executer: async ({ projet, apresProjet }) => {
                const choix = await choisir('Documentation M3', SKILLS_M3.map((s) => ({ label: s.label, valeur: s.skill, description: s.description })));
                const sujet = apresProjet.trim() || await saisir('Sujet (laisser vide pour tout le projet)');
                await lancerClaude(projet!, `Utilise le skill ${choix} pour ce projet${sujet.trim() ? ` : ${sujet.trim()}` : ''}.`, 'fond');
            },
        },
    ];
}

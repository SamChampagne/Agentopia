import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CHEMINS } from './chemins.js';

// Fichier de config dans le dossier utilisateur : ~/.claudetopia.json
export const CHEMIN_CONFIG = CHEMINS.config;
export const CHEMIN_HISTORIQUE = CHEMINS.historique;

export interface Config {
    racines: string[];   // dossiers qui contiennent des projets (1 sous-dossier = 1 projet)
    extras: string[];    // projets isolés ajoutés à la main
    banniere: string;    // texte de la bannière au démarrage
    theme: { primaire: string; secondaire: string; accent: string };
    couleurs: Record<string, string>;   // couleur d'onglet forcée par projet : { "SaniPlan": "#e63946" }
    notifications: boolean;             // toast Windows quand une session Claude t'attend
    prompts: Record<string, string>;    // prompts favoris : /claude saniplan @tests
    panneau: boolean;                   // panneau live (sessions + serveurs) au-dessus de la saisie
    prenom: string;                     // pour le "Bonjour" (sinon : git user.name / user.email)
    lancement: 'fond' | 'onglet';       // où /claude ouvre les sessions
    dockerDistant: string[];            // serveurs SSH dont on surveille aussi les conteneurs Docker
    largeurLaterale: number;            // largeur de la colonne de gauche (0 = automatique)
    fetchAuto: boolean;                 // git fetch de tous les dépôts toutes les 5 min, en fond
    equipe: { parallele: number; permissions: string };   // équipes d'agents : agents en même temps, mode de permissions
    sectionsMasquees: string[];         // sections de la colonne de gauche masquées (docker, ssh)
    sectionsRepliees?: string[];        // sections repliées (en-tête seul) ; par défaut : ssh
    modeClair?: boolean;                // terminal à fond blanc : fonds et bordures clairs
    cartesDetaillees?: boolean;         // cartes de session sur 3 lignes (avec ta dernière demande)
    planifications?: import('./planificateur.js').Planification[];   // tâches planifiées (/planifier)
    budgetJour?: number;                // alerte au-delà de ce coût du jour en $ (équivalent API) ; 0 = aucune
    maitre: { actif: boolean; modele: string; veille?: number };   // veille : minutes d'inactivité avant de libérer sa mémoire (0 = jamais)
    sftp: import('./sftp.js').ConnexionSftp[];   // connexions SFTP (le mot de passe est chiffré à part)   // l'agent maître (gère les sessions) : haiku = rapide
}

const PROMPTS_DEFAUT: Record<string, string> = {
    tests: 'Écris ou complète les tests pour les changements récents de ce projet, puis lance-les et corrige ce qui échoue.',
    revue: 'Fais une revue de code du diff actuel (git diff) : bugs, cas limites, sécurité, lisibilité. Classe par sévérité.',
    securite: 'Audite la sécurité de ce projet : secrets dans le code, injections SQL/XSS, authentification, dépendances vulnérables.',
    claudemd: 'Analyse ce projet et crée ou mets à jour le CLAUDE.md : stack, commandes, architecture, conventions.',
    explique: "Explique-moi l'architecture de ce projet : dossiers principaux, flux de données, points d'entrée.",
    perf: 'Cherche les problèmes de performance évidents dans ce projet et propose des corrections.',
    doc: "Mets à jour le README : installation, configuration, commandes utiles.",
};

const CONFIG_DEFAUT: Config = {
    racines: [path.join(os.homedir(), 'dev'), 'C:\\dev'],
    extras: [],
    banniere: 'CLAUDETOPIA',
    theme: { primaire: '#00b4d8', secondaire: '#90e0ef', accent: '#f72585' },
    couleurs: {},
    notifications: true,
    prompts: PROMPTS_DEFAUT,
    panneau: true,
    prenom: '',
    lancement: 'fond',
    dockerDistant: [],
    largeurLaterale: 0,
    fetchAuto: true,
    equipe: { parallele: 3, permissions: 'acceptEdits' },
    sectionsMasquees: [],
    maitre: { actif: true, modele: 'haiku' },
    sftp: [],
};

// Vrai si le fichier de config n'existait pas : on lance l'assistant /scan au démarrage
export let premierLancement = false;

export function chargerConfig(): Config {
    try {
        const brut = JSON.parse(fs.readFileSync(CHEMIN_CONFIG, 'utf-8'));
        const config = { ...CONFIG_DEFAUT, ...brut, theme: { ...CONFIG_DEFAUT.theme, ...brut.theme } };
        // Écrit les nouvelles clés dans le fichier pour qu'elles soient faciles à modifier
        if (Object.keys(CONFIG_DEFAUT).some((k) => !(k in brut))) sauverConfig(config);
        return config;
    } catch {
        if (!fs.existsSync(CHEMIN_CONFIG)) premierLancement = true;
        sauverConfig(CONFIG_DEFAUT);
        return structuredClone(CONFIG_DEFAUT);
    }
}

export function sauverConfig(config: Config): void {
    fs.writeFileSync(CHEMIN_CONFIG, JSON.stringify(config, null, 2), 'utf-8');
}

export function chargerHistorique(): string[] {
    try {
        return fs.readFileSync(CHEMIN_HISTORIQUE, 'utf-8').split('\n').filter(Boolean).reverse();
    } catch {
        return [];
    }
}

export function ajouterHistorique(ligne: string): void {
    try {
        fs.appendFileSync(CHEMIN_HISTORIQUE, ligne + '\n', 'utf-8');
    } catch {
        // pas grave si l'historique ne s'écrit pas
    }
}

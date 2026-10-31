import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CHEMINS, NOM, nomBanniere } from './chemins.js';
import { FOURNISSEURS, estFournisseur, capacitesFournisseur, validerModele, type Fournisseur } from './providers/types.js';
import { StockageConfig } from './stockageConfig.js';
import { loginGitHubValide } from './githubLocal.js';

// Fichier de config dans le dossier utilisateur : ~/.claudetopia.json
export const CHEMIN_CONFIG = CHEMINS.config;
export const CHEMIN_HISTORIQUE = CHEMINS.historique;

export interface Config {
    racines: string[];   // dossiers qui contiennent des projets (1 sous-dossier = 1 projet)
    extras: string[];    // projets isolés ajoutés à la main
    banniere: string;    // texte de la bannière au démarrage
    theme: { primaire: string; secondaire: string; accent: string };
    couleurs: Record<string, string>;   // couleur d'onglet forcée par projet : { "SaniPlan": "#e63946" }
    notifications: boolean;             // toast Windows quand une session t'attend
    prompts: Record<string, string>;    // prompts favoris : /claude saniplan @tests
    panneau: boolean;                   // panneau live (sessions + serveurs) au-dessus de la saisie
    prenom: string;                     // pour le "Bonjour" (sinon : git user.name / user.email)
    lancement: 'fond' | 'onglet';       // où /claude-cli ouvre les sessions natives
    fournisseurDefaut?: Fournisseur | 'choisir'; // nouvelles conversations intégrées
    compteGitHub?: string;              // login GitHub CLI choisi pour Agentopia ; aucun secret
    modelesFournisseurs?: Partial<Record<Fournisseur, string>>;
    preparationProjets?: { projet: string; commande?: { programme: string; args: string[] }; fichiersLocaux?: string[] }[];
    limitesAgents?: { toursJour: number; dureeMinutes: number };
    dockerDistant: string[];            // serveurs SSH dont on surveille aussi les conteneurs Docker
    largeurLaterale: number;            // largeur de la colonne de gauche (0 = automatique)
    fetchAuto: boolean;                 // git fetch de tous les dépôts toutes les 5 min, en fond
    equipe: { parallele: number; permissions: string; paralleleGlobal?: number; parFournisseur?: Partial<Record<Fournisseur, number>> };
    sectionsMasquees: string[];         // sections de la colonne de gauche masquées (docker, ssh)
    sectionsRepliees?: string[];        // sections repliées (en-tête seul) ; par défaut : ssh
    cartesDetaillees?: boolean;         // cartes de session sur 3 lignes (avec ta dernière demande)
    planifications?: import('./planificateur.js').Planification[];   // tâches planifiées (/planifier)
    ecran?: import('./ui/disposition.js').Disposition;   // disposition de l'écran (/ecran)
    modelesSession?: import('./modelesSession.js').ModeleSession[];   // recettes de session (/modele)
    gardeFou?: { serveurs: string[]; branches: string[] };   // serveurs SSH « prod » et branches protégées (/garde-fou)
    ecranVeille?: number;               // minutes sans clavier ni souris avant l'écran de veille (0 = jamais ; 5 par défaut)
    sons?: boolean;                    // petit son quand une session finit ou a besoin de toi
    themeAuto?: { mode: 'heure' | 'windows'; jour: string; soir: string };   // palette qui change le soir, ou selon le mode clair/sombre de Windows
    budgetJour?: number;                // alerte au-delà de ce coût du jour en $ (équivalent API) ; 0 = aucune
    maitre: { actif: boolean; modele: string; veille?: number; fournisseur?: Fournisseur | 'claude-cli' | 'auto' };   // fournisseur du maître, indépendant des agents de travail
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
    banniere: NOM.toUpperCase(),
    theme: { primaire: '#00b4d8', secondaire: '#90e0ef', accent: '#f72585' },
    couleurs: {},
    notifications: true,
    prompts: PROMPTS_DEFAUT,
    panneau: true,
    prenom: '',
    lancement: 'fond',
    fournisseurDefaut: 'choisir',
    dockerDistant: [],
    largeurLaterale: 0,
    fetchAuto: true,
    equipe: { parallele: 3, paralleleGlobal: 3, permissions: 'acceptEdits' },
    sectionsMasquees: [],
    maitre: { actif: true, modele: 'haiku' },
    sftp: [],
};

// Vrai si le fichier de config n'existait pas : on lance l'assistant /scan au démarrage
export let premierLancement = false;

export function normaliserConfig(valeur: unknown): Config {
    if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) throw new Error('Configuration invalide');
    const brut = valeur as Record<string, any>;
    if (brut.compteGitHub !== undefined && !loginGitHubValide(brut.compteGitHub)) throw new Error('Compte GitHub invalide');
    for (const cle of ['racines', 'extras', 'dockerDistant', 'sectionsMasquees', 'sectionsRepliees']) {
        if (brut[cle] !== undefined && (!Array.isArray(brut[cle]) || !brut[cle].every((v: unknown) => typeof v === 'string'))) throw new Error(`Réglage invalide : ${cle}`);
    }
    for (const cle of ['theme', 'couleurs', 'prompts', 'equipe', 'maitre', 'ecran', 'limitesAgents', 'gardeFou', 'themeAuto']) {
        if (brut[cle] !== undefined && (!brut[cle] || typeof brut[cle] !== 'object' || Array.isArray(brut[cle]))) throw new Error(`Réglage invalide : ${cle}`);
    }
    for (const cle of ['sftp', 'planifications', 'modelesSession']) {
        if (brut[cle] !== undefined && (!Array.isArray(brut[cle]) || !brut[cle].every((v: unknown) => v && typeof v === 'object' && !Array.isArray(v)))) throw new Error(`Réglage invalide : ${cle}`);
    }
    for (const cle of ['banniere', 'prenom', 'lancement']) if (brut[cle] !== undefined && typeof brut[cle] !== 'string') throw new Error(`Réglage invalide : ${cle}`);
    for (const cle of ['notifications', 'panneau', 'fetchAuto', 'cartesDetaillees', 'sons']) if (brut[cle] !== undefined && typeof brut[cle] !== 'boolean') throw new Error(`Réglage invalide : ${cle}`);
    for (const cle of ['largeurLaterale', 'budgetJour', 'ecranVeille']) if (brut[cle] !== undefined && (typeof brut[cle] !== 'number' || !Number.isFinite(brut[cle]))) throw new Error(`Réglage invalide : ${cle}`);
    for (const [section, champs] of Object.entries({ theme: ['primaire', 'secondaire', 'accent'], equipe: ['permissions'], maitre: ['modele'], ecran: ['laterale', 'actions'], themeAuto: ['mode', 'jour', 'soir'] })) {
        for (const champ of champs) if (brut[section]?.[champ] !== undefined && typeof brut[section][champ] !== 'string') throw new Error(`Réglage invalide : ${section}.${champ}`);
    }
    for (const section of ['couleurs', 'prompts']) if (brut[section] && !Object.values(brut[section]).every((v) => typeof v === 'string')) throw new Error(`Réglage invalide : ${section}`);
    for (const [section, champ] of [['maitre', 'actif'], ['ecran', 'icones']]) {
        if (brut[section]?.[champ] !== undefined && typeof brut[section][champ] !== 'boolean') throw new Error(`Réglage invalide : ${section}.${champ}`);
    }
    for (const [section, champs] of Object.entries({ equipe: ['parallele'], maitre: ['veille'], limitesAgents: ['toursJour', 'dureeMinutes'] })) {
        for (const champ of champs) if (brut[section]?.[champ] !== undefined && (typeof brut[section][champ] !== 'number' || !Number.isFinite(brut[section][champ]))) throw new Error(`Réglage invalide : ${section}.${champ}`);
    }
    for (const [section, champs] of Object.entries({ ecran: ['cockpitMasques'], gardeFou: ['serveurs', 'branches'] })) {
        for (const champ of champs) if (brut[section]?.[champ] !== undefined && (!Array.isArray(brut[section][champ]) || !brut[section][champ].every((v: unknown) => typeof v === 'string'))) throw new Error(`Réglage invalide : ${section}.${champ}`);
    }
    const defaut = structuredClone(CONFIG_DEFAUT);
    if (brut.modelesFournisseurs !== undefined) {
        if (!brut.modelesFournisseurs || typeof brut.modelesFournisseurs !== 'object' || Array.isArray(brut.modelesFournisseurs)) throw new Error('Réglage invalide : modèles fournisseurs');
        for (const [f, m] of Object.entries(brut.modelesFournisseurs)) {
            if (!estFournisseur(f) || !capacitesFournisseur(f).modele || !validerModele(m)) throw new Error('Réglage de modèle non pris en charge');
        }
    }
    const limite = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 32;
    if (brut.equipe?.paralleleGlobal !== undefined && !limite(brut.equipe.paralleleGlobal)) throw new Error('Plafond global invalide (0 à 32)');
    if (brut.equipe?.parFournisseur !== undefined && (!brut.equipe.parFournisseur || typeof brut.equipe.parFournisseur !== 'object' || Array.isArray(brut.equipe.parFournisseur)
        || !Object.entries(brut.equipe.parFournisseur).every(([f, n]) => estFournisseur(f) && limite(n)))) throw new Error('Plafond fournisseur invalide');
    if (brut.preparationProjets !== undefined && (!Array.isArray(brut.preparationProjets) || brut.preparationProjets.length > 200 || !brut.preparationProjets.every((p: any) =>
        p && typeof p.projet === 'string' && path.isAbsolute(p.projet) && p.projet.length <= 4000
        && (p.commande === undefined || p.commande && typeof p.commande.programme === 'string' && p.commande.programme.length > 0 && p.commande.programme.length <= 4000 && !/[\x00-\x1f]/.test(p.commande.programme)
            && Array.isArray(p.commande.args) && p.commande.args.length <= 100 && p.commande.args.every((a: unknown) => typeof a === 'string' && a.length <= 4000 && !a.includes('\0')))
        && (p.fichiersLocaux === undefined || Array.isArray(p.fichiersLocaux) && p.fichiersLocaux.length <= 100 && p.fichiersLocaux.every((f: unknown) => typeof f === 'string' && f.length <= 4000 && !path.isAbsolute(f) && !f.split(/[\\/]/).includes('..') && !/[\x00-\x1f]/.test(f)))))) throw new Error('Préparation de projet invalide');
    const config = { ...defaut, ...brut, theme: { ...defaut.theme, ...brut.theme }, equipe: { ...defaut.equipe, ...brut.equipe }, maitre: { ...defaut.maitre, ...brut.maitre } } as Config & { modeClair?: boolean };
    if (!Object.hasOwn(FOURNISSEURS, config.fournisseurDefaut ?? '')) config.fournisseurDefaut = 'choisir';
    config.banniere = nomBanniere(config.banniere);
    if (config.modeClair) config.theme = { ...defaut.theme };
    delete config.modeClair;
    return config;
}
const stockage = new StockageConfig(CHEMIN_CONFIG, normaliserConfig, () => structuredClone(CONFIG_DEFAUT));
export const etatRecuperationConfig = () => stockage.etat;
export function chargerConfig(): Config {
    if (!fs.existsSync(CHEMIN_CONFIG)) premierLancement = true;
    return stockage.charger();
}
export function sauverConfig(config: Config): void { stockage.sauver(config); }

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

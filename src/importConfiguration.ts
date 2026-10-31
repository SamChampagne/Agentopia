import type { Config } from './config.js';
import * as path from 'node:path';
import type { HoteSsh } from './sshConfig.js';
import { FOURNISSEURS, estFournisseur, validerModele, capacitesFournisseur } from './providers/types.js';

export interface ExportConfiguration {
    format: 'claudetopia-export'; version: 1; date?: string; poste?: string;
    config: Partial<Config>; ssh: HoteSsh[];
}

const objet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texte = (v: unknown): v is string => typeof v === 'string';
const listeTextes = (v: unknown) => Array.isArray(v) && v.every(texte);
const nombre = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const chaineSsh = (v: unknown) => texte(v) && !!v && !/^[\-#]|[\s"'\x00-\x1f]/.test(v);
const portValide = (v: unknown) => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 65535;
function exiger(ok: boolean, champ: string): asserts ok {
    if (!ok) throw new Error(`Import refusé : champ « ${champ} » invalide. Aucun réglage n’a été modifié.`);
}
function option(o: Record<string, unknown>, cle: string, valide: (v: unknown) => boolean, prefixe = 'config') {
    if (o[cle] !== undefined) exiger(valide(o[cle]), `${prefixe}.${cle}`);
}

export function validerHoteSsh(h: HoteSsh): void {
    exiger(chaineSsh(h.alias) && !/[?*!\[\]]/.test(h.alias), 'ssh.alias');
    exiger(chaineSsh(h.hote), 'ssh.hote');
    if (h.utilisateur !== undefined) exiger(chaineSsh(h.utilisateur), 'ssh.utilisateur');
    if (h.port !== undefined) exiger(portValide(h.port), 'ssh.port');
    if (h.cle !== undefined) exiger(texte(h.cle) && !/["\x00-\x1f]/.test(h.cle), 'ssh.cle');
}

// Valider le document entier avant la confirmation et avant toute écriture :
// un import ne doit pas appliquer à moitié des réglages ou injecter un bloc SSH.
export function validerExportConfiguration(d: unknown): ExportConfiguration {
    exiger(objet(d) && d.format === 'claudetopia-export' && d.version === 1, 'format/version');
    exiger(objet(d.config), 'config');
    exiger(Array.isArray(d.ssh), 'ssh');
    option(d, 'poste', texte, 'export'); option(d, 'date', texte, 'export');
    const c = d.config;
    for (const k of ['racines', 'extras', 'dockerDistant', 'sectionsMasquees', 'sectionsRepliees']) option(c, k, listeTextes);
    for (const k of ['banniere', 'prenom']) option(c, k, texte);
    for (const k of ['notifications', 'fetchAuto', 'cartesDetaillees']) option(c, k, (v) => typeof v === 'boolean');
    for (const k of ['budgetJour', 'largeurLaterale']) option(c, k, nombre);
    for (const k of ['prompts', 'couleurs']) option(c, k, (v) => objet(v) && Object.values(v).every(texte));
    option(c, 'theme', (v) => objet(v) && ['primaire', 'secondaire', 'accent'].every((k) => texte(v[k])));
    option(c, 'lancement', (v) => v === 'fond' || v === 'onglet');
    option(c, 'fournisseurDefaut', (v) => v === 'choisir' || (texte(v) && Object.hasOwn(FOURNISSEURS, v)));
    option(c, 'equipe', (v) => objet(v) && Number.isInteger(v.parallele) && Number(v.parallele) > 0 && texte(v.permissions));
    if (objet(c.equipe)) {
        option(c.equipe, 'paralleleGlobal', v => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 32, 'equipe');
        option(c.equipe, 'parFournisseur', v => objet(v) && Object.entries(v).every(([k, n]) => estFournisseur(k) && Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 32), 'equipe');
    }
    option(c, 'modelesFournisseurs', v => objet(v) && Object.entries(v).every(([k, m]) => estFournisseur(k) && capacitesFournisseur(k).modele && !!validerModele(m)));
    option(c, 'preparationProjets', v => Array.isArray(v) && v.length <= 200 && v.every(p => objet(p) && texte(p.projet) && path.isAbsolute(p.projet)
        && (p.commande === undefined || objet(p.commande) && texte(p.commande.programme) && p.commande.programme.length > 0 && p.commande.programme.length <= 4000 && !/[\x00-\x1f]/.test(p.commande.programme) && Array.isArray(p.commande.args) && p.commande.args.length <= 100 && p.commande.args.every(a => texte(a) && a.length <= 4000 && !a.includes('\0')))
        && (p.fichiersLocaux === undefined || Array.isArray(p.fichiersLocaux) && p.fichiersLocaux.length <= 100 && p.fichiersLocaux.every(f => texte(f) && f.length <= 4000 && !path.isAbsolute(f) && !f.split(/[\\/]/).includes('..') && !/[\x00-\x1f]/.test(f)))));
    option(c, 'maitre', (v) => objet(v) && typeof v.actif === 'boolean' && texte(v.modele)
        && (v.veille === undefined || nombre(v.veille))
        && (v.fournisseur === undefined || ['auto', 'claude-cli', ...Object.keys(FOURNISSEURS)].includes(String(v.fournisseur))));
    if (c.planifications !== undefined) {
        exiger(Array.isArray(c.planifications), 'config.planifications');
        const ids = new Set<string>();
        for (const p of c.planifications) {
            exiger(objet(p) && ['id', 'nom', 'projet', 'consigne'].every((k) => texte(p[k]) && !!p[k]), 'planification');
            exiger(texte(p.id) && !ids.has(p.id), 'planification.id'); ids.add(p.id);
            exiger(texte(p.heure) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.heure), 'planification.heure');
            exiger(Array.isArray(p.jours) && p.jours.every((j) => Number.isInteger(j) && j >= 0 && j <= 6), 'planification.jours');
            exiger(typeof p.actif === 'boolean', 'planification.actif');
            option(p, 'fournisseur', (v) => texte(v) && Object.hasOwn(FOURNISSEURS, v), 'planification');
            option(p, 'modele', v => texte(v) && v.length <= 160 && !/[\x00-\x20\x7f]/.test(v), 'planification');
        }
    }
    if (c.sftp !== undefined) {
        exiger(Array.isArray(c.sftp), 'config.sftp');
        for (const s of c.sftp) {
            exiger(objet(s) && texte(s.nom) && !!s.nom && chaineSsh(s.hote) && chaineSsh(s.utilisateur) && portValide(s.port)
                && (s.auth === 'cle' || s.auth === 'motdepasse'), 'sftp');
            option(s, 'cle', texte, 'sftp'); option(s, 'dossier', texte, 'sftp');
        }
    }
    for (const h of d.ssh) {
        exiger(objet(h), 'ssh'); validerHoteSsh(h as unknown as HoteSsh);
    }
    return d as unknown as ExportConfiguration;
}

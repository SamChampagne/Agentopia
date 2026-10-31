import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { normaliserConfig } from './config.js';
import { decoderEquipes } from './stockageEquipes.js';
import { RACINE_SESSIONS, estIdentifiantSession, validerEtatSession } from './stockageSessions.js';
import { processusVivant, prendreVerrou } from './verrou.js';
import { appliquerTransaction } from './transactionFichiers.js';
import { lireFichierBorne, verifierCheminLocal, ecrireFichierAtomique } from './fichiersProteges.js';

const ZONES = ['config', 'equipes', 'brouillons', 'preparation', 'modelesEquipes', 'verifications', 'utilisation', 'etat', 'historiqueNatif', 'planifications', 'sftpEmpreintes'] as const;
type Zone = typeof ZONES[number] | 'sessions';
type FichierSauve = { zone: Zone; chemin: string; contenu: string; sha256: string };
export interface SauvegardeProfil { format: 'agentopia-sauvegarde-v1'; creee: string; fichiers: FichierSauve[]; exclusions: string[] }
const MAX_FICHIER = 32 * 1024 * 1024, MAX_TOTAL = 128 * 1024 * 1024, MAX_ARCHIVE = 256 * 1024 * 1024;
const empreinte = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const racineZone = (z: Zone) => z === 'sessions' ? RACINE_SESSIONS : CHEMINS[z];
const simple = (s: string) => !!s && !/[\x00-\x1f<>:"|?*\\]/.test(s) && s !== '.' && s !== '..' && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(s);
function cible(z: Zone, nom: string): string {
    if (!ZONES.includes(z as typeof ZONES[number]) && z !== 'sessions') throw new Error('Zone de sauvegarde inconnue');
    const parties = nom ? nom.split('/') : [];
    if (parties.some(p => !simple(p))) throw new Error('Chemin de sauvegarde invalide');
    if (z === 'sessions' && (parties.length !== 2 || !estIdentifiantSession(parties[0]) || !['etat.json', 'etat.sauvegarde.json', 'conversation.jsonl', 'archive'].includes(parties[1]))) throw new Error('Fichier de session non restaurable');
    if (['config', 'equipes', 'preparation', 'etat', 'historiqueNatif', 'planifications', 'sftpEmpreintes'].includes(z) && nom) throw new Error('Zone de fichier invalide');
    if (['brouillons', 'modelesEquipes', 'verifications', 'utilisation'].includes(z) && !nom) throw new Error('Une zone de dossier doit désigner un fichier enfant.');
    return path.join(racineZone(z), ...parties);
}
function fichiersSource(): { zone: Zone; chemin: string; fichier: string }[] {
    const liste: { zone: Zone; chemin: string; fichier: string }[] = [];
    function visiter(z: Zone, f: string, nom: string, profondeur = 0) {
        verifierCheminLocal(f); if (!fs.existsSync(f)) return;
        const st = fs.lstatSync(f); if (profondeur > 12 || liste.length >= 50_000) throw new Error('Profil trop volumineux');
        if (st.isDirectory()) {
            for (const n of fs.readdirSync(f)) {
                if (!simple(n)) throw new Error('Nom de fichier de profil invalide');
                if (n.endsWith('.verrou') || n === 'verrous' || n.endsWith('.execution.json') || n.endsWith('.tmp')) continue;
                visiter(z, path.join(f, n), nom ? `${nom}/${n}` : n, profondeur + 1);
            }
        } else liste.push({ zone: z, chemin: nom, fichier: f });
    }
    for (const z of ZONES) visiter(z, racineZone(z), '');
    verifierCheminLocal(RACINE_SESSIONS);
    if (fs.existsSync(RACINE_SESSIONS)) for (const id of fs.readdirSync(RACINE_SESSIONS).filter(estIdentifiantSession)) {
        for (const nom of ['etat.json', 'etat.sauvegarde.json', 'conversation.jsonl', 'archive']) {
            const f = cible('sessions', `${id}/${nom}`); verifierCheminLocal(f);
            if (fs.existsSync(f)) liste.push({ zone: 'sessions', chemin: `${id}/${nom}`, fichier: f });
        }
    }
    return liste;
}
/** La pause persistante bloque les nouveaux tours ; refuser tout processus qui n'a pas terminé. */
export function verifierProfilAuRepos(): void {
    if (!fs.existsSync(path.join(CHEMINS.moteur, 'pause.json'))) throw new Error('Mets les agents en pause avec /tout-arreter avant cette opération.');
    const demandes = path.join(CHEMINS.moteur, 'commandes');
    verifierCheminLocal(demandes);
    if (fs.existsSync(demandes) && fs.readdirSync(demandes).some(n => /\.(json|en-cours)$/.test(n))) throw new Error('Le moteur termine encore une commande. Réessaie après son arrêt.');
    if (fs.existsSync(CHEMINS.verifications) && fs.readdirSync(CHEMINS.verifications).some(n => n.endsWith('.execution.json'))) throw new Error('Une vérification est active ou son arrêt reste à confirmer.');
    if (!fs.existsSync(RACINE_SESSIONS)) return;
    for (const id of fs.readdirSync(RACINE_SESSIONS).filter(estIdentifiantSession)) {
        for (const nom of ['verrou', 'execution/proprietaire.json', 'importation.verrou/proprietaire.json']) {
            const f = path.join(RACINE_SESSIONS, id, nom); verifierCheminLocal(f);
            if (!fs.existsSync(f)) continue;
            let v: any; try { v = JSON.parse(lireFichierBorne(f, 8192).toString('utf8')); } catch { throw new Error(`État d’exécution incertain pour ${id}. /recuperer-sessions avant cette opération.`); }
            if (processusVivant(v.pid || v.lancement, v.demarragePoste)) throw new Error('Une session ou un terminal travaille encore. Ferme-le ou attends son arrêt.');
        }
    }
}
export function creerSauvegardeProfil(destination: string): { fichiers: number; octets: number } {
    verifierProfilAuRepos(); verifierCheminLocal(destination);
    if (fs.existsSync(destination)) throw new Error('Ce fichier existe déjà. Choisis un autre nom pour préserver ta sauvegarde.');
    const sources = fichiersSource(), fichiers: FichierSauve[] = []; let total = 0;
    for (const f of sources) {
        const b = lireFichierBorne(f.fichier, MAX_FICHIER); total += b.length;
        if (total > MAX_TOTAL) throw new Error('Profil supérieur à 128 Mio : sauvegarde manuelle nécessaire. Aucun fichier modifié.');
        fichiers.push({ zone: f.zone, chemin: f.chemin, contenu: b.toString('base64'), sha256: empreinte(b) });
    }
    verifierProfilAuRepos();
    const apres = fichiersSource();
    if (apres.length !== sources.length || apres.some((f, i) => f.fichier !== sources[i].fichier || empreinte(lireFichierBorne(f.fichier, MAX_FICHIER)) !== fichiers[i].sha256)) throw new Error('Le profil a changé pendant la copie. Ferme les autres fenêtres puis réessaie.');
    const sauvegarde: SauvegardeProfil = { format: 'agentopia-sauvegarde-v1', creee: new Date().toISOString(), fichiers,
        exclusions: ['Coffre, jetons, clés privées et authentifications des CLI', 'Dépôts Git, worktrees et fichiers joints externes (références conservées)', 'Commandes en attente, processus et verrous', 'Configuration SSH partagée et historiques natifs Claude/Codex'] };
    fs.writeFileSync(destination, JSON.stringify(sauvegarde), { flag: 'wx', mode: 0o600 }); return { fichiers: fichiers.length, octets: total };
}
export function lireSauvegardeProfil(fichier: string): SauvegardeProfil {
    const v = JSON.parse(lireFichierBorne(fichier, MAX_ARCHIVE).toString('utf8')) as SauvegardeProfil;
    if (v?.format !== 'agentopia-sauvegarde-v1' || typeof v.creee !== 'string' || !Array.isArray(v.fichiers) || v.fichiers.length > 50_000) throw new Error('Sauvegarde Agentopia invalide');
    const vus = new Set<string>(); let total = 0;
    for (const e of v.fichiers) {
        if (!e || typeof e.zone !== 'string' || typeof e.chemin !== 'string' || typeof e.contenu !== 'string' || e.contenu.length > MAX_FICHIER * 1.34 || !/^[a-f0-9]{64}$/.test(e.sha256)) throw new Error('Entrée de sauvegarde invalide');
        const p = cible(e.zone, e.chemin), cle = process.platform === 'win32' ? p.toLowerCase() : p;
        const b = Buffer.from(e.contenu, 'base64'); total += b.length;
        if (vus.has(cle) || total > MAX_TOTAL || b.length > MAX_FICHIER || empreinte(b) !== e.sha256 || b.toString('base64') !== e.contenu) throw new Error('Sauvegarde altérée, doublonnée ou trop volumineuse');
        vus.add(cle);
        // Prévalidation métier de l'ensemble avant toute écriture.
        adapter(e, b);
    }
    return v;
}
function adapter(e: FichierSauve, b: Buffer): Buffer {
    if (e.zone === 'config') {
        const c = normaliserConfig(JSON.parse(b.toString('utf8'))); c.planifications = c.planifications?.map(p => ({ ...p, actif: false }));
        c.preparationProjets = undefined; // Les commandes de préparation doivent être revues sur ce poste.
        return Buffer.from(JSON.stringify(c, null, 2));
    }
    if (e.zone === 'equipes') {
        const equipes = decoderEquipes(b.toString('utf8'));
        for (const equipe of equipes) {
            if (['en cours', 'integration', 'planification'].includes(equipe.etat)) equipe.etat = 'plan';
            for (const t of [...equipe.taches, ...(equipe.integrateur ? [equipe.integrateur] : [])]) if (['en cours', 'bloquee'].includes(t.etat)) t.etat = 'arretee';
        }
        return Buffer.from(JSON.stringify(equipes));
    }
    if (e.zone === 'sessions' && /\/etat(?:\.sauvegarde)?\.json$/.test(e.chemin)) {
        const s = JSON.parse(b.toString('utf8')); validerEtatSession(s, e.chemin.split('/')[0]);
        s.etat = 'arretee'; s.issue = 'cancelled'; s.pid = undefined; s.demarragePoste = undefined; s.permission = undefined; s.terminalExterne = undefined;
        s.erreur = 'Session restaurée. Vérifie le dossier du projet et reconnecte son fournisseur avant de reprendre.';
        return Buffer.from(JSON.stringify(s));
    }
    return b;
}
export function restaurerSauvegardeProfil(fichier: string): { fichiers: number; journal: string } {
    const sauvegarde = lireSauvegardeProfil(fichier); verifierProfilAuRepos();
    // Une restauration remplace les fichiers concernés, conserve les autres et
    // garde leurs versions précédentes dans un journal permettant d'annuler.
    const fin = prendreVerrou(`${CHEMINS.equipes}.verrou`); if (!fin) throw new Error('Équipes utilisées dans une autre fenêtre.');
    try {
        const journal = `${CHEMINS.config}.restauration.json`;
        const changements = sauvegarde.fichiers.map(e => ({ fichier: cible(e.zone, e.chemin), contenu: adapter(e, Buffer.from(e.contenu, 'base64')) }));
        // La pause est déjà persistée et reste extérieure au journal : la
        // rafraîchir avant une annulation ne doit pas bloquer cette annulation.
        verifierProfilAuRepos(); appliquerTransaction(journal, changements);
        return { fichiers: sauvegarde.fichiers.length, journal };
    } finally { fin(); }
}
export function fichiersRestaurationAutorises(sauvegarde: SauvegardeProfil): string[] {
    return sauvegarde.fichiers.map(e => cible(e.zone, e.chemin));
}

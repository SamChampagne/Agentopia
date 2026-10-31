import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ecrireAtomique } from './stockageAtomique.js';
import { randomUUID } from 'node:crypto';
import { prendreVerrou, sousVerrou, processusVivant } from './verrou.js';
import { lireFichierBorne, verifierCheminLocal } from './fichiersProteges.js';
import type { SessionIntegree, ReponsePermission } from './providers/types.js';
import { estFournisseur, validerModele } from './providers/types.js';

export const RACINE_SESSIONS = path.resolve(process.env.CLAUDETOPIA_DATA_DIR || path.join(os.homedir(), '.claudetopia-agents'));
const MAX_ETAT = 8 * 1024 * 1024;
const objet = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const texte = (v: unknown) => typeof v === 'string' && !v.includes('\0');
const nombre = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const option = (o: Record<string, any>, cle: string, test: (v: any) => boolean) => o[cle] === undefined || test(o[cle]);
export const estIdentifiantSession = (id: unknown): id is string => typeof id === 'string' && /^ct-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export const estIdentifiantPermission = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9_-]{1,128}$/i.test(id);

/** Les profils peuvent vivre ailleurs ; leurs sessions ne peuvent pas rediriger des écritures. */
function refuserLien(cible: string): void {
    try {
        const s = fs.lstatSync(cible);
        if (s.isSymbolicLink() || s.isFile() && s.nlink > 1) throw new Error('Chemin de session invalide : lien ou jonction refusé. Fichiers conservés.');
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
}
export function dossierSession(id: string): string {
    if (!estIdentifiantSession(id)) throw new Error('Identifiant de session invalide');
    const dossier = path.join(RACINE_SESSIONS, id); refuserLien(dossier); return dossier;
}
export function fichierSession(id: string, nom: string): string {
    if (!/^[a-z0-9_.-]+$/i.test(nom) || nom === '.' || nom === '..') throw new Error('Nom de fichier de session invalide');
    const fichier = path.join(dossierSession(id), nom); refuserLien(fichier); return fichier;
}
export function fichierReponsePermission(dossier: string, id: string): string {
    if (!estIdentifiantPermission(id)) throw new Error('Identifiant de permission invalide');
    refuserLien(dossier);
    const fichier = path.join(dossier, `reponse-${id}.json`); refuserLien(fichier); return fichier;
}

function utilisation(v: unknown): boolean {
    return objet(v) && ['entree', 'sortie', 'cache', 'coutUSD'].every((k) => option(v, k, nombre));
}
function permission(v: unknown): boolean {
    return objet(v) && estIdentifiantPermission(v.id) && texte(v.titre) && texte(v.detail)
        && ['commande', 'dossier'].every((k) => option(v, k, texte))
        && option(v, 'action', (a) => ['commande', 'fichiers', 'outil'].includes(a))
        && option(v, 'questions', (q) => Array.isArray(q) && q.every((x) => objet(x) && texte(x.id) && texte(x.question)
            && option(x, 'options', (o) => Array.isArray(o) && o.every(texte))));
}
export function validerEtatSession(v: unknown, id: string): asserts v is SessionIntegree {
    const valide = objet(v) && v.id === id && estIdentifiantSession(v.id)
        && estFournisseur(v.fournisseur) && texte(v.cwd) && path.isAbsolute(v.cwd)
        && texte(v.titre) && nombre(v.creee) && nombre(v.maj) && texte(v.tour) && v.tour.length <= 512
        && ['attend', 'travaille', 'bloquee', 'erreur', 'arretee'].includes(v.etat)
        && ['modele', 'threadId', 'resultat', 'erreur', 'dernierPrompt', 'recuUsage'].every((k) => option(v, k, texte))
        && ['archivee', 'lectureSeule', 'terminalExterne'].every((k) => option(v, k, (x) => typeof x === 'boolean'))
        && option(v, 'pid', (p) => Number.isInteger(p) && p > 0) && option(v, 'demarragePoste', nombre)
        && option(v, 'issue', (x) => ['success', 'error', 'cancelled'].includes(x)) && option(v, 'permission', permission)
        && ['utilisation', 'compteursClaude', 'compteursCodex'].every((k) => option(v, k, utilisation))
        && option(v, 'origine', (o) => objet(o) && o.fournisseur === 'codex' && texte(o.threadId) && typeof o.copieAuProchainMessage === 'boolean')
        && option(v, 'bilan', (b) => objet(b) && Array.isArray(b.commandes) && b.commandes.every((c) => objet(c) && texte(c.commande)
            && option(c, 'codeSortie', Number.isInteger)) && ['fichiers', 'resume'].every((k) => option(b, k, texte))
            && option(b, 'durees', (d) => objet(d) && nombre(d.travailMs) && nombre(d.attenteMs)));
    if (!valide) throw new Error('Métadonnées de session corrompues ou identité incohérente. État et conversation conservés ; restaure une copie valide avant de reprendre.');
    validerModele(v.modele);
}
/** Absence seulement = undefined. Une donnée existante invalide n'est jamais une session neuve. */
export function lireEtatSession(id: string): SessionIntegree | undefined {
    const fichier = fichierSession(id, 'etat.json');
    let contenu: string;
    try {
        if (fs.statSync(fichier).size > MAX_ETAT) throw new Error('Métadonnées de session trop volumineuses. Fichiers conservés.');
        contenu = fs.readFileSync(fichier, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error(`État de session illisible. Fichiers conservés : ${(err as Error).message}`);
    }
    let valeur: unknown;
    try { valeur = JSON.parse(contenu); } catch { throw new Error('Métadonnées de session corrompues (JSON illisible). État et conversation conservés ; restaure une copie valide avant de reprendre.'); }
    validerEtatSession(valeur, id); return valeur;
}
export function sauverEtatSession(s: SessionIntegree): void {
    const nouvelle = { ...s, maj: Date.now() };
    validerEtatSession(nouvelle, s.id);
    if (Buffer.byteLength(JSON.stringify(nouvelle), 'utf8') > MAX_ETAT) throw new Error('Métadonnées de session trop volumineuses. Dernier état conservé.');
    const ancienne = lireEtatSession(s.id); // Ne pas écraser une erreur d'accès, un fichier corrompu ou une autre identité.
    ecrireAtomique(fichierSession(s.id, 'etat.sauvegarde.json'), ancienne || nouvelle);
    ecrireAtomique(fichierSession(s.id, 'etat.json'), nouvelle); s.maj = nouvelle.maj;
}
export interface ProblemeSession { id: string; message: string; sauvegarde: boolean; importAbandonne: boolean }
export function problemesSessions(): ProblemeSession[] {
    let noms: string[]; try { noms = fs.readdirSync(RACINE_SESSIONS); } catch { return []; }
    return noms.filter(estIdentifiantSession).flatMap(id => {
        let message = '', sauvegarde = false, importAbandonne = false;
        try { if (!lireEtatSession(id)) message = 'État absent : conversation conservée.'; } catch (e) { message = (e as Error).message; }
        try { const v = JSON.parse(lireFichierBorne(fichierSession(id, 'etat.sauvegarde.json'), MAX_ETAT).toString('utf8')); validerEtatSession(v, id); sauvegarde = true; } catch { /* Offre seulement une copie validée. */ }
        try { importAbandonne = Date.now() - fs.statSync(fichierSession(id, 'importation')).mtimeMs > 30_000; } catch { /* Ancien import absent. */ }
        if (importAbandonne) message ||= 'Ancien import interrompu : verrou conservé.';
        return message ? [{ id, message, sauvegarde, importAbandonne }] : [];
    });
}
export function restaurerEtatSession(id: string, source = fichierSession(id, 'etat.sauvegarde.json')): string {
    return sousVerrou(fichierSession(id, 'operation'), () => {
        const liberer = prendreVerrou(fichierSession(id, 'execution')); if (!liberer) throw new Error('Session encore utilisée : récupération refusée.');
        try {
            const verrou = fichierSession(id, 'verrou');
            try { const v = JSON.parse(lireFichierBorne(verrou, 8192).toString('utf8')); if (processusVivant(v.pid || v.lancement, v.demarragePoste)) throw new Error('Un processus utilise encore cette session.'); }
            catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
            const s = JSON.parse(lireFichierBorne(source, MAX_ETAT).toString('utf8')); validerEtatSession(s, id);
            const copie = fichierSession(id, `etat.avant-recuperation-${randomUUID()}.json`);
            try { fs.writeFileSync(copie, lireFichierBorne(fichierSession(id, 'etat.json'), MAX_ETAT), { flag: 'wx', mode: 0o600 }); }
            catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
            s.etat = 'arretee'; s.issue = 'cancelled'; s.erreur = 'Session récupérée : relis la conversation avant de reprendre.';
            s.pid = undefined; s.demarragePoste = undefined; s.permission = undefined; s.terminalExterne = undefined; s.maj = Date.now();
            ecrireAtomique(fichierSession(id, 'etat.json'), s);
            for (const nom of ['verrou', 'requete.json', 'importation']) {
                const f = fichierSession(id, nom); verifierCheminLocal(f);
                if (fs.existsSync(f)) fs.renameSync(f, fichierSession(id, `${nom}.recup-${randomUUID()}`));
            }
            return copie;
        } finally { liberer(); }
    });
}
export function validerReponsePermission(r: unknown): ReponsePermission {
    if (!objet(r) || typeof r.accepte !== 'boolean' || !option(r, 'reponses', (v) => objet(v) && Object.values(v).every(texte)))
        throw new Error('Réponse de permission invalide');
    return { accepte: r.accepte, ...(r.reponses ? { reponses: Object.fromEntries(Object.entries(r.reponses)) as Record<string, string> } : {}) };
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CHEMINS, surPath } from './chemins.js';
import { sauverConfig, type Config } from './config.js';
import { FOURNISSEURS, type Fournisseur } from './providers/types.js';
import { disponibilite } from './providers/config.js';
import { verifierConnexion, type EtatConnexion } from './providers/connexion.js';
import { guiderConnexion } from './providers/assistantConnexion.js';
import { installerOutil } from './preparerOutils.js';
import { scanner, doublons, correspondFiltre, type ResultatScan } from './scan.js';
import { Annule, bus, choisir, choisirPlusieurs, tache } from './ui/bus.js';
import { ecrireAtomique } from './sessionsIntegrees.js';

export interface Preparation {
    version: 1;
    selection?: Fournisseur[];
    ignores: Fournisseur[];
    projetsVus: string[];
    projetsTermines: boolean;
    etats: Partial<Record<Fournisseur, EtatConnexion & { date: number }>>;
    terminee?: boolean;
}
export function lirePreparation(fichier = CHEMINS.preparation): Preparation {
    try {
        const p = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        if (p.version !== 1 || !Array.isArray(p.projetsVus) || !Array.isArray(p.ignores)) throw new Error();
        const fournisseurs = (liste: unknown) => Array.isArray(liste) ? [...new Set(liste.filter((f): f is Fournisseur => typeof f === 'string' && Object.hasOwn(FOURNISSEURS, f)))] : [];
        return { ...p, selection: p.selection === undefined ? undefined : fournisseurs(p.selection), ignores: fournisseurs(p.ignores),
            projetsVus: p.projetsVus.filter((v: unknown) => typeof v === 'string'), etats: p.etats && typeof p.etats === 'object' ? p.etats : {} };
    } catch { return { version: 1, ignores: [], projetsVus: [], projetsTermines: false, etats: {} }; }
}
export const preparationAReprendre = () => !lirePreparation().terminee;
const norme = (s: string) => path.resolve(s).toLowerCase();
const servicesPreparation = {
    scanner, choisir, choisirPlusieurs, verifier: verifierConnexion, connecter: (f: Fournisseur) => guiderConnexion(f, true),
    installer: installerOutil, present: surPath, disponibilite,
    sauvegarderConfig: sauverConfig,
    rafraichir: async () => { const c = await import('./commandes.js'); c.rafraichirProjets(); },
    historique: async () => { const h = await import('./historiqueAgents.js'); return h.actualiserHistoriqueNatif(); },
};

// Le même parcours sert au premier lancement, après installation, et à chaque nouveau scan.
// Chaque choix est sauvegardé avant l'étape suivante ; aucun secret n'est enregistré dans ce reçu.
export async function preparerPoste(config: Config, options: { rescan?: boolean; filtre?: string; fichier?: string } = {}, services = servicesPreparation): Promise<Preparation> {
    const fichier = options.fichier ?? CHEMINS.preparation;
    const etat = lirePreparation(fichier);
    const sauver = () => { fs.mkdirSync(path.dirname(fichier), { recursive: true }); ecrireAtomique(fichier, etat); };
    etat.terminee = false; sauver();
    if (!etat.projetsTermines || options.rescan) {
        const scan: ResultatScan = await tache('Recherche de tes projets', () => services.scanner((vus, n) => bus.emit('tache', `Recherche · ${vus} dossiers · ${n} projets`)));
        const copies = doublons(scan.projets);
        const connus = new Set([...etat.projetsVus, ...config.extras].map(norme));
        const racines = new Set(config.racines.map(norme));
        const nouveaux = scan.projets.filter((p) => !p.worktree && !connus.has(norme(p.chemin)) && !racines.has(norme(path.dirname(p.chemin)))
            && (!options.filtre || correspondFiltre(p, options.filtre))).sort((a, b) => b.activite.getTime() - a.activite.getTime());
        if (nouveaux.length) {
            const selection = await services.choisirPlusieurs('Quels projets veux-tu suivre ? Les projets récents sont déjà cochés.', nouveaux.map((p) => ({
                label: p.nom, valeur: p.chemin, description: `${p.chemin}${copies.has(p) ? ' · copie du même dépôt' : ''}`,
                coche: !copies.has(p) && p.activite.getTime() > Date.now() - 365 * 86_400_000 && !/[/\\]Downloads[/\\]/i.test(p.chemin),
            })));
            config.extras = [...new Set([...config.extras, ...selection])];
            services.sauvegarderConfig(config);
            etat.projetsVus = [...new Set([...etat.projetsVus, ...nouveaux.map((p) => p.chemin)])];
        }
        etat.projetsTermines = true; sauver(); await services.rafraichir();
    }
    if (!etat.selection) {
        etat.selection = await services.choisirPlusieurs('Quels agents veux-tu utiliser ? Tu pourras en ajouter dans Config.', (Object.keys(FOURNISSEURS) as Fournisseur[]).map((f) => ({
            label: FOURNISSEURS[f].nom, valeur: f, coche: services.disponibilite(f).pret,
            description: `${FOURNISSEURS[f].capacite} · ${services.disponibilite(f).texte}`,
        })));
        sauver();
    }
    if (etat.selection.some((f) => f !== 'perplexity') && !services.present('git')) {
        const action = await services.choisir('Git manque pour suivre les changements et faire travailler une équipe.', [
            { label: 'Installer et continuer', valeur: 'installer' }, { label: 'Continuer sans Git', valeur: 'passer' },
        ], false);
        if (action === 'installer') await tache('Installation de Git', () => services.installer('git'));
    }
    for (const f of etat.selection) {
        if (!Object.hasOwn(FOURNISSEURS, f) || etat.ignores.includes(f)) continue;
        let resultat: EtatConnexion;
        try {
            if (f === 'codex' && !services.present('codex')) await tache('Installation de Codex', () => services.installer('codex'));
            resultat = await tache(`Vérification ${FOURNISSEURS[f].nom}`, () => services.verifier(f));
            while (!resultat.pret) {
                const action = await services.choisir(`${FOURNISSEURS[f].nom} · ${resultat.texte}`, [
                    { label: 'Connecter et continuer', valeur: 'connecter' },
                    { label: 'Passer pour le moment', valeur: 'passer' },
                ], false);
                if (action === 'passer') { etat.ignores.push(f); break; }
                await services.connecter(f);
                resultat = await services.verifier(f);
            }
        } catch (e) {
            if (e instanceof Annule || (e as Error).name === 'Annule') throw e;
            resultat = { pret: false, texte: (e as Error).message };
        }
        etat.etats[f] = { ...resultat, date: Date.now() }; sauver();
    }
    const prets = etat.selection.filter((f) => !etat.ignores.includes(f) && etat.etats[f]?.pret);
    if (prets.length === 1 && (!config.fournisseurDefaut || config.fournisseurDefaut === 'choisir')) {
        config.fournisseurDefaut = prets[0]; services.sauvegarderConfig(config);
    }
    // L'inventaire ne reprend aucune conversation et ne lance aucun modèle.
    try {
        const inventaire = await tache('Retrouver tes conversations', () => services.historique());
        if (inventaire.erreur) bus.emit('notice', inventaire.erreur);
    }
    catch { bus.emit('notice', 'Historique indisponible pour le moment · réessaie depuis Historique des agents'); }
    etat.terminee = etat.selection.every((f) => etat.ignores.includes(f) || etat.etats[f]?.pret); sauver();
    const bilan = etat.selection.map((f) => `${FOURNISSEURS[f].nom} : ${etat.ignores.includes(f) ? 'reporté' : etat.etats[f]?.pret ? 'connecté' : 'à terminer'}`).join(' · ');
    console.log(`${etat.terminee ? 'Préparation enregistrée' : 'Préparation à reprendre'}${bilan ? ` · ${bilan}` : ' · aucun agent sélectionné'}`);
    bus.emit('notice', etat.terminee ? 'Choisis un projet et écris ce que tu veux faire.' : 'Une étape reste à terminer · Config → Préparer le poste');
    return etat;
}

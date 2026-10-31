import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { DOSSIER_MOTEUR, VERSION_MOTEUR, moteurEnPause, type ActionMoteur } from './moteurClient.js';
import { prendreVerrou } from './verrou.js';
import { ecrireAtomique, listerIntegrees, interrompreIntegree, envoyerIntegree } from './sessionsIntegrees.js';
import * as equipes from './equipe.js';
import { listerAgents, arreterArrierePlan } from './agents.js';
import { verifierPlanifications, lancerPlanification } from './planificateur.js';
import { chargerConfig } from './config.js';
import { toast } from './notifications.js';
import { annulerOperationsGit, dansOperationGit } from './gitExecution.js';
import { journaliserDiagnostic, installerDiagnostics } from './diagnostics.js';

// Un seul moteur par dossier de données ; aucun serveur réseau et aucune génération au démarrage.
export async function executerMoteur(options: { envoyer?: typeof envoyerIntegree; intervalle?: number; signal?: AbortSignal } = {}): Promise<void> {
    installerDiagnostics();
    process.env.AGENTOPIA_MOTEUR = '1';
    const liberer = prendreVerrou(path.join(DOSSIER_MOTEUR, 'instance'));
    if (!liberer) return;
    const commandes = path.join(DOSSIER_MOTEUR, 'commandes'); fs.mkdirSync(commandes, { recursive: true });
    let arrete = false, dernierePlanification = 0, erreur: string | undefined;
    const operations = new Map<string, { id?: string; controle: AbortController; promesse: Promise<void> }>();
    const interrompre = (id?: string) => { for (const o of operations.values()) if (!id || o.id === id) o.controle.abort(); equipes.interromprePreparationEquipe(id); };
    const etat = () => ecrireAtomique(path.join(DOSSIER_MOTEUR, 'etat.json'), { pid: process.pid, date: Date.now(), erreur, version: VERSION_MOTEUR });
    const finir = () => { arrete = true; };
    process.once('SIGTERM', finir); process.once('SIGINT', finir);
    const pouls = setInterval(() => {
        try {
        etat();
        if (moteurEnPause()) { interrompre(); annulerOperationsGit(); }
        // Une préparation Git attendue par la boucle doit rester interruptible depuis l'UI.
        for (const f of fs.readdirSync(commandes).filter((n) => n.endsWith('.json'))) try {
            const c = JSON.parse(fs.readFileSync(path.join(commandes, f), 'utf8'));
            if (c.action === 'arreter' || c.action === 'ranger') interrompre(c.id);
            if (c.action === 'tout-arreter') { interrompre(); annulerOperationsGit(); }
        } catch { /* La boucle de commandes fournira le diagnostic. */ }
        } catch (e) { journaliserDiagnostic('moteur.pouls', e); }
    }, 500); etat();
    const actions: Record<ActionMoteur, (id: string, tache: string, donnees?: any) => unknown> = {
        lancer: equipes.lancerEquipe, arreter: equipes.arreterEquipe,
        integrer: (id) => equipes.integrer(id, options.envoyer ?? envoyerIntegree), relancer: equipes.relancerTache,
        'modifier-plan': (id, _tache, donnees) => equipes.modifierPlan(id, donnees),
        'annuler-attente': equipes.annulerAttenteTache,
        'recuperer-equipes': (_id, _tache, donnees) => equipes.recupererEquipes(donnees?.empreinte),
        reprendre: (id, tache) => equipes.reprendreTache(id, tache, options.envoyer ?? envoyerIntegree),
        ecarter: equipes.basculerEcart, retirer: equipes.retirerTache, ranger: equipes.terminerEquipe,
        planification: (id) => {
            const p = chargerConfig().planifications?.find((p) => p.id === id);
            if (!p) throw new Error('Tâche planifiée introuvable');
            return lancerPlanification(p);
        },
        'tout-arreter': async () => {
            for (const s of listerIntegrees()) interrompreIntegree(s.id);
            if (!options.envoyer) for (const s of await listerAgents()) if (!s.integree && s.arrierePlan && s.id) await arreterArrierePlan(s.id);
            if (!equipes.erreurStockageEquipes()) for (const e of equipes.lireEquipes()) if (['en cours', 'integration'].includes(e.etat)) await equipes.arreterEquipe(e.id);
        },
    };
    try {
        // Une commande interrompue n'est jamais rejouée aveuglément (ex. écarter une branche).
        for (const f of fs.readdirSync(commandes).filter((n) => n.endsWith('.en-cours'))) {
            ecrireAtomique(path.join(commandes, f.replace('.en-cours', '.reponse')), { erreur: 'Opération interrompue. Consulte l’état de l’équipe avant de réessayer.' });
            fs.rmSync(path.join(commandes, f), { force: true });
        }
        while (!arrete && !options.signal?.aborted) {
            try {
                if (!operations.size && !equipes.lancementsEnCours()) try { equipes.rechargerEquipes(); } catch { /* La file doit rester disponible pour récupérer ou arrêter. */ }
                for (const f of fs.readdirSync(commandes).filter((n) => n.endsWith('.json')).sort()) {
                    const fichier = path.join(commandes, f), enCours = fichier.replace(/\.json$/, '.en-cours');
                    let apercu: any; try { apercu = JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { /* Diagnostic dans le traitement normal. */ }
                    const prioritaire = ['arreter', 'ranger', 'tout-arreter', 'annuler-attente'].includes(apercu?.action);
                    if (!prioritaire && [...operations.values()].some((o) => o.id === apercu?.id)) continue;
                    if (prioritaire && apercu?.action !== 'annuler-attente') interrompre(apercu?.id);
                    fs.renameSync(fichier, enCours);
                    const controle = new AbortController();
                    const promesse = dansOperationGit(controle.signal, async () => {
                    let resultat: unknown, echec: string | undefined;
                    try {
                        const c = JSON.parse(fs.readFileSync(enCours, 'utf8'));
                        if (!Object.hasOwn(actions, c.action)) throw new Error('Commande moteur inconnue');
                        if (equipes.erreurStockageEquipes() && !['recuperer-equipes', 'tout-arreter'].includes(c.action)) throw new Error(equipes.erreurStockageEquipes());
                        if (Date.now() - c.creee > 120_000) throw new Error('Demande expirée ; relance-la depuis l’équipe');
                        if (moteurEnPause() && ['lancer', 'integrer', 'relancer', 'reprendre', 'planification'].includes(c.action)) throw new Error('Tout est en pause · Reprendre le moteur avant de lancer une tâche');
                        resultat = await actions[c.action as ActionMoteur](c.id, c.tache, c.donnees);
                    } catch (e) { echec = (e as Error).message; journaliserDiagnostic('moteur.commande', e); }
                    ecrireAtomique(fichier.replace(/\.json$/, '.reponse'), { resultat, erreur: echec });
                    fs.rmSync(enCours, { force: true });
                    });
                    operations.set(f, { id: apercu?.id, controle, promesse });
                    void promesse.catch((e) => journaliserDiagnostic('moteur.reponse', e)).finally(() => operations.delete(f));
                }
                if (equipes.erreurStockageEquipes()) throw new Error(equipes.erreurStockageEquipes());
                if (!moteurEnPause()) {
                    listerIntegrees(); // détecter les workers disparus avant de suivre leur tâche
                    const natives = equipes.lireEquipes().some((e) => !e.mixte && ['en cours', 'integration'].includes(e.etat)) ? await listerAgents() : [];
                    await equipes.avancerEquipes(natives, { envoyer: options.envoyer ?? envoyerIntegree, notifier: toast });
                    if (!options.envoyer && Date.now() - dernierePlanification > 60_000) { dernierePlanification = Date.now(); await verifierPlanifications(); }
                }
                erreur = undefined;
            } catch (e) { journaliserDiagnostic('moteur.boucle', e); erreur = (e as Error).message.replace(/(?:sk-|pplx-)[\w-]+/g, '[clé masquée]').slice(0, 300); }
            etat(); await pause(options.intervalle ?? 1500);
        }
    } finally { interrompre(); await Promise.allSettled([...operations.values()].map((o) => o.promesse)); await equipes.attendreLancements(); clearInterval(pouls); process.off('SIGTERM', finir); process.off('SIGINT', finir); liberer(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void executerMoteur().catch(() => { process.exitCode = 1; });
}

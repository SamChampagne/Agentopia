import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Commande } from './commandes.js';
import { type Config, CHEMIN_CONFIG, chargerConfig } from './config.js';
import { CHEMINS } from './chemins.js';
import { bureau } from './configCommandes.js';
import { coffreSecrets } from './jetons.js';
import { FICHIER_SSH } from './sshConfig.js';
import { restaurerTransaction } from './transactionFichiers.js';
import { problemesSessions, restaurerEtatSession } from './stockageSessions.js';
import { creerSauvegardeProfil, lireSauvegardeProfil, restaurerSauvegardeProfil, fichiersRestaurationAutorises } from './sauvegardeProfil.js';
import { etatMoteur, pauseGlobale } from './moteurClient.js';
import { ecrireFichierAtomique } from './fichiersProteges.js';
import { choisir, saisir, confirmer, tache } from './ui/bus.js';

async function preparerPause(): Promise<void> {
    if (!await confirmer('Mettre les agents en pause pour conserver des données cohérentes ? Aucun travail ne reprendra automatiquement après cette opération.')) throw new Error('Opération annulée.');
    if (etatMoteur().actif) await pauseGlobale();
    else ecrireFichierAtomique(path.join(CHEMINS.moteur, 'pause.json'), JSON.stringify({ date: Date.now() }));
}
export function commandesRecuperation(config: Config): Commande[] {
    return [
        { nom: 'recuperer-coffre', groupe: 'Config', description: 'Restaurer la dernière sauvegarde chiffrée des connexions', executer: async () => {
            const v = coffreSecrets.lire(coffreSecrets.sauvegarde);
            if (!await confirmer(`Restaurer ${Object.keys(v).length} entrée(s) du coffre ? Le fichier actuel sera conservé à part. Ces secrets restent liés à ce compte Windows.`)) return;
            const copie = coffreSecrets.restaurer(); console.log(`Coffre restauré. ${copie ? `Original conservé : ${copie}. ` : ''}Relance Agentopia pour revérifier les connexions.`);
        } },
        { nom: 'recuperer-importation', groupe: 'Config', description: 'Annuler le dernier import de réglages et SSH sans effacer des modifications ultérieures', executer: async () => {
            if (!await confirmer('Restaurer les fichiers précédant le dernier import ? Un fichier modifié depuis cet import bloquera la récupération automatique.')) return;
            restaurerTransaction(`${CHEMIN_CONFIG}.importation.json`, [CHEMIN_CONFIG, `${CHEMIN_CONFIG}.sauvegarde.json`, FICHIER_SSH]);
            Object.assign(config, chargerConfig()); console.log('Import annulé, fichiers précédents restaurés. Relance Agentopia pour appliquer les réglages.');
        } },
        { nom: 'recuperer-sessions', groupe: 'Config', description: 'Voir les sessions illisibles et restaurer un état valide sans perdre leur conversation', executer: async () => {
            const problemes = problemesSessions();
            if (!problemes.length) { console.log('Aucune session illisible détectée.'); return; }
            const p = await choisir('Sessions à récupérer (les conversations restent conservées)', problemes.map(p => ({ label: p.id, description: p.message, valeur: p })), false);
            const source = p.sauvegarde ? undefined : (await saisir('Chemin d’une copie valide de etat.json pour cette même session')).trim().replace(/^"|"$/g, '');
            if (source === '') return;
            if (!await confirmer('Restaurer cet état ? Le fichier actuel sera conservé, la conversation restera intacte et la session sera arrêtée.')) return;
            const copie = restaurerEtatSession(p.id, source); console.log(`Session récupérée et arrêtée. Original conservé si présent : ${copie}. Relis la conversation avant de reprendre.`);
        } },
        { nom: 'sauvegarder', alias: ['backup'], groupe: 'Config', args: '[fichier]', description: 'Sauvegarder les réglages, équipes, conversations et preuves Agentopia', executer: async ({ reste }) => {
            const destination = (reste || await saisir('Fichier de sauvegarde', path.join(bureau(), `Agentopia-sauvegarde-${new Date().toISOString().replace(/[:.]/g, '-')}.json`))).trim().replace(/^"|"$/g, '');
            if (!destination) return;
            console.log('Inclus : données Agentopia, conversations, équipes, brouillons et preuves. Exclus : coffre, clés et comptes des CLI, dépôts/worktrees, historique natif et fichiers joints externes. Les conversations peuvent contenir des informations sensibles.');
            await preparerPause();
            const r = await tache('Sauvegarde du profil Agentopia', async () => creerSauvegardeProfil(destination));
            console.log(`Sauvegarde créée : ${destination} · ${r.fichiers} fichiers · ${(r.octets / 1048576).toFixed(1)} Mio. Les agents restent en pause.`);
        } },
        { nom: 'restaurer-sauvegarde', groupe: 'Config', args: '[fichier]', description: 'Restaurer une sauvegarde Agentopia, avec tous les agents et planifications en pause', executer: async ({ reste }) => {
            const fichier = (reste || await saisir('Sauvegarde Agentopia à restaurer')).trim().replace(/^"|"$/g, ''); if (!fichier) return;
            const sauvegarde = lireSauvegardeProfil(fichier);
            if (!await confirmer(`Restaurer ${sauvegarde.fichiers.length} fichiers du ${sauvegarde.creee} ? Les fichiers concernés seront remplacés et leurs versions précédentes conservées. Projets, CLI et secrets ne sont pas inclus.`)) return;
            await preparerPause();
            const r = await tache('Restauration du profil Agentopia', async () => restaurerSauvegardeProfil(fichier));
            console.log(`${r.fichiers} fichiers restaurés. Relance Agentopia ; les agents et tâches restent en pause. Vérifie les chemins des projets, reconfigure leurs préparations et reconnecte les fournisseurs. Copie de récupération : ${r.journal}`);
        } },
        { nom: 'annuler-restauration', groupe: 'Config', args: '[sauvegarde]', description: 'Annuler la dernière restauration si ses fichiers n’ont pas été modifiés depuis', executer: async ({ reste }) => {
            const fichier = (reste || await saisir('Sauvegarde utilisée lors de la restauration')).trim().replace(/^"|"$/g, ''); if (!fichier) return;
            const sauvegarde = lireSauvegardeProfil(fichier);
            if (!await confirmer('Annuler la dernière restauration ? Les changements effectués depuis bloqueront l’opération.')) return;
            await preparerPause(); restaurerTransaction(`${CHEMIN_CONFIG}.restauration.json`, fichiersRestaurationAutorises(sauvegarde));
            ecrireFichierAtomique(path.join(CHEMINS.moteur, 'pause.json'), JSON.stringify({ date: Date.now() }));
            console.log('Restauration annulée. Relance Agentopia ; les agents restent en pause.');
        } },
    ];
}

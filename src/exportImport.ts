import * as fs from 'fs';
import * as path from 'path';
import type { Commande } from './commandes.js';
import { Config, CHEMIN_CONFIG, normaliserConfig } from './config.js';
import { lireHotes, preparerImportHotes, clesDisponibles } from './sshConfig.js';
import { appliquerTransaction } from './transactionFichiers.js';
import { lireFichierBorne } from './fichiersProteges.js';
import { bureau } from './configCommandes.js';
import { confirmer, saisir } from './ui/bus.js';
import { c } from './theme.js';
import { validerExportConfiguration, type ExportConfiguration } from './importConfiguration.js';
import { listerProjets } from './projets.js';

// Emporter sa configuration sur un autre poste : réglages, prompts, tâches planifiées, dossiers de projets,
// serveurs SSH et connexions SFTP. Jamais de secret : ni jetons, ni mots de passe, ni clés privées.

// Réglages copiés tels quels (les chemins et les secrets sont traités à part)
const REGLAGES: (keyof Config)[] = ['banniere', 'prenom', 'theme', 'couleurs', 'notifications', 'prompts', 'lancement', 'fournisseurDefaut', 'equipe', 'maitre',
    'fetchAuto', 'sectionsMasquees', 'sectionsRepliees','cartesDetaillees', 'budgetJour', 'largeurLaterale', 'dockerDistant', 'modelesFournisseurs', 'preparationProjets'];

const nomDe = (chemin: string) => path.basename(chemin.replace(/[\\/]+$/, ''));
const dossierPresent = (chemin: string) => { try { return fs.statSync(chemin).isDirectory(); } catch { return false; } };
const cleChemin = (chemin: string) => process.platform === 'win32' ? path.resolve(chemin).toLowerCase() : path.resolve(chemin);

export function commandesExport(config: Config): Commande[] {
    return [
        {
            nom: 'exporter', groupe: 'Config',
            description: 'Exporter sa configuration (sans aucun secret) pour un autre poste',
            executer: async () => {
                const donnees: ExportConfiguration = {
                    format: 'claudetopia-export', version: 1, date: new Date().toISOString(), poste: process.env.COMPUTERNAME ?? '',
                    config: {
                        ...Object.fromEntries(REGLAGES.map((k) => [k, config[k]])),
                        racines: config.racines, extras: config.extras,
                        planifications: config.planifications ?? [],
                        sftp: config.sftp ?? [],   // le mot de passe n'y est pas : il est chiffré à part, sur ce poste seulement
                    },
                    // Le chemin des clés privées ne voyage pas : seulement leur nom, pour retrouver une clé du même nom
                    ssh: lireHotes().map((h) => ({ ...h, cle: h.cle ? path.basename(h.cle) : undefined })),
                };
                const fichier = path.join(process.env.CLAUDETOPIA_DOSSIER_EXPORT ?? bureau(), 'claudetopia-export.json');
                fs.writeFileSync(fichier, JSON.stringify(donnees, null, 2), 'utf-8');
                console.log(c.succes(`✓ Exporté : ${fichier}`));
                console.log(c.discret(`${Object.keys(config.prompts).length} prompts · ${(config.planifications ?? []).length} tâche(s) planifiée(s) · ${donnees.ssh.length} serveur(s) SSH · ${(config.sftp ?? []).length} connexion(s) SFTP`));
                console.log(c.discret('Aucun secret dedans (jetons, mots de passe, clés). Sur l\'autre poste : /importer, puis /connexions pour reconnecter les comptes.'));
            },
        },
        {
            nom: 'importer', args: '[fichier]', groupe: 'Config',
            description: 'Importer la configuration exportée d\'un autre poste',
            executer: async ({ reste }) => {
                const fichier = (reste || await saisir('Fichier à importer', path.join(process.env.CLAUDETOPIA_DOSSIER_EXPORT ?? bureau(), 'claudetopia-export.json'))).trim().replace(/^"|"$/g, '');
                let lu: unknown;
                try {
                    const fd = fs.openSync(fichier, 'r');
                    try {
                        const st = fs.fstatSync(fd);
                        if (!st.isFile() || st.size > 4 * 1024 * 1024) throw new Error('Fichier d’import limité à 4 Mo');
                        const contenu = Buffer.alloc(st.size + 1);
                        const lus = fs.readSync(fd, contenu, 0, contenu.length, 0);
                        if (lus > st.size) throw new Error('Le fichier d’import a changé pendant la lecture');
                        lu = JSON.parse(contenu.subarray(0, lus).toString('utf8'));
                    } finally { fs.closeSync(fd); }
                } catch {
                    return console.log(c.erreur(`✕ Fichier illisible ou supérieur à 4 Mo : ${fichier}`));
                }
                const d = validerExportConfiguration(lu);
                const resume = `${Object.keys(d.config.prompts ?? {}).length} prompts, ${(d.config.planifications ?? []).length} tâche(s) planifiée(s), ${d.ssh.length} serveur(s) SSH, ${(d.config.sftp ?? []).length} connexion(s) SFTP`;
                const date = d.date && Number.isFinite(Date.parse(d.date)) ? ` (${new Date(d.date).toLocaleDateString('fr-CA')})` : '';
                if (!await confirmer(`Importer la configuration de ${d.poste || 'l\'autre poste'}${date} : ${resume} ? Les tâches importées resteront en pause.`)) return;

                const notes: string[] = [];
                const candidate = structuredClone(config);
                for (const k of REGLAGES) {
                    if (d.config[k] === undefined) continue;
                    // Les prompts s'ajoutent à ceux d'ici, le reste remplace
                    if (k === 'prompts') candidate.prompts = { ...d.config.prompts, ...config.prompts };
                    else if (k === 'preparationProjets') notes.push('Préparations de projets non activées : reconfigure les commandes et fichiers locaux sur ce poste avant utilisation.');
                    else (candidate as unknown as Record<string, unknown>)[k] = d.config[k];
                }
                // Dossiers de projets : seulement ceux qui existent sur ce poste
                const racines = [...new Set(d.config.racines ?? [])].filter((r) => dossierPresent(r) && !config.racines.includes(r));
                const extras = [...new Set(d.config.extras ?? [])].filter((r) => dossierPresent(r) && !config.extras.includes(r));
                candidate.racines.push(...racines);
                candidate.extras.push(...extras);
                const absents = [...(d.config.racines ?? []), ...(d.config.extras ?? [])].filter((r) => !dossierPresent(r));
                if (absents.length) notes.push(`${absents.length} dossier(s) de projets absent(s) ici (ignorés) : /scan pour chercher les projets de ce poste`);

                // Tâches planifiées : le projet est retrouvé par son nom
                const { rafraichirProjets } = await import('./commandes.js');
                const projets = listerProjets(candidate);
                for (const p of d.config.planifications ?? []) {
                    if ((config.planifications ?? []).some((x) => x.id === p.id)) continue;
                    const exact = projets.find((x) => cleChemin(x.chemin) === cleChemin(p.projet));
                    const correspondants = exact ? [exact] : projets.filter((x) => x.nom.toLowerCase() === nomDe(p.projet).toLowerCase());
                    if (correspondants.length !== 1) {
                        notes.push(`tâche « ${p.nom} » ignorée : projet ${nomDe(p.projet)} ${correspondants.length ? 'ambigu (plusieurs dossiers)' : 'absent de ce poste'}`);
                        continue;
                    }
                    candidate.planifications = [...(candidate.planifications ?? []), { ...p, projet: correspondants[0].chemin, actif: false }];
                    notes.push(`tâche « ${p.nom} » importée en pause · /planifications pour la vérifier et l’activer`);
                }
                // SFTP : les connexions par mot de passe devront le ressaisir (il ne voyage pas)
                for (const s of d.config.sftp ?? []) {
                    if ((candidate.sftp ?? []).some((x) => x.nom === s.nom)) continue;
                    candidate.sftp = [...(candidate.sftp ?? []), s];
                    if (s.auth === 'motdepasse') notes.push(`SFTP « ${s.nom} » : ressaisis le mot de passe avec /sftp-modifier ${s.nom}`);
                }
                // Serveurs SSH absents d'ici ; la clé, si une clé du même nom existe sur ce poste
                const cles = clesDisponibles();
                const ssh = preparerImportHotes(d.ssh.map(h => ({ ...h, cle: h.cle ? cles.find(k => path.basename(k) === h.cle) : undefined })));
                const changements: { fichier: string; contenu: string | Buffer }[] = [];
                if (fs.existsSync(CHEMIN_CONFIG)) changements.push({ fichier: `${CHEMIN_CONFIG}.sauvegarde.json`, contenu: lireFichierBorne(CHEMIN_CONFIG, 8 * 1024 * 1024) });
                if (ssh.ajoutes) changements.push({ fichier: ssh.fichier, contenu: ssh.contenu });
                changements.push({ fichier: CHEMIN_CONFIG, contenu: JSON.stringify(normaliserConfig(candidate), null, 2) });
                appliquerTransaction(`${CHEMIN_CONFIG}.importation.json`, changements);
                Object.assign(config, candidate); rafraichirProjets();
                const ajoutes = ssh.ajoutes;
                console.log(c.succes(`✓ Configuration importée · ${racines.length + extras.length} dossier(s) de projets, ${ajoutes} serveur(s) SSH ajoutés`));
                notes.forEach((n) => console.log(c.alerte(`! ${n}`)));
                console.log(c.discret('Comptes et jetons : /connexions · relance Agentopia pour appliquer le thème et la mise en page'));
            },
        },
    ];
}

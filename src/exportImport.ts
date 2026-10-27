import * as fs from 'fs';
import * as path from 'path';
import type { Commande } from './commandes.js';
import { Config, sauverConfig } from './config.js';
import { lireHotes, enregistrerHote, clesDisponibles, HoteSsh } from './sshConfig.js';
import { bureau } from './configCommandes.js';
import { confirmer, saisir } from './ui/bus.js';
import { c } from './theme.js';

// Emporter sa configuration sur un autre poste : réglages, prompts, tâches planifiées, dossiers de projets,
// serveurs SSH et connexions SFTP. Jamais de secret : ni jetons, ni mots de passe, ni clés privées.

interface Export {
    format: 'claudetopia-export';
    version: 1;
    date: string;
    poste: string;
    config: Partial<Config>;
    ssh: HoteSsh[];
}

// Réglages copiés tels quels (les chemins et les secrets sont traités à part)
const REGLAGES: (keyof Config)[] = ['banniere', 'prenom', 'theme', 'couleurs', 'notifications', 'prompts', 'lancement', 'equipe', 'maitre',
    'fetchAuto', 'sectionsMasquees', 'sectionsRepliees', 'modeClair', 'cartesDetaillees', 'budgetJour', 'largeurLaterale', 'dockerDistant'];

const nomDe = (chemin: string) => path.basename(chemin.replace(/[\\/]+$/, ''));

export function commandesExport(config: Config): Commande[] {
    return [
        {
            nom: 'exporter', groupe: 'Config',
            description: 'Exporter sa configuration (sans aucun secret) pour un autre poste',
            executer: async () => {
                const donnees: Export = {
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
                let d: Export;
                try {
                    d = JSON.parse(fs.readFileSync(fichier, 'utf-8'));
                } catch {
                    return console.log(c.erreur(`✕ Fichier illisible : ${fichier}`));
                }
                if (d.format !== 'claudetopia-export') return console.log(c.erreur('✕ Ce n\'est pas un export Claudetopia'));
                const resume = `${Object.keys(d.config.prompts ?? {}).length} prompts, ${(d.config.planifications ?? []).length} tâche(s) planifiée(s), ${d.ssh.length} serveur(s) SSH, ${(d.config.sftp ?? []).length} connexion(s) SFTP`;
                if (!await confirmer(`Importer la configuration de ${d.poste || 'l\'autre poste'} (${new Date(d.date).toLocaleDateString('fr-CA')}) : ${resume} ?`)) return;

                const notes: string[] = [];
                for (const k of REGLAGES) {
                    if (d.config[k] === undefined) continue;
                    // Les prompts s'ajoutent à ceux d'ici, le reste remplace
                    if (k === 'prompts') config.prompts = { ...d.config.prompts, ...config.prompts };
                    else (config as unknown as Record<string, unknown>)[k] = d.config[k];
                }
                // Dossiers de projets : seulement ceux qui existent sur ce poste
                const racines = (d.config.racines ?? []).filter((r) => fs.existsSync(r) && !config.racines.includes(r));
                const extras = (d.config.extras ?? []).filter((r) => fs.existsSync(r) && !config.extras.includes(r));
                config.racines.push(...racines);
                config.extras.push(...extras);
                const absents = [...(d.config.racines ?? []), ...(d.config.extras ?? [])].filter((r) => !fs.existsSync(r));
                if (absents.length) notes.push(`${absents.length} dossier(s) de projets absent(s) ici (ignorés) : /scan pour chercher les projets de ce poste`);

                // Tâches planifiées : le projet est retrouvé par son nom
                const { getProjets, rafraichirProjets } = await import('./commandes.js');
                rafraichirProjets();
                const projets = getProjets();
                for (const p of d.config.planifications ?? []) {
                    if ((config.planifications ?? []).some((x) => x.id === p.id)) continue;
                    const ici = projets.find((x) => x.nom.toLowerCase() === nomDe(p.projet).toLowerCase());
                    if (!ici) {
                        notes.push(`tâche « ${p.nom} » ignorée : projet ${nomDe(p.projet)} absent de ce poste`);
                        continue;
                    }
                    config.planifications = [...(config.planifications ?? []), { ...p, projet: ici.chemin }];
                }
                // SFTP : les connexions par mot de passe devront le ressaisir (il ne voyage pas)
                for (const s of d.config.sftp ?? []) {
                    if ((config.sftp ?? []).some((x) => x.nom === s.nom)) continue;
                    config.sftp = [...(config.sftp ?? []), s];
                    if (s.auth === 'motdepasse') notes.push(`SFTP « ${s.nom} » : ressaisis le mot de passe avec /sftp-modifier ${s.nom}`);
                }
                sauverConfig(config);

                // Serveurs SSH absents d'ici ; la clé, si une clé du même nom existe sur ce poste
                const deja = new Set(lireHotes().map((h) => h.alias.toLowerCase()));
                const cles = clesDisponibles();
                let ajoutes = 0;
                for (const h of d.ssh) {
                    if (deja.has(h.alias.toLowerCase())) continue;
                    enregistrerHote({ ...h, cle: h.cle ? cles.find((k) => path.basename(k) === h.cle) : undefined });
                    ajoutes++;
                }
                console.log(c.succes(`✓ Configuration importée · ${racines.length + extras.length} dossier(s) de projets, ${ajoutes} serveur(s) SSH ajoutés`));
                notes.forEach((n) => console.log(c.alerte(`! ${n}`)));
                console.log(c.discret('Comptes et jetons : /connexions · relance Claudetopia pour appliquer le thème et la mise en page'));
            },
        },
    ];
}

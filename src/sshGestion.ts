import * as path from 'path';
import type { Commande } from './commandes.js';
import { Config, sauverConfig } from './config.js';
import { lireHotes, hote, enregistrerHote, supprimerHote, clesDisponibles, assurerCle, commandeInstallationCle, HoteSsh } from './sshConfig.js';
import { ConnexionSftp, ciblesSftp, cleSecret } from './sftp.js';
import { enregistrerSecret, oublierSecret } from './jetons.js';
import { choisir, saisir, confirmer, afficherVue } from './ui/bus.js';
import { passerLaMain } from './ui/ecran.js';
import { c } from './theme.js';

// Gérer ses serveurs depuis Claudetopia : ~/.ssh/config (ajouter, modifier, supprimer, installer sa clé)
// et des connexions SFTP (clé ou mot de passe) pour parcourir les fichiers d'un serveur.

const AUCUNE = '(clé par défaut)';

async function formulaireSsh(depart?: HoteSsh): Promise<HoteSsh> {
    const alias = (await saisir('Nom court du serveur (ex. prod-web)', depart?.alias ?? '')).trim();
    if (!alias || /\s/.test(alias)) throw new Error('le nom ne doit pas contenir d\'espace');
    const adresse = (await saisir('Adresse (nom ou IP)', depart?.hote ?? '')).trim();
    if (!adresse) throw new Error('adresse obligatoire');
    const utilisateur = (await saisir('Utilisateur', depart?.utilisateur ?? '')).trim() || undefined;
    const port = Number((await saisir('Port', String(depart?.port ?? 22))).trim()) || 22;
    const cles = clesDisponibles();
    const cle = cles.length
        ? await choisir('Clé SSH', [{ label: AUCUNE, valeur: '' }, ...cles.map((k) => ({ label: path.basename(k), valeur: k, description: k }))], false)
        : '';
    return { alias, hote: adresse, utilisateur, port, cle: cle || undefined };
}

async function installerCle(h: HoteSsh): Promise<void> {
    const cle = assurerCle(h.cle);
    if ('erreur' in cle) return console.log(c.erreur(`✗ Impossible de créer une clé : ${cle.erreur}`));
    if (cle.creee) console.log(c.succes(`✓ Nouvelle clé créée : ${cle.prive}`));
    console.log(c.discret(`Connexion à ${h.alias} : tape ton mot de passe une dernière fois, la clé sera installée.`));
    passerLaMain('ssh', [h.alias, commandeInstallationCle(cle.publique)]);
    console.log(c.succes(`Terminé · « ✓ Tester l'accès » dans la vue SSH pour vérifier que Claude peut s'y connecter seul`));
}

async function formulaireSftp(config: Config, depart?: ConnexionSftp): Promise<void> {
    const nom = (await saisir('Nom de la connexion SFTP (ex. hébergeur-site)', depart?.nom ?? '')).trim();
    if (!nom) return;
    const hoteSftp = (await saisir('Adresse du serveur', depart?.hote ?? '')).trim();
    const port = Number((await saisir('Port', String(depart?.port ?? 22))).trim()) || 22;
    const utilisateur = (await saisir('Utilisateur', depart?.utilisateur ?? '')).trim();
    if (!hoteSftp || !utilisateur) return console.log(c.alerte('Adresse et utilisateur obligatoires'));
    const auth = await choisir<'motdepasse' | 'cle'>('Connexion par', [
        { label: '⚿ Mot de passe', valeur: 'motdepasse', description: 'chiffré par Windows, seul ton compte peut le relire' },
        { label: '⚷ Clé SSH', valeur: 'cle' },
    ], false);
    let cle: string | undefined;
    if (auth === 'motdepasse') {
        const mdp = await saisir('Mot de passe', '', true);
        if (mdp && !enregistrerSecret(cleSecret(nom), mdp)) return console.log(c.erreur('✗ Impossible de chiffrer le mot de passe'));
    } else {
        const cles = clesDisponibles();
        cle = cles.length ? (await choisir('Clé SSH', [{ label: AUCUNE, valeur: '' }, ...cles.map((k) => ({ label: path.basename(k), valeur: k }))], false)) || undefined : undefined;
    }
    const dossier = (await saisir('Dossier à ouvrir au départ (vide = dossier personnel)', depart?.dossier ?? '')).trim() || undefined;
    const connexion: ConnexionSftp = { nom, hote: hoteSftp, port, utilisateur, auth, cle, dossier };
    config.sftp = [...(config.sftp ?? []).filter((x) => x.nom !== (depart?.nom ?? nom)), connexion];
    sauverConfig(config);
    console.log(c.succes(`✓ Connexion SFTP « ${nom} » enregistrée`));
    await ouvrirSftp(connexion);
}

async function ouvrirSftp(cible: ConnexionSftp): Promise<void> {
    const { VueSftp } = await import('./ui/VueSftp.js');
    const React = await import('react');
    await afficherVue((fermer) => React.createElement(VueSftp, { fermer, cible }));
}

export function commandesSsh(config: Config): Commande[] {
    const choisirHote = async (cle?: string, message = 'Quel serveur ?') => {
        if (cle) {
            const h = hote(cle);
            if (!h) throw new Error(`serveur « ${cle} » absent de ~/.ssh/config`);
            return h;
        }
        const hotes = lireHotes();
        if (!hotes.length) throw new Error('aucun serveur dans ~/.ssh/config : /ssh-ajouter');
        return choisir(message, hotes.map((h) => ({ label: h.alias, valeur: h, description: `${h.utilisateur ? h.utilisateur + '@' : ''}${h.hote}${h.port && h.port !== 22 ? ':' + h.port : ''}` })));
    };
    return [
        {
            nom: 'ssh-ajouter', groupe: 'Système',
            description: 'Ajouter un serveur SSH (~/.ssh/config), puis installer ta clé',
            executer: async () => {
                const h = await formulaireSsh();
                if (hote(h.alias) && !await confirmer(`${h.alias} existe déjà : le remplacer ?`)) return;
                enregistrerHote(h);
                console.log(c.succes(`✓ ${h.alias} ajouté à ~/.ssh/config · « ssh ${h.alias} » marche maintenant partout`));
                if (await confirmer(`Installer ta clé sur ${h.alias} (connexion sans mot de passe, et Claude pourra s'y connecter seul) ?`)) await installerCle(h);
            },
        },
        {
            nom: 'ssh-modifier', args: '[serveur]', groupe: 'Système',
            description: 'Modifier un serveur de ~/.ssh/config',
            executer: async ({ args }) => {
                const avant = await choisirHote(args[0], 'Modifier quel serveur ?');
                const h = await formulaireSsh(avant);
                enregistrerHote(h, avant.alias);
                console.log(c.succes(`✓ ${h.alias} modifié`));
            },
        },
        {
            nom: 'ssh-supprimer', args: '[serveur]', groupe: 'Système',
            description: 'Retirer un serveur de ~/.ssh/config',
            executer: async ({ args }) => {
                const h = await choisirHote(args[0], 'Retirer quel serveur ?');
                if (!await confirmer(`Retirer ${h.alias} de ~/.ssh/config ? (une sauvegarde existe : config.claudetopia.bak)`)) return;
                supprimerHote(h.alias);
                console.log(c.succes(`✓ ${h.alias} retiré`));
            },
        },
        {
            nom: 'ssh-cle', args: '[serveur]', groupe: 'Système',
            description: 'Installer ta clé SSH sur un serveur (une seule fois le mot de passe)',
            executer: async ({ args }) => installerCle(await choisirHote(args[0], 'Installer ta clé sur quel serveur ?')),
        },
        {
            nom: 'sftp', alias: ['fichiers'], args: '[connexion]', groupe: 'Système',
            description: 'Parcourir les fichiers d\'un serveur (SFTP) : ouvrir, télécharger, envoyer',
            executer: async ({ args }) => {
                const cibles = ciblesSftp();
                let cible = args[0] ? cibles.find((x) => x.nom.toLowerCase() === args[0].toLowerCase()) : undefined;
                if (args[0] && !cible) return console.log(c.alerte(`Connexion « ${args[0]} » inconnue`));
                if (!cible) {
                    const choix = await choisir<ConnexionSftp | 'nouvelle'>('Parcourir les fichiers de', [
                        { label: '+ Nouvelle connexion SFTP…', valeur: 'nouvelle', description: 'avec mot de passe ou clé' },
                        ...cibles.map((x) => ({ label: `⇅ ${x.nom}`, valeur: x, description: `${x.utilisateur}@${x.hote}${x.auth === 'motdepasse' ? ' · mot de passe' : ''}` })),
                    ]);
                    if (choix === 'nouvelle') return formulaireSftp(config);
                    cible = choix;
                }
                await ouvrirSftp(cible);
            },
        },
        {
            nom: 'sftp-ajouter', groupe: 'Système',
            description: 'Configurer une connexion SFTP (mot de passe chiffré ou clé)',
            executer: () => formulaireSftp(config),
        },
        {
            nom: 'sftp-modifier', args: '[connexion]', groupe: 'Système', cache: true,
            description: 'Modifier une connexion SFTP',
            executer: async ({ args }) => {
                const liste = config.sftp ?? [];
                const x = args[0] ? liste.find((s) => s.nom === args[0]) : await choisir('Modifier quelle connexion ?', liste.map((s) => ({ label: s.nom, valeur: s })));
                if (x) await formulaireSftp(config, x);
            },
        },
        {
            nom: 'sftp-supprimer', args: '[connexion]', groupe: 'Système', cache: true,
            description: 'Supprimer une connexion SFTP (et son mot de passe)',
            executer: async ({ args }) => {
                const liste = config.sftp ?? [];
                const x = args[0] ? liste.find((s) => s.nom === args[0]) : await choisir('Supprimer quelle connexion ?', liste.map((s) => ({ label: s.nom, valeur: s })));
                if (!x || !await confirmer(`Supprimer la connexion SFTP « ${x.nom} » ?`)) return;
                config.sftp = liste.filter((s) => s !== x);
                sauverConfig(config);
                oublierSecret(cleSecret(x.nom));
                console.log(c.succes(`✓ « ${x.nom} » supprimée`));
            },
        },
    ];
}

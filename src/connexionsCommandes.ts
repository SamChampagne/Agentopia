import type { Commande } from './commandes.js';
import { chargerConfig, sauverConfig, type Config } from './config.js';
import { choisirCompteGitHub } from './compteGitHubCommande.js';
import { AIDE_JETONS, Hebergeur, pageJeton, jetonsConfigures, enregistrerJeton, oublierJeton, originesGitLab, ancienGitLabPresent, ancienJetonGitLab, associerAncienGitLab } from './jetons.js';
import { origineGitLab } from './originesGit.js';
import { OUTILS, DOCKER_DESKTOP, identiteJeton, oublierIdentite, remotesDuPoste, lirePressePapiers, viderPressePapiers, existe } from './connexions.js';
import { assurerCle } from './sshConfig.js';
import { lireSynchro } from './synchro.js';
import { choisir, saisir, confirmer, afficherVue, tache } from './ui/bus.js';
import { lancerDetache, ouvrirUrlWeb, ouvrirFenetrePowerShell } from './lanceurs.js';
import { scriptInstallationWinget } from './lancementsWindows.js';
import { c } from './theme.js';

// Tout connecter depuis l'application, en le moins d'étapes possible

const SITES: Record<string, Hebergeur> = { github: 'GitHub', azure: 'Azure DevOps', gitlab: 'GitLab' };

// Un jeton ressemble à une longue suite sans espace (évite d'enregistrer un texte copié par erreur)
const ressembleAUnJeton = (t: string) => t.length >= 20 && t.length <= 400 && !/\s/.test(t);

async function connecterGitLab(): Promise<void> {
    const existantes = originesGitLab();
    let origine = existantes.length ? await choisir('Quel serveur GitLab ?', [...existantes.map(o => ({ label: o, valeur: o })), { label: 'Connecter un autre serveur', valeur: '' }], false) : '';
    if (!origine) origine = origineGitLab((await saisir('Adresse HTTPS de ton serveur GitLab', 'https://gitlab.com')).trim());
    if (!await confirmer(`Les requêtes et le jeton seront envoyés uniquement à ${origine}. Est-ce bien ton serveur GitLab ?`)) return;
    const ancien = ancienGitLabPresent();
    const action = await choisir(`Compte ${origine}`, [
        { label: existantes.includes(origine) ? 'Reconnecter avec un nouveau jeton' : 'Connecter un nouveau jeton', valeur: 'nouveau' },
        ...(ancien && !existantes.includes(origine) ? [{ label: 'Associer l’ancien jeton à cette adresse', valeur: 'ancien', description: 'Le vérifier sur cette adresse avant de l’associer' }] : []),
        ...(existantes.includes(origine) ? [{ label: 'Déconnecter ce serveur uniquement', valeur: 'oublier' }] : []),
        ...(ancien ? [{ label: 'Oublier l’ancien jeton sans adresse', valeur: 'oublier-ancien' }] : []),
    ], false);
    if (action.startsWith('oublier')) {
        oublierJeton('GitLab', action === 'oublier' ? origine : undefined); oublierIdentite('GitLab');
        console.log(c.succes('Compte GitLab déconnecté. Les autres comptes sont conservés.')); return;
    }
    let secret: string | undefined;
    if (action === 'ancien') secret = ancienJetonGitLab();
    else {
        ouvrirUrlWeb(pageJeton('GitLab', [], origine));
        secret = (await saisir(`Jeton pour ${origine} (scope read_api)`, '', true)).trim();
    }
    if (!secret) return;
    const id = await tache(`Vérification sur ${origine}`, () => identiteJeton('GitLab', secret!, [], origine));
    if (!id.ok) { console.log(c.erreur(`GitLab : ${id.texte}. Aucun compte modifié.`)); return; }
    if (action === 'ancien') associerAncienGitLab(origine, secret);
    else if (!enregistrerJeton('GitLab', secret, origine)) throw new Error('Impossible de chiffrer le jeton. Aucun compte modifié.');
    oublierIdentite('GitLab');
    console.log(c.succes(`Connecté à ${origine} · ${id.texte}`));
    const synchro = await import('./synchro.js'); void synchro.rafraichirDistants();
}

// Programme d'installation dans une fenêtre PowerShell visible (winget peut demander une confirmation Windows)
function installerAvecWinget(nom: string, id: string): void {
    ouvrirFenetrePowerShell(scriptInstallationWinget(nom, id));
}

export function commandesConnexions(config: Config = chargerConfig()): Commande[] {
    return [
        {
            nom: 'connexions', alias: ['connecter-tout'], groupe: 'Config',
            description: 'Tout ce qui se connecte (Claude, GitHub, Azure, GitLab, SSH, SFTP, Docker, outils) : état et réglage en un clic',
            executer: async () => {
                const { VueConnexions } = await import('./ui/VueConnexions.js');
                const React = await import('react');
                await afficherVue((fermer) => React.createElement(VueConnexions, { fermer }));
            },
        },
        {
            nom: 'connecter', args: '[github|azure|gitlab]', groupe: 'Git',
            description: 'Connecter GitHub, Azure DevOps ou GitLab (pull requests, dépôts en ligne)',
            executer: async ({ args }) => {
                // Le site d'abord : celui qui a le plus de dépôts sur ce poste est proposé en premier
                const depots = lireSynchro().depots;
                const nb = (h: Hebergeur) => depots.filter((d) => d.hebergeur === h).length;
                const deja = jetonsConfigures();
                const site: Hebergeur = SITES[args[0]?.toLowerCase()] ?? await choisir('Connecter quel site ?',
                    (Object.values(SITES)).sort((a, b) => nb(b) - nb(a)).map((h) => ({
                        label: `${deja.includes(h) ? '✓' : '○'} ${h}`, valeur: h,
                        description: `${nb(h) ? `${nb(h)} dépôt${nb(h) > 1 ? 's' : ''} sur ce poste` : 'aucun dépôt détecté'}${deja.includes(h) ? ' · déjà connecté' : ''}`,
                    })), false);
                if (site === 'GitLab') return connecterGitLab();
                if (site === 'GitHub' && !args.includes('--jeton') && await choisirCompteGitHub(config) !== 'jeton') return;
                if (deja.includes(site)) {
                    const quoi = await choisir(`${site} est déjà connecté`, [
                        { label: '⇄ Le reconnecter avec un nouveau jeton', valeur: 'nouveau' },
                        { label: '✕ Le déconnecter (supprimer le jeton)', valeur: 'oublier' },
                    ], false);
                    if (quoi === 'oublier') {
                        oublierJeton(site);
                        if (site === 'GitHub') { delete config.compteGitHub; sauverConfig(config); }
                        oublierIdentite(site);
                        if (site === 'GitHub') {
                            const { actualiserCompteGitHub } = await import('./synchro.js');
                            void actualiserCompteGitHub().catch(() => undefined);
                        }
                        return console.log(c.succes(`${site} déconnecté`));
                    }
                }
                const remotes = remotesDuPoste();
                ouvrirUrlWeb(pageJeton(site, remotes));
                console.log(c.discret(`Page ${site} ouverte dans le navigateur : ${AIDE_JETONS[site].consigne}, puis copie le jeton.`));
                const comment = await choisir(`Jeton ${site}`, [
                    { label: '⎘ Je l\'ai copié : le prendre dans le presse-papiers', valeur: 'presse', description: 'rien à coller, le presse-papiers est vidé après' },
                    { label: '✎ Le coller moi-même', valeur: 'coller' },
                ], false);
                let secret = '';
                if (comment === 'presse') {
                    secret = await lirePressePapiers();
                    if (!ressembleAUnJeton(secret)) {
                        console.log(c.alerte('Le presse-papiers ne contient pas de jeton : colle-le ici'));
                        secret = '';
                    }
                }
                if (!secret) secret = (await saisir(`Colle le jeton ${site}`, '', true)).trim();
                if (!secret) return;
                // On vérifie AVANT d'enregistrer : un jeton refusé n'est pas gardé
                const id = await tache(`Vérification du jeton ${site}`, () => identiteJeton(site, secret, remotes));
                if (!id.ok) return console.log(c.erreur(`✕ ${site} : ${id.texte} · rien n'a été enregistré`));
                if (!enregistrerJeton(site, secret)) return console.log(c.erreur('✕ Impossible de chiffrer le jeton'));
                if (site === 'GitHub') { delete config.compteGitHub; sauverConfig(config); }
                oublierIdentite(site);
                if (comment === 'presse') viderPressePapiers();
                console.log(c.succes(`✓ Connecté à ${site} : ${id.texte} · jeton chiffré pour ton compte Windows`));
                // Pull requests et dépôts en ligne, tout de suite
                const synchro = await import('./synchro.js');
                void (site === 'GitHub' ? synchro.actualiserCompteGitHub() : synchro.rafraichirDistants()).catch(() => undefined);
            },
        },
        {
            nom: 'installer', args: '<git|wt|code|rg|docker>', groupe: 'Config',
            description: 'Installer un outil manquant (winget, dans une fenêtre visible)',
            executer: async ({ args }) => {
                const cle = args[0] ?? await choisir('Installer quel outil ?', Object.entries(OUTILS).map(([k, o]) => ({ label: o.nom, valeur: k, description: o.pour })), false);
                const o = OUTILS[cle];
                if (!o) return console.log(c.alerte(`Outil inconnu : ${cle} (${Object.keys(OUTILS).join(', ')})`));
                installerAvecWinget(o.nom, o.winget);
                console.log(c.succes(`Installation de ${o.nom} lancée dans une nouvelle fenêtre · accepte si Windows demande une confirmation`));
            },
        },
        {
            nom: 'notifications-cliquables', args: '[oui|non]', groupe: 'Config',
            description: 'Un clic sur une notification Windows ouvre la session concernée (lien claudetopia: pour ton compte)',
            executer: async ({ args }) => {
                const n = await import('./notifications.js');
                if (args[0] === 'non') {
                    n.retirerLien();
                    return console.log(c.succes('Notifications cliquables désactivées (lien claudetopia: retiré)'));
                }
                if (!await confirmer('Enregistrer le lien « claudetopia: » pour ton compte Windows (registre HKCU, sans droits admin) ? Un clic sur une notification ouvrira la session.')) return;
                n.enregistrerLien();
                console.log(n.lienEnregistre() ? c.succes('✓ Notifications cliquables activées · /notifs test pour essayer') : c.erreur('✕ Impossible d\'enregistrer le lien'));
            },
        },
        {
            nom: 'ssh-creer-cle', groupe: 'Système', cache: true,
            description: 'Créer une clé SSH (si tu n\'en as pas)',
            executer: () => {
                const r = assurerCle();
                if ('erreur' in r) return console.log(c.erreur(`✕ ${r.erreur}`));
                console.log(r.creee ? c.succes(`✓ Clé créée : ${r.prive}`) : c.discret(`Tu as déjà une clé : ${r.prive}`));
                console.log(c.discret('Pour l\'installer sur un serveur : vue SSH → « ⚿ Installer ma clé »'));
            },
        },
        {
            nom: 'docker-demarrer', groupe: 'Système', cache: true,
            description: 'Démarrer Docker Desktop',
            executer: async () => {
                if (!existe(DOCKER_DESKTOP)) return console.log(c.alerte('Docker Desktop introuvable : /installer docker'));
                lancerDetache(DOCKER_DESKTOP, []);
                console.log(c.succes('Docker Desktop démarre (environ 30 s) · la section Docker se remplira toute seule'));
                if (await confirmer('Attendre qu\'il soit prêt ?')) {
                    const { rafraichirDocker, lireDonnees } = await import('./ui/donnees.js');
                    await tache('Démarrage de Docker', async () => {
                        for (let i = 0; i < 30; i++) {
                            await new Promise((r) => setTimeout(r, 3000));
                            await rafraichirDocker();
                            if (!lireDonnees().docker.find((h) => !h.serveur)?.erreur) return;
                        }
                    });
                    console.log(c.succes('✓ Docker est prêt'));
                }
            },
        },
    ];
}


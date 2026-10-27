import * as os from 'os';
import * as path from 'path';
import { scanner, grouper, doublons, correspondFiltre, outils, ProjetTrouve } from './scan.js';
import { inventaire, usageParServeur } from './ssh.js';
import { config, getProjets, rafraichirProjets } from './commandes.js';
import { sauverConfig } from './config.js';
import { depuis } from './projets.js';
import { bus, choisirPlusieurs, saisir } from './ui/bus.js';
import { c } from './theme.js';
import { tableau, titre } from './affichage.js';

const UN_AN = 365 * 86_400_000;
const court = (chemin: string) => chemin.replace(os.homedir(), '~');

function hebergeur(remote?: string): string {
    if (!remote) return '';
    if (/github\.com/i.test(remote)) return 'GitHub';
    if (/dev\.azure\.com|visualstudio\.com/i.test(remote)) return 'Azure DevOps';
    if (/gitlab/i.test(remote)) return 'GitLab';
    if (/bitbucket/i.test(remote)) return 'Bitbucket';
    return remote.replace(/^\w+:\/\/|^git@/, '').split(/[/:]/)[0];
}

// Assistant : trouve les projets, serveurs SSH et outils du poste, puis configure le CLI
export async function scan(filtre?: string): Promise<void> {
    let resultat;
    try {
        resultat = await scanner((vus, trouves) => bus.emit('tache', `Scan du disque · ${vus.toLocaleString('fr-CA')} dossiers · ${trouves} projets`));
    } finally {
        bus.emit('tache', undefined);
    }
    const tous = filtre ? resultat.projets.filter((p) => correspondFiltre(p, filtre)) : resultat.projets;
    const copies = doublons(tous);
    const { racines, isoles } = grouper(tous);

    // Ce qui est déjà suivi par le CLI
    const suivis = new Set(getProjets().map((p) => p.chemin.toLowerCase()));
    const racinesSuivies = new Set(config.racines.map((r) => r.toLowerCase()));
    const cheminsSuivis = [...suivis];
    // Suivi = le projet lui-même, son dossier parent est une racine, ou il est dans un projet suivi (dépôt imbriqué)
    const dejaSuivi = (p: ProjetTrouve) => {
        const bas = p.chemin.toLowerCase();
        return suivis.has(bas) || racinesSuivies.has(path.dirname(bas)) || cheminsSuivis.some((s) => bas.startsWith(s + path.sep));
    };
    const quand = (p: ProjetTrouve) => (p.activite.getTime() ? depuis(p.activite) : 'jamais commité');

    console.log(titre('Scan terminé') + c.discret(
        `  ${tous.length} projets${filtre ? ` contenant « ${filtre} »` : ''} · ${resultat.dossiersVus.toLocaleString('fr-CA')} dossiers · ${(resultat.duree / 1000).toFixed(1)} s`));

    // Dossiers de projets
    const nouvellesRacines = racines.filter((g) => !racinesSuivies.has(g.dossier.toLowerCase()));
    if (racines.length) {
        console.log(titre('Dossiers de projets'));
        console.log(tableau(racines.map((g) => [
            racinesSuivies.has(g.dossier.toLowerCase()) ? c.succes('✓') : c.accent('+'),
            court(g.dossier), c.discret(`${g.projets.length} projets`),
            c.discret(g.projets.slice(0, 4).map((p) => p.nom).join(', ') + (g.projets.length > 4 ? '…' : '')),
        ]), { retrait: 2 }));
    }

    // Projets isolés
    const aProposer = isoles.filter((p) => !dejaSuivi(p) && !p.worktree);
    if (isoles.length) {
        console.log(titre('Projets isolés', isoles.length));
        console.log(tableau([...isoles].sort((a, b) => b.activite.getTime() - a.activite.getTime()).slice(0, 30).map((p) => [
            dejaSuivi(p) ? c.succes('✓') : copies.has(p) ? c.alerte('≈') : c.accent('+'),
            p.nom,
            c.discret(court(path.dirname(p.chemin))),
            c.secondaire([p.git ? hebergeur(p.remote) || 'git' : '', ...p.types].filter(Boolean).join(' · ')),
            c.discret(quand(p)),
            p.sessionsClaude ? c.accent('✻') : '',
        ]), { max: [2, 28, 40, 22] }));
        if (isoles.length > 30) console.log(c.discret(`  … et ${isoles.length - 30} autres`));
        console.log(c.discret('  ✓ déjà suivi · + nouveau · ≈ doublon (même dépôt ailleurs) · ✻ sessions Claude'));
    }
    if (copies.size) {
        console.log(titre('Doublons', copies.size) + c.discret('  même dépôt cloné plusieurs fois'));
        console.log(tableau([...copies].map(([doublon, garde]) => [
            court(doublon.chemin), c.discret(quand(doublon)), c.discret('→ plus récent :'), court(garde.chemin),
        ])));
    }

    // Serveurs SSH
    const serveurs = await inventaire();
    const usage = await usageParServeur(serveurs);
    console.log(titre('Serveurs SSH'));
    if (!serveurs.length) {
        console.log(c.discret('  Aucun : ni ~/.ssh/config ni known_hosts'));
    } else {
        console.log(`  ${serveurs.filter((s) => s.configure).length} dans ~/.ssh/config · ${serveurs.filter((s) => !s.configure).length} autres connus · `
            + `${c.accent(String(usage.size))} utilisés par Claude ${c.discret('· détail : /ssh, accès par clé : /ssh test')}`);
    }

    // Outils
    const liste = outils();
    console.log(titre('Outils'));
    console.log(tableau(liste.map((o) => [
        o.present ? c.succes('✓') : c.erreur('✗'), o.nom, c.discret(o.role), o.present ? '' : c.alerte(o.installer),
    ])));

    // Choix
    const choixRacines = nouvellesRacines.length ? await choisirPlusieurs(
        'Dossiers à suivre (chaque sous-dossier devient un projet) · Espace cocher · a tout',
        nouvellesRacines.map((g) => ({
            label: court(g.dossier), valeur: g.dossier, description: `${g.projets.length} projets`,
            coche: g.projets.some((p) => Date.now() - p.activite.getTime() < UN_AN),
        })),
    ) : [];
    const choixProjets = aProposer.length ? await choisirPlusieurs(
        'Projets à ajouter · Espace cocher · a tout',
        [...aProposer].sort((a, b) => b.activite.getTime() - a.activite.getTime()).map((p) => ({
            label: p.nom,
            valeur: p.chemin,
            description: `${court(path.dirname(p.chemin))} · ${copies.has(p) ? 'doublon · ' : ''}${quand(p)}`,
            // Pré-coché : dépôt git actif dans l'année, pas une vieille copie, pas un téléchargement
            coche: p.git && !copies.has(p) && Date.now() - p.activite.getTime() < UN_AN && !/\\Downloads\\/i.test(p.chemin),
        })),
    ) : [];

    if (!config.prenom) {
        config.prenom = await saisir('Ton prénom (pour l\'accueil)', os.userInfo().username).catch(() => '');
    }

    config.racines.push(...choixRacines);
    config.extras.push(...choixProjets.filter((p) => !config.extras.includes(p)));
    sauverConfig(config);
    const total = rafraichirProjets().length;
    console.log(c.succes(`\n✓ ${choixRacines.length} dossier(s) et ${choixProjets.length} projet(s) ajoutés · ${total} projets suivis`)
        + c.discret('\n  Tape Entrée pour ouvrir le menu, /projets pour la liste'));
}

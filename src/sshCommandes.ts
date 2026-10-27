import * as os from 'os';
import { Projet } from './projets.js';
import { Serveur, inventaire, usageParServeur, joignable, testerAcces, lireAcces, sauverAcces } from './ssh.js';
import { lireDonnees, rafraichirAcces, decrireConnexion } from './ui/donnees.js';
import { serveursPertinents, ilYa } from './ui/Panneau.js';
import { nomDossierClaude } from './usage.js';
import { ouvrirOnglet } from './lanceurs.js';
import { choisir, tache } from './ui/bus.js';
import { c } from './theme.js';
import { tableau } from './affichage.js';

// S'assure que l'inventaire est chargé (au tout début, la collecte live peut ne pas être finie)
async function chargees() {
    const d = lireDonnees();
    if (!d.serveurs.length) {
        d.serveurs = await inventaire();
        d.usage = await usageParServeur(d.serveurs);
        d.acces = lireAcces();
    }
    if (!d.joignables.size) {
        const etats = await Promise.all(d.serveurs.map((s) => joignable(s)));
        d.joignables = new Map(d.serveurs.map((s, i) => [s, etats[i]]));
    }
    return d;
}

export async function afficherServeurs(tous = false): Promise<void> {
    const d = await tache('Lecture des serveurs SSH', chargees);
    const liste = tous ? d.serveurs : serveursPertinents(d);
    const projets = (await import('./commandes.js')).getProjets();
    console.log(tableau(liste.map((s) => {
        const ok = d.joignables.get(s);
        const acces = d.acces[s.nom];
        const actives = d.connexions.map((cx) => decrireConnexion(cx, d)).filter((x) => x.serveur === s);
        const usage = d.usage.get(s) ?? [];
        return [
            (ok === undefined ? c.discret('●') : ok ? c.succes('●') : c.erreur('●')) + ' ' + c.primaire.bold(s.nom),
            c.discret(`${s.utilisateur ? s.utilisateur.slice(0, 18) + '@' : ''}${s.ip ?? s.hote}`),
            !acces ? c.discret('? /ssh test') : acces.ok ? c.succes('clé ✓') : c.alerte(acces.message),
            actives.length ? c.accent(`⇄ ${actives.map((a) => a.session?.nom ?? 'terminal').join(', ')}`) : '',
            usage.map((u) => `${nomDossierClaude(u.dossier, projets)} ${c.discret(`×${u.nombre} · ${ilYa(u.dernier)}`)}`).join(c.discret(' | ')),
        ];
    }), { entetes: ['Serveur', 'Adresse', 'Accès Claude', 'Connecté', 'Utilisé par Claude dans'], max: [16, 34, 26, 24], retrait: 0 }));
    const caches = d.serveurs.length - liste.length;
    console.log(c.discret(`\n● port 22 joignable · Accès Claude = connexion par clé sans mot de passe (ce que Claude peut faire seul)`)
        + (caches ? c.discret(`\n${caches} serveurs de known_hosts jamais utilisés masqués · /ssh tous`) : ''));
}

// Teste la connexion par clé (BatchMode) : c'est exactement ce dont Claude a besoin pour travailler seul
export async function testerServeurs(): Promise<void> {
    const d = await chargees();
    const cibles = serveursPertinents(d).filter((s) => s.configure || d.usage.has(s));
    const resultats = await tache(`Test de connexion par clé sur ${cibles.length} serveurs`, () => Promise.all(cibles.map(testerAcces)));
    const acces = lireAcces();
    cibles.forEach((s, i) => (acces[s.nom] = resultats[i]));
    sauverAcces(acces);
    rafraichirAcces();
    await afficherServeurs();
}

function cible(s: Serveur): string {
    return s.configure ? s.nom : `${s.utilisateur ? s.utilisateur + '@' : ''}${s.hote}`;
}

export async function ouvrirSsh(nom?: string, parmi?: Serveur[]): Promise<void> {
    const d = await chargees();
    let serveur = nom ? d.serveurs.find((s) => s.nom.toLowerCase() === nom.toLowerCase() || s.noms.has(nom.toLowerCase())) : undefined;
    if (nom && !serveur) {
        console.log(c.erreur(`Serveur inconnu : ${nom}`));
        return;
    }
    serveur ??= await choisir('Se connecter à', (parmi ?? serveursPertinents(d)).map((s) => ({
        label: s.nom, valeur: s, description: `${s.utilisateur ?? ''}@${s.ip ?? s.hote}`,
    })));
    ouvrirOnglet(os.homedir(), `⇄ ${serveur.nom}`, `ssh ${cible(serveur)}`);
    console.log(c.succes(`Connexion SSH à ${serveur.nom} dans un nouvel onglet`));
}

// Serveurs que Claude a utilisés depuis ce projet
export async function serveursDuProjet(projet: Projet): Promise<void> {
    const d = await tache('Lecture des serveurs SSH', chargees);
    const dossier = projet.chemin.replace(/[^a-zA-Z0-9]/g, '-');
    const utilises = d.serveurs.filter((s) => d.usage.get(s)?.some((u) => u.dossier === dossier));
    if (!utilises.length) {
        console.log(c.discret(`Claude n'a jamais lancé ssh/scp/rsync depuis ${projet.nom}.`));
        return ouvrirSsh();
    }
    console.log(tableau(utilises.map((s) => {
        const u = d.usage.get(s)!.find((x) => x.dossier === dossier)!;
        const acces = d.acces[s.nom];
        return [c.primaire.bold(s.nom), c.discret(s.ip ?? s.hote), `${u.nombre} commandes`, c.discret(`dernière il y a ${ilYa(u.dernier)}`),
            !acces ? '' : acces.ok ? c.succes('clé ✓') : c.alerte(acces.message)];
    }), { retrait: 0 }));
    await ouvrirSsh(undefined, utilises);
}

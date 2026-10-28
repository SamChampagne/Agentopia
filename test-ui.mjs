// Test de l'interface plein écran : rend l'App, simule clavier ET clics souris
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './dist/ui/App.js';
import { souris } from './dist/ui/terminal.js';
import { capturerConsole } from './dist/ui/journal.js';
import { calculerMise, miseLaterale, placerBoutons, CARTE } from './dist/ui/mise.js';
import { largeurTitre } from './dist/ui/Zones.js';
import { BOUTONS_HAUT } from './dist/ui/App.js';
const LARGEUR_TITRE = largeurTitre();
// Boutons du haut, par libellé (« Git », « Équipes »…)
const BARRE = placerBoutons(BOUTONS_HAUT, LARGEUR_TITRE);
const enHaut = (label) => BARRE.find((b) => b.label.endsWith(label));
import { lireDonnees } from './dist/ui/donnees.js';

const sortie = (t) => process.stderr.write(t + '\n');
capturerConsole();
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const brut = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const { stdin, lastFrame } = render(React.createElement(App));
const ecran = (titre) => sortie(`\n===== ${titre} =====\n${brut(lastFrame())}`);
const taper = async (texte, ms = 150) => { for (const ch of texte) { stdin.write(ch); await attendre(15); } await attendre(ms); };
const touche = async (k, ms = 300) => { stdin.write(k); await attendre(ms); };
const clic = async (x, y, ms = 400) => {
    souris.emit('souris', { x, y, bouton: 'gauche', appui: true });
    souris.emit('souris', { x, y, bouton: 'gauche', appui: false });
    await attendre(ms);
};
const molette = async (x, y, sens, ms = 200) => { souris.emit('souris', { x, y, bouton: sens, appui: true }); await attendre(ms); };
const ENTREE = '\r', ECHAP = '\x1b';

const m = calculerMise(100, 34);   // dimensions par défaut d'ink-testing-library
const etapes = process.argv[2]?.split(',') ?? ['base'];

await attendre(5000);
ecran('Démarrage (après collecte)');

if (etapes.includes('base')) {
    // 3e carte : barre du haut + ligne (2) + titre (1) + 2 cartes (10) + intérieur
    await clic(5, 2 + 1 + 2 * CARTE + 1, 2500);
    ecran('Clic sur la 3e carte');
    const s = lireDonnees().agents[2];
    // « ← Retour » est le premier bouton de la conversation
    const retour = placerBoutons([{ label: '← Retour', action: 'fermer' }], m.lateral)[0];
    await clic(retour.x + 2, 2 + 1);
    ecran('Clic sur ← Retour');
    const haut = [BARRE.find((b) => b.action === '/menu-principal'), enHaut('Projets')];
    await clic(haut[1].x + 2, 0, 1000);
    ecran('Clic sur « Projets » (barre du haut)');
    await molette(m.lateral + 10, 10, 'molette-haut');
    await molette(m.lateral + 10, 10, 'molette-haut');
    ecran('Molette vers le haut dans le journal');
    await clic(haut[0].x + 2, 0, 800);
    ecran('Clic sur « Menu »');
    await clic(m.lateral + 6, 2 + 4 + 2, 800);   // 3e projet de la liste (recherche active : éléments à partir de la ligne 4)
    ecran('Clic sur le 3e projet');
    await touche(ECHAP, 400);
    await taper('/pro', 200);
    ecran('Saisie /pro');
    await clic(m.lateral + 4, 2 + m.corps - 1, 1200);
    ecran('Clic sur la suggestion');
}
if (etapes.includes('vues')) {
    const haut = [BARRE.find((b) => b.action === '/menu-principal'), enHaut('Projets'), enHaut('Moniteur'), enHaut('Docker'), enHaut('SSH')];
    await attendre(4000);   // laisse le temps à docker ps / docker stats
    ecran('Accueil avec section Docker');
    await clic(haut[3].x + 2, 0, 1500);
    ecran('Vue Docker');
    await clic(m.lateral + 6, 2 + 3 + 3, 600);   // 4e ligne de la liste
    ecran('Vue Docker : clic sur une ligne');
    const fermerD = placerBoutons(['▶ Démarrer', '■ Arrêter', '↻ Redémarrer', '≡ Logs', '❯ Shell', '✕ Fermer'].map((label) => ({ label, action: label })), 0)[5];
    await clic(m.lateral + fermerD.x + 2, 2 + 1, 600);
    ecran('Vue Docker : clic sur ✕ Fermer');
    await clic(haut[4].x + 1, 0, 1500);
    ecran('Vue SSH');
    await clic(m.lateral + 6, 2 + 3 + 5 + 1, 600);   // 2e bloc serveur
    ecran('Vue SSH : clic sur le 2e serveur');
}
if (etapes.includes('git')) {
    const haut = [BARRE.find((b) => b.action === '/menu-principal'), enHaut('Projets'), enHaut('Moniteur'), enHaut('Git')];
    await clic(haut[3].x + 1, 0, 9000);
    ecran('Vue Git');
    await clic(m.lateral + 6, 2 + 3 + 2, 1500);   // 3e dépôt
    ecran('Vue Git : clic sur le 3e dépôt');
}
if (etapes.includes('projets')) {
    const haut = [BARRE.find((b) => b.action === '/menu-principal'), enHaut('Projets'), enHaut('Moniteur'), enHaut('Git')];
    await attendre(4000);   // la synchro git démarre en fond
    await clic(haut[1].x + 2, 0, 800);
    ecran('Vue Projets');
    await taper('sani', 500);
    ecran('Vue Projets filtrée « sani »');
    await touche(ECHAP, 300);
    await touche(ECHAP, 300);
    const t = Date.now();
    await clic(haut[3].x + 1, 0, 400);
    ecran(`Vue Git ouverte (capture ${Date.now() - t} ms après le clic)`);
}
if (etapes.includes('equipe')) {
    await clic(enHaut('Équipes').x + 2, 0, 1200);
    ecran('Vue Équipes (liste)');
    await clic(m.lateral + 4, 2 + 4, 1500);   // « + Nouvelle équipe »
    ecran('Nouvelle équipe : choix du projet');
    await touche(ECHAP, 600);
    // Une équipe factice (le fichier est surveillé : elle apparaît toute seule)
    const fs = await import('fs');
    const os = await import('os');
    const fichier = os.homedir() + '/.claudetopia-equipes.json';
    const avant = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf-8') : '[]';
    const t = (id, titre, role, etat, extra = {}) => ({ id, titre, role, consigne: `Consigne de ${titre}`, dependances: [], etat, ...extra });
    const fausse = {
        id: 'test', projet: process.cwd(), nomProjet: 'SaniPlan', objectif: "Ajouter l'export PDF des livrables avec tests et doc",
        resume: 'Backend et frontend en parallèle, puis les tests', etat: 'en cours', creee: Date.now(),
        taches: [
            t('t1', 'Endpoint export PDF', 'backend', 'faite', { branche: 'worktree-equipe-test-t1', resultat: 'Ajout de GET /livrables/:id/pdf, 2 fichiers touchés.' }),
            t('t2', 'Bouton « Exporter » dans la fiche', 'frontend', 'en cours', { debut: Date.now() - 120000 }),
            t('t3', "Tests de l'export", 'tests', 'attente', { dependances: ['t1', 't2'] }),
            t('t4', "Documenter l'export", 'doc', 'bloquee'),
        ],
    };
    fs.writeFileSync(fichier, JSON.stringify([...JSON.parse(avant), fausse], null, 2));
    await attendre(3500);
    ecran('Carte ◆ équipe dans la colonne de gauche');
    await clic(5, 2 + 1 + 1, 1500);
    ecran("Vue de l'équipe (clic sur sa carte)");
    await clic(m.lateral + 6, 6 + 2 + 1, 800);   // 2e tâche
    ecran('Équipe : 2e tâche sélectionnée');
    await touche(ECHAP, 600);
    fs.writeFileSync(fichier, avant);
    await attendre(1500);
}
if (etapes.includes('clicdroit')) {
    const droit = async (x, y, ms = 800) => { souris.emit('souris', { x, y, bouton: 'droit', appui: true }); souris.emit('souris', { x, y, bouton: 'droit', appui: false }); await attendre(ms); };
    await droit(5, 2 + 1 + 1);
    ecran('Clic droit sur une carte de session');
    await touche(ECHAP, 500);
    await droit(m.lateral + 20, 10);
    ecran('Clic droit dans le journal');
    await touche(ECHAP, 500);
    const ml = miseLaterale(m.corps, 5, 1);
    await droit(5, 2 + m.corps - 1);   // en-tête Serveurs SSH (replié par défaut)
    ecran('Clic droit sur la section Serveurs SSH');
    await touche(ECHAP, 500);
    await clic(m.lateral + 6, 2 + 4 + 2, 300);   // hors menu : on vérifie juste que rien ne casse
}
if (etapes.includes('config')) {
    const fs = await import('fs');
    const os = await import('os');
    const fichier = os.homedir() + "/.claudetopia.json";
    const sauvegarde = fs.readFileSync(fichier, 'utf-8');
    const haut = [BARRE.find((b) => b.action === '/menu-principal'), enHaut('Projets'), enHaut('Moniteur'), enHaut('Git'), enHaut('Docker'), enHaut('SSH'), enHaut('Journal'), enHaut('Récents'), enHaut('Config')];
    await clic(haut[8].x + 2, 0, 4000);
    ecran('Vue Configuration');
    await touche(ECHAP, 500);
    await taper('/diagnostic', 50);
    await touche(ENTREE, 15000);
    ecran('Diagnostic');
    // Glisser la ligne verticale de 10 colonnes vers la droite
    souris.emit('souris', { x: m.lateral - 1, y: 12, bouton: 'gauche', appui: true });
    for (let x = m.lateral; x <= m.lateral + 9; x += 3) souris.emit('souris', { x, y: 12, bouton: 'gauche', appui: true, glisse: true });
    souris.emit('souris', { x: m.lateral + 9, y: 12, bouton: 'gauche', appui: false });
    await attendre(800);
    ecran('Après avoir glissé la séparation');
    fs.writeFileSync(fichier, sauvegarde, 'utf-8');
}
if (etapes.includes('session')) {
    await clic(5, 2 + 1 + 1, 3500);   // 1re carte
    ecran('Conversation : boutons et ligne git');
    await touche(ECHAP, 400);
    await touche('?', 1200);
    ecran('Touche ? : aide');
}
if (etapes.includes('jetons')) {
    const haut = [BARRE.find((b) => b.action === '/menu-principal'), enHaut('Projets'), enHaut('Moniteur'), enHaut('Git')];
    await clic(haut[3].x + haut[3].largeur - 1, 0, 9000);   // tout au bout du bouton Git (là où le clic échouait)
    ecran('Vue Git (clic au bout du bouton)');
    const b = placerBoutons(['↻ Fetch tout', '⇡ Pousser', '⇣ Tirer', '◷ PR', '⧉ Web', '⚿ Jetons'].map((label) => ({ label, action: label })), 0)[5];
    await clic(m.lateral + b.x + 2, 2 + 1, 1500);
    ecran('Clic sur ⚿ Jetons');
    await touche(ECHAP, 600);
}
if (etapes.includes('envoi')) {
    await taper('Réponds seulement le mot PREMIER, sans outil', 300);
    ecran('Saisie sans session ouverte (ligne de destination)');
    await touche(ENTREE, 25000);
    ecran('Nouvelle session ouverte automatiquement');
    await taper('Réponds seulement le mot DEUXIEME, sans outil', 300);
    ecran('Saisie avec la conversation ouverte');
    await touche(ENTREE, 25000);
    ecran('Après envoi du 2e message');
}
if (etapes.includes('menu')) {
    const haut = [BARRE.find((b) => b.action === '/menu-principal'), enHaut('Projets')];
    await clic(haut[0].x + 2, 0, 800);
    ecran('Menu ouvert');
    await clic(5, 2 + 1 + 1, 1500);          // 1re carte pendant que le menu est ouvert
    ecran('Clic sur une carte pendant le menu');
    await clic(haut[0].x + 2, 0, 800);
    await clic(haut[1].x + 2, 0, 1500);      // « Projets » pendant que le menu est ouvert
    ecran('Clic sur « Projets » pendant le menu');
    await clic(haut[0].x + 2, 0, 800);
    await clic(m.lateral + 3, 2 + 4 + 10, 800);   // ligne « ✕ Annuler » (recherche : éléments dès la ligne 4, 10 visibles)
    ecran('Clic sur ✕ Annuler');
}
process.exit(0);

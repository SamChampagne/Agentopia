process.env.CLAUDETOPIA_SANS_REPRISE = '1';   // ne lit ni n'écrit l'état de reprise de l'utilisateur
// Test de la nouvelle interface, sans terminal : rien n'est envoyé à Claude ni modifié.
// Entrée n'est pressée que sur des commandes « /… » vérifiées à l'écran juste avant ; les dialogues sont annulés par Échap.
// Lancer : bun tui/test-interface.tsx   (VOIR=1 pour afficher les écrans)
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { App } from './app.tsx';
import { demarrerCollecte, lireDonnees } from '../dist/ui/donnees.js';
import { capturerConsole, lignesJournal } from '../dist/ui/journal.js';
import { lireTranscript } from '../dist/agents.js';

const COLS = 200, ROWS = 50;
// Une erreur (dont un garde-fou qui refuse d'appuyer sur Entrée) arrête le test au lieu de le laisser tourner
const arret = (e: unknown) => {
    process.stderr.write(`✗ arrêt du test : ${(e as Error)?.message ?? e}
`);
    process.exit(1);
};
process.on('unhandledRejection', arret);
process.on('uncaughtException', arret);
demarrerCollecte();
const { renderer, mockInput, mockMouse, flush, captureCharFrame } = await createTestRenderer({ width: COLS, height: ROWS, useMouse: true, autoFocus: false });
capturerConsole();
createRoot(renderer).render(<App quitter={() => undefined} />);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
async function ecran() {
    await flush();
    await w(150);
    await flush();
    return captureCharFrame();
}
function verifier(nom: string, vrai: boolean, image?: string) {
    if (vrai) ok++; else ko++;
    process.stderr.write(`${vrai ? '✓' : '✗'} ${nom}\n`);
    if ((!vrai || process.env.VOIR) && image) process.stderr.write(image.split('\n').slice(0, 30).map((l) => l.slice(0, 160)).join('\n') + '\n');
}
// Tape une commande « /… » et n'appuie sur Entrée que si la barre la contient exactement
const trace = (m: string) => process.env.TRACE && process.stderr.write(`   · ${(performance.now() / 1000).toFixed(1)} s ${m}\n`);
async function commande(texte: string) {
    if (!texte.startsWith('/')) throw new Error('garde-fou : seulement des commandes /…');
    trace(`tape ${texte}`);
    await mockInput.typeText(texte);
    trace('tapé');
    const image = await ecran();
    trace('écran lu');
    if (!image.includes(`❯ ${texte}`)) {
        process.stderr.write(image.split('\n').slice(-14).map((l) => l.slice(0, 160)).join('\n') + '\n');
        throw new Error(`garde-fou : la barre ne contient pas « ${texte} », Entrée non pressée`);
    }
    mockInput.pressEnter();
    trace('Entrée');
    await w(600);
    return ecran();
}
async function echap() {
    mockInput.pressEscape();
    await w(200);
    return ecran();
}

await w(7000);
let image = await ecran();
verifier('accueil : cockpit et colonne', image.includes('SESSIONS CLAUDE') && image.includes('Sessions  Projets') && image.includes('SERVEURS SSH'), image);

await mockInput.typeText('/the');
image = await ecran();
verifier('suggestions : « /the » propose /theme', image.includes('/theme'), image);
image = await echap();
verifier('Échap vide la barre', !image.includes('❯ /the'), image);

image = await commande('/theme');
verifier('/theme : dialogue de choix (palettes)', image.includes('Catppuccin') && image.includes('Entrée ou clic valider'), image);
mockInput.pressArrow('down');
image = await ecran();
verifier('↓ déplace la sélection dans le choix', image.includes('❯ Catppuccin') || image.includes('❯ Tokyo'), image);
image = await echap();
await w(300);
verifier('Échap annule le choix', !image.includes('Entrée ou clic valider') && lignesJournal().some((l: string) => l.includes('Annulé')), image);

image = await commande('/prenom');
verifier('/prenom : dialogue de saisie', image.includes('Ton prénom') && image.includes('Entrée valider · Échap annuler'), image);
image = await echap();
verifier('Échap annule la saisie', !image.includes('Ton prénom'), image);

image = await commande('/config');
verifier('/config : vue Configuration (OpenTUI)', image.includes('CONFIGURATION') && image.includes('Raccourci bureau') && image.includes('Thème'), image);
mockInput.pressArrow('down');
image = await ecran();
verifier('↓ dans Config déplace la sélection', /❯ Claude/.test(image), image);
image = await echap();
verifier('Échap referme Config', !image.includes('CONFIGURATION'), image);

// Docker et SSH : ouvrir, se déplacer, refermer (ni Entrée, ni s/r/t/f : ils agiraient sur un vrai conteneur ou serveur)
image = await commande('/docker');
verifier('/docker : vue Docker (OpenTUI)', image.includes('DOCKER') && image.includes('▶ Démarrer') && image.includes('Échap fermer'), image);
image = await echap();
verifier('Échap referme Docker', !image.includes('▶ Démarrer'), image);
image = await commande('/ssh');
verifier('/ssh : vue Serveurs SSH (OpenTUI)', image.includes('SERVEURS SSH') && image.includes('⇄ Se connecter') && image.includes('Claude :'), image);
mockInput.pressArrow('down');
image = await ecran();
image = await echap();
verifier('Échap referme SSH', !image.includes('⇄ Se connecter'), image);

// Git : ouvrir, se déplacer, refermer (ni f/p/l/c : fetch, push, pull, clone)
image = await commande('/git');
verifier('/git : vue Git (OpenTUI)', image.includes('GIT') && image.includes('↻ Fetch tout') && image.includes('⎇ '), image);
mockInput.pressArrow('down');
image = await ecran();
verifier('Git : détail du dépôt choisi', image.includes('Pull requests :') || image.includes('Pas encore cloné'), image);
image = await echap();
verifier('Échap referme Git', !image.includes('↻ Fetch tout'), image);

// Projets : les lettres filtrent ; Échap efface le filtre puis ferme (pas d'Entrée : elle ouvre les actions)
image = await commande('/projets');
verifier('/projets : vue Projets (OpenTUI)', image.includes('PROJETS') && image.includes('tape pour filtrer'), image);
await mockInput.typeText('zzqx');
image = await ecran();
verifier('Projets : le filtre s’applique', image.includes('« zzqx »') && image.includes('aucun projet ne correspond'), image);
image = await echap();
verifier('Échap efface le filtre', image.includes('tape pour filtrer'), image);
image = await echap();
verifier('Échap referme Projets', !image.includes('tape pour filtrer'), image);

// Live : plein écran (la colonne disparaît), puis Échap la ramène
image = await commande('/global');
verifier('/global : vue globale en plein écran', image.includes('VUE GLOBALE') && image.includes('SERVEURS SSH (') && !image.includes('Sessions  Projets'), image);
image = await echap();
verifier('Échap referme Live et la colonne revient', !image.includes('VUE GLOBALE') && image.includes('Sessions  Projets'), image);

// Équipes : la liste (pas d'Entrée : la première ligne crée une équipe)
image = await commande('/equipe');
verifier('/equipe : liste des équipes', image.includes("ÉQUIPES D'AGENTS") && image.includes('Nouvelle équipe'), image);
image = await echap();
verifier('Échap referme Équipes', !image.includes("ÉQUIPES D'AGENTS"), image);

// Panneau de détail : un projet de l'onglet Projets (ses boutons ne sont pas cliqués)
await mockMouse.click(12, 2);
await ecran();
await mockMouse.click(10, 3);
image = await ecran();
verifier('clic sur un projet : panneau de détail', image.includes('← Retour') && image.includes('SESSIONS CLAUDE (') && (image.includes('Branche') || image.includes('pas un dépôt git')), image);
image = await echap();
verifier('Échap referme le détail', !image.includes('SESSIONS CLAUDE ('), image);
await mockMouse.click(3, 2);
await ecran();

// Les dernières vues : ouvrir et refermer seulement (Entrée y lance des actions réelles ;
// dans Disposition, changer un réglage modifierait la vraie config)
const vues: [string, string, string][] = [
    ['/recents', 'PROJETS RÉCENTS', 'Récents'],
    ['/connexions', '⚿ CONNEXIONS', 'Connexions'],
    ['/questions', 'EN ATTENTE DE TOI', 'Questions'],
    ['/ecran', "DISPOSITION DE L'ÉCRAN", 'Disposition'],
    ['/top', 'Moniteur', 'Moniteur'],
];
for (const [cmd, titre, nom] of vues) {
    image = await commande(cmd);
    verifier(`${cmd} : vue ${nom} (OpenTUI)`, image.includes(titre) && !image.includes('pas encore passée'), image);
    image = await echap();
    verifier(`Échap referme ${nom}`, !image.includes(titre), image);
}
// Fichiers (SFTP) sur dev : connexion et liste du dossier, en lecture seule
image = await commande('/sftp dev');
await w(4000);
image = await ecran();
verifier('/sftp dev : vue Fichiers, dossier listé', image.includes('⇅ FICHIERS · dev') && /\d+ éléments?/.test(image), image);
image = await echap();
verifier('Échap referme Fichiers', !image.includes('⇅ FICHIERS'), image);

image = await commande('/sorties');
verifier('/sorties : journal complet', image.includes('▤ JOURNAL'), image);
image = await echap();
verifier('Échap revient au cockpit', image.includes('SESSIONS CLAUDE'), image);

// La session qui a le plus de messages : on vérifie aussi que le texte s'affiche
// Dans l'ordre des cartes affichées : seulement les actives (ni terminées, ni en pause), 4 lignes par carte
const { cartesLaterales, enPause } = await import('../dist/ui/Laterale.js');
const donnees = lireDonnees();
const cartes = cartesLaterales(donnees).filter((x: any) => x.type !== 'session' || (x.s.statut !== 'terminee' && !enPause(x.s, donnees.activites.get(x.s.sessionId))));
const agents = cartes.map((x: any) => x.s ?? { fichier: '' });
const tailles = agents.map((a: any) => (a.fichier ? lireTranscript(a.fichier).length : -1));
const avecMessages = tailles.indexOf(Math.max(...tailles, 0));
if (avecMessages >= 0) {
    await mockMouse.click(4, 3 + 4 * avecMessages);
    image = await ecran();
    verifier('clic sur une carte : conversation et ses actions', image.includes('← Retour') && image.includes('Copier la réponse'), image);
    if (tailles[avecMessages]) {
        // Les résultats d'outils (⎿) n'apparaissent que dans la conversation, quelle que soit la largeur de la colonne
        verifier('le texte de la conversation s’affiche', image.includes('⎿ '), image);
        // Ouverte en bas : la dernière ligne de la conversation est visible
        const { lignesTranscript } = await import('../dist/ui/Zones.js');
        const derniere = lignesTranscript(lireTranscript(agents[avecMessages].fichier), 100).map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean).at(-1) ?? '';
        verifier(`ouverte sur la fin (« ${derniere.slice(0, 30)}… »)`, image.replace(/\s+/g, ' ').includes(derniere.slice(0, 25)), image);

        // Ctrl+F : on ne tape le terme que si le mode recherche est bien actif (sinon ce serait un message à la session),
        // et on n'appuie jamais sur Entrée
        mockInput.pressKey('f', { ctrl: true });
        image = await ecran();
        const enRecherche = image.includes('chercher dans la conversation');
        verifier('Ctrl+F : mode recherche', enRecherche, image);
        if (enRecherche) {
            await mockInput.typeText('re');
            image = await ecran();
            verifier('Ctrl+F : occurrences comptées', /\d+\/\d+ · Entrée = suivante|aucun résultat/.test(image), image);
            image = await echap();
            verifier('Échap ferme la recherche, la barre est vide', !image.includes('chercher dans la conversation') && image.includes('← Retour'), image);
        }
    }
    await mockMouse.moveTo(60 + 6, 6);
    image = await ecran();
    image = await echap();
    verifier('Échap referme la conversation', image.includes('SESSIONS CLAUDE'), image);
}

// Passer d'une vue à l'autre sans fermer la première (clic dans la barre du haut)
{
    const haut = (await ecran()).split('\n')[0];
    await mockMouse.click(haut.indexOf('◆ Équipes') + 2, 0);
    image = await ecran();
    await w(800);
    await mockMouse.click(haut.indexOf('◈ Config') + 2, 0);
    await w(800);
    image = await ecran();
    verifier('Équipes ouverte, clic sur Config : on passe directement à Config', image.includes('CONFIGURATION') && !image.includes("ÉQUIPES D'AGENTS"), image);
    image = await echap();
}

// Sessions inactives (terminées, en pause) : cachées, une ligne pour les montrer
{
    image = await ecran();
    const y = image.split('\n').findIndex((l) => l.includes('inactive'));
    if (y >= 0) {
        await mockMouse.click(5, y);
        image = await ecran();
        verifier('clic sur « + N inactives » : elles s’affichent', image.includes('cacher les'), image);
        const y2 = image.split('\n').findIndex((l) => l.includes('cacher les'));
        await mockMouse.click(5, y2);
        image = await ecran();
        verifier('puis on les recache', !image.includes('cacher les'), image);
    }
}

// « Quelle touche ? » : Espace sur une ligne vide ; on ne descend que dans un groupe (g = Git), jamais sur une action
await mockInput.typeText(' ');
image = await ecran();
verifier('Espace : carte « Quelle touche ? »', image.includes('␣ Actions') && image.includes('Git ›'), image);
await mockInput.typeText('g');
image = await ecran();
verifier('g : groupe Git', image.includes('␣ g · Git') && image.includes('Vue Git'), image);
mockInput.pressBackspace();
image = await ecran();
verifier('⌫ remonte', image.includes('␣ Actions'), image);
image = await echap();
// Barre vide = son texte d'aide est affiché (l'Espace qui a ouvert la carte n'y est pas resté)
verifier('Échap ferme la carte, la barre reste vide', !image.includes('␣ Actions') && image.includes('❯ Tape / pour les commandes'), image);

// Clic droit : menu de la carte, puis menu général du cockpit (refermés par Échap)
await mockMouse.click(4, 3, 2);
image = await ecran();
verifier('clic droit sur une carte : son menu', image.includes('Ouvrir la conversation') && image.includes('Fermer la session'), image);
image = await echap();
await mockMouse.click(120, 30, 2);
image = await ecran();
verifier('clic droit sur le cockpit : menu général', image.includes('Parler au maître') && image.includes('Nouvelle session Claude'), image);
image = await echap();
verifier('Échap referme le menu sans rien lancer', image.includes('SESSIONS CLAUDE'), image);

// Ctrl+K : la palette (recherche), refermée par Échap
mockInput.pressKey('k', { ctrl: true });
await w(800);
image = await ecran();
verifier('Ctrl+K : palette avec recherche', image.includes('tape pour filtrer'), image);
image = await echap();

// Alt+M : mode maître (rien n'est tapé ni envoyé), Échap pour revenir
mockInput.pressKey('m', { meta: true });
image = await ecran();
verifier('Alt+M : mode maître', image.includes('au maître') && image.includes('◈ MAÎTRE'), image);
image = await echap();
verifier('Échap quitte le mode maître', !image.includes('au maître :'), image);

await mockMouse.click(12, 2);
image = await ecran();
verifier('onglet Projets', !image.includes('+ Session') && /⎇ /.test(image), image);
await mockMouse.click(3, 2);

process.stderr.write(`\n${ok} réussis · ${ko} échoués\n`);
process.exit(ko ? 1 : 0);

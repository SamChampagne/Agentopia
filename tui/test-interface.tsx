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
demarrerCollecte();
const { renderer, mockInput, mockMouse, flush, captureCharFrame } = await createTestRenderer({ width: COLS, height: ROWS, useMouse: true });
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
async function commande(texte: string) {
    if (!texte.startsWith('/')) throw new Error('garde-fou : seulement des commandes /…');
    await mockInput.typeText(texte);
    const image = await ecran();
    if (!image.includes(`❯ ${texte}`)) throw new Error(`garde-fou : la barre ne contient pas « ${texte} », Entrée non pressée`);
    mockInput.pressEnter();
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

image = await commande('/recents');
verifier('/recents : vue pas encore migrée, annoncée', image.includes('pas encore passée à la nouvelle interface'), image);
image = await echap();
verifier('Échap referme la vue', !image.includes('pas encore passée'), image);

image = await commande('/sorties');
verifier('/sorties : journal complet', image.includes('▤ JOURNAL'), image);
image = await echap();
verifier('Échap revient au cockpit', image.includes('SESSIONS CLAUDE'), image);

// La session qui a le plus de messages : on vérifie aussi que le texte s'affiche
const agents = lireDonnees().agents;
const tailles = agents.map((a: any) => lireTranscript(a.fichier).length);
const avecMessages = tailles.indexOf(Math.max(...tailles, 0));
if (avecMessages >= 0) {
    await mockMouse.click(4, 3 + 3 * avecMessages);
    image = await ecran();
    verifier('clic sur une carte : conversation et ses actions', image.includes('← Retour') && image.includes('Copier la réponse'), image);
    if (tailles[avecMessages]) {
        verifier('le texte de la conversation s’affiche', /❯ |▸ |⎿ /.test(image.split('\n').map((l) => l.slice(80)).join('\n')), image);
        // Ouverte en bas : la dernière ligne de la conversation est visible
        const { lignesTranscript } = await import('../dist/ui/Zones.js');
        const derniere = lignesTranscript(lireTranscript(agents[avecMessages].fichier), 100).map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean).at(-1) ?? '';
        verifier(`ouverte sur la fin (« ${derniere.slice(0, 30)}… »)`, image.replace(/\s+/g, ' ').includes(derniere.slice(0, 25)), image);
    }
    await mockMouse.moveTo(60 + 6, 6);
    image = await ecran();
    image = await echap();
    verifier('Échap referme la conversation', image.includes('SESSIONS CLAUDE'), image);
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

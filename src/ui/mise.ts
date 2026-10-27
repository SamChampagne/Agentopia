import stringWidth from 'string-width';

// Géométrie de l'écran plein : tout est calculé ici pour que les clics retrouvent
// exactement ce qui est affiché (Ink ne donne pas la position absolue des éléments).

export const HAUT = 2;              // barre du haut + ligne de séparation
export const BAS = 5;               // destination du texte (1) + saisie (3) + barre de statut (1)
// Hauteur d'une carte de session : 2 lignes de contenu + 1 ligne d'espace (3 lignes de contenu en mode détaillé, /cartes)
export let CARTE = 3;
export function choisirTailleCartes(detaillees: boolean): void {
    CARTE = detaillees ? 4 : 3;
}
export const MAX_SERVEURS = 5;
export const LATERAL_MIN = 28;

// Largeur de la colonne de gauche choisie par l'utilisateur (0 = automatique)
let largeurChoisie = 0;
export function choisirLargeurLaterale(n: number): void {
    largeurChoisie = n;
}

export interface Mise {
    largeur: number;
    hauteur: number;                // une ligne de moins que le terminal (évite qu'Ink efface tout à chaque rendu)
    corps: number;                  // hauteur entre la barre du haut et la saisie
    lateral: number;                // largeur de la colonne de gauche
    principal: number;              // largeur de la zone principale
}

export function calculerMise(colonnes: number, lignes: number): Mise {
    // 2 colonnes libres à droite : certains symboles (⚠ ✔ ⏺…) sont dessinés sur 2 colonnes par le terminal
    // alors qu'Ink en compte 1. Sans marge, une ligne pleine passerait à la ligne et tout l'écran remonterait.
    const largeur = Math.max(70, colonnes - 2);
    const hauteur = Math.max(20, lignes - 1);
    const auto = Math.max(34, Math.min(48, Math.floor(largeur * 0.33)));
    const lateral = largeurChoisie ? Math.max(LATERAL_MIN, Math.min(largeur - 50, largeurChoisie)) : auto;
    return { largeur, hauteur, corps: hauteur - HAUT - BAS, lateral, principal: largeur - lateral };
}

export const MAX_DOCKER = 4;
export const MAITRE_MIN = 2;        // lignes réservées au maître (titre + 1 ligne) dans l'espace libre

export interface MiseLaterale {
    nbCartes: number;               // cartes visibles
    ligneNouvelle: number;          // « + Session   ❯ Terminal »
    ligneMaitre: number;            // en-tête du maître (sous une ligne vide)
    hauteurMaitre: number;          // en-tête compris : tout l'espace libre
    afficheDocker: boolean;         // section présente (repliée ou non)
    ligneDocker: number;            // en-tête Docker
    nbDocker: number;               // lignes visibles (0 si repliée)
    afficheServeurs: boolean;
    ligneServeurs: number;          // en-tête Serveurs SSH
    nbServeurs: number;
}

// Colonne de gauche (la dernière colonne est la ligne verticale de séparation). Chaque section commence
// par une ligne vide puis une bande d'en-tête ; Docker et Serveurs SSH peuvent être repliés (en-tête seul) :
//   0              en-tête « Sessions Claude »
//   1…             cartes (CARTE lignes chacune)
//   ligneNouvelle  « + Session   ❯ Terminal »
//   (vide), en-tête du maître, puis tout l'espace libre
//   (vide), en-tête Docker, une ligne par projet compose
//   (vide), en-tête Serveurs SSH, un serveur par ligne, collés en bas
// nbCartesExistantes : sans cartes vides sous la dernière session, l'espace libre va au maître
export function miseLaterale(corps: number, nbServeurs: number, nbLignesDocker = 0, replies: { docker?: boolean; ssh?: boolean } = {}, nbCartesExistantes = Infinity): MiseLaterale {
    const afficheServeurs = nbServeurs > 0;
    const afficheDocker = nbLignesDocker > 0;
    const serveurs = replies.ssh ? 0 : Math.min(MAX_SERVEURS, nbServeurs);
    const docker = replies.docker ? 0 : Math.min(MAX_DOCKER, nbLignesDocker);
    const blocServeurs = afficheServeurs ? serveurs + 2 : 0;
    const blocDocker = afficheDocker ? docker + 2 : 0;
    // 3 = en-tête des sessions, « + Session », ligne vide avant le maître
    const nbCartes = Math.max(1, Math.min(Math.max(1, nbCartesExistantes), Math.floor((corps - 3 - blocServeurs - blocDocker - MAITRE_MIN) / CARTE)));
    const ligneNouvelle = 1 + nbCartes * CARTE;
    const ligneServeurs = corps - serveurs - 1;
    const ligneDocker = corps - blocServeurs - docker - 1;
    // Le maître s'arrête à la ligne vide qui précède la section suivante
    const finMaitre = afficheDocker ? ligneDocker - 1 : afficheServeurs ? ligneServeurs - 1 : corps;
    return {
        nbCartes,
        ligneNouvelle,
        ligneMaitre: ligneNouvelle + 2,
        hauteurMaitre: Math.max(0, finMaitre - ligneNouvelle - 2),
        afficheDocker,
        ligneDocker,
        nbDocker: docker,
        afficheServeurs,
        ligneServeurs,
        nbServeurs: serveurs,
    };
}

export interface Bouton {
    label: string;
    action: string;
    x: number;
    largeur: number;
}

// Place des boutons sur une ligne à partir de x ; renvoie leur position pour les clics.
// La largeur est mesurée comme Ink la mesure (string-width) : certains symboles (≡…) font 2 colonnes.
export function placerBoutons(boutons: { label: string; action: string }[], x0: number): Bouton[] {
    let x = x0;
    return boutons.map((b) => {
        const largeur = stringWidth(b.label) + 2;
        const bouton = { ...b, x, largeur };
        x += largeur + 1;
        return bouton;
    });
}

// Un clic sur l'espace entre deux boutons compte pour celui de gauche
export const boutonA = (boutons: Bouton[], x: number) => boutons.find((b) => x >= b.x && x <= b.x + b.largeur);

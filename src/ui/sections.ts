import { chargerConfig, sauverConfig } from '../config.js';
import type { Donnees } from './donnees.js';
import { serveursPertinents } from './Panneau.js';
import { lignesDocker, cartesLaterales } from './Laterale.js';
import { miseLaterale } from './mise.js';

// Sections de la colonne de gauche qu'on peut masquer (clic droit) pour laisser la place aux cartes.
// Gardé en mémoire : lu une fois, écrit seulement quand on change.

export const SECTIONS = { docker: 'Docker', ssh: 'Serveurs SSH' } as const;
export type Section = keyof typeof SECTIONS;

const masquees = new Set<string>(chargerConfig().sectionsMasquees ?? []);

export const sectionMasquee = (s: Section): boolean => masquees.has(s);

export async function basculerSection(s: Section, visible = masquees.has(s)): Promise<void> {
    if (visible) masquees.delete(s);
    else masquees.add(s);
    // La config en mémoire des commandes est celle qui est sauvegardée : on la met à jour elle aussi
    const { config } = await import('../commandes.js');
    config.sectionsMasquees = [...masquees];
    sauverConfig(config);
}

export const serveursLateraux = (d: Donnees) => (masquees.has('ssh') ? [] : serveursPertinents(d));
export const dockerLateral = (d: Donnees) => (masquees.has('docker') ? [] : lignesDocker(d));

// Repliées : seul l'en-tête reste (un clic dessus déplie). Les serveurs SSH sont repliés par défaut.
const repliees = new Set<string>(chargerConfig().sectionsRepliees ?? ['ssh']);
export const sectionRepliee = (s: Section): boolean => repliees.has(s);

export async function basculerRepli(s: Section): Promise<void> {
    if (repliees.has(s)) repliees.delete(s);
    else repliees.add(s);
    const { config } = await import('../commandes.js');
    config.sectionsRepliees = [...repliees];
    sauverConfig(config);
}

// Géométrie de la colonne de gauche pour ces données : la même pour l'affichage et pour les clics
// (Docker et SSH ont maintenant leur propre espace de travail : l'espace Sessions n'a que les cartes et le maître)
export const miseLateraleDe = (corps: number, d: Donnees) => miseLaterale(corps, 0, 0, {}, cartesLaterales(d).length);

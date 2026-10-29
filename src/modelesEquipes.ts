import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { ecrireAtomique } from './sessionsIntegrees.js';
import { FOURNISSEURS, type Fournisseur } from './providers/types.js';
import { validerDependances } from './equipePlan.js';
import type { Equipe } from './equipe.js';

export interface DefinitionTache { titre: string; fournisseur: Fournisseur; consigne: string; dependances: string[] }
export interface ModeleEquipe { id: string; nom: string; cree: number; taches: DefinitionTache[] }
export function validerDefinitions(taches: unknown): DefinitionTache[] {
    if (!Array.isArray(taches)) throw new Error('Le modèle ne contient pas de tâches');
    const nettoyees = taches.map((t) => {
        if (!t || !Object.hasOwn(FOURNISSEURS, t.fournisseur) || typeof t.titre !== 'string' || !t.titre.trim() || t.titre.length > 160
            || typeof t.consigne !== 'string' || !t.consigne.trim() || t.consigne.length > 32_000
            || !Array.isArray(t.dependances) || t.dependances.some((d: unknown) => typeof d !== 'string')) throw new Error('Tâche de modèle invalide');
        return { titre: t.titre.trim(), fournisseur: t.fournisseur as Fournisseur, consigne: t.consigne.trim(), dependances: [...t.dependances] as string[] };
    });
    validerDependances(nettoyees.map((t, i) => ({ id: `t${i + 1}`, dependances: t.dependances })));
    return nettoyees;
}
const identifiant = (id: string) => /^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id);
const fichier = (id: string) => {
    if (!identifiant(id)) throw new Error('Identifiant de modèle invalide');
    return path.join(CHEMINS.modelesEquipes, `${id}.json`);
};
export function lireModelesEquipes(): ModeleEquipe[] {
    if (!fs.existsSync(CHEMINS.modelesEquipes)) return [];
    return fs.readdirSync(CHEMINS.modelesEquipes).filter((f) => f.endsWith('.json') && identifiant(f.slice(0, -5))).flatMap((f) => {
        try {
            const m = JSON.parse(fs.readFileSync(path.join(CHEMINS.modelesEquipes, f), 'utf8'));
            if (typeof m.nom !== 'string' || !m.nom.trim() || m.nom.length > 80 || !Number.isFinite(m.cree)) return [];
            return [{ id: f.slice(0, -5), nom: m.nom, cree: m.cree, taches: validerDefinitions(m.taches) }];
        } catch { return []; } // Un fichier abîmé reste sur disque, les autres modèles restent utilisables.
    }).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
export function enregistrerModeleEquipe(equipe: Equipe, nom: string): ModeleEquipe {
    if (!equipe.mixte) throw new Error('Seules les équipes avec fournisseurs explicites peuvent servir de modèle');
    if (!nom.trim() || nom.trim().length > 80) throw new Error('Donne un nom de 1 à 80 caractères');
    const ids = new Map(equipe.taches.map((t, i) => [t.id, `t${i + 1}`]));
    // Copie du plan seulement : jamais de session, résultat, coût, branche ou chemin de worktree.
    const taches = validerDefinitions(equipe.taches.map((t) => ({ titre: t.titre, fournisseur: t.fournisseur, consigne: t.consigne,
        dependances: t.dependances.map((d) => ids.get(d) ?? d) })));
    const modele = { id: randomUUID(), nom: nom.trim(), cree: Date.now(), taches };
    fs.mkdirSync(CHEMINS.modelesEquipes, { recursive: true }); ecrireAtomique(fichier(modele.id), modele); return modele;
}
export function retirerModeleEquipe(id: string): void { fs.rmSync(fichier(id), { force: true }); }

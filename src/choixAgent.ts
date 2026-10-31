import { chargerConfig } from './config.js';
import { FOURNISSEURS, type Fournisseur } from './providers/types.js';
import { disponibilite } from './providers/config.js';
import { choisir, tache } from './ui/bus.js';
import { guiderConnexion } from './providers/assistantConnexion.js';
import { conseiller } from './conseiller.js';

export async function choisirAgent(code = false, prefere = chargerConfig().fournisseurDefaut): Promise<Fournisseur> {
    const candidats = (Object.keys(FOURNISSEURS) as Fournisseur[]).filter((f) => !code || FOURNISSEURS[f].code);
    const prets = candidats.filter((f) => disponibilite(f).pret);
    const f = prefere && prefere !== 'choisir' && candidats.includes(prefere) ? prefere
        : prets.length === 1 ? prets[0] : await choisir(code ? 'Quel agent travaille dans le projet ?' : 'Quel agent utiliser ?', candidats.map((f) => ({
            label: FOURNISSEURS[f].nom, valeur: f, description: `${FOURNISSEURS[f].capacite} · ${disponibilite(f).texte}`,
        })), false);
    await guiderConnexion(f, true); return f;
}
export async function demanderAgentTexte(prompt: string, cwd: string): Promise<string> {
    const f = await choisirAgent();
    const r = await tache(`${FOURNISSEURS[f].nom} prépare sa réponse`, () => conseiller(f, prompt, undefined, { cwd }));
    if (r.erreur) throw new Error(r.erreur);
    if (!r.texte?.trim()) throw new Error('L’agent n’a pas renvoyé de réponse exploitable');
    return r.texte;
}

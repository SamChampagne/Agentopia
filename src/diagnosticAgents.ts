import type { Config } from './config.js';
import { verifierConnexion, type EtatConnexion } from './providers/connexion.js';
import { FOURNISSEURS, type Fournisseur } from './providers/types.js';

export interface VerificationAgent {
    niveau: 'ok' | 'avert' | 'erreur';
    quoi: string;
    detail: string;
    solution?: string;
}

// Les contrôles interrogent le compte ou le catalogue, jamais un modèle.
export async function diagnostiquerAgents(
    config: Pick<Config, 'fournisseurDefaut'>,
    verifier: (f: Fournisseur) => Promise<EtatConnexion> = verifierConnexion,
): Promise<VerificationAgent[]> {
    const fournisseurs = Object.keys(FOURNISSEURS) as Fournisseur[];
    const controles = await Promise.all(fournisseurs.map(async (f): Promise<VerificationAgent> => {
        let etat: EtatConnexion;
        try { etat = await verifier(f); }
        catch { etat = { pret: false, texte: 'Vérification interrompue. Réessaie depuis les connexions.' }; }
        const choisi = config.fournisseurDefaut === f;
        return {
            niveau: etat.pret ? 'ok' : choisi ? 'erreur' : 'avert',
            quoi: `${FOURNISSEURS[f].nom} intégré`,
            detail: `${choisi ? 'Agent par défaut · ' : ''}${etat.texte}`,
            solution: etat.pret ? undefined : `/connexions pour ${choisi ? 'rétablir cet agent' : 'activer ce fournisseur optionnel'}`,
        };
    }));
    if (!controles.some((v) => v.niveau === 'ok')) controles.unshift({
        niveau: 'erreur', quoi: 'Sessions intégrées',
        detail: 'Aucun fournisseur vérifié disponible pour démarrer une session.',
        solution: '/connexions pour connecter au moins un agent, puis relancer /diagnostic',
    });
    return controles;
}

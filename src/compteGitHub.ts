import { chargerConfig } from './config.js';
import { jeton } from './jetons.js';
import { jetonCompteGitHub, verifierCompteGitHub } from './githubLocal.js';

export interface EtatCompteGitHub { ok: boolean; texte: string }
export async function cleGitHub(): Promise<string | undefined> {
    const compte = chargerConfig().compteGitHub;
    // Une préférence explicite ne retombe jamais sur le coffre ou un autre utilisateur.
    if (compte) return jetonCompteGitHub(compte);
    return jeton('GitHub');
}

export async function etatCompteGitHub(): Promise<EtatCompteGitHub> {
    const compte = chargerConfig().compteGitHub;
    try {
        const cle = await cleGitHub();
        if (!cle) return { ok: false, texte: 'Choisir un compte local ou un jeton' };
        const login = await verifierCompteGitHub(cle);
        if (compte && login.toLowerCase() !== compte.toLowerCase()) return { ok: false, texte: `@${compte} : identité incohérente, reconnecter` };
        return { ok: true, texte: `@${login} · ${compte ? 'choisi pour Agentopia' : 'automatique'}` };
    } catch { return { ok: false, texte: compte ? `@${compte} · connexion à vérifier` : 'Connexion GitHub à vérifier' }; }
}

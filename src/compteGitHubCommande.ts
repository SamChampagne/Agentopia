import { type Config, sauverConfig } from './config.js';
import { listerComptesGitHub, jetonCompteGitHub, verifierCompteGitHub } from './githubLocal.js';
import { bus, choisir, tache } from './ui/bus.js';

const servicesDefaut = {
    lister: listerComptesGitHub, jeton: jetonCompteGitHub, verifier: verifierCompteGitHub,
    actualiser: async () => {
        const { oublierIdentite } = await import('./connexions.js'); oublierIdentite('GitHub');
        const { actualiserCompteGitHub } = await import('./synchro.js'); await actualiserCompteGitHub();
    },
};

export async function choisirCompteGitHub(config: Config, services = servicesDefaut): Promise<'jeton' | undefined> {
    let comptes: Awaited<ReturnType<typeof listerComptesGitHub>> = [], erreur = '';
    try { comptes = await tache('Lecture des comptes GitHub locaux', () => services.lister()); }
    catch { erreur = 'Comptes locaux indisponibles : vérifie GitHub CLI dans Connexions → Outils.\n'; }
    const ordonnes = [...comptes].sort((a, b) => Number(b.login === config.compteGitHub) - Number(a.login === config.compteGitHub));
    const choix = await choisir('Compte GitHub pour Agentopia', [
        ...ordonnes.map(c => ({ label: `@${c.login}`, valeur: `local:${c.login}`,
            description: `${c.login === config.compteGitHub ? 'choisi ici · ' : ''}${c.valide ? 'connexion valide' : 'à reconnecter'}${c.actif ? ' · actif sur le poste' : ''}` })),
        { label: 'Réglage habituel du poste', valeur: 'auto', description: 'Jeton Agentopia et configuration Git existante' },
        { label: 'Gérer un jeton dans Agentopia', valeur: 'jeton', description: 'Connexion manuelle, chiffrée sur ce poste' },
    ], false, `${erreur}Choisis un compte déjà connecté sur cet ordinateur.\nIl servira aux PR, tickets, dépôts et opérations GitHub HTTPS d’Agentopia.\nLes clés SSH et l’identité des commits se règlent séparément.\nLe compte GitHub actif dans tes autres outils reste le même.`);
    if (choix === 'jeton') return 'jeton';
    const compte = choix === 'auto' ? undefined : comptes.find(c => `local:${c.login}` === choix)?.login;
    if (choix !== 'auto' && !compte) throw new Error('Ce compte GitHub ne figure plus dans la liste locale.');
    if (compte) await tache(`Vérification de @${compte}`, async () => {
        const login = await services.verifier(await services.jeton(compte));
        if (login.toLowerCase() !== compte.toLowerCase()) throw new Error('Identité GitHub différente de celle choisie. Aucun réglage modifié.');
    });
    const avant = config.compteGitHub;
    if (compte) config.compteGitHub = compte; else delete config.compteGitHub;
    try { sauverConfig(config); } catch (e) { if (avant) config.compteGitHub = avant; else delete config.compteGitHub; throw e; }
    bus.emit('notice', compte ? `GitHub : @${compte} · choisi pour Agentopia` : 'GitHub : réglage habituel restauré');
    try { await services.actualiser(); }
    catch { bus.emit('notice', `Compte enregistré${compte ? ` : @${compte}` : ''} · actualisation GitHub indisponible, réessaie depuis Git.`); }
}

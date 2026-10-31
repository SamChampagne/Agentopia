import { Annule, bus, choisir, saisir, tache } from '../ui/bus.js';
import { enregistrerSecret, oublierSecret } from '../jetons.js';
import { binaireCodex } from './config.js';
import { verifierConnexion } from './connexion.js';
import { FOURNISSEURS, type Fournisseur } from './types.js';
import { connecterCodex, installerOutil } from '../preparerOutils.js';

const servicesParDefaut = {
    choisir, saisir, verifier: verifierConnexion,
    enregistrer: enregistrerSecret, oublier: oublierSecret,
    connecterCodex,
    installerCodex: () => installerOutil('codex'),
};

// Le même dialogue sert dans Config et pendant une création de session.
// Une connexion réussie reprend l'action en cours avec son projet et sa consigne.
export async function guiderConnexion(f: Fournisseur, reprendre = false, services = servicesParDefaut): Promise<void> {
    let etat = await tache(`Vérification ${FOURNISSEURS[f].nom}`, () => services.verifier(f));
    if (reprendre && etat.pret) return;
    while (true) {
        const variable = f === 'claude' ? 'ANTHROPIC_API_KEY' : 'PERPLEXITY_API_KEY';
        const environnement = f !== 'codex' && !!process.env[variable];
        const action = await services.choisir(`${FOURNISSEURS[f].nom} · ${etat.texte}`, [
            ...(etat.pret && reprendre ? [{ label: 'Continuer', valeur: 'continuer' }] : []),
            ...(f === 'codex' ? [!binaireCodex()
                ? { label: 'Installer Codex et continuer', valeur: 'installer', description: 'Téléchargement officiel, puis connexion guidée.' }
                : { label: 'Connecter Codex', valeur: 'connecter', description: 'Connecte-toi dans le navigateur ; Agentopia reprend automatiquement.' }]
                : environnement ? [] : [{ label: 'Enregistrer ou remplacer la clé API', valeur: 'cle', description: 'Saisie masquée ; stockage chiffré avec ton compte Windows.' }]),
            { label: 'Vérifier à nouveau', valeur: 'verifier', description: environnement ? `${variable} est prioritaire. Pour la changer, modifie-la puis relance le logiciel.` : 'Vérification sans génération de texte.' },
            ...(f !== 'codex' && !reprendre ? [{ label: 'Retirer la clé enregistrée', valeur: 'retirer' }] : []),
            { label: reprendre ? 'Annuler la création' : 'Retour', valeur: 'retour' },
        ], false);
        if (action === 'retour') { if (reprendre) throw new Annule(); return; }
        if (action === 'continuer') return;
        if (action === 'installer') await tache('Installation de Codex', () => services.installerCodex());
        if (action === 'connecter') await tache('Connecte-toi dans le navigateur · reprise automatique ensuite', () => services.connecterCodex());
        if (action === 'retirer') {
            services.oublier(`agent:${f}`);
            bus.emit('notice', environnement ? 'Clé locale retirée ; la variable d’environnement reste prioritaire.' : 'Clé locale retirée.');
            return;
        }
        if (action === 'cle') {
            const cle = (await services.saisir(`Clé API ${FOURNISSEURS[f].nom}`, '', true)).trim();
            if (!cle) continue;
            if (!services.enregistrer(`agent:${f}`, cle)) throw new Error('Impossible de chiffrer la clé : rien enregistré.');
        }
        etat = await tache(`Vérification ${FOURNISSEURS[f].nom}`, () => services.verifier(f));
        bus.emit('notice', etat.texte);
        if (reprendre && etat.pret) return;
    }
}

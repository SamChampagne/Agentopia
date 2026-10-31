import type { PermissionAgent } from './providers/types.js';

// Une description ne change jamais la commande ni la décision envoyée au fournisseur.
function nomCommande(commande: string): string {
    let simple = commande.trim();
    const enveloppe = simple.match(/^(?:"[^"]*(?:powershell|pwsh)(?:\.exe)"|(?:powershell|pwsh)(?:\.exe)?)(?: -NoProfile)? -Command (["'])(.*)\1$/i);
    if (enveloppe) simple = enveloppe[2];
    // Ne pas cacher une deuxième action derrière « lancer les tests ».
    if (/[;&|\r\n`$<>]/.test(simple)) return 'Exécuter une commande';
    if (/^(?:npm (?:test|run test(?::[\w-]+)?)|bun (?:test|run test(?::[\w-]+)?)|node --test)(?: [\w./\\ :"'=-]+)?$/i.test(simple)) return 'Lancer les tests';
    if (/^git commit(?: [\w\s./\\ :"'=-]+)?$/i.test(simple)) return 'Enregistrer les changements dans Git';
    if (/^git merge(?: [\w./\\ :"'=-]+)?$/i.test(simple)) return 'Fusionner une branche';
    if (/^git (?:status|diff|log)(?: [\w./\\ :"'=-]+)?$/i.test(simple)) return 'Consulter les changements Git';
    return 'Exécuter une commande';
}
export function presenterPermission(p: PermissionAgent) {
    const titre = p.action === 'commande' ? nomCommande(p.commande || '')
        : p.action === 'fichiers' ? 'Modifier des fichiers du projet'
        : p.questions?.length ? 'Répondre à l’agent' : 'Autoriser une action de l’agent';
    const contexte = [p.dossier ? `Dossier : ${p.dossier}` : '',
        p.commande ? `Commande exacte :\n${p.commande}` : `Demande : ${p.titre}`,
        'Le temps d’attente ne compte pas dans la limite de travail. Autoriser vaut pour cette demande uniquement.',
    ].filter(Boolean).join('\n\n');
    return { titre, contexte, details: `Détails transmis par le fournisseur :\n${p.detail}\n\n${contexte}` };
}

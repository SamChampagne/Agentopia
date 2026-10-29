// Le clavier appartient à une seule zone à la fois. Ces indications restent
// indépendantes du moteur de rendu pour pouvoir être testées sans terminal.
export function contexteSaisie(demande?: { type: string; recherche?: boolean }, vue = '', raccourcis = false): string | undefined {
    if (raccourcis) return 'Raccourcis : choisis une action · Échap pour retrouver la barre';
    if (!demande) return undefined;
    if (demande.type === 'saisie') return 'Saisie dans le dialogue ouvert · Entrée valider · Échap annuler';
    if (demande.type === 'choix') return demande.recherche
        ? 'Le clavier filtre la liste ouverte · ↑ ↓ choisir · Entrée valider · Échap revenir'
        : 'Le clavier contrôle le choix ouvert · ↑ ↓ choisir · Entrée valider · Échap revenir';
    if (/^\/?projets(?:\s|$)/.test(vue)) return 'Projets : tape pour filtrer la liste · Échap efface le filtre, puis revient à la barre';
    return 'Le clavier contrôle la vue ouverte · Échap pour revenir à la barre de message';
}

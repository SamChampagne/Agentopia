export function validerDependances(taches: { id: string; dependances: string[] }[]): void {
    if (!taches.length || taches.length > 8) throw new Error('Une équipe doit contenir de 1 à 8 tâches');
    const ids = new Set(taches.map((t) => t.id));
    if (ids.size !== taches.length) throw new Error('Chaque tâche doit avoir un identifiant unique');
    const vues = new Set<string>(), pile = new Set<string>();
    const visiter = (id: string) => {
        if (pile.has(id)) throw new Error(`Dépendance circulaire : ${id}`);
        if (vues.has(id)) return;
        pile.add(id);
        const t = taches.find((x) => x.id === id)!;
        for (const d of t.dependances) {
            if (!ids.has(d)) throw new Error(`Dépendance inconnue : ${d}`);
            visiter(d);
        }
        pile.delete(id); vues.add(id);
    };
    taches.forEach((t) => visiter(t.id));
}

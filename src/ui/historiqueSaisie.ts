// La navigation ne remplace le brouillon que provisoirement : ↓ le retrouve.
// Une frappe ou un changement de conversation commence une nouvelle navigation.
export class HistoriqueSaisie {
    private position = -1;
    private brouillon = '';
    get enCours() { return this.position >= 0; }
    reinitialiser() { this.position = -1; this.brouillon = ''; }
    parcourir(direction: 'up' | 'down', texte: string, historique: readonly string[]): string {
        if (!historique.length || (this.position < 0 && direction === 'down')) return texte;
        if (this.position < 0) this.brouillon = texte;
        this.position = Math.max(-1, Math.min(historique.length - 1, this.position + (direction === 'up' ? 1 : -1)));
        return this.position < 0 ? this.brouillon : historique[this.position];
    }
}

import { createElement } from 'react';
import { afficherVue } from './bus.js';

export interface Avis {
    id: number;
    texte: string;
    date: number;
    derniereDate: number;
    repetitions: number;
    lu: boolean;
}

// Avis de ce lancement uniquement. Ne pas les recopier vers la console ou le bus :
// la vue qui les consulte ne doit ni les dupliquer, ni déclencher d'autres avis.
export class HistoriqueAvis {
    private avis: readonly Avis[] = [];
    private prochain = 0;
    private abonnes = new Set<() => void>();
    constructor(private limite = 100) {}
    lire = (): readonly Avis[] => this.avis;
    abonner = (f: () => void) => { this.abonnes.add(f); return () => { this.abonnes.delete(f); }; };
    private publier(avis: readonly Avis[]) { this.avis = avis; this.abonnes.forEach((f) => f()); }
    ajouter(texte: string, date = Date.now()) {
        const propre = texte.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
        if (!propre) return;
        const dernier = this.avis[0];
        if (dernier?.texte === propre && date >= dernier.derniereDate && date - dernier.derniereDate <= 10_000) {
            this.publier([{ ...dernier, derniereDate: date, repetitions: dernier.repetitions + 1, lu: false }, ...this.avis.slice(1)]);
        } else {
            this.publier([{ id: ++this.prochain, texte: propre, date, derniereDate: date, repetitions: 1, lu: false }, ...this.avis].slice(0, Math.max(1, this.limite)));
        }
    }
    marquerLus() { if (this.avis.some((a) => !a.lu)) this.publier(this.avis.map((a) => ({ ...a, lu: true }))); }
}

export const historiqueAvis = new HistoriqueAvis();
export const heureAvis = (date: number) => new Date(date).toLocaleTimeString('fr-CA', { hour12: false });
export function texteAvis(avis: Avis): string {
    return `${new Date(avis.date).toLocaleString('fr-CA')}${avis.repetitions > 1 ? ` · ${avis.repetitions} occurrences (dernière : ${heureAvis(avis.derniereDate)})` : ''}\n\n${avis.texte}`;
}
export async function ouvrirAvis(): Promise<void> {
    const { VueAvis } = await import('./VueAvis.js');
    await afficherVue((fermer) => createElement(VueAvis, { fermer }));
}

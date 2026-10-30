import type { CarnetBrouillons } from './brouillons.js';
import { imageDuPressePapiers } from './pressePapiers.js';
import { verifierPiecesJointes } from './piecesJointes.js';
import { bus } from './bus.js';

export type LireImage = (signal: AbortSignal) => Promise<string | undefined>;
export class CollageImage {
    private etat: { destination?: string; libelle?: string } = {};
    private abonnes = new Set<() => void>();
    private controle?: AbortController;
    constructor(private carnet: CarnetBrouillons,
        private lireImage: LireImage = (signal) => imageDuPressePapiers({ signal }),
        private notifier: (texte: string) => void = (texte) => { bus.emit('notice', texte); }) {}
    lire = () => this.etat;
    abonner = (f: () => void) => { this.abonnes.add(f); return () => { this.abonnes.delete(f); }; };
    private publier(etat: typeof this.etat) { this.etat = etat; this.abonnes.forEach((f) => f()); }
    async coller(destination: string, libelle: string): Promise<boolean> {
        if (this.controle) return false;
        const controle = new AbortController();
        this.controle = controle;
        this.publier({ destination, libelle });
        try {
            const chemin = await this.lireImage(controle.signal);
            if (controle.signal.aborted) return false;
            if (!chemin) { this.notifier('Pas d’image dans le presse-papiers · brouillon conservé.'); return false; }
            verifierPiecesJointes([chemin]);
            // Relire le brouillon d'origine : la frappe et un changement de conversation
            // restent possibles pendant que PowerShell accède au presse-papiers.
            const actuel = this.carnet.lire(destination);
            if (actuel.images.includes(chemin)) { this.notifier(`Image déjà jointe · ${libelle}.`); return true; }
            this.carnet.ecrire(destination, { images: [...actuel.images, chemin],
                texte: `${actuel.texte}${actuel.texte && !actuel.texte.endsWith(' ') ? ' ' : ''}[image ${actuel.images.length + 1}] ` });
            this.notifier(`Image ajoutée au brouillon · ${libelle}.`);
            return true;
        } catch (e) {
            if (!controle.signal.aborted) this.notifier(`Image non ajoutée : ${(e as Error).message} · brouillon conservé.`);
            return false;
        } finally {
            if (this.controle === controle) { this.controle = undefined; this.publier({}); }
        }
    }
    fermer() { this.controle?.abort(); }
}

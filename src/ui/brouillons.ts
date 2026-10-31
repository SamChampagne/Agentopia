import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CHEMINS } from '../chemins.js';

export interface Brouillon { texte: string; images: string[] }
const vide = (): Brouillon => ({ texte: '', images: [] });
export function destinationBrouillon(session?: string, maitre = false, recherche = false, cwd = process.cwd()): string {
    return recherche ? `recherche:${session ?? cwd}` : maitre ? `maitre:${cwd}` : session ? `session:${session}` : `commande:${cwd}`;
}

// Un fichier par destination : sauvegarder B ne remplace jamais le brouillon de A.
export class CarnetBrouillons {
    private valeurs = new Map<string, Brouillon>();
    private sales = new Set<string>();
    private abonnes = new Set<() => void>();
    private minuterie?: NodeJS.Timeout;
    constructor(private dossier = CHEMINS.brouillons, private erreur: () => void = () => {}) {}
    private fichier(cle: string) { return path.join(this.dossier, `${createHash('sha256').update(cle).digest('hex')}.json`); }
    lire(cle: string): Brouillon {
        if (!this.valeurs.has(cle)) {
            let valeur = vide();
            if (!cle.startsWith('recherche:')) try {
                const lu = JSON.parse(fs.readFileSync(this.fichier(cle), 'utf8'));
                if (typeof lu.texte === 'string' && Array.isArray(lu.images)) valeur = { texte: lu.texte, images: lu.images.filter((v: unknown) => typeof v === 'string') };
            } catch { /* Premier brouillon ou sauvegarde illisible : saisie disponible. */ }
            this.valeurs.set(cle, valeur);
        }
        return this.valeurs.get(cle)!;
    }
    ecrire(cle: string, modification: Partial<Brouillon>) {
        this.valeurs.set(cle, { ...this.lire(cle), ...modification });
        if (!cle.startsWith('recherche:')) this.sales.add(cle);
        clearTimeout(this.minuterie);
        this.minuterie = setTimeout(() => this.sauver(), 250);
        this.minuterie.unref();
        this.abonnes.forEach((f) => f());
    }
    restaurer(cle: string, ancien: Brouillon) {
        const actuel = this.lire(cle);
        // Un envoi en échec ne doit pas écraser le texte déjà retapé entre-temps.
        this.ecrire(cle, { texte: [ancien.texte, actuel.texte].filter(Boolean).join('\n\n'), images: [...new Set([...ancien.images, ...actuel.images])] });
    }
    abonner = (f: () => void) => { this.abonnes.add(f); return () => { this.abonnes.delete(f); }; };
    sauver = () => {
        clearTimeout(this.minuterie);
        for (const cle of this.sales) {
            const fichier = this.fichier(cle), temporaire = `${fichier}.${randomUUID()}.tmp`;
            try {
                fs.mkdirSync(this.dossier, { recursive: true });
                fs.writeFileSync(temporaire, JSON.stringify(this.lire(cle)), { encoding: 'utf8', mode: 0o600 });
                fs.renameSync(temporaire, fichier);
                this.sales.delete(cle);
            } catch {
                try { fs.unlinkSync(temporaire); } catch { /* Aucun fichier temporaire. */ }
                this.erreur();
            }
        }
    };
}

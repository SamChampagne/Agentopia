/** Une limite de travail actif : les demandes utilisateur suspendent le compteur. */
export interface SourceTemps {
    maintenant(): number;
    programmer(action: () => void, delai: number): unknown;
    annuler(id: unknown): void;
}
const tempsSysteme: SourceTemps = {
    maintenant: () => performance.now(),
    programmer: (action, delai) => setTimeout(action, delai),
    annuler: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
export class HorlogeTravail {
    private instant: number;
    private travailMs = 0;
    private attenteMs = 0;
    private attentes = 0;
    private fermee = false;
    private minuterie: unknown;
    constructor(private limiteMs: number, private expirer: () => void, private temps: SourceTemps = tempsSysteme) {
        this.instant = temps.maintenant();
        this.programmer();
    }
    private mesurer() {
        if (this.fermee) return;
        const maintenant = this.temps.maintenant(), delta = Math.max(0, maintenant - this.instant);
        if (this.attentes) this.attenteMs += delta; else this.travailMs += delta;
        this.instant = maintenant;
    }
    private programmer() {
        if (this.fermee || this.attentes) return;
        this.minuterie = this.temps.programmer(() => {
            if (this.fermee || this.attentes) return;
            this.arreter(); this.expirer();
        }, Math.max(0, this.limiteMs - this.travailMs));
    }
    suspendre(): () => void {
        this.mesurer();
        if (!this.fermee && this.travailMs >= this.limiteMs) { this.arreter(); this.expirer(); }
        if (this.fermee) return () => {};
        this.temps.annuler(this.minuterie);
        this.attentes++;
        let liberee = false;
        return () => {
            if (liberee || this.fermee) return;
            liberee = true; this.mesurer(); this.attentes--;
            this.programmer();
        };
    }
    bilan() {
        this.mesurer();
        return { travailMs: Math.round(this.travailMs), attenteMs: Math.round(this.attenteMs) };
    }
    arreter() {
        this.mesurer(); this.fermee = true; this.temps.annuler(this.minuterie);
    }
}

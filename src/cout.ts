import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Coût du jour en « équivalent API » : ce que la consommation coûterait au tarif public de l'API.
// Avec un abonnement Claude, ce n'est pas la facture, mais c'est une bonne mesure de ce qu'on consomme.
// Lecture incrémentale des transcripts du jour : seules les nouvelles lignes sont lues.

interface Prix {
    entree: number;           // $ par million de jetons
    sortie: number;
    lectureCache: number;
}

// Tarifs publics de l'API (octobre 2026) ; l'écriture en cache coûte 1,25 × l'entrée
const TARIFS: [RegExp, Prix][] = [
    [/fable-5|mythos-5/, { entree: 10, sortie: 50, lectureCache: 0.25 }],
    [/opus-5-5/, { entree: 4, sortie: 20, lectureCache: 0.2 }],
    [/opus/, { entree: 5, sortie: 25, lectureCache: 0.5 }],
    [/sonnet-5/, { entree: 2, sortie: 10, lectureCache: 0.2 }],
    [/sonnet/, { entree: 3, sortie: 15, lectureCache: 0.3 }],
    [/haiku-5/, { entree: 0.1, sortie: 0.5, lectureCache: 0.01 }],
    [/haiku/, { entree: 1, sortie: 5, lectureCache: 0.1 }],
];
const PAR_DEFAUT: Prix = { entree: 4, sortie: 20, lectureCache: 0.2 };

export const prix = (modele: string): Prix => TARIFS.find(([m]) => m.test(modele))?.[1] ?? PAR_DEFAUT;

interface Usage {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

export function coutMessage(modele: string, u: Usage): number {
    const p = prix(modele);
    return ((u.input_tokens ?? 0) * p.entree + (u.cache_creation_input_tokens ?? 0) * p.entree * 1.25
        + (u.cache_read_input_tokens ?? 0) * p.lectureCache + (u.output_tokens ?? 0) * p.sortie) / 1_000_000;
}

export interface CoutJour {
    jour: string;
    total: number;                                       // $
    jetons: number;                                      // entrée + sortie + écriture cache
    parSession: Map<string, { cout: number; jetons: number }>;   // par sessionId (nom du transcript)
}

const RACINE = path.join(os.homedir(), '.claude', 'projects');
const cleJour = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

let etat: CoutJour = { jour: cleJour(), total: 0, jetons: 0, parSession: new Map() };
const lus = new Map<string, number>();       // fichier → octets déjà lus
const vus = new Set<string>();               // id de message déjà comptés (écrits plusieurs fois pendant le streaming)

export function lireCoutJour(): CoutJour {
    return etat;
}

// Asynchrone : une pause après chaque fichier lu, la première lecture du jour ne fige pas l'interface
export async function mettreAJourCout(): Promise<CoutJour> {
    const jour = cleJour();
    if (jour !== etat.jour) {
        etat = { jour, total: 0, jetons: 0, parSession: new Map() };
        lus.clear();
        vus.clear();
    }
    const minuit = new Date();
    minuit.setHours(0, 0, 0, 0);
    let dossiers: string[] = [];
    try {
        dossiers = fs.readdirSync(RACINE);
    } catch {
        return etat;
    }
    for (const dossier of dossiers) {
        let fichiers: string[];
        try {
            fichiers = fs.readdirSync(path.join(RACINE, dossier)).filter((f) => f.endsWith('.jsonl'));
        } catch {
            continue;
        }
        for (const f of fichiers) {
            const chemin = path.join(RACINE, dossier, f);
            let st: fs.Stats;
            try {
                st = fs.statSync(chemin);
            } catch {
                continue;
            }
            if (st.mtime < minuit) continue;
            const deja = lus.get(chemin) ?? 0;
            if (st.size <= deja) continue;
            await new Promise((r) => setImmediate(r));
            // Seulement la partie nouvelle du fichier
            const fd = fs.openSync(chemin, 'r');
            const tampon = Buffer.alloc(st.size - deja);
            fs.readSync(fd, tampon, 0, tampon.length, deja);
            fs.closeSync(fd);
            const texte = tampon.toString('utf-8');
            const fin = texte.lastIndexOf('\n');
            if (fin < 0) continue;
            lus.set(chemin, deja + Buffer.byteLength(texte.slice(0, fin + 1)));
            const session = f.slice(0, -6);
            for (const ligne of texte.slice(0, fin).split('\n')) {
                if (!ligne.includes('"usage"') || !ligne.includes('"assistant"')) continue;
                try {
                    const o = JSON.parse(ligne);
                    const u: Usage | undefined = o.message?.usage;
                    const id = o.message?.id;
                    if (!u || !id || vus.has(id) || new Date(o.timestamp) < minuit) continue;
                    vus.add(id);
                    const cout = coutMessage(String(o.message.model ?? ''), u);
                    const jetons = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
                    etat.total += cout;
                    etat.jetons += jetons;
                    const s = etat.parSession.get(session) ?? { cout: 0, jetons: 0 };
                    s.cout += cout;
                    s.jetons += jetons;
                    etat.parSession.set(session, s);
                } catch {
                    // ligne illisible
                }
            }
        }
    }
    return etat;
}

export const dollars = (n: number) => (n >= 100 ? `${Math.round(n)} $` : `${n.toFixed(2).replace('.', ',')} $`);

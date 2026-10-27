import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

export interface Usage {
    jours: { date: string; tokens: number; cacheLu: number }[];   // du plus ancien au plus récent
    parProjet: { dossier: string; tokens: number }[];
    parModele: { modele: string; tokens: number }[];
}

function cleJour(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lit les .jsonl des N derniers jours. tokens = entrée + sortie + écriture cache ; la lecture cache est à part
export async function calculerUsage(nbJours = 7): Promise<Usage> {
    const racine = path.join(os.homedir(), '.claude', 'projects');
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    debut.setDate(debut.getDate() - (nbJours - 1));

    const jours = new Map<string, { tokens: number; cacheLu: number }>();
    for (let i = 0; i < nbJours; i++) {
        const d = new Date(debut);
        d.setDate(d.getDate() + i);
        jours.set(cleJour(d), { tokens: 0, cacheLu: 0 });
    }
    const parProjet = new Map<string, number>();
    const parModele = new Map<string, number>();
    const vus = new Set<string>();   // le même message est écrit plusieurs fois pendant le streaming

    for (const dossier of fs.existsSync(racine) ? fs.readdirSync(racine) : []) {
        const cheminDossier = path.join(racine, dossier);
        let fichiers: string[];
        try {
            fichiers = fs.readdirSync(cheminDossier).filter((f) => f.endsWith('.jsonl'));
        } catch {
            continue;
        }
        for (const f of fichiers) {
            const chemin = path.join(cheminDossier, f);
            if (fs.statSync(chemin).mtime < debut) continue;
            const lignes = readline.createInterface({ input: fs.createReadStream(chemin), crlfDelay: Infinity });
            for await (const ligne of lignes) {
                if (!ligne.includes('"usage"') || !ligne.includes('"type":"assistant"')) continue;
                try {
                    const o = JSON.parse(ligne);
                    const u = o.message?.usage;
                    const id = o.message?.id;
                    if (!u || !id || vus.has(id)) continue;
                    vus.add(id);
                    const jour = jours.get(cleJour(new Date(o.timestamp)));
                    if (!jour) continue;
                    const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
                    jour.tokens += tokens;
                    jour.cacheLu += u.cache_read_input_tokens ?? 0;
                    parProjet.set(dossier, (parProjet.get(dossier) ?? 0) + tokens);
                    const modele = String(o.message.model ?? '?').replace(/^claude-/, '');
                    if (tokens) parModele.set(modele, (parModele.get(modele) ?? 0) + tokens);
                } catch {
                    // ligne illisible
                }
            }
        }
    }
    const trier = <T extends { tokens: number }>(a: T[]) => a.sort((x, y) => y.tokens - x.tokens);
    return {
        jours: [...jours].map(([date, v]) => ({ date, ...v })),
        parProjet: trier([...parProjet].map(([dossier, tokens]) => ({ dossier, tokens }))),
        parModele: trier([...parModele].map(([modele, tokens]) => ({ modele, tokens }))),
    };
}

// "C--Users-moi-dev-MonProjet" → "MonProjet" (nom du projet connu, sinon le chemin décodé au mieux)
export function nomDossierClaude(dossier: string, projets: { nom: string; chemin: string }[]): string {
    const projet = projets.find((p) => p.chemin.replace(/[^a-zA-Z0-9]/g, '-') === dossier);
    // Sinon on décode au mieux : "C--dev" → "C:\dev", "C--Users-x-SamTravail-Infor" → "~\SamTravail\Infor"
    return projet?.nom ?? dossier
        .replace(/^C--Users-[^-]+-/, '~\\')
        .replace(/^([A-Z])--/, '$1:\\')
        .replace(/-/g, '\\');
}

export function formatTokens(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
    return String(n);
}

const BLOCS = '▁▂▃▄▅▆▇█';
export function sparkline(valeurs: number[]): string {
    const max = Math.max(...valeurs, 1);
    return valeurs.map((v) => (v ? BLOCS[Math.min(7, Math.floor((v / max) * 7.99))] : ' ')).join('');
}

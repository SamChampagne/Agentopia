import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Commande } from './commandes.js';
import { Projet } from './projets.js';
import { coutMessage, dollars } from './cout.js';
import { nomDossierClaude } from './usage.js';
import { tache } from './ui/bus.js';
import { c, couleurProjet } from './theme.js';
import chalk from 'chalk';

// Coût des N derniers jours (équivalent API), par jour et par projet, relu dans les conversations de Claude Code.
// Un message compte une seule fois, même recopié dans une autre conversation (reprise, copie).

const RACINE = path.join(os.homedir(), '.claude', 'projects');
const USAGE = Buffer.from('"usage"');
const cleJour = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface Historique {
    jours: { jour: string; cout: number }[];               // du plus ancien au plus récent, jours vides compris
    projets: { nom: string; cout: number }[];               // du plus cher au moins cher
    total: number;
}

export async function historiqueCout(projets: Projet[], nbJours = 30): Promise<Historique> {
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    debut.setDate(debut.getDate() - (nbJours - 1));
    const parJour = new Map<string, number>();
    const parProjet = new Map<string, number>();
    const vus = new Set<string>();
    let dossiers: string[] = [];
    try {
        dossiers = fs.readdirSync(RACINE);
    } catch {
        // pas encore de conversations
    }
    for (const dossier of dossiers) {
        let fichiers: string[] = [];
        try {
            fichiers = fs.readdirSync(path.join(RACINE, dossier)).filter((f) => f.endsWith('.jsonl'));
        } catch {
            continue;
        }
        // Équipes d'agents, essais : les dossiers temporaires comptent ensemble
        const projet = /-Temp-/i.test(dossier) ? '(dossiers temporaires)' : nomDossierClaude(dossier, projets);
        for (const f of fichiers) {
            const chemin = path.join(RACINE, dossier, f);
            try {
                if (fs.statSync(chemin).mtime < debut) continue;
            } catch {
                continue;
            }
            const octets = await fs.promises.readFile(chemin).catch(() => undefined);
            if (!octets) continue;
            // Seulement les lignes qui contiennent « "usage" » sont décodées (le reste est l'essentiel du volume)
            for (let i = octets.indexOf(USAGE); i >= 0;) {
                const d = octets.lastIndexOf(0x0a, i) + 1;
                let fin = octets.indexOf(0x0a, i);
                if (fin < 0) fin = octets.length;
                const ligne = octets.toString('utf-8', d, fin);
                i = octets.indexOf(USAGE, fin);
                if (!ligne.includes('"assistant"')) continue;
                try {
                    const o = JSON.parse(ligne);
                    const id = o.message?.id;
                    const date = new Date(o.timestamp);
                    if (!o.message?.usage || !id || vus.has(id) || !(date >= debut)) continue;
                    vus.add(id);
                    const cout = coutMessage(String(o.message.model ?? ''), o.message.usage);
                    parJour.set(cleJour(date), (parJour.get(cleJour(date)) ?? 0) + cout);
                    parProjet.set(projet, (parProjet.get(projet) ?? 0) + cout);
                } catch {
                    // ligne illisible
                }
            }
            await new Promise((r) => setImmediate(r));
        }
    }
    const jours = Array.from({ length: nbJours }, (_, i) => {
        const d = new Date(debut);
        d.setDate(d.getDate() + i);
        return { jour: cleJour(d), cout: parJour.get(cleJour(d)) ?? 0 };
    });
    return {
        jours,
        projets: [...parProjet].map(([nom, cout]) => ({ nom, cout })).sort((a, b) => b.cout - a.cout),
        total: jours.reduce((n, j) => n + j.cout, 0),
    };
}

const BLOCS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
// Barre horizontale précise au huitième de caractère
function barre(valeur: number, max: number, largeur: number): string {
    const huitiemes = max ? Math.round((valeur / max) * largeur * 8) : 0;
    return '█'.repeat(Math.floor(huitiemes / 8)) + BLOCS[huitiemes % 8];
}

function afficher(h: Historique): void {
    const max = Math.max(...h.jours.map((j) => j.cout), 0.01);
    const actifs = h.jours.filter((j) => j.cout > 0);
    console.log(c.primaire(`Coût des ${h.jours.length} derniers jours : ≈ ${dollars(h.total)}`)
        + c.discret(`  · ${actifs.length} jour(s) d'activité · moyenne ${dollars(actifs.length ? h.total / actifs.length : 0)} par jour actif · équivalent API`));
    console.log();
    for (const j of h.jours) {
        const d = new Date(`${j.jour}T12:00:00`);
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const libelle = d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
        const couleur = j.cout === max ? chalk.hex('#f87171') : chalk.hex('#38bdf8');
        console.log(`  ${(weekend ? c.discret : (s: string) => s)(libelle.padEnd(14))} ${couleur(barre(j.cout, max, 40).padEnd(41))} ${j.cout ? c.discret(dollars(j.cout)) : ''}`);
    }
    console.log();
    console.log(c.primaire('Par projet'));
    const maxP = h.projets[0]?.cout ?? 0;
    for (const p of h.projets.slice(0, 12)) {
        console.log(`  ${chalk.hex(couleurProjet(p.nom))('●')} ${p.nom.slice(0, 28).padEnd(28)} ${chalk.hex(couleurProjet(p.nom))(barre(p.cout, maxP, 30).padEnd(31))} ${c.discret(`${dollars(p.cout)} · ${Math.round((p.cout / (h.total || 1)) * 100)} %`)}`);
    }
}

export function commandesHistorique(getProjets: () => Projet[]): Commande[] {
    return [{
        nom: 'depenses', alias: ['historique-couts'], args: '[jours]', groupe: 'Claude',
        description: 'Coût des 30 derniers jours (équivalent API) : par jour et par projet',
        executer: async ({ args }) => {
            const nb = Math.min(365, Math.max(2, Number(args[0]) || 30));
            const h = await tache(`Lecture des conversations des ${nb} derniers jours`, () => historiqueCout(getProjets(), nb));
            afficher(h);
        },
    }];
}

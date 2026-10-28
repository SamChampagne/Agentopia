import * as fs from 'fs';
import * as path from 'path';
import type { SessionVue } from './agents.js';

// Les modifications de fichiers faites par les sessions (Edit, Write, MultiEdit, NotebookEdit), lues dans leurs transcripts.
// Lecture incrémentale comme lireTranscript : seules les lignes ajoutées depuis la dernière fois sont décodées.
// Sert au diff en direct (la dernière modification, avec l'avant / après) et à la carte des fichiers chauds.

export interface Modification {
    chemin: string;              // absolu
    date: number;                // ms
}

export interface DerniereModification extends Modification {
    cle: string;                 // id de l'appel d'outil : change à chaque nouvelle modification
    avant: string;               // texte remplacé ('' pour un fichier écrit en entier)
    apres: string;
    outil: string;
}

interface Etat { jusqua: number; modifications: Modification[]; derniere?: DerniereModification }
const etats = new Map<string, Etat>();
const OUTILS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const GARDEES = 500;

function decoder(texte: string, e: Etat): void {
    for (const ligne of texte.split('\n')) {
        if (!ligne.includes('"tool_use"') || !/"name":"(Edit|Write|MultiEdit|NotebookEdit)"/.test(ligne)) continue;
        let o;
        try {
            o = JSON.parse(ligne);
        } catch {
            continue;
        }
        // Seulement les messages de Claude (pas les copies « api-request-blob », sans date) ni ceux des sous-agents
        const date = Date.parse(o.timestamp);
        if (o.type !== 'assistant' || o.isSidechain || !date) continue;
        for (const bloc of o.message?.content ?? []) {
            if (bloc.type !== 'tool_use' || !OUTILS.test(bloc.name)) continue;
            const entree = bloc.input ?? {};
            const brut = entree.file_path ?? entree.notebook_path;
            if (typeof brut !== 'string') continue;
            const chemin = path.resolve(brut);
            e.modifications.push({ chemin, date });
            const edits: { old_string?: string; new_string?: string }[] = bloc.name === 'MultiEdit' ? entree.edits ?? [] : [entree];
            e.derniere = {
                chemin, date, cle: bloc.id ?? `${date}`, outil: bloc.name,
                avant: bloc.name === 'Write' ? '' : edits.map((x) => x.old_string ?? '').join('\n'),
                apres: bloc.name === 'Write' ? String(entree.content ?? '') : bloc.name === 'NotebookEdit' ? String(entree.new_source ?? '') : edits.map((x) => x.new_string ?? '').join('\n'),
            };
        }
    }
    if (e.modifications.length > GARDEES) e.modifications = e.modifications.slice(-GARDEES);
}

// Lit les octets [debut, fin) jusqu'au dernier saut de ligne (une ligne en cours d'écriture attend la prochaine lecture)
function lire(fichier: string, debut: number, fin: number): { texte: string; jusqua: number } {
    const fd = fs.openSync(fichier, 'r');
    try {
        const tampon = Buffer.alloc(fin - debut);
        const lus = fs.readSync(fd, tampon, 0, tampon.length, debut);
        const dernier = tampon.lastIndexOf(0x0a, lus - 1);
        return dernier < 0 ? { texte: '', jusqua: debut } : { texte: tampon.toString('utf-8', 0, dernier), jusqua: debut + dernier + 1 };
    } finally {
        fs.closeSync(fd);
    }
}

export function modificationsSession(fichier: string): Etat {
    let e = etats.get(fichier);
    try {
        const taille = fs.statSync(fichier).size;
        if (!e || taille < e.jusqua) {
            // Première lecture : la fin seulement (les modifications récentes), sans la ligne coupée au début
            const debut = Math.max(0, taille - 3_000_000);
            const { texte, jusqua } = lire(fichier, debut, taille);
            e = { jusqua, modifications: [] };
            decoder(debut > 0 ? texte.slice(texte.indexOf('\n') + 1) : texte, e);
            if (etats.size > 80) etats.clear();
            etats.set(fichier, e);
        } else if (taille > e.jusqua) {
            const { texte, jusqua } = lire(fichier, e.jusqua, taille);
            e.jusqua = jusqua;
            decoder(texte, e);
        }
    } catch {
        // transcript pas encore créé
    }
    return e ?? { jusqua: 0, modifications: [] };
}

// ─── Fichiers chauds ──────────────────────────────────────────────────────────

export interface FichierChaud {
    chemin: string;
    modifications: { date: number; session: SessionVue }[];      // les plus récentes d'abord
    sessions: SessionVue[];                                      // sessions différentes qui l'ont touché
    conflit: boolean;                                            // au moins deux sessions encore actives
}

// Les fichiers modifiés dans la fenêtre (30 min par défaut), du plus récemment touché au plus ancien
export function fichiersChauds(agents: SessionVue[], fenetre = 30 * 60_000, maintenant = Date.now()): FichierChaud[] {
    const parFichier = new Map<string, FichierChaud>();
    for (const s of agents) {
        for (const m of modificationsSession(s.fichier).modifications) {
            if (maintenant - m.date > fenetre) continue;
            const cle = m.chemin.toLowerCase();
            const f = parFichier.get(cle) ?? { chemin: m.chemin, modifications: [], sessions: [], conflit: false };
            f.modifications.push({ date: m.date, session: s });
            if (!f.sessions.includes(s)) f.sessions.push(s);
            parFichier.set(cle, f);
        }
    }
    const liste = [...parFichier.values()];
    for (const f of liste) {
        f.modifications.sort((a, b) => b.date - a.date);
        f.conflit = f.sessions.filter((s) => s.statut !== 'terminee').length >= 2;
    }
    return liste.sort((a, b) => b.modifications[0].date - a.modifications[0].date);
}

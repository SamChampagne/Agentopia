import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Session {
    id: string;
    titre: string;
    date: Date;
}

export function dossierSessions(chemin: string): string {
    return path.join(os.homedir(), '.claude', 'projects', chemin.replace(/[^a-zA-Z0-9]/g, '-'));
}

// Titre d'une session : titre perso > titre généré par Claude > dernier prompt > 1er message
function titreSession(fichier: string): string {
    let titrePerso = '', titreIA = '', dernierPrompt = '', premierMessage = '';
    for (const ligne of fs.readFileSync(fichier, 'utf-8').split('\n')) {
        if (!ligne.includes('"type":"custom-title"') && !ligne.includes('"type":"ai-title"')
            && !ligne.includes('"type":"last-prompt"') && (premierMessage || !ligne.includes('"type":"user"'))) {
            continue;
        }
        try {
            const o = JSON.parse(ligne);
            if (o.type === 'custom-title' && o.customTitle) titrePerso = o.customTitle;
            else if (o.type === 'ai-title' && o.aiTitle) titreIA = o.aiTitle;
            else if (o.type === 'last-prompt' && o.lastPrompt) dernierPrompt = o.lastPrompt;
            else if (o.type === 'user' && typeof o.message?.content === 'string' && !o.message.content.startsWith('<')) {
                premierMessage = o.message.content;
            }
        } catch {
            // ligne illisible, on passe
        }
    }
    return (titrePerso || titreIA || dernierPrompt || premierMessage || '(sans titre)').replace(/\s+/g, ' ');
}

// Les sessions Claude d'un projet, de la plus récente à la plus ancienne
export function listerSessions(chemin: string, max = 15): Session[] {
    const dossier = dossierSessions(chemin);
    if (!fs.existsSync(dossier)) return [];
    return fs.readdirSync(dossier)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f, date: fs.statSync(path.join(dossier, f)).mtime }))
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, max)
        .map(({ f, date }) => ({ id: f.replace('.jsonl', ''), titre: titreSession(path.join(dossier, f)), date }));
}

// Sessions modifiées pendant la période : on filtre sur la date du fichier AVANT de lire les titres
export function sessionsDeLaPeriode(chemin: string, debut: Date, fin: Date): Session[] {
    const dossier = dossierSessions(chemin);
    if (!fs.existsSync(dossier)) return [];
    return fs.readdirSync(dossier)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f, date: fs.statSync(path.join(dossier, f)).mtime }))
        .filter(({ date }) => date >= debut && date <= fin)
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .map(({ f, date }) => ({ id: f.replace('.jsonl', ''), titre: titreSession(path.join(dossier, f)), date }));
}

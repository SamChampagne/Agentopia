import * as path from 'node:path';
import { derniereSessionClaude } from './projets.js';
import { listerIntegrees } from './sessionsIntegrees.js';

const cle = (dossier: string) => process.platform === 'win32' ? path.resolve(dossier).toLowerCase() : path.resolve(dossier);

// Un seul parcours des conversations intégrées par liste de projets, y compris les archives.
export function activiteAgents(): Map<string, number> {
    const dates = new Map<string, number>();
    for (const s of listerIntegrees(true)) {
        if (!Number.isFinite(s.maj)) continue;
        const dossier = cle(s.cwd);
        dates.set(dossier, Math.max(dates.get(dossier) ?? 0, s.maj));
    }
    return dates;
}

export function derniereSessionProjet(dossier: string, dates: Map<string, number>): Date | undefined {
    const native = derniereSessionClaude(dossier)?.getTime() ?? 0;
    const date = Math.max(native, dates.get(cle(dossier)) ?? 0);
    return date ? new Date(date) : undefined;
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { PermissionAgent, ReponsePermission } from './providers/types.js';

/** Sérialise les demandes d'un tour, indépendamment du transport du fournisseur. */
export function creerDemandesPermission(options: {
    dossier: string; tour: string; signal: AbortSignal;
    suspendre(): () => void;
    publier(permission?: PermissionAgent): void;
}) {
    let file = Promise.resolve();
    return async (p: Omit<PermissionAgent, 'id'>): Promise<ReponsePermission> => {
        const precedente = file, reprendre = options.suspendre();
        let liberer!: () => void;
        file = new Promise<void>((ok) => { liberer = ok; });
        let publiee = false;
        try {
            await precedente;
            options.signal.throwIfAborted();
            const permission = { ...p, id: randomUUID() };
            options.publier(permission); publiee = true;
            const fichier = path.join(options.dossier, `reponse-${permission.id}.json`);
            while (true) {
                options.signal.throwIfAborted();
                if (fs.existsSync(fichier)) {
                    const r = JSON.parse(fs.readFileSync(fichier, 'utf8'));
                    fs.rmSync(fichier, { force: true });
                    if (r.tour === options.tour && typeof r.accepte === 'boolean') return r;
                }
                await pause(250, undefined, { signal: options.signal });
            }
        } finally {
            // Après un arrêt, seul le worker écrit l'état final du tour.
            try { if (publiee && !options.signal.aborted) options.publier(); }
            finally { reprendre(); liberer(); }
        }
    };
}

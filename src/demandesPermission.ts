import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { PermissionAgent, ReponsePermission } from './providers/types.js';
import { fichierReponsePermission, validerReponsePermission } from './stockageSessions.js';

/** Sérialise les demandes d'un tour, indépendamment du transport du fournisseur. */
export function creerDemandesPermission(options: {
    dossier: string; tour: string; signal: AbortSignal; session?: string;
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
            while (true) {
                options.signal.throwIfAborted();
                const fichier = fichierReponsePermission(options.dossier, permission.id);
                if (fs.existsSync(fichier)) {
                    if (fs.statSync(fichier).size > 1024 * 1024) throw new Error('Réponse de permission trop volumineuse');
                    let r: any, valeur: ReponsePermission | undefined;
                    try { r = JSON.parse(fs.readFileSync(fichier, 'utf8')); valeur = validerReponsePermission(r); } catch { /* Une réponse illisible n'accorde aucune permission. */ }
                    fs.rmSync(fichier, { force: true });
                    if (valeur && r.tour === options.tour && (!options.session || r.session === options.session && r.permission === permission.id)) return valeur;
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

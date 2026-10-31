import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { gitVerifieAsync, creerWorktreeIsole } from './gitExecution.js';

export interface PlanCorrection { depot: string; reference: string; dossier: string; branche: string; refLocale: string }
export function planifierCorrection(depot: string, reference: string, nom: string, racine = path.join(path.dirname(CHEMINS.equipes), 'agentopia-corrections')): PlanCorrection {
    if (!/^(?:refs\/pull\/[1-9]\d*\/head|[a-f0-9]{40,64})$/i.test(reference)) throw new Error('Référence PR/CI invalide : aucune correction démarrée.');
    const id = randomUUID(), suffixe = `${nom.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 45)}-${id.slice(0, 8)}`;
    return { depot: path.resolve(depot), reference, dossier: path.join(racine, suffixe), branche: `agentopia/${suffixe}`, refLocale: `refs/agentopia/corrections/${id}` };
}
export async function preparerCorrection(plan: PlanCorrection, signal?: AbortSignal,
    services = { git: gitVerifieAsync, worktree: creerWorktreeIsole }): Promise<{ dossier: string; base: string; branche: string }> {
    // Ref privée par tentative : aucune modification de HEAD, FETCH_HEAD ou de
    // la branche d'une autre session, même quand deux revues arrivent ensemble.
    await services.git(['fetch', '--no-tags', '--no-write-fetch-head', 'origin', `${plan.reference}:${plan.refLocale}`], plan.depot, { signal, timeoutMs: 120_000 });
    const base = await services.git(['rev-parse', '--verify', `${plan.refLocale}^{commit}`], plan.depot, { signal });
    if (!/^[a-f0-9]{40,64}$/i.test(base)) throw new Error('Git n’a pas fourni un commit vérifiable. Aucune session créée.');
    await fs.promises.mkdir(path.dirname(plan.dossier), { recursive: true });
    await services.worktree({ depot: plan.depot, base, branche: plan.branche, dossier: plan.dossier, signal });
    return { dossier: plan.dossier, base, branche: plan.branche };
}

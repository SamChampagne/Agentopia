import { lireUsage, type RecuUsage } from '../utilisation.js';

export function metriquesLive(recus: RecuUsage[] = lireUsage()) {
    const couts = recus.filter((r) => typeof r.coutUSD === 'number' && Number.isFinite(r.coutUSD) && r.coutUSD >= 0);
    return { tours: recus.length, cout: couts.length ? couts.reduce((n, r) => n + r.coutUSD!, 0) : undefined,
        inconnus: recus.length - couts.length,
        fournisseurs: [...new Set(recus.map((r) => r.fournisseur))].map((f) => ({ nom: f, tours: recus.filter((r) => r.fournisseur === f).length })) };
}

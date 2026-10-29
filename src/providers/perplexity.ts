import { cleFournisseur } from './config.js';
import type { ContexteAgent } from './types.js';

export function decoderPerplexity(r: any): string {
    if (r.status && r.status !== 'completed') throw new Error(`Recherche Perplexity non terminée : ${r.status}`);
    const textes: string[] = [], sources = new Map<string, string>();
    const source = (s: any) => {
        const url = s?.url;
        if (typeof url === 'string' && /^https?:\/\//.test(url) && !sources.has(url)) sources.set(url, `${s.id ? `[web:${s.id}] ` : ''}${String(s.title || url)}`);
    };
    for (const o of r.output || []) {
        for (const s of o.search_results || o.results || []) source(s);
        for (const s of o.contents || []) source(s);
        for (const bloc of o.content || []) {
            if (bloc.type === 'output_text' && typeof bloc.text === 'string') textes.push(bloc.text);
            for (const a of bloc.annotations || []) source(a.url_citation || a);
        }
    }
    for (const s of r.search_results || []) source(s);
    if (!textes.length) throw new Error('Perplexity n’a renvoyé aucun texte exploitable');
    return textes.join('\n\n') + (sources.size ? '\n\nSources :\n' + [...sources].map(([url, titre]) => `- ${titre} : ${url}`).join('\n') : '');
}
export async function executerPerplexity(c: ContexteAgent, requete: typeof fetch = fetch): Promise<string> {
    const cle = cleFournisseur('perplexity');
    if (!cle) throw new Error('Configure une clé API Perplexity dans /fournisseurs');
    c.evenement({ role: 'outil', texte: 'Recherche web Perplexity · réponse et sources en préparation' });
    const r = await requete('https://api.perplexity.ai/v1/agent', {
        method: 'POST', signal: AbortSignal.any([c.signal, AbortSignal.timeout(180_000)]),
        headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ effort: 'low', input: [...c.historique, { role: 'user', content: c.prompt }] }),
    });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Clé Perplexity refusée · /fournisseurs'
        : r.status === 429 ? 'Limite Perplexity atteinte. Réessaie plus tard.' : `Perplexity : erreur HTTP ${r.status}`);
    const texte = decoderPerplexity(await r.json());
    c.evenement({ role: 'assistant', texte });
    return texte;
}

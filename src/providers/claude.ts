import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { cleFournisseur } from './config.js';
import type { ContexteAgent } from './types.js';
import { normaliserUsage } from '../utilisation.js';

export async function executerClaude(c: ContexteAgent, requete: typeof query = query): Promise<string> {
    const cle = cleFournisseur('claude');
    if (!cle) throw new Error('Configure une clé API Anthropic dans /fournisseurs');
    const controller = new AbortController();
    const arreter = () => controller.abort();
    c.signal.addEventListener('abort', arreter, { once: true });
    if (c.signal.aborted) controller.abort();
    let resultat: string | undefined;
    const precedente = c.session.compteursClaude;
    const reprise = !!c.session.threadId;
    async function* entree(): AsyncGenerator<SDKUserMessage> {
        yield { type: 'user', message: { role: 'user', content: c.prompt }, parent_tool_use_id: null };
    }
    try {
        const flux = requete({ prompt: entree(), options: {
            cwd: c.session.cwd, model: c.session.modele, resume: c.session.threadId,
            abortController: controller, permissionMode: c.session.lectureSeule ? 'plan' : 'default', settingSources: c.conseil ? [] : ['project'],
            ...(c.conseil ? { tools: [], persistSession: false } : c.session.lectureSeule ? { tools: ['Read', 'Glob', 'Grep'] } : {}),
            env: { ...process.env, ANTHROPIC_API_KEY: cle, CLAUDE_CODE_OAUTH_TOKEN: undefined },
            canUseTool: async (nom, input) => {
                if (c.session.lectureSeule && !['Read', 'Glob', 'Grep'].includes(nom)) return { behavior: 'deny', message: 'Cette mission est en lecture seule. Ouvre une mission Corriger ou Ajouter une fonction pour modifier le projet.' };
                const questions = nom === 'AskUserQuestion' && Array.isArray(input.questions)
                    ? input.questions.map((q: any, i: number) => ({ id: String(i), question: String(q.question), options: q.options?.map((o: any) => String(o.label)) })) : undefined;
                const r = await c.permission({ titre: nom, detail: JSON.stringify(input, null, 2), questions });
                if (!r.accepte) return { behavior: 'deny', message: 'Refusé par l’utilisateur dans Agentopia' };
                if (questions) return { behavior: 'allow', updatedInput: { ...input,
                    answers: Object.fromEntries(questions.map((q) => [q.question, r.reponses?.[q.id] || ''])) } };
                return { behavior: 'allow', updatedInput: input };
            },
        } });
        for await (const m of flux) {
            if ('session_id' in m && m.session_id) c.thread(m.session_id);
            if (m.type === 'assistant') for (const bloc of m.message.content) {
                if (bloc.type === 'text') c.evenement({ role: 'assistant', texte: bloc.text });
                if (bloc.type === 'tool_use') c.evenement({ role: 'outil', texte: bloc.name,
                    fichier: typeof (bloc.input as any)?.file_path === 'string' ? (bloc.input as any).file_path : undefined,
                    commande: bloc.name === 'Bash' && typeof (bloc.input as any)?.command === 'string' ? (bloc.input as any).command : undefined });
            }
            if (m.type === 'result') {
                // Le SDK reprend ses compteurs cumulatifs avec le transcript : soustraire
                // la référence précédente, jamais additionner tout l'historique à chaque tour.
                const modeles = Object.values(m.modelUsage ?? {});
                const cumul = normaliserUsage({ coutUSD: m.total_cost_usd,
                    ...(modeles.length ? { entree: modeles.reduce((n, u) => n + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0),
                        sortie: modeles.reduce((n, u) => n + u.outputTokens, 0), cache: modeles.reduce((n, u) => n + u.cacheReadInputTokens, 0) } : {}) });
                const delta: typeof cumul = {};
                for (const k of ['entree', 'sortie', 'cache', 'coutUSD'] as const) {
                    const avant = reprise ? precedente?.[k] : 0;
                    if (avant !== undefined && cumul[k] !== undefined && cumul[k]! >= avant) delta[k] = cumul[k]! - avant;
                }
                c.session.compteursClaude = cumul; c.utilisation?.(delta);
                if (m.subtype !== 'success' || m.is_error) throw new Error(m.subtype === 'success' ? m.result : m.errors.join('\n'));
                resultat = m.result;
            }
        }
        if (resultat === undefined) throw new Error('Claude a fermé la connexion sans résultat final');
        return resultat;
    } finally { c.signal.removeEventListener('abort', arreter); }
}

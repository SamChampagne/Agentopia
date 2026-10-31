import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { binaireCodex, cleFournisseur } from './config.js';
import type { Fournisseur } from './types.js';

export interface EtatConnexion { pret: boolean; texte: string }
// Diagnostic du compte uniquement : aucun thread ni appel à un modèle.
export async function verifierCompteCodex(transport?: ChildProcessWithoutNullStreams, delai = 20_000): Promise<EtatConnexion> {
    const binaire = binaireCodex();
    if (!binaire && !transport) return { pret: false, texte: 'Codex CLI manque. Installe-le, puis choisis Vérifier à nouveau.' };
    const proc = transport ?? spawn(binaire!, ['app-server'], { stdio: 'pipe', windowsHide: true });
    const lignes = createInterface({ input: proc.stdout });
    let timer: NodeJS.Timeout | undefined;
    try {
        return await new Promise<EtatConnexion>((resoudre) => {
            const finir = (pret: boolean, texte: string) => resoudre({ pret, texte });
            const envoyer = (m: unknown) => { if (!proc.stdin.destroyed) proc.stdin.write(JSON.stringify(m) + '\n'); };
            timer = setTimeout(() => finir(false, 'Codex ne répond pas. Ferme sa connexion puis réessaie.'), delai);
            proc.on('error', () => finir(false, 'Impossible de démarrer Codex CLI. Vérifie son installation.'));
            proc.on('exit', () => finir(false, 'Codex a fermé la connexion. Réessaie la vérification.'));
            proc.stdin.on('error', () => finir(false, 'Connexion à Codex interrompue.'));
            proc.stderr.resume();
            lignes.on('line', (ligne) => {
                let m: any; try { m = JSON.parse(ligne); } catch { return; }
                if (m.error) return finir(false, 'Le diagnostic Codex a échoué. Vérifie sa version et sa connexion.');
                if (m.id === 1) {
                    envoyer({ method: 'initialized' });
                    envoyer({ id: 2, method: 'account/read', params: { refreshToken: false } });
                }
                if (m.id === 2) finir(!!m.result?.account, m.result?.account
                    ? 'Compte Codex connecté · aucun modèle appelé.' : 'Codex est installé, mais aucun compte n’est connecté.');
            });
            envoyer({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agentopia_diagnostic', version: '1.0.0' } } });
        });
    } finally { clearTimeout(timer); lignes.close(); proc.stdin.end(); proc.kill(); }
}

export async function verifierConnexion(f: Fournisseur, requete: typeof fetch = fetch, cle = cleFournisseur(f)): Promise<EtatConnexion> {
    if (f === 'codex') return verifierCompteCodex();
    if (!cle) return { pret: false, texte: `Clé API ${f === 'claude' ? 'Anthropic' : 'Perplexity'} manquante.` };
    try {
        // Catalogue seulement : aucune consigne, aucun fichier et aucune génération envoyés.
        const r = await requete(f === 'claude' ? 'https://api.anthropic.com/v1/models?limit=1' : 'https://api.perplexity.ai/v1/models', {
            headers: { Authorization: `Bearer ${cle}`, ...(f === 'claude' ? { 'anthropic-version': '2026-10-21' } : {}) },
            redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
            await r.body?.cancel();
            if (r.status === 401 || r.status === 403) return { pret: false, texte: 'Clé refusée ou accès interdit. Vérifie la clé et ses permissions.' };
            if (r.status === 429) return { pret: false, texte: 'Limite de requêtes atteinte. Attends un peu, puis vérifie à nouveau.' };
            return { pret: false, texte: `Vérification indisponible (HTTP ${r.status}). Réessaie dans un instant.` };
        }
        const catalogue = await r.json() as { data?: unknown; models?: unknown };
        if (!Array.isArray(catalogue.data) && !Array.isArray(catalogue.models)) return { pret: false, texte: 'Réponse du catalogue non reconnue. Réessaie la vérification.' };
        return { pret: true, texte: 'Catalogue API accessible · aucun modèle appelé. L’accès au modèle et le quota seront confirmés au premier message.' };
    } catch { return { pret: false, texte: 'API inaccessible ou délai dépassé. Vérifie la connexion réseau puis réessaie.' }; }
}

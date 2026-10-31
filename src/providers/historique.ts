import * as fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { ContexteAgent } from './types.js';

/** Lecture bornée du contexte local : le worker ne charge jamais tout le JSONL en mémoire. */
export async function lireContexteLocal(fichier: string, signal: AbortSignal, limite = 20): Promise<ContexteAgent['historique']> {
    const resultat: ContexteAgent['historique'] = [], decoder = new StringDecoder('utf8');
    const maxLigne = 8 * 1024 * 1024;
    const flux = fs.createReadStream(fichier, { signal, highWaterMark: 64 * 1024 });
    let reste = '';
    const ajouter = (ligne: string) => {
        if (!ligne.trim()) return;
        if (ligne.length > maxLigne) throw new Error('Un message de l’historique dépasse 8 Mio. Exporte la conversation avant de démarrer une nouvelle session.');
        let m: any; try { m = JSON.parse(ligne); } catch { throw new Error('Historique local illisible : la conversation est conservée. Exporte-la pour vérifier le fichier avant de reprendre.'); }
        if (!['user', 'assistant'].includes(m.type) || m.agentopia?.role === 'outil') return;
        const contenu = m.message?.content;
        const texte = typeof contenu === 'string' ? contenu : Array.isArray(contenu) ? contenu.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n') : '';
        if (texte) { resultat.push({ role: m.type, content: texte }); if (resultat.length > limite) resultat.shift(); }
    };
    try {
        for await (const b of flux) {
            signal.throwIfAborted(); reste += decoder.write(b);
            let saut: number;
            while ((saut = reste.indexOf('\n')) >= 0) { ajouter(reste.slice(0, saut)); reste = reste.slice(saut + 1); }
            if (reste.length > maxLigne) throw new Error('Un événement de l’historique dépasse 8 Mio. Conversation conservée.');
        }
        reste += decoder.end(); if (reste.trim()) ajouter(reste);
        return resultat;
    } finally { flux.destroy(); }
}

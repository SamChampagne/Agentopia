import * as fs from 'node:fs';
import * as path from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { decoderTranscript, type Message } from './agents.js';

const MAX_LIGNE = 8 * 1024 * 1024;
const MAX_PAGE_MESSAGES = 12000;

// Lecture asynchrone d'un instantané. Les lignes encore en écriture restent au
// prochain rafraîchissement, comme dans le lecteur de conversation en direct.
async function* messagesDuFichier(fichier: string, options: { signal?: AbortSignal; debut?: number; fin?: number } = {}) {
    const stat = await fs.promises.stat(fichier);
    const fin = Math.min(stat.size, options.fin ?? stat.size);
    if (!fin) return;
    const debut = options.debut ?? 0;
    if (debut >= fin) return;
    const flux = fs.createReadStream(fichier, { start: debut, end: fin - 1, signal: options.signal });
    let morceaux: Buffer[] = [], longueur = 0;
    try {
        for await (const brut of flux) {
            options.signal?.throwIfAborted();
            const bloc = brut as Buffer;
            let depuis = 0;
            do {
                const saut = bloc.indexOf(10, depuis);
                const finLigne = saut < 0 ? bloc.length : saut;
                const segment = bloc.subarray(depuis, finLigne);
                longueur += segment.length;
                if (longueur > MAX_LIGNE) throw new Error('Un événement de cette conversation dépasse 8 Mio. Exporte le JSONL pour consulter ce fichier sans le charger dans l’interface.');
                morceaux.push(segment);
                if (saut < 0) break;
                for (const m of decoderTranscript(Buffer.concat(morceaux, longueur).toString('utf8'))) yield m;
                morceaux = []; longueur = 0; depuis = saut + 1;
            } while (depuis < bloc.length);
        }
        // Un événement sans LF est encore en cours d’écriture : attendre la prochaine lecture.
    } finally { flux.destroy(); }
}

export async function chargerHistoriqueConversation(fichier: string, octets: number, signal?: AbortSignal, avant?: number): Promise<{ messages: Message[]; complet: boolean; taille: number; debut: number; fin: number }> {
    const taille = (await fs.promises.stat(fichier)).size;
    const fin = Math.min(taille, avant ?? taille);
    let debut = Math.max(0, fin - octets);
    if (debut) {
        const fd = await fs.promises.open(fichier, 'r');
        try {
            const tampon = Buffer.alloc(Math.min(64 * 1024, fin - debut));
            while (debut < fin) {
                signal?.throwIfAborted();
                const { bytesRead } = await fd.read(tampon, 0, Math.min(tampon.length, fin - debut), debut);
                if (!bytesRead) break;
                const saut = tampon.subarray(0, bytesRead).indexOf(10);
                if (saut >= 0) { debut += saut + 1; break; }
                debut += bytesRead;
            }
        } finally { await fd.close(); }
        // Ne pas boucler sur une page vide quand un événement dépasse la page.
        if (debut >= fin) {
            if (octets >= MAX_LIGNE) throw new Error('Un événement dépasse la page maximale de 8 Mio. Exporte le JSONL pour le consulter.');
            return chargerHistoriqueConversation(fichier, Math.min(MAX_LIGNE, octets * 2), signal, avant);
        }
    }
    const messages: Message[] = [], indices = new Map<string, number>();
    for await (const m of messagesDuFichier(fichier, { signal, debut, fin })) {
        const i = m.id ? indices.get(m.id) : undefined;
        if (i !== undefined) messages[i] = m;
        else {
            if (messages.length >= MAX_PAGE_MESSAGES) {
                if (octets <= 1024) throw new Error('Trop de messages dans un événement. Exporte le JSONL pour le consulter.');
                return chargerHistoriqueConversation(fichier, Math.max(1024, Math.floor(octets / 2)), signal, avant);
            }
            if (m.id) indices.set(m.id, messages.length); messages.push(m);
        }
    }
    return { messages, complet: debut === 0 && fin === taille, taille, debut, fin };
}

export async function rechercherHistoriqueConversation(fichier: string, terme: string, options: { signal?: AbortSignal; limite?: number } = {}): Promise<{ messages: Message[]; total: number }> {
    const recherche = terme.toLocaleLowerCase();
    if (recherche.length < 2) return { messages: [], total: 0 };
    const trouves = new Set<string>(), derniers = new Map<string, Message>();
    let index = 0, anonymes = 0;
    const limite = Math.max(1, Math.min(1000, options.limite ?? 300));
    for await (const m of messagesDuFichier(fichier, options)) {
        const id = m.id || `ligne-${index++}`;
        if ([m.texte, m.commande, m.sortie, m.fichier].filter(Boolean).join('\n').toLocaleLowerCase().includes(recherche)) {
            if (m.id) {
                trouves.add(id);
                if (trouves.size > 200000) throw new Error('Recherche trop volumineuse : plus de 200 000 événements correspondants. Affine les mots recherchés.');
            } else anonymes++;
            derniers.delete(id); derniers.set(id, m);
            if (derniers.size > limite) derniers.delete(derniers.keys().next().value!);
        } else { trouves.delete(id); derniers.delete(id); }
    }
    return { messages: [...derniers.values()], total: trouves.size + anonymes };
}

export async function exporterConversation(fichier: string, destination: string, format: 'markdown' | 'jsonl', options: { ecraser?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    const source = await fs.promises.realpath(fichier);
    let cible = path.resolve(destination);
    try { cible = await fs.promises.realpath(cible); } catch { /* fichier à créer */ }
    const normaliser = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
    if (normaliser(source) === normaliser(cible)) throw new Error('Choisis un autre fichier : l’historique source ne peut pas être écrasé.');
    const sortie = fs.createWriteStream(destination, { flags: options.ecraser ? 'w' : 'wx', signal: options.signal });
    const ecrire = async (texte: string) => { if (!sortie.write(texte)) await once(sortie, 'drain'); };
    // Toujours observer les erreurs du fichier, même pendant la lecture async.
    let erreur: Error | undefined; sortie.on('error', (e) => { erreur = e; });
    try {
        await once(sortie, 'open');
        if (format === 'jsonl') { await pipeline(fs.createReadStream(fichier), sortie, { signal: options.signal }); return; }
        await ecrire('# Conversation Agentopia\n\nJournal complet des événements ; les mises à jour d’un même outil peuvent apparaître plusieurs fois.\n\n');
        for await (const m of messagesDuFichier(fichier, options)) {
            if (erreur) throw erreur;
            await ecrire(`## ${m.role}${m.date ? ` · ${m.date.toISOString()}` : ''}\n\n${m.texte}\n\n${m.commande ? `Commande :\n\n\`\`\`text\n${m.commande}\n\`\`\`\n\n` : ''}${m.sortie ? `Sortie :\n\n\`\`\`text\n${m.sortie}\n\`\`\`\n\n` : ''}`);
        }
        sortie.end(); await once(sortie, 'finish');
        if (erreur) throw erreur;
    } catch (e) { sortie.destroy(); throw e; }
}

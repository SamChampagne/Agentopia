import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Serveur, lireAcces } from './ssh.js';

// Ce qui se passe DANS les serveurs SSH : charge, mémoire, disque, conteneurs Docker en marche.
// Une seule commande par serveur, sans mot de passe (BatchMode : seulement les serveurs où ta clé est installée),
// relevée toutes les 20 s, et seulement tant qu'une vue en a besoin (vue globale, panneau d'un serveur).

export interface Metriques {
    charge?: number;          // charge moyenne sur 1 min
    coeurs?: number;
    memoire?: number;         // % utilisé
    memoireTotale?: number;   // Mo
    disque?: number;          // % utilisé de /
    depuis?: string;          // « up 12 days, 3 hours »
    conteneurs?: number;      // docker ps
    erreur?: string;
    date: Date;
}

export const metriques = new EventEmitter();
const cache = new Map<string, Metriques>();
export const metriquesDe = (nom: string): Metriques | undefined => cache.get(nom);

const SCRIPT = [
    'cat /proc/loadavg', 'echo ---', 'nproc', 'echo ---',
    "free -m | awk '/^Mem:/{print $2, $3}'", 'echo ---',
    'df -P / | tail -1', 'echo ---',
    'uptime -p 2>/dev/null', 'echo ---',
    '(docker ps -q 2>/dev/null | wc -l) || echo',
].join('; ');

export function releverMetriques(s: Serveur): Promise<Metriques> {
    const cible = s.configure ? s.nom : `${s.utilisateur ? s.utilisateur + '@' : ''}${s.hote}`;
    return new Promise((ok) => {
        const p = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', ...(s.configure ? [] : ['-p', String(s.port)]), cible, SCRIPT]);
        let sortie = '', erreurs = '';
        p.stdout.on('data', (d) => (sortie += d));
        p.stderr.on('data', (d) => (erreurs += d));
        const minuterie = setTimeout(() => p.kill(), 12_000);
        p.on('error', (e) => ok({ erreur: e.message, date: new Date() }));
        p.on('close', (code) => {
            clearTimeout(minuterie);
            if (code !== 0 && !sortie.includes('---')) {
                const m = /Permission denied/i.test(erreurs) ? 'clé non installée' : /timed out|Could not resolve|No route/i.test(erreurs) ? 'injoignable' : 'relevé impossible';
                return ok({ erreur: m, date: new Date() });
            }
            const [charge, coeurs, mem, df, depuis, docker] = sortie.split('---').map((x) => x.trim());
            const [total, utilise] = (mem ?? '').split(/\s+/).map(Number);
            ok({
                charge: Number(charge?.split(' ')[0]) || 0,
                coeurs: Number(coeurs) || undefined,
                memoire: total ? Math.round((utilise / total) * 100) : undefined,
                memoireTotale: total || undefined,
                disque: Number(/(\d+)%/.exec(df ?? '')?.[1]) || undefined,
                depuis: depuis?.replace(/^up\s+/, '') || undefined,
                conteneurs: docker === '' ? undefined : Number(docker),
                date: new Date(),
            });
        });
    });
}

// Les vues qui veulent les relevés s'abonnent ; sans abonné, plus aucune connexion
let abonnes = 0;
let boucle: NodeJS.Timeout | undefined;
let serveursSuivis: () => Serveur[] = () => [];

async function tour(): Promise<void> {
    const acces = lireAcces();
    // Seulement là où une connexion sans mot de passe a marché (sinon ssh échouerait de toute façon)
    const cibles = serveursSuivis().filter((s) => acces[s.nom]?.ok);
    for (let i = 0; i < cibles.length; i += 4) {
        await Promise.all(cibles.slice(i, i + 4).map(async (s) => cache.set(s.nom, await releverMetriques(s))));
        metriques.emit('maj');
    }
}

export function suivreMetriques(serveurs: () => Serveur[]): () => void {
    serveursSuivis = serveurs;
    abonnes++;
    if (!boucle) {
        void tour();
        boucle = setInterval(() => void tour(), 20_000);
    }
    return () => {
        abonnes--;
        if (abonnes <= 0 && boucle) {
            clearInterval(boucle);
            boucle = undefined;
            abonnes = 0;
        }
    };
}

// Petite jauge texte : ▁▂▃▄▅▆▇█ selon un pourcentage
export const barre = (pourcent: number) => '▁▂▃▄▅▆▇█'[Math.max(0, Math.min(7, Math.round((pourcent / 100) * 7)))];

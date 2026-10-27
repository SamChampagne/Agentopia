import { spawn } from 'child_process';
import { Serveur } from './ssh.js';

// Conteneurs Docker, en local ou sur un serveur via ssh (même commande, sortie JSON ligne par ligne)

export interface Conteneur {
    id: string;
    nom: string;
    image: string;
    enMarche: boolean;
    etat: string;             // running, exited, paused…
    statut: string;           // "Up 52 minutes", "Exited (1) 5 days ago"
    sante?: string;           // healthy, unhealthy, starting
    ports: string;            // "127.0.0.1:8000->8000/tcp"
    projet?: string;          // projet docker compose
    service?: string;
    dossier?: string;         // dossier du docker-compose
    cpu?: string;
    memoire?: string;
}

export interface Hote {
    nom: string;              // "local" ou nom du serveur
    serveur?: Serveur;
    conteneurs: Conteneur[];
    erreur?: string;
    date: Date;
}

function executer(args: string[], serveur?: Serveur, delai = 20_000): Promise<{ ok: boolean; sortie: string }> {
    return new Promise((ok) => {
        const [programme, liste] = serveur
            ? ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', serveur.configure ? serveur.nom : serveur.hote, 'docker', ...args.map((a) => `'${a}'`)]]
            : ['docker', args];
        const proc = spawn(programme, liste);
        let sortie = '', erreurs = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.stderr.on('data', (d) => (erreurs += d));
        const minuterie = setTimeout(() => proc.kill(), delai);
        proc.on('error', (e) => ok({ ok: false, sortie: e.message }));
        proc.on('close', (code) => {
            clearTimeout(minuterie);
            ok({ ok: code === 0, sortie: code === 0 ? sortie : (erreurs.trim() || sortie.trim() || `code ${code}`) });
        });
    });
}

function libelle(labels: string, cle: string): string | undefined {
    return labels.split(',').find((l) => l.startsWith(cle + '='))?.slice(cle.length + 1);
}

// stats : docker stats est lent et gourmand (~2 s de calcul) : l'appelant ne le demande pas à chaque fois
export async function listerConteneurs(serveur?: Serveur, stats = true): Promise<Hote> {
    const nom = serveur?.nom ?? 'local';
    const res = await executer(['ps', '-a', '--no-trunc', '--format', '{{json .}}'], serveur);
    if (!res.ok) {
        const message = /daemon|pipe|connect/i.test(res.sortie) ? 'Docker n\'est pas démarré'
            : /Permission denied/i.test(res.sortie) ? 'accès SSH refusé (clé requise)'
                : /not found|introuvable|not recognized/i.test(res.sortie) ? 'docker absent' : res.sortie.split('\n')[0].slice(0, 80);
        return { nom, serveur, conteneurs: [], erreur: message, date: new Date() };
    }
    const conteneurs: Conteneur[] = res.sortie.split('\n').filter(Boolean).flatMap((l) => {
        try {
            const o = JSON.parse(l);
            const labels: string = o.Labels ?? '';
            return [{
                id: String(o.ID).slice(0, 12),
                nom: o.Names,
                image: o.Image,
                enMarche: o.State === 'running',
                etat: o.State,
                statut: o.Status,
                // La santé d'un conteneur arrêté est périmée : on ne la garde que s'il tourne
                sante: o.State === 'running' && o.HealthStatus && o.HealthStatus !== 'none' ? o.HealthStatus : undefined,
                ports: o.Ports ?? '',
                projet: libelle(labels, 'com.docker.compose.project'),
                service: libelle(labels, 'com.docker.compose.service'),
                dossier: libelle(labels, 'com.docker.compose.project.working_dir'),
            }];
        } catch {
            return [];
        }
    });
    // CPU / mémoire des conteneurs en marche (docker stats prend ~2 s)
    if (stats && conteneurs.some((c) => c.enMarche)) {
        const mesures = await executer(['stats', '--no-stream', '--format', '{{json .}}'], serveur);
        for (const l of mesures.ok ? mesures.sortie.split('\n').filter(Boolean) : []) {
            try {
                const s = JSON.parse(l);
                const c = conteneurs.find((x) => x.id.startsWith(String(s.ID).slice(0, 12)));
                if (c) {
                    c.cpu = s.CPUPerc;
                    c.memoire = String(s.MemUsage).split(' / ')[0];
                }
            } catch {
                // ligne illisible
            }
        }
    }
    return { nom, serveur, conteneurs, date: new Date() };
}

export interface Groupe {
    nom: string;              // projet compose, ou "autres"
    dossier?: string;
    conteneurs: Conteneur[];
}

// Regroupe par projet compose ; les groupes avec des conteneurs en marche d'abord
export function grouperConteneurs(conteneurs: Conteneur[]): Groupe[] {
    const groupes = new Map<string, Groupe>();
    for (const c of conteneurs) {
        const cle = c.projet ?? '(sans compose)';
        const g = groupes.get(cle) ?? { nom: cle, dossier: c.dossier, conteneurs: [] };
        g.conteneurs.push(c);
        groupes.set(cle, g);
    }
    const enMarche = (g: Groupe) => g.conteneurs.filter((c) => c.enMarche).length;
    return [...groupes.values()].sort((a, b) => enMarche(b) - enMarche(a) || a.nom.localeCompare(b.nom));
}

// Port publié lisible : "127.0.0.1:8000->8000/tcp, …" → ":8000"
export function portsCourts(ports: string): string {
    return [...new Set([...ports.matchAll(/:(\d+)->/g)].map((m) => `:${m[1]}`))].join(' ');
}

export function actionConteneur(action: 'start' | 'stop' | 'restart', id: string, serveur?: Serveur): Promise<{ ok: boolean; sortie: string }> {
    return executer([action, id], serveur, 60_000);
}

// Pour "passer la main" (logs en continu, shell dans le conteneur)
export function commandeInteractive(type: 'logs' | 'shell', id: string, serveur?: Serveur): [string, string[]] {
    const args = type === 'logs' ? ['logs', '-f', '--tail', '200', id] : ['exec', '-it', id, 'sh', '-c', 'command -v bash >/dev/null && exec bash || exec sh'];
    if (!serveur) return ['docker', args];
    return ['ssh', ['-t', serveur.configure ? serveur.nom : serveur.hote, 'docker', ...args.map((a) => `'${a}'`)]];
}

import { Projet } from './projets.js';
import { Instantane, SessionActive } from './systeme.js';

export interface ServeurDev {
    port: number;
    pid: number;
    processus: string;
    projet?: string;
}

const PROCESSUS_DEV = /node|php|dotnet|python|java|ruby|deno|bun|nginx|httpd|docker|wslrelay|iisexpress|vite|next/i;

// Ports en écoute rattachés à un projet (via une session Claude parente ou le chemin dans la ligne de commande)
export function serveursDev(snap: Instantane, projets: Projet[], sessions: SessionActive[]): ServeurDev[] {
    const parPid = new Map(sessions.map((s) => [s.pid, s.nom]));
    const resultat: ServeurDev[] = [];
    for (const e of snap.ecoutes) {
        const proc = snap.processus.get(e.pid);
        if (!proc || e.pid <= 4) continue;
        let projet: string | undefined;
        // Remonte les parents : un serveur lancé par Claude appartient à son projet
        for (let p = proc, i = 0; p && i < 15 && !projet; p = snap.processus.get(p.ppid)!, i++) {
            projet = parPid.get(p.pid);
        }
        const texte = `${proc.exe} ${proc.commande}`.toLowerCase();
        projet ??= projets
            .filter((p) => texte.includes(p.chemin.toLowerCase()))
            .sort((a, b) => b.chemin.length - a.chemin.length)[0]?.nom;
        if (projet || PROCESSUS_DEV.test(proc.nom)) {
            resultat.push({ port: e.port, pid: e.pid, processus: proc.nom.replace(/\.exe$/i, ''), projet });
        }
    }
    return resultat.sort((a, b) => a.port - b.port);
}

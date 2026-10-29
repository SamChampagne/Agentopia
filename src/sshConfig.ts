import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

// Modifier ~/.ssh/config depuis Agentopia : ajouter, modifier, supprimer un serveur.
// Seul le bloc « Host <alias> » concerné est réécrit ; le reste du fichier (commentaires, Host *, Match…)
// est gardé tel quel. Une copie de sauvegarde est faite avant la première modification.

export const DOSSIER_SSH = path.join(os.homedir(), '.ssh');
// CLAUDETOPIA_SSH_CONFIG : un autre fichier (tests)
const FICHIER = process.env.CLAUDETOPIA_SSH_CONFIG ?? path.join(DOSSIER_SSH, 'config');

export interface HoteSsh {
    alias: string;
    hote: string;
    utilisateur?: string;
    port?: number;
    cle?: string;             // IdentityFile
}

interface Bloc {
    alias?: string;           // undefined : texte hors bloc Host simple (préambule, Host *, Match…)
    lignes: string[];
}

function decouper(): Bloc[] {
    if (!fs.existsSync(FICHIER)) return [];
    const blocs: Bloc[] = [{ lignes: [] }];
    for (const ligne of fs.readFileSync(FICHIER, 'utf-8').split(/\r?\n/)) {
        const m = /^\s*(Host|Match)\s+(.+?)\s*$/i.exec(ligne);
        if (m) {
            const simple = m[1].toLowerCase() === 'host' && !/[\s*?!]/.test(m[2]);
            blocs.push({ alias: simple ? m[2] : undefined, lignes: [ligne] });
        } else {
            blocs[blocs.length - 1].lignes.push(ligne);
        }
    }
    return blocs;
}

export function lireHotes(): HoteSsh[] {
    return decouper().filter((b) => b.alias).map((b) => {
        const h: HoteSsh = { alias: b.alias!, hote: b.alias! };
        for (const l of b.lignes.slice(1)) {
            const m = /^\s*(\w+)\s+(.+?)\s*$/.exec(l);
            if (!m) continue;
            const cle = m[1].toLowerCase();
            if (cle === 'hostname') h.hote = m[2];
            if (cle === 'user') h.utilisateur = m[2];
            if (cle === 'port') h.port = Number(m[2]) || undefined;
            if (cle === 'identityfile') h.cle = m[2].replace(/^"|"$/g, '');
        }
        return h;
    });
}

export const hote = (alias: string) => lireHotes().find((h) => h.alias.toLowerCase() === alias.toLowerCase());

function texteBloc(h: HoteSsh): string[] {
    return [
        `Host ${h.alias}`,
        `    HostName ${h.hote}`,
        ...(h.utilisateur ? [`    User ${h.utilisateur}`] : []),
        ...(h.port && h.port !== 22 ? [`    Port ${h.port}`] : []),
        ...(h.cle ? [`    IdentityFile ${h.cle.includes(' ') ? `"${h.cle}"` : h.cle}`] : []),
        '',
    ];
}

function ecrire(blocs: Bloc[]): void {
    fs.mkdirSync(DOSSIER_SSH, { recursive: true });
    const sauvegarde = FICHIER + '.claudetopia.bak';
    if (fs.existsSync(FICHIER) && !fs.existsSync(sauvegarde)) fs.copyFileSync(FICHIER, sauvegarde);
    const texte = blocs.flatMap((b) => b.lignes).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
    fs.writeFileSync(FICHIER, texte.endsWith('\n') ? texte : texte + '\n', 'utf-8');
}

// Ajoute le serveur, ou remplace son bloc (ancienAlias : il a été renommé)
export function enregistrerHote(h: HoteSsh, ancienAlias = h.alias): void {
    const blocs = decouper();
    const i = blocs.findIndex((b) => b.alias?.toLowerCase() === ancienAlias.toLowerCase());
    // Les blocs spécifiques doivent passer avant « Host * » : un nouveau serveur va juste avant le premier bloc générique
    if (i >= 0) blocs[i] = { alias: h.alias, lignes: texteBloc(h) };
    else {
        const generique = blocs.findIndex((b, k) => k > 0 && !b.alias);
        if (generique > 0) blocs.splice(generique, 0, { alias: h.alias, lignes: texteBloc(h) });
        else blocs.push({ alias: h.alias, lignes: ['', ...texteBloc(h)] });
    }
    ecrire(blocs);
}

export function supprimerHote(alias: string): boolean {
    const blocs = decouper();
    const reste = blocs.filter((b) => b.alias?.toLowerCase() !== alias.toLowerCase());
    if (reste.length === blocs.length) return false;
    ecrire(reste);
    return true;
}

// Clés privées présentes dans ~/.ssh (celles qui ont une .pub à côté)
export function clesDisponibles(): string[] {
    try {
        return fs.readdirSync(DOSSIER_SSH).filter((f) => f.endsWith('.pub')).map((f) => path.join(DOSSIER_SSH, f.slice(0, -4)))
            .filter((f) => fs.existsSync(f));
    } catch {
        return [];
    }
}

// Clé à installer sur un serveur : celle du serveur, sinon id_ed25519 / id_rsa, sinon on en crée une (sans phrase secrète)
export function assurerCle(cle?: string): { prive: string; publique: string; creee: boolean } | { erreur: string } {
    const candidates = [cle, path.join(DOSSIER_SSH, 'id_ed25519'), path.join(DOSSIER_SSH, 'id_rsa')]
        .filter((c): c is string => !!c).map((c) => c.replace(/^~/, os.homedir()));
    const trouvee = candidates.find((c) => fs.existsSync(c) && fs.existsSync(c + '.pub'));
    if (trouvee) return { prive: trouvee, publique: fs.readFileSync(trouvee + '.pub', 'utf-8').trim(), creee: false };
    const nouvelle = path.join(DOSSIER_SSH, 'id_ed25519');
    fs.mkdirSync(DOSSIER_SSH, { recursive: true });
    const r = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `${os.userInfo().username}@claudetopia`, '-f', nouvelle], { encoding: 'utf-8' });
    if (r.status !== 0 || !fs.existsSync(nouvelle + '.pub')) return { erreur: (r.stderr || r.error?.message || 'ssh-keygen a échoué').trim().split('\n')[0] };
    return { prive: nouvelle, publique: fs.readFileSync(nouvelle + '.pub', 'utf-8').trim(), creee: true };
}

// Commande à lancer sur le serveur pour y ajouter la clé publique (une seule fois)
export function commandeInstallationCle(publique: string): string {
    return `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && (grep -qF '${publique}' ~/.ssh/authorized_keys || echo '${publique}' >> ~/.ssh/authorized_keys) && chmod 600 ~/.ssh/authorized_keys && echo 'Clé installée.'`;
}

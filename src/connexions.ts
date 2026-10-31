import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { CLAUDE } from './claude.js';
import { chargerConfig } from './config.js';
import { compteClaude, identiteGit } from './configCommandes.js';
import { appel } from './git.js';
import { Hebergeur, jeton, jetonsConfigures, pageJeton, originesGitLab, ancienGitLabPresent, etatCoffre } from './jetons.js';
import { origineGitLab } from './originesGit.js';
import { lireSynchro } from './synchro.js';
import { lireHotes, clesDisponibles } from './sshConfig.js';
import { lireAcces } from './ssh.js';
import { lireDonnees } from './ui/donnees.js';
import { surPath } from './chemins.js';
import { FOURNISSEURS, type Fournisseur } from './providers/types.js';
import { disponibilite } from './providers/config.js';
import { etatCompteGitHub } from './compteGitHub.js';

// Tout ce que Agentopia peut connecter, avec son état et l'action qui le règle en un clic.
// Les vérifications tournent en parallèle ; les plus lentes (API, versions) sont mises en cache.

export type Etat = 'ok' | 'avert' | 'manque' | 'neutre' | 'verification';

export interface Element {
    groupe: string;
    nom: string;
    etat: Etat;
    detail: string;
    action: string;            // libellé
    commande: string;          // ce que fait le clic
}

const sortie = (programme: string, args: string[]): Promise<{ code: number | null; texte: string }> => new Promise((ok) => {
    const p = spawn(programme, args, { shell: programme === 'claude' });
    let texte = '';
    p.stdout?.on('data', (d) => (texte += d));
    p.stderr?.on('data', (d) => (texte += d));
    const minuterie = setTimeout(() => p.kill(), 10_000);
    p.on('error', () => ok({ code: -1, texte: '' }));
    p.on('close', (code) => {
        clearTimeout(minuterie);
        ok({ code, texte: texte.trim() });
    });
});
const present = async (cmd: string) => !!surPath(cmd);

// ─── Comptes Git en ligne : à qui appartient ce jeton ? ──────────────────────

export const remotesDuPoste = () => lireSynchro().depots.map((d) => d.remote ?? '').filter(Boolean);

export async function identiteJeton(h: Hebergeur, cle: string, remotes = remotesDuPoste(), origine?: string): Promise<{ ok: boolean; texte: string }> {
    if (h === 'GitHub') {
        const r = await appel('https://api.github.com/user', { Authorization: `Bearer ${cle}`, Accept: 'application/vnd.github+json' });
        return r.ok ? { ok: true, texte: `@${r.json.login}` } : { ok: false, texte: r.statut === 401 ? 'jeton refusé (expiré ou mal copié)' : `GitHub répond ${r.statut || 'rien'}` };
    }
    if (h === 'Azure DevOps') {
        const org = /^https:\/\/dev\.azure\.com\/([^/]+)\//.exec(pageJeton(h, remotes))?.[1];
        if (!org) return { ok: false, texte: 'aucune organisation Azure DevOps dans tes dépôts' };
        const r = await appel(`https://dev.azure.com/${org}/_apis/connectionData`, { Authorization: `Basic ${Buffer.from(':' + cle).toString('base64')}` });
        const nom = r.json?.authenticatedUser?.providerDisplayName;
        return r.ok && nom ? { ok: true, texte: `${nom} · ${org}` } : { ok: false, texte: r.statut === 401 || (r.ok && !nom) ? 'jeton refusé (expiré ou mauvaise organisation)' : `Azure répond ${r.statut || 'rien'}` };
    }
    if (!origine) return { ok: false, texte: 'origine GitLab à confirmer : /connecter gitlab' };
    const base = origineGitLab(origine);
    const r = await appel(`${base}/api/v4/user`, { 'PRIVATE-TOKEN': cle });
    return r.ok ? { ok: true, texte: `@${r.json.username} · ${base.replace(/^https?:\/\//, '')}` } : { ok: false, texte: r.statut === 401 ? 'jeton refusé (expiré ou scope read_api manquant)' : `${base} répond ${r.statut || 'rien'}` };
}

// Vérifications des jetons : une fois par lancement (et après chaque changement)
const identites = new Map<string, Promise<{ ok: boolean; texte: string }>>();
export const oublierIdentite = (h: Hebergeur) => { for (const k of identites.keys()) if (k === h || k.startsWith(h + ':')) identites.delete(k); };

// ─── Outils installables avec winget ─────────────────────────────────────────

export const OUTILS: Record<string, { nom: string; commande: string; winget: string; pour: string }> = {
    gh: { nom: 'GitHub CLI', commande: 'gh', winget: 'GitHub.cli', pour: 'comptes GitHub locaux, PR et dépôts' },
    git: { nom: 'Git', commande: 'git', winget: 'Git.Git', pour: 'projets, commits, équipes' },
    wt: { nom: 'Windows Terminal', commande: 'wt', winget: 'Microsoft.WindowsTerminal', pour: 'onglets, souris' },
    code: { nom: 'VS Code', commande: 'code', winget: 'Microsoft.VisualStudioCode', pour: 'ouvrir projets et fichiers' },
    rg: { nom: 'ripgrep', commande: 'rg', winget: 'BurntSushi.ripgrep.MSVC', pour: '/cherche' },
    docker: { nom: 'Docker Desktop', commande: 'docker', winget: 'Docker.DockerDesktop', pour: 'section Docker' },
};

export const DOCKER_DESKTOP = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');

// ─── L'état de tout ──────────────────────────────────────────────────────────

let versionClaude: Promise<string> | undefined;

export async function etatConnexions(): Promise<Element[]> {
    const config = chargerConfig();
    const d = lireDonnees();
    const depots = lireSynchro().depots;
    const jetons = jetonsConfigures();

    const [claudeOk, compte, outils] = await Promise.all([
        (async () => CLAUDE !== 'claude' || present('claude'))(),
        compteClaude(),
        Promise.all(Object.entries(OUTILS).map(async ([cle, o]) => [cle, await present(o.commande)] as const)),
    ]);
    const outilPresent = Object.fromEntries(outils);
    versionClaude ??= claudeOk ? sortie(CLAUDE, ['--version']).then((r) => r.texte.split(' ')[0] ?? '') : Promise.resolve('');

    const elements: Element[] = [];
    // Configuration locale seulement : la présence du CLI/de la clé ne valide pas le compte.
    for (const f of Object.keys(FOURNISSEURS) as Fournisseur[]) {
        const etat = disponibilite(f);
        elements.push({ groupe: 'FOURNISSEURS IA', nom: FOURNISSEURS[f].nom, etat: 'neutre', detail: etat.texte,
            action: etat.pret ? 'vérifier la connexion' : 'configurer', commande: `/fournisseurs ${f}` });
    }
    // Intégration native Claude CLI : indépendante des fournisseurs intégrés.
    elements.push(claudeOk
        ? { groupe: 'OUTILS CLAUDE CLI', nom: 'Claude Code', etat: 'ok', detail: `installé ${await versionClaude}`, action: 'mettre à jour', commande: '/installer-claude' }
        : { groupe: 'OUTILS CLAUDE CLI', nom: 'Claude Code', etat: 'neutre', detail: 'absent : sessions natives et maître Claude indisponibles', action: 'installer', commande: '/installer-claude' });
    if (claudeOk) {
        elements.push(compte.connecte
            ? { groupe: 'OUTILS CLAUDE CLI', nom: 'Compte Claude CLI', etat: 'ok', detail: `${compte.email ?? ''} ${compte.methode ? `(${compte.methode})` : ''}`.trim(), action: 'changer de compte', commande: '/compte claude' }
            : { groupe: 'OUTILS CLAUDE CLI', nom: 'Compte Claude CLI', etat: 'neutre', detail: 'pas connecté (CLI uniquement)', action: 'se connecter', commande: '/connexion-claude' });
    }

    // Git et comptes en ligne
    const git = identiteGit();
    elements.push(outilPresent.git
        ? { groupe: 'GIT', nom: 'Git', etat: 'ok', detail: 'installé', action: '', commande: '' }
        : { groupe: 'GIT', nom: 'Git', etat: 'manque', detail: `absent : ${OUTILS.git.pour}`, action: 'installer', commande: '/installer git' });
    elements.push(git.nom && git.email
        ? { groupe: 'GIT', nom: 'Identité des commits', etat: 'ok', detail: `${git.nom} <${git.email}>`, action: 'modifier', commande: '/compte git' }
        : { groupe: 'GIT', nom: 'Identité des commits', etat: 'avert', detail: 'nom ou courriel manquant : git refusera de commiter', action: 'configurer', commande: '/compte git' });
    for (const h of ['GitHub', 'Azure DevOps', 'GitLab'] as Hebergeur[]) {
        const n = depots.filter((x) => x.hebergeur === h).length;
        const cle = h === 'GitHub' ? 'github' : h === 'Azure DevOps' ? 'azure' : 'gitlab';
        if (h === 'GitHub') {
            const id = await etatCompteGitHub();
            elements.push({ groupe: 'GIT', nom: 'Compte GitHub', etat: id.ok ? 'ok' : 'avert', detail: id.texte, action: 'choisir un compte', commande: '/compte github' });
            continue;
        }
        if (h === 'GitLab') {
            const origines = originesGitLab();
            if (ancienGitLabPresent()) elements.push({ groupe: 'GIT', nom: 'GitLab · ancien compte', etat: 'avert', detail: 'adresse à confirmer : aucun jeton envoyé automatiquement', action: 'associer', commande: '/connecter gitlab' });
            for (const origine of origines) {
                const key = `GitLab:${origine}`;
                if (!identites.has(key)) { const secret = jeton(h, origine); identites.set(key, secret ? identiteJeton(h, secret, [], origine) : Promise.resolve({ ok: false, texte: 'jeton illisible' })); }
                const id = await identites.get(key)!;
                elements.push({ groupe: 'GIT', nom: `GitLab · ${new URL(origine).host}`, etat: id.ok ? 'ok' : 'avert', detail: id.texte, action: 'gérer', commande: '/connecter gitlab' });
            }
            if (!origines.length && !ancienGitLabPresent()) elements.push({ groupe: 'GIT', nom: 'GitLab', etat: 'neutre', detail: 'choisir l’adresse du serveur à connecter', action: 'connecter', commande: '/connecter gitlab' });
            continue;
        }
        if (jetons.includes(h)) {
            if (!identites.has(h)) {
                const secret = jeton(h);
                identites.set(h, secret ? identiteJeton(h, secret) : Promise.resolve({ ok: false, texte: 'jeton illisible' }));
            }
            const id = await identites.get(h)!;
            elements.push(id.ok
                ? { groupe: 'GIT', nom: h, etat: 'ok', detail: `${id.texte}${n ? ` · ${n} dépôt${n > 1 ? 's' : ''}` : ''}`, action: 'changer', commande: `/connecter ${cle}` }
                : { groupe: 'GIT', nom: h, etat: 'manque', detail: id.texte, action: 'reconnecter', commande: `/connecter ${cle}` });
        } else {
            elements.push(n
                ? { groupe: 'GIT', nom: h, etat: 'avert', detail: `${n} dépôt${n > 1 ? 's' : ''} sur ce poste, pas connecté (pull requests invisibles)`, action: 'connecter', commande: `/connecter ${cle}` }
                : { groupe: 'GIT', nom: h, etat: 'neutre', detail: 'aucun dépôt sur ce poste', action: 'connecter', commande: `/connecter ${cle}` });
        }
    }
    if (etatCoffre()) elements.push({ groupe: 'GIT', nom: 'Coffre de connexions', etat: 'avert', detail: etatCoffre()!, action: 'récupérer', commande: '/recuperer-coffre' });

    // Serveurs
    const cles = clesDisponibles();
    elements.push(cles.length
        ? { groupe: 'SERVEURS', nom: 'Clé SSH', etat: 'ok', detail: cles.map((k) => path.basename(k)).join(', '), action: '', commande: '' }
        : { groupe: 'SERVEURS', nom: 'Clé SSH', etat: 'avert', detail: 'aucune : chaque connexion demandera un mot de passe', action: 'créer', commande: '/ssh-creer-cle' });
    const hotes = lireHotes();
    const acces = lireAcces();
    const avecCle = hotes.filter((h) => acces[h.alias]?.ok).length;
    elements.push(hotes.length
        ? { groupe: 'SERVEURS', nom: 'Serveurs SSH', etat: avecCle === hotes.length ? 'ok' : 'avert', detail: `${hotes.length} configuré${hotes.length > 1 ? 's' : ''} · ${avecCle} sans mot de passe`, action: 'gérer', commande: '/ssh' }
        : { groupe: 'SERVEURS', nom: 'Serveurs SSH', etat: 'neutre', detail: 'aucun serveur configuré', action: 'ajouter', commande: '/ssh-ajouter' });
    const sftp = config.sftp ?? [];
    elements.push({ groupe: 'SERVEURS', nom: 'Connexions SFTP', etat: sftp.length ? 'ok' : 'neutre', detail: sftp.length ? sftp.map((s) => s.nom).join(', ') : 'aucune', action: 'ajouter', commande: '/sftp-ajouter' });
    const local = d.docker.find((h) => !h.serveur);
    elements.push(!outilPresent.docker
        ? { groupe: 'SERVEURS', nom: 'Docker', etat: 'neutre', detail: 'absent (optionnel)', action: 'installer', commande: '/installer docker' }
        : local?.erreur
            ? { groupe: 'SERVEURS', nom: 'Docker', etat: 'avert', detail: local.erreur, action: 'démarrer', commande: '/docker-demarrer' }
            : { groupe: 'SERVEURS', nom: 'Docker', etat: 'ok', detail: `${local?.conteneurs.filter((c) => c.enMarche).length ?? 0} conteneur(s) en marche`, action: 'ouvrir', commande: '/docker' });

    const { lienEnregistre } = await import('./notifications.js');
    elements.push(lienEnregistre()
        ? { groupe: 'OUTILS', nom: 'Notifications cliquables', etat: 'ok', detail: 'un clic sur une notification ouvre la session', action: 'désactiver', commande: '/notifications-cliquables non' }
        : { groupe: 'OUTILS', nom: 'Notifications cliquables', etat: 'neutre', detail: 'un clic sur une notification ouvrirait la session concernée', action: 'activer', commande: '/notifications-cliquables oui' });

    // Outils
    for (const cle of ['gh', 'wt', 'code', 'rg']) {
        const o = OUTILS[cle];
        elements.push(outilPresent[cle]
            ? { groupe: 'OUTILS', nom: o.nom, etat: 'ok', detail: 'installé', action: '', commande: '' }
            : { groupe: 'OUTILS', nom: o.nom, etat: 'avert', detail: `absent : ${o.pour}`, action: 'installer', commande: `/installer ${cle}` });
    }
    return elements;
}

// Le jeton qu'on vient de copier (presse-papiers), sans le taper
export async function lirePressePapiers(): Promise<string> {
    const r = await sortie('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw']);
    return r.texte.trim();
}
export function viderPressePapiers(): void {
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value $null'], { stdio: 'ignore' }).unref();
}

export const existe = (p: string) => fs.existsSync(p);

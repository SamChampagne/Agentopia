import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chargerConfig, sauverConfig } from './config.js';
import { CHEMINS, surPath } from './chemins.js';
import { choisir, choisirPlusieurs, confirmer } from './ui/bus.js';
import { executerProcessus, gitExecution } from './gitExecution.js';

export interface PreparationProjet { projet: string; commande?: { programme: string; args: string[] }; fichiersLocaux?: string[] }
function canon(p: string): string {
    let n = path.resolve(p);
    // Git restitue le chemin long du dépôt, même si le profil utilise un alias 8.3
    // ou une jonction. Comparer l'identité réelle évite de perdre sa préparation.
    try { n = fs.realpathSync.native(n); }
    catch (e) {
        // Un ancien projet supprimé ne doit pas empêcher de trouver les autres profils.
        if (!['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code || '')) throw e;
    }
    return process.platform === 'win32' ? n.toLowerCase() : n;
}
export function preparationDuProjet(projet: string): PreparationProjet | undefined {
    const cible = canon(projet);
    return chargerConfig().preparationProjets?.find((p) => canon(p.projet) === cible);
}
export function propositionsPreparation(projet: string): { nom: string; commande: { programme: string; args: string[] } }[] {
    const fichier = path.join(projet, 'package.json'); if (!fs.existsSync(fichier) || fs.statSync(fichier).size > 1024 * 1024) return [];
    const p = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    const gestionnaire = typeof p.packageManager === 'string' ? p.packageManager.split('@')[0]
        : fs.existsSync(path.join(projet, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(projet, 'yarn.lock')) ? 'yarn'
            : ['bun.lock', 'bun.lockb'].some((n) => fs.existsSync(path.join(projet, n))) ? 'bun' : 'npm';
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(gestionnaire)) return [];
    const programme = surPath(`${gestionnaire}.exe`) || surPath(`${gestionnaire}.cmd`) || surPath(gestionnaire); if (!programme) return [];
    const args = gestionnaire === 'npm' ? [fs.existsSync(path.join(projet, 'package-lock.json')) ? 'ci' : 'install']
        : gestionnaire === 'pnpm' || gestionnaire === 'bun' ? ['install', '--frozen-lockfile'] : ['install'];
    return [{ nom: `${gestionnaire} ${args.join(' ')} · installer les dépendances`, commande: { programme, args } },
        ...Object.entries(p.scripts || {}).filter(([nom, contenu]) => /^(setup|bootstrap|prepare)$/.test(nom) && typeof contenu === 'string' && !/--watch|\binteractive\b/.test(contenu))
            .map(([nom]) => ({ nom: `${gestionnaire} run ${nom} · script du projet`, commande: { programme, args: ['run', nom] } }))];
}
function sourceLocale(projet: string, nom: string): string {
    const source = path.resolve(projet, nom), relatif = path.relative(path.resolve(projet), source);
    if (!nom || !relatif || relatif.startsWith('..') || path.isAbsolute(relatif)) throw new Error('Fichier local hors du projet');
    const s = fs.lstatSync(source);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink > 1 || s.size > 1024 * 1024) throw new Error(`Fichier local refusé : ${nom}`);
    const reel = path.relative(fs.realpathSync(projet), fs.realpathSync(source));
    if (reel.startsWith('..') || path.isAbsolute(reel)) throw new Error('Fichier local redirigé hors du projet');
    return source;
}
/** L'accord porte sur ce profil explicite, réutilisé lors des créations de worktrees demandées par l'utilisateur. */
export async function reglerPreparationProjet(projet: string): Promise<void> {
    const actuelle = preparationDuProjet(projet), propositions = propositionsPreparation(projet);
    const index = await choisir('Préparer les nouveaux worktrees', [
        { label: 'Aucune commande automatique', valeur: -1 },
        ...propositions.map((p, i) => ({ label: p.nom, valeur: i })),
        { label: 'Annuler', valeur: -2 },
    ], false, `${projet}\nProfil actuel : ${actuelle?.commande ? `${actuelle.commande.programme} ${actuelle.commande.args.join(' ')}` : 'aucune commande'}\nLes commandes installent ou exécutent les scripts du projet. Aucun gestionnaire absent n’est installé ici. Limites : 5 min, 512 Ko de sortie.`);
    if (index === -2) return;
    const fichiers: string[] = [], suivis = await gitExecution(['ls-files', '-z'], projet);
    if (!suivis.ok) throw new Error('Impossible de distinguer les fichiers locaux des fichiers versionnés');
    const versionnes = new Set(suivis.sortie.split('\0'));
    for (const nom of fs.readdirSync(projet).slice(0, 500)) {
        try {
            sourceLocale(projet, nom);
            if (!versionnes.has(nom)) fichiers.push(nom);
        } catch { /* Dossiers, liens et fichiers trop volumineux ne sont pas proposés. */ }
    }
    const choisis = await choisirPlusieurs('Fichiers locaux à copier · peuvent contenir des secrets · aucune copie par défaut', fichiers.map((nom) => ({ label: nom, valeur: nom, coche: actuelle?.fichiersLocaux?.includes(nom), description: 'Copie explicite, sans écraser un fichier déjà présent.' })));
    for (const nom of choisis) sourceLocale(projet, nom);
    const profil: PreparationProjet = { projet: path.resolve(projet), commande: propositions[index]?.commande, fichiersLocaux: choisis };
    if (!await confirmer(`Enregistrer cette préparation pour les prochains worktrees de ce projet ?\nCommande : ${profil.commande ? `${profil.commande.programme} ${profil.commande.args.join(' ')}` : 'aucune'}\nFichiers copiés : ${choisis.join(', ') || 'aucun'}\nLes installations peuvent télécharger et exécuter les scripts de dépendances. Aucune commande n’est lancée maintenant.`)) return;
    const c = chargerConfig(); c.preparationProjets = [...(c.preparationProjets || []).filter((p) => canon(p.projet) !== canon(projet)), profil]; sauverConfig(c);
}
export async function preparerWorktree(projet: string, dossier: string, options: { signal?: AbortSignal; journal: (fichier: string) => void }): Promise<void> {
    const profil = preparationDuProjet(projet); if (!profil) return;
    options.signal?.throwIfAborted();
    for (const nom of profil.fichiersLocaux || []) {
        const source = sourceLocale(projet, nom), destination = path.resolve(dossier, nom);
        const relatif = path.relative(path.resolve(dossier), destination);
        if (!relatif || relatif.startsWith('..') || path.isAbsolute(relatif)) throw new Error('Destination locale hors du worktree');
        const racine = fs.realpathSync(dossier);
        let parent = dossier;
        for (const fragment of path.dirname(relatif).split(path.sep).filter((p) => p && p !== '.')) {
            parent = path.join(parent, fragment);
            if (fs.existsSync(parent)) { const s = fs.lstatSync(parent); if (s.isSymbolicLink() || !s.isDirectory()) throw new Error('Parent de copie redirigé ou invalide'); }
            else fs.mkdirSync(parent);
            const reel = path.relative(racine, fs.realpathSync(parent));
            if (reel.startsWith('..') || path.isAbsolute(reel)) throw new Error('Parent de copie hors du worktree');
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); fs.chmodSync(destination, 0o600);
    }
    if (!profil.commande) return;
    const { programme, args } = profil.commande;
    if (typeof programme !== 'string' || !Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error('Commande de préparation invalide');
    const journaux = path.join(CHEMINS.moteur, 'preparations'); fs.mkdirSync(journaux, { recursive: true });
    const journal = path.join(journaux, `${Date.now()}-${randomUUID()}.log`); fs.writeFileSync(journal, `Dossier : ${dossier}\nCommande : ${programme} ${args.join(' ')}\n`, { mode: 0o600 }); options.journal(journal);
    const r = await executerProcessus(programme, args, dossier, { signal: options.signal, timeoutMs: 300_000, maxOctets: 512 * 1024,
        progression: (texte) => fs.appendFileSync(journal, texte) });
    fs.appendFileSync(journal, `\nCode de sortie : ${r.code}\n`);
    if (!r.ok) throw new Error(`Préparation échouée (code ${r.code}). Consulte le journal : ${journal}`);
}
export function lireJournalPreparation(fichier: string): string {
    const racine = path.resolve(CHEMINS.moteur, 'preparations'), cible = path.resolve(fichier);
    if (path.dirname(cible) !== racine || !/^\d+-[a-f0-9-]+\.log$/.test(path.basename(cible))) throw new Error('Journal de préparation invalide');
    const s = fs.lstatSync(cible); if (!s.isFile() || s.isSymbolicLink() || s.nlink > 1 || s.size > 600 * 1024) throw new Error('Journal de préparation illisible ou trop volumineux');
    return fs.readFileSync(cible, 'utf8');
}

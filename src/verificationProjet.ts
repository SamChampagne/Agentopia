import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { CHEMINS, surPath } from './chemins.js';
import { ecrireAtomique, lireIntegree } from './sessionsIntegrees.js';
import { equipeDe, rechargerEquipes, type Equipe } from './equipe.js';
import { prendreVerrou, processusVivant, demarragePoste } from './verrou.js';

export const LIMITE_VERIFICATION_MS = 5 * 60_000;
export const LIMITE_JOURNAL = 512 * 1024;
const processusTermines = new WeakSet<ChildProcess>();
const processusFermes = new WeakSet<ChildProcess>();
const fermeturesForcees = new WeakSet<ChildProcess>();
type Gestionnaire = 'npm' | 'pnpm' | 'yarn' | 'bun';
export interface CommandeVerification {
    gestionnaire: Gestionnaire; script: string; contenu: string; avant?: string; apres?: string;
    commande: string; executable: string; manifeste: string;
}
export interface CibleVerification { equipe: string; tache?: string; dossier: string; titre: string }
export interface EmpreinteProjet { head?: string; branche?: string; empreinte?: string; erreur?: string }
export interface PreuveVerification {
    id: string; cible: CibleVerification; commande: CommandeVerification; debut: number; fin?: number;
    avant: EmpreinteProjet; apres?: EmpreinteProjet; codeSortie?: number | null; signal?: string | null;
    resultat: 'en cours' | 'reussi' | 'echoue' | 'interrompu'; raison?: string;
    proprietaire: number; pidExecution?: number; arretNonConfirme?: boolean; demarragePoste: number; journal: string; octets: number;
}
export type EtatVerification = 'non verifie' | 'en cours' | 'reussi' | 'echoue' | 'interrompu' | 'perime' | 'inconnu';
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const canonique = (p: string) => {
    let r = path.resolve(p); try { r = fs.realpathSync.native(r); } catch { /* Le lancement donnera le diagnostic précis. */ }
    return process.platform === 'win32' ? r.toLowerCase() : r;
};
const dossierPreuves = (equipe: string) => path.join(CHEMINS.verifications, hash(equipe));
const fichierPreuve = (p: PreuveVerification) => path.join(dossierPreuves(p.cible.equipe), `${p.id}.json`);
const journalPreuve = (p: PreuveVerification) => path.join(dossierPreuves(p.cible.equipe), `${p.id}.log`);
const MAX_PREUVE = 512 * 1024;
function sauverPreuve(p: PreuveVerification): void {
    if (Buffer.byteLength(JSON.stringify(p), 'utf8') > MAX_PREUVE) throw new Error('La preuve dépasse sa taille autorisée.');
    ecrireAtomique(fichierPreuve(p), p);
}

export function detecterVerifications(dossier: string): { commandes: CommandeVerification[]; explication?: string } {
    try {
        const fichier = path.join(dossier, 'package.json');
        if (!fs.existsSync(fichier)) return { commandes: [], explication: 'Aucun package.json dans ce dossier. Cette première version propose les scripts JavaScript/TypeScript du dossier choisi.' };
        if (fs.statSync(fichier).size > 1024 * 1024) throw new Error('package.json dépasse la limite de lecture (1 Mo).');
        const texte = fs.readFileSync(fichier, 'utf8'), p = JSON.parse(texte);
        const declares = typeof p.packageManager === 'string' ? p.packageManager.match(/^(npm|pnpm|yarn|bun)@/) : undefined;
        if (p.packageManager && !declares) throw new Error('Le gestionnaire indiqué dans packageManager n’est pas pris en charge.');
        const locks: [Gestionnaire, string[]][] = [['npm', ['package-lock.json', 'npm-shrinkwrap.json']], ['pnpm', ['pnpm-lock.yaml']], ['yarn', ['yarn.lock']], ['bun', ['bun.lock', 'bun.lockb']]];
        const trouves = locks.filter(([, fichiers]) => fichiers.some((f) => fs.existsSync(path.join(dossier, f)))).map(([g]) => g);
        if (!declares && trouves.length > 1) throw new Error('Plusieurs gestionnaires ont un fichier lock. Indique packageManager dans package.json avant de lancer une vérification.');
        const gestionnaire = (declares?.[1] || trouves[0] || 'npm') as Gestionnaire;
        const executable = process.platform === 'win32' ? surPath(`${gestionnaire}.exe`) || surPath(`${gestionnaire}.cmd`) : surPath(gestionnaire);
        if (!executable) throw new Error(`${gestionnaire} n’est pas installé ou accessible dans le PATH. Aucun outil ne sera téléchargé automatiquement.`);
        if (!/\.exe$/i.test(executable) && fs.statSync(executable).size < 100_000 && /corepack/i.test(fs.readFileSync(executable, 'utf8')))
            throw new Error(`${gestionnaire} passe par Corepack. Utilise une installation directe du gestionnaire ; Agentopia ne lance pas de téléchargement implicite.`);
        const scripts = p.scripts && typeof p.scripts === 'object' ? p.scripts as Record<string, unknown> : {};
        const commandes = Object.entries(scripts).filter(([nom, contenu]) => /^(test|check|typecheck|lint)(:|$)/i.test(nom)
            && nom.length <= 160 && /^[a-z0-9_.:-]+$/i.test(nom) && typeof contenu === 'string' && contenu.trim()
            && [contenu, scripts[`pre${nom}`], scripts[`post${nom}`]].every((v) => typeof v !== 'string' || Buffer.byteLength(v, 'utf8') <= 16_000)
            && !/(?:^|[:\s-])(?:watch[a-z]*|interactive|ui)(?:$|[:\s=])/i.test(`${nom} ${contenu}`))
            .sort(([a], [b]) => a.includes(':') === b.includes(':') ? a.localeCompare(b) : a.includes(':') ? 1 : -1)
            .map(([script, contenu]) => ({ gestionnaire, script, contenu: contenu as string,
                avant: typeof scripts[`pre${script}`] === 'string' ? scripts[`pre${script}`] as string : undefined,
                apres: typeof scripts[`post${script}`] === 'string' ? scripts[`post${script}`] as string : undefined,
                commande: `${gestionnaire} run ${script}`, executable, manifeste: hash(texte) }));
        return { commandes, explication: commandes.length ? (!declares && !trouves.length ? 'Aucun gestionnaire déclaré : npm sera utilisé pour les scripts de package.json.' : undefined)
            : 'Aucun script test, check, typecheck ou lint utilisable. Les variantes watch/interactives et scripts de plus de 16 Ko sont exclus.' };
    } catch (err) { return { commandes: [], explication: (err as Error).message }; }
}

function lireGit(cwd: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
    return new Promise((ok, ko) => {
        const enfant = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const blocs: Buffer[] = []; let octets = 0, erreur = '', fini = false;
        const arreter = () => { enfant.kill(); terminer(new Error('Capture Git interrompue')); };
        const timer = setTimeout(() => { enfant.kill(); terminer(new Error('Capture Git trop longue (10 s)')); }, 10_000);
        const terminer = (err?: Error) => { if (fini) return; fini = true; clearTimeout(timer); signal?.removeEventListener('abort', arreter); err ? ko(err) : ok(Buffer.concat(blocs)); };
        enfant.stdout!.on('data', (b: Buffer) => { octets += b.length; if (octets > 4 * 1024 * 1024) { enfant.kill(); terminer(new Error('Liste des fichiers trop volumineuse')); } else blocs.push(b); });
        enfant.stderr!.on('data', (b: Buffer) => { erreur = (erreur + b.toString()).slice(-2000); });
        enfant.on('error', terminer); enfant.on('close', (code) => terminer(code === 0 ? undefined : new Error(erreur.trim() || 'Git inaccessible')));
        signal?.addEventListener('abort', arreter, { once: true }); if (signal?.aborted) arreter();
    });
}

/** Contenu des fichiers suivis et non ignorés : un second changement sale doit invalider la preuve. */
export async function capturerProjet(dossier: string, signal?: AbortSignal, limites = { fichiers: 10_000, octets: 64 * 1024 * 1024 }): Promise<EmpreinteProjet> {
    const r: EmpreinteProjet = {};
    try {
        r.head = (await lireGit(dossier, ['rev-parse', '--verify', 'HEAD'], signal)).toString().trim();
        r.branche = (await lireGit(dossier, ['branch', '--show-current'], signal)).toString().trim();
        const racine = (await lireGit(dossier, ['rev-parse', '--show-toplevel'], signal)).toString().trim();
        const etat = await lireGit(racine, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal);
        const fichiers = [...new Set((await lireGit(racine, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], signal)).toString().split('\0').filter(Boolean))].sort();
        if (fichiers.length > limites.fichiers) throw new Error(`Empreinte limitée à ${limites.fichiers} fichiers ; résultat non vérifiable.`);
        const h = createHash('sha256').update(r.head).update(r.branche).update(etat); let total = 0;
        for (const f of fichiers) {
            if (signal?.aborted) throw new Error('Capture interrompue');
            const cible = path.resolve(racine, f), relatif = path.relative(racine, cible);
            if (relatif.startsWith('..') || path.isAbsolute(relatif)) throw new Error('Chemin Git hors du projet');
            h.update(f).update('\0');
            let avant: fs.Stats;
            try { avant = await fs.promises.lstat(cible); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') { h.update('absent'); continue; } throw err; }
            if (avant.isDirectory()) throw new Error('Un sous-module ou dossier suivi nécessite une vérification séparée.');
            total += avant.size; if (total > limites.octets) throw new Error('Empreinte trop volumineuse ; résultat non vérifiable.');
            const contenu = avant.isSymbolicLink() ? Buffer.from(await fs.promises.readlink(cible)) : await fs.promises.readFile(cible);
            const apres = await fs.promises.lstat(cible);
            if (avant.size !== apres.size || avant.mtimeMs !== apres.mtimeMs || avant.ino !== apres.ino) throw new Error('Un fichier a changé pendant la capture.');
            h.update(String(avant.mode)).update('\0').update(contenu).update('\0');
        }
        if (r.head !== (await lireGit(racine, ['rev-parse', '--verify', 'HEAD'], signal)).toString().trim()
            || r.branche !== (await lireGit(racine, ['branch', '--show-current'], signal)).toString().trim()
            || !etat.equals(await lireGit(racine, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal))) throw new Error('Le projet a changé pendant la capture.');
        r.empreinte = h.digest('hex');
    } catch (err) { r.erreur = (err as Error).message; }
    return r;
}

export function ciblesVerification(e: Equipe): CibleVerification[] {
    return [{ equipe: e.id, dossier: e.projet, titre: 'Projet · branche actuelle' },
        ...e.taches.filter((t) => t.cwd && t.branche && !['en cours', 'bloquee', 'attente'].includes(t.etat)).map((t) => ({ equipe: e.id, tache: t.id, dossier: t.cwd!, titre: `Tâche ${t.id} · ${t.titre}` }))];
}
export function indisponibiliteVerification(cible: CibleVerification): string | undefined {
    rechargerEquipes(); const e = equipeDe(cible.equipe);
    if (!e || e.archivee) return 'Cette équipe est introuvable ou rangée.';
    const t = cible.tache ? e.taches.find((t) => t.id === cible.tache) : undefined;
    if (cible.tache && !t || canonique(cible.dossier) !== canonique(t?.cwd || e.projet)) return 'Le dossier de cette vérification ne correspond plus à l’équipe.';
    if (['en cours', 'integration', 'planification'].includes(e.etat)
        || [...e.taches, ...(e.integrateur ? [e.integrateur] : [])].some((t) => ['en cours', 'bloquee'].includes(t.etat)
            || t.fournisseur && t.agentId && ['travaille', 'bloquee'].includes(lireIntegree(t.agentId)?.etat || '')))
        return 'Attends la fin ou l’arrêt effectif des agents et de l’intégration avant de vérifier le projet.';
    return undefined;
}

const encorePossede = (enfant: ChildProcess) => !!enfant.pid && enfant.exitCode === null && enfant.signalCode === null && !processusTermines.has(enfant);
async function arreterArbre(enfant: ChildProcess): Promise<boolean> {
    // Un parent terminé avec ses pipes encore ouverts peut avoir laissé des descendants.
    if (!encorePossede(enfant)) return processusFermes.has(enfant);
    if (process.platform === 'win32') return new Promise<boolean>((ok) => {
        const t = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(enfant.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { t.kill(); ok(false); }, 2500);
        t.once('error', () => { clearTimeout(timer); ok(false); }); t.once('close', (code) => { clearTimeout(timer); ok(code === 0); });
    });
    else {
        try { process.kill(-enfant.pid!, 'SIGTERM'); } catch (err) { return (err as NodeJS.ErrnoException).code === 'ESRCH'; }
        await new Promise((ok) => setTimeout(ok, 300));
        try { process.kill(-enfant.pid!, 'SIGKILL'); } catch (err) { return (err as NodeJS.ErrnoException).code === 'ESRCH'; }
        return true;
    }
}

function surveillerSortieApplication(enfant: ChildProcess, confirmer: () => void): () => void {
    const quitter = () => {
        if (!encorePossede(enfant)) { if (processusFermes.has(enfant)) confirmer(); return; }
        // Au moment de process.exit, une attente async ne serait plus exécutée.
        if (process.platform === 'win32') {
            const r = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
                ['/PID', String(enfant.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 2500 });
            if (r.status === 0) confirmer();
        } else { try { process.kill(-enfant.pid!, 'SIGKILL'); confirmer(); } catch { /* Arrêt non confirmé. */ } }
    };
    process.once('exit', quitter);
    enfant.once('exit', () => processusTermines.add(enfant));
    enfant.once('close', () => { if (!fermeturesForcees.has(enfant)) processusFermes.add(enfant); });
    return () => process.off('exit', quitter);
}

export function invocationVerification(c: CommandeVerification): { programme: string; args: string[] } {
    if (process.platform !== 'win32' || /\.exe$/i.test(c.executable)) return { programme: c.executable, args: ['run', c.script] };
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const script = `& ${q(c.executable)} 'run' ${q(c.script)}; exit $LASTEXITCODE`;
    return { programme: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

export async function executerVerification(cible: CibleVerification, commande: CommandeVerification,
    options: { signal?: AbortSignal; progression?: (texte: string) => void; dureeMs?: number; octets?: number;
        arreter?: (enfant: ChildProcess) => Promise<boolean>;
        lancer?: (programme: string, args: string[], options: SpawnOptions) => ChildProcess } = {}): Promise<PreuveVerification> {
    const indisponible = indisponibiliteVerification(cible); if (indisponible) throw new Error(indisponible);
    const dossier = canonique(cible.dossier), finVerrou = prendreVerrou(path.join(CHEMINS.verifications, 'verrous', hash(dossier)));
    if (!finVerrou) throw new Error('Une vérification est déjà en cours dans ce dossier.');
    const execution = path.join(CHEMINS.verifications, `${hash(dossier)}.execution.json`);
    let enfantLance: ChildProcess | undefined;
    let preuveEnCours: PreuveVerification | undefined;
    let retirerSurveillance: (() => void) | undefined;
    try {
        try {
            const precedente = JSON.parse(fs.readFileSync(execution, 'utf8'));
            if (processusVivant(precedente.pid, precedente.demarragePoste) && !precedente.arretNonConfirme) throw new Error('Une commande de vérification est encore active dans ce dossier, même si sa fenêtre a été fermée. Attends sa fin.');
            throw new Error(`L’arrêt de la vérification précédente n’a pas été confirmé (PID ${precedente.pid}). Son parent peut être terminé avec des descendants encore actifs. Vérifie et arrête son arbre avant de retirer son marqueur : ${execution}`);
        } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
        const actuelle = () => detecterVerifications(dossier).commandes.find((c) => c.script === commande.script && JSON.stringify(c) === JSON.stringify(commande));
        if (!actuelle()) throw new Error('Le script ou son gestionnaire a changé. Choisis de nouveau la vérification avant de la lancer.');
        const avant = await capturerProjet(dossier, options.signal);
        const p: PreuveVerification = { id: `${Date.now()}-${randomUUID()}`, cible: { ...cible, dossier }, commande, debut: Date.now(), avant,
            resultat: 'interrompu', raison: 'Préparation sans lancement confirmé', proprietaire: process.pid, demarragePoste: demarragePoste(), journal: '', octets: 0 };
        preuveEnCours = p;
        fs.mkdirSync(dossierPreuves(cible.equipe), { recursive: true, mode: 0o700 });
        p.journal = journalPreuve(p); fs.writeFileSync(p.journal, '', { mode: 0o600 });
        sauverPreuve(p);
        const garde = indisponibiliteVerification(cible);
        if (options.signal?.aborted || garde || !actuelle()) {
            p.resultat = 'interrompu'; p.raison = garde || (options.signal?.aborted ? 'Annulée avant lancement' : 'Le script a changé avant le lancement');
        } else {
            p.resultat = 'en cours'; p.raison = undefined;
            const { programme, args } = invocationVerification(commande);
            const limite = Math.min(options.octets ?? LIMITE_JOURNAL, LIMITE_JOURNAL);
            const enfant = (options.lancer || spawn)(programme, args, { cwd: dossier, windowsHide: true, detached: process.platform !== 'win32',
                stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', FORCE_COLOR: '0', npm_config_update_notifier: 'false', COREPACK_ENABLE_NETWORK: '0' } });
            enfantLance = enfant;
            retirerSurveillance = surveillerSortieApplication(enfant, () => {
                p.resultat = 'interrompu'; p.arretNonConfirme = false; p.fin = Date.now(); p.raison = 'Application fermée ; arrêt de l’arbre confirmé';
                try {
                    sauverPreuve(p);
                    if (JSON.parse(fs.readFileSync(execution, 'utf8')).id === p.id) fs.rmSync(execution);
                } catch { /* Marqueur conservé si la fin ne peut pas être enregistrée. */ }
            });
            if (enfant.pid) {
                p.pidExecution = enfant.pid;
                ecrireAtomique(execution, { id: p.id, pid: enfant.pid, demarragePoste: p.demarragePoste });
                sauverPreuve(p);
            }
            let arret: Promise<boolean> | undefined, sortieForcee: NodeJS.Timeout | undefined;
            let abandonner!: () => void;
            const abandon = new Promise<void>((ok) => { abandonner = ok; });
            const detacher = () => { fermeturesForcees.add(enfant); enfant.stdout?.destroy(); enfant.stderr?.destroy(); enfant.unref(); abandonner(); };
            const nonConfirme = () => {
                p.arretNonConfirme = true; p.raison += ' · arrêt non confirmé : la commande peut rester active';
                try { ecrireAtomique(execution, { id: p.id, pid: p.pidExecution, demarragePoste: p.demarragePoste, arretNonConfirme: true }); } catch { /* La preuve garde également le PID. */ }
            };
            const interrompre = (raison: string) => {
                if (arret) return;
                p.raison = raison;
                let delai: NodeJS.Timeout;
                arret = Promise.race([(options.arreter || arreterArbre)(enfant), new Promise<boolean>((ok) => { delai = setTimeout(() => ok(false), 3000); })])
                    .catch(() => false).then((arrete) => {
                        clearTimeout(delai!);
                        if (!arrete) { nonConfirme(); detacher(); }
                        else sortieForcee = setTimeout(() => { if (encorePossede(enfant)) nonConfirme(); detacher(); }, 2000);
                        return arrete;
                    });
            };
            const annuler = () => interrompre('Annulée à ta demande');
            options.signal?.addEventListener('abort', annuler, { once: true }); if (options.signal?.aborted) annuler();
            const timer = setTimeout(() => interrompre('Durée maximale atteinte'), Math.max(1, Math.min(options.dureeMs ?? LIMITE_VERIFICATION_MS, LIMITE_VERIFICATION_MS)));
            const sortie = (b: Buffer) => {
                const morceau = b.subarray(0, Math.max(0, limite - p.octets));
                try { if (morceau.length) { fs.appendFileSync(p.journal, morceau); p.octets += morceau.length; options.progression?.(morceau.toString('utf8')); } }
                catch (err) { interrompre(`Journal inaccessible : ${(err as Error).message}`); }
                if (b.length > morceau.length) interrompre('Limite du journal atteinte (512 Ko maximum)');
            };
            enfant.stdout!.on('data', sortie); enfant.stderr!.on('data', sortie);
            const ferme = new Promise<void>((ok) => {
                enfant.once('error', (err) => { p.raison = err.message; p.resultat = 'echoue'; });
                enfant.once('close', (code, signal) => { p.codeSortie = code; p.signal = signal; ok(); });
            });
            await Promise.race([ferme, abandon]);
            clearTimeout(timer); options.signal?.removeEventListener('abort', annuler); await arret; clearTimeout(sortieForcee);
            p.resultat = arret ? 'interrompu' : p.codeSortie === 0 ? 'reussi' : 'echoue';
        }
        p.apres = p.arretNonConfirme ? { erreur: 'Arrêt non confirmé ; état final non certifié.' } : await capturerProjet(dossier);
        p.fin = p.arretNonConfirme ? undefined : Date.now(); sauverPreuve(p);
        try { if (!p.arretNonConfirme && JSON.parse(fs.readFileSync(execution, 'utf8')).id === p.id) fs.rmSync(execution); } catch { /* Pas de marqueur à supprimer. */ }
        if (!p.arretNonConfirme) retirerSurveillance?.();
        return p;
    } catch (err) {
        const arrete = !enfantLance || await arreterArbre(enfantLance);
        if (preuveEnCours) {
            preuveEnCours.resultat = 'interrompu'; preuveEnCours.fin = Date.now(); preuveEnCours.raison = (err as Error).message;
            if (!arrete) { preuveEnCours.arretNonConfirme = true; preuveEnCours.fin = undefined; preuveEnCours.raison += ' · arrêt non confirmé'; enfantLance?.unref(); }
            try { sauverPreuve(preuveEnCours); } catch { /* L'erreur d'écriture est remontée ; aucun succès n'est annoncé. */ }
            if (arrete) {
                try { if (JSON.parse(fs.readFileSync(execution, 'utf8')).id === preuveEnCours.id) fs.rmSync(execution); } catch { /* Fin conservatrice. */ }
                retirerSurveillance?.();
            }
        }
        throw err;
    } finally { finVerrou(); }
}

function preuveValide(p: any, equipe: string, fichier: string): p is PreuveVerification {
    const texte = (v: unknown) => typeof v === 'string';
    const date = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 8.64e15;
    const empreinte = (v: any) => v && typeof v === 'object'
        && ['head', 'branche', 'erreur'].every((k) => v[k] === undefined || texte(v[k]))
        && (v.empreinte === undefined || typeof v.empreinte === 'string' && /^[a-f0-9]{64}$/.test(v.empreinte));
    return p && typeof p === 'object' && p.cible?.equipe === equipe && texte(p.id) && `${p.id}.json` === fichier
        && texte(p.cible.dossier) && path.isAbsolute(p.cible.dossier) && texte(p.cible.titre) && (p.cible.tache === undefined || texte(p.cible.tache))
        && p.commande && ['gestionnaire', 'script', 'contenu', 'commande', 'executable', 'manifeste'].every((k) => texte(p.commande[k]))
        && ['avant', 'apres'].every((k) => p.commande[k] === undefined || texte(p.commande[k]))
        && ['en cours', 'reussi', 'echoue', 'interrompu'].includes(p.resultat)
        && date(p.debut) && (p.fin === undefined || date(p.fin)) && empreinte(p.avant) && (p.apres === undefined || empreinte(p.apres))
        && Number.isInteger(p.proprietaire) && p.proprietaire > 0 && date(p.demarragePoste)
        && (p.pidExecution === undefined || Number.isInteger(p.pidExecution) && p.pidExecution > 0)
        && (p.arretNonConfirme === undefined || typeof p.arretNonConfirme === 'boolean')
        && Number.isInteger(p.octets) && p.octets >= 0 && p.octets <= LIMITE_JOURNAL
        && (p.codeSortie === undefined || p.codeSortie === null || Number.isInteger(p.codeSortie))
        && (p.signal === undefined || p.signal === null || texte(p.signal)) && (p.raison === undefined || texte(p.raison));
}

export function lirePreuvesVerification(equipe: string): PreuveVerification[] {
    try {
        return fs.readdirSync(dossierPreuves(equipe)).filter((f) => /^\d+-[a-f0-9-]+\.json$/.test(f)).sort().reverse().slice(0, 50).flatMap((f) => {
            try {
                const chemin = path.join(dossierPreuves(equipe), f); if (fs.statSync(chemin).size > MAX_PREUVE) return [];
                const p = JSON.parse(fs.readFileSync(chemin, 'utf8')) as PreuveVerification;
                if (!preuveValide(p, equipe, f)) return [];
                p.journal = journalPreuve(p); return [p];
            } catch { return []; }
        });
    } catch { return []; }
}
export function etatVerification(p?: PreuveVerification, actuelle?: EmpreinteProjet): EtatVerification {
    if (!p) return 'non verifie';
    if (p.arretNonConfirme) return p.pidExecution && processusVivant(p.pidExecution, p.demarragePoste) ? 'en cours' : 'inconnu';
    if (p.resultat === 'en cours') return (p.pidExecution ? processusVivant(p.pidExecution, p.demarragePoste) : processusVivant(p.proprietaire, p.demarragePoste)) ? 'en cours' : 'inconnu';
    if (p.resultat === 'interrompu') return 'interrompu';
    if (!p.avant.empreinte || !p.apres?.empreinte || !actuelle?.empreinte) return 'inconnu';
    if (p.avant.empreinte !== p.apres.empreinte || p.apres.empreinte !== actuelle.empreinte) return 'perime';
    return p.resultat;
}
export function lireJournalVerification(p: PreuveVerification): string {
    // Le chemin enregistré n'est jamais utilisé pour une lecture arbitraire.
    const fichier = journalPreuve(p), taille = fs.statSync(fichier).size;
    if (taille > LIMITE_JOURNAL) throw new Error('Le journal dépasse sa taille autorisée.');
    return fs.readFileSync(fichier, 'utf8').replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

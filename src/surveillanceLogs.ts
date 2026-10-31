import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import type { Commande } from './commandes.js';
import { Conteneur, Hote } from './docker.js';
import { choisirFournisseur } from './sessionsCommandes.js';
import { guiderConnexion } from './providers/assistantConnexion.js';
import { creerIntegree, envoyerIntegree } from './sessionsIntegrees.js';
import { journaliserDiagnostic } from './diagnostics.js';
import { toast } from './notifications.js';
import { choisir, saisir, tache } from './ui/bus.js';
import { bus } from './ui/bus.js';
import { c } from './theme.js';

// Surveiller les logs d'un conteneur (local ou sur un serveur SSH) : à chaque ligne qui correspond au motif
// (erreurs 5xx, error, exception…), une notification ; ensuite, Claude peut analyser l'extrait.
// C'est Agentopia qui lit les logs (docker logs -f), pas une session Claude : rien ne coûte tant que tout va bien.

const MOTIF_DEFAUT = '\\b5\\d\\d\\b|error|exception|fatal|panic|traceback';
const PAUSE_ALERTES = 60_000;     // une notification par minute au plus, par conteneur

interface Surveillance {
    id: string;
    conteneur: Conteneur;
    hote: Hote;
    motif: RegExp;
    proc: ChildProcess;
    recentes: string[];           // dernières lignes (contexte pour Claude)
    alertes: { date: Date; ligne: string }[];
    derniereAlerte: number;
}

const surveillances = new Map<string, Surveillance>();

export const listeSurveillances = () => [...surveillances.values()];

export function surveiller(hote: Hote, conteneur: Conteneur, motif = MOTIF_DEFAUT, lancer: typeof spawn = spawn): Surveillance {
    const expression = new RegExp(motif, 'i'); // Valider avant tout processus.
    const id = `${hote.serveur?.nom || 'local'}:${conteneur.id}`;
    const deja = surveillances.get(id);
    if (deja) return deja;
    const commande = ['logs', '-f', '--since', '1s', conteneur.id];
    const proc = hote.serveur
        ? lancer('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', hote.serveur.nom, 'docker', ...commande], { windowsHide: true })
        : lancer('docker', commande, { windowsHide: true });
    const s: Surveillance = { id, conteneur, hote, motif: expression, proc, recentes: [], alertes: [], derniereAlerte: 0 };
    let reste = '';
    const lire = (d: Buffer) => {
        const lignes = (reste + d.toString('utf-8').slice(-64_000)).split(/\r?\n/).map((l) => l.slice(-4000));
        reste = (lignes.pop() ?? '').slice(-4000);
        for (const ligne of lignes) {
            if (!ligne.trim()) continue;
            s.recentes.push(ligne);
            if (s.recentes.length > 120) s.recentes.shift();
            if (!s.motif.test(ligne)) continue;
            s.alertes.push({ date: new Date(), ligne });
            if (s.alertes.length > 50) s.alertes.shift();
            if (Date.now() - s.derniereAlerte < PAUSE_ALERTES) continue;
            s.derniereAlerte = Date.now();
            toast(`! ${conteneur.nom}${hote.serveur ? ` (${hote.nom})` : ''}`, ligne.slice(0, 200), 'claudetopia:surveillances');
            bus.emit('notice', `! ${conteneur.nom} : ${ligne.slice(0, 120)} · /surveillances pour analyser`);
        }
    };
    proc.stdout?.on('data', lire);
    proc.stderr?.on('data', lire);
    const quitter = () => proc.kill();
    const nettoyer = () => { if (surveillances.get(id) === s) surveillances.delete(id); process.off('exit', quitter); };
    proc.once('error', (erreur) => {
        nettoyer(); journaliserDiagnostic('docker.surveillance', erreur);
        bus.emit('notice', `Surveillance interrompue : ${hote.serveur ? 'SSH' : 'Docker'} inaccessible. Vérifie son installation et sa connexion, puis relance /surveiller-logs.`);
    });
    proc.once('close', (code) => { nettoyer(); if (code && code !== 0) { journaliserDiagnostic('docker.surveillance.fin', new Error('Processus terminé')); bus.emit('notice', `Surveillance terminée (code ${code}) · /surveiller-logs pour reprendre`); } });
    surveillances.set(id, s);
    process.once('exit', quitter);
    return s;
}

export function arreterSurveillance(id: string): void {
    surveillances.get(id)?.proc.kill();
    surveillances.delete(id);
}

export function commandesSurveillance(): Commande[] {
    return [
        {
            nom: 'surveiller-logs', args: '[conteneur] [motif]', groupe: 'Système',
            description: 'Surveiller les logs d\'un conteneur Docker (local ou distant) : notification à chaque erreur',
            executer: async ({ args }) => {
                const { lireDonnees } = await import('./ui/donnees.js');
                const tous = lireDonnees().docker.flatMap((h) => h.conteneurs.filter((x) => x.enMarche).map((x) => ({ h, x })));
                if (!tous.length) return console.log(c.alerte('Aucun conteneur en marche'));
                const candidats = tous.filter(({ x }) => x.id.startsWith(args[0] ?? '\0') || x.nom === args[0]);
                const choix = candidats.length === 1 ? candidats[0] : await choisir('Surveiller les logs de', (candidats.length ? candidats : tous).map(({ h, x }) => ({ label: `${h.serveur ? `${h.nom} › ` : ''}${x.nom}`, valeur: { h, x }, description: x.image })), tous.length > 8);
                const motif = args[1] ?? (await saisir('Motif à surveiller (expression régulière, insensible à la casse)', MOTIF_DEFAUT)).trim();
                try {
                    new RegExp(motif, 'i');
                } catch {
                    return console.log(c.erreur('Motif invalide'));
                }
                surveiller(choix.h, choix.x, motif || MOTIF_DEFAUT);
                console.log(c.succes(`◉ Logs de ${choix.x.nom} surveillés (« ${motif} ») · une notification à la première erreur · /surveillances pour gérer`));
            },
        },
        {
            nom: 'surveillances', groupe: 'Système',
            description: 'Logs surveillés : dernières erreurs, analyse par un agent, arrêter',
            executer: async () => {
                const liste = listeSurveillances();
                if (!liste.length) return console.log(c.discret('Aucun log surveillé · /surveiller-logs'));
                const s = await choisir('Logs surveillés', liste.map((x) => ({
                    label: `◉ ${x.hote.serveur ? `${x.hote.nom} › ` : ''}${x.conteneur.nom}`, valeur: x,
                    description: x.alertes.length ? `${x.alertes.length} alerte(s), dernière : ${x.alertes.at(-1)!.ligne.slice(0, 60)}` : 'aucune erreur',
                })), false);
                const action = await choisir(s.conteneur.nom, [
                    { label: '✻ Analyser avec un agent', valeur: 'analyser', description: 'une session reçoit les dernières lignes et cherche la cause' },
                    { label: '≡ Voir les dernières erreurs', valeur: 'voir' },
                    { label: '■ Arrêter la surveillance', valeur: 'arreter' },
                ], false);
                if (action === 'arreter') {
                    arreterSurveillance(s.id);
                    return console.log(c.succes(`Surveillance de ${s.conteneur.nom} arrêtée`));
                }
                if (action === 'voir') {
                    if (!s.alertes.length) return console.log(c.discret('Aucune erreur pour l\'instant'));
                    return s.alertes.slice(-20).forEach((a) => console.log(`${c.discret(a.date.toLocaleTimeString('fr-CA'))} ${a.ligne}`));
                }
                // Analyse : dans le dossier du docker-compose s'il est sur ce poste, sinon dans le dossier personnel
                const dossier = !s.hote.serveur && s.conteneur.dossier ? s.conteneur.dossier : os.homedir();
                const fournisseur = await choisirFournisseur('Agent pour analyser ces logs', true);
                await guiderConnexion(fournisseur, true);
                const session = creerIntegree(fournisseur, dossier, `Logs : ${s.conteneur.nom}`);
                await tache('Démarrage de l\'analyse', () => envoyerIntegree(session.id,
                    `Analyse ces logs du conteneur Docker « ${s.conteneur.nom} » (image ${s.conteneur.image}${s.hote.serveur ? `, sur le serveur ${s.hote.nom}` : ''}).
Erreurs repérées :
${s.alertes.slice(-15).map((a) => `- ${a.ligne}`).join('\n') || '- (aucune)'}

Dernières lignes :
${s.recentes.slice(-80).join('\n')}

Explique la cause la plus probable, puis${s.hote.serveur ? ' propose une correction (sans rien modifier sur le serveur sans me le demander).' : ' cherche dans le code du projet et propose (ou fais) la correction.'}`));
                console.log(c.succes(`✓ Analyse lancée (session ${session.id})`));
                bus.emit('selectionner', session.id);
            },
        },
    ];
}

import * as path from 'path';
import { Box, Text } from 'ink';
import type { Donnees } from './donnees.js';
import { decrireConnexion } from './donnees.js';
import { Detail, Morceau } from './espaces.js';
import { Bouton } from './mise.js';
import { ilYa } from './Panneau.js';
import { depotDe } from '../synchro.js';
import { metriquesDe, barre } from '../metriques.js';
import { theme, couleurProjet, fond } from '../theme.js';
import { tailleLisible } from '../sftp.js';
import type { Projet } from '../projets.js';

// Panneau de détail d'un projet, d'un serveur ou d'un conteneur : ses informations et ses actions,
// dans la zone principale (comme une conversation), sans changer d'écran

export interface ContenuDetail {
    titre: Morceau[];
    boutons: { label: string; action: string }[];    // action : commande Claudetopia, ou « retour »
    lignes: Morceau[][];
}

const ligne = (etiquette: string, valeur: string, couleur?: string): Morceau[] => [{ t: `  ${etiquette.padEnd(18)}`, c: 'gray' }, { t: valeur, c: couleur }];
const vide: Morceau[] = [{ t: '' }];
const RETOUR = { label: '← Retour', action: 'retour' };

export function contenuDetail(detail: Detail, d: Donnees, projets: Projet[]): ContenuDetail | undefined {
    if (detail.type === 'projet') {
        const p = projets.find((x) => x.chemin === detail.cle);
        if (!p) return undefined;
        const g = depotDe(p.chemin);
        const sessions = d.agents.filter((a) => path.resolve(a.cwd).toLowerCase().startsWith(path.resolve(p.chemin).toLowerCase()));
        return {
            titre: [{ t: '● ', c: couleurProjet(p.nom) }, { t: p.nom, gras: true }, { t: `  ${p.chemin}`, c: 'gray' }],
            boutons: [RETOUR, { label: '✻ Session', action: `/claude ${p.chemin}` }, { label: '✓ Commit', action: `/commit ${p.chemin}` },
                { label: '⇣ Pull', action: `/pull ${p.chemin}` }, { label: '◧ VS Code', action: `/code ${p.chemin}` },
                { label: '❯ Terminal', action: `/terminal defaut ${p.chemin}` }, { label: '⋯ Actions', action: `/actions ${p.chemin}` }],
            lignes: [
                ...(g ? [
                    ligne('Branche', `⎇ ${g.branche}${g.amont ? `  (suit ${g.amont})` : '  (pas de branche distante)'}`, theme.secondaire),
                    ligne('État', [g.modifs ? `${g.modifs} fichier(s) modifié(s)` : '', g.avance ? `${g.avance} commit(s) à pousser` : '', g.retard ? `${g.retard} commit(s) à tirer` : ''].filter(Boolean).join(' · ') || 'propre, à jour', g.modifs || g.retard ? '#facc15' : '#4ade80'),
                    ligne('Dernier commit', g.dernierCommit ? `${g.dernierCommit.sujet}  · il y a ${ilYa(g.dernierCommit.date)}` : '—'),
                    ligne('Hébergé sur', g.hebergeur ? `${g.hebergeur}${g.web ? `  ${g.web}` : ''}` : g.remote ?? 'aucun remote'),
                    ...(g.prs?.length ? [vide, [{ t: '  PULL REQUESTS', c: theme.primaire, gras: true }] as Morceau[], ...g.prs.slice(0, 5).map((pr): Morceau[] => [{ t: `  #${pr.numero} `, c: theme.accent }, { t: pr.titre }, { t: `  ${pr.auteur} · ${pr.branche}`, c: 'gray' }])] : []),
                ] : [ligne('Git', 'pas un dépôt git', 'gray')]),
                vide,
                [{ t: `  SESSIONS CLAUDE (${sessions.length})`, c: theme.primaire, gras: true }],
                ...(sessions.length ? sessions.map((s): Morceau[] => [{ t: `  ${s.statut === 'travaille' ? '✻' : s.statut === 'bloquee' ? '!' : '○'} `, c: theme.accent }, { t: s.titre || s.nom }, { t: s.question ? `  ? ${s.question}` : '', c: '#fdba74' }])
                    : [[{ t: '  aucune pour l\'instant · « ✻ Session » pour en lancer une', c: 'gray' }]]),
            ],
        };
    }
    if (detail.type === 'serveur') {
        const s = d.serveurs.find((x) => x.nom === detail.cle);
        if (!s) return undefined;
        const ok = d.joignables.get(s);
        const acces = d.acces[s.nom];
        const m = metriquesDe(s.nom);
        const connexions = d.connexions.map((cx) => decrireConnexion(cx, d)).filter((x) => x.serveur === s);
        const usage = d.usage.get(s) ?? [];
        const docker = d.docker.find((h) => h.nom === s.nom);
        return {
            titre: [{ t: '● ', c: ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171' }, { t: s.nom, gras: true }, { t: `  ${s.utilisateur ? s.utilisateur + '@' : ''}${s.hote}${s.port !== 22 ? `:${s.port}` : ''}`, c: 'gray' }],
            boutons: [RETOUR, { label: '⇄ Se connecter', action: `/ssh ${s.nom}` }, ...(s.configure ? [{ label: '⇅ Fichiers', action: `/sftp ${s.nom}` }] : []),
                { label: '⚿ Installer ma clé', action: `/ssh-cle ${s.nom}` }, { label: '≡ Tout', action: `/ssh vue ${s.nom}` }],
            lignes: [
                ligne('Réseau', ok === undefined ? 'vérification…' : ok ? `en ligne (${s.ip ?? s.hote})` : 'hors ligne ou injoignable', ok ? '#4ade80' : ok === false ? '#f87171' : 'gray'),
                ligne('Accès de Claude', !acces ? 'pas encore testé (vue SSH → Tester)' : acces.ok ? 'sans mot de passe (clé SSH)' : acces.message, acces?.ok ? '#4ade80' : '#facc15'),
                ligne('Connecté maintenant', connexions.length ? connexions.map((x) => x.session?.nom ?? 'un terminal').join(', ') : 'personne', connexions.length ? theme.accent : 'gray'),
                vide,
                [{ t: '  À L\'INTÉRIEUR', c: theme.primaire, gras: true }, { t: m ? `  relevé il y a ${ilYa(m.date)}` : '', c: 'gray' }],
                ...(m && !m.erreur ? [
                    ligne('Charge', `${barre(Math.min(100, ((m.charge ?? 0) / (m.coeurs ?? 1)) * 100))} ${m.charge?.toFixed(2)} sur ${m.coeurs ?? '?'} cœur(s)`),
                    ligne('Mémoire', `${barre(m.memoire ?? 0)} ${m.memoire ?? '?'}%${m.memoireTotale ? ` de ${tailleLisible(m.memoireTotale * 1024 * 1024)}` : ''}`, (m.memoire ?? 0) > 85 ? '#f87171' : undefined),
                    ligne('Disque /', `${barre(m.disque ?? 0)} ${m.disque ?? '?'}%`, (m.disque ?? 0) > 85 ? '#f87171' : undefined),
                    ligne('Allumé depuis', m.depuis ?? '?'),
                    ligne('Conteneurs Docker', m.conteneurs === undefined ? 'pas de Docker' : `${m.conteneurs} en marche`),
                ] : [[{ t: `  ${m?.erreur ? `${m.erreur} · ` : ''}${acces?.ok ? 'relevé en cours…' : 'les relevés demandent une connexion sans mot de passe (⚿ Installer ma clé)'}`, c: 'gray' }]]),
                ...(docker ? [vide, [{ t: '  CONTENEURS', c: theme.primaire, gras: true }] as Morceau[], ...docker.conteneurs.slice(0, 8).map((c): Morceau[] => [{ t: `  ● `, c: c.enMarche ? '#4ade80' : 'gray' }, { t: c.nom }, { t: `  ${c.statut}`, c: 'gray' }])] : []),
                vide,
                [{ t: '  UTILISÉ PAR CLAUDE DEPUIS', c: theme.primaire, gras: true }],
                ...(usage.length ? usage.slice(0, 5).map((u): Morceau[] => [{ t: `  ${path.basename(u.dossier).replace(/^C--Users-[^-]+-/, '')}`, c: undefined }, { t: `  ${u.nombre} commande(s), il y a ${ilYa(u.dernier)}`, c: 'gray' }]) : [[{ t: '  aucun projet', c: 'gray' }]]),
            ],
        };
    }
    const [hote, id] = detail.cle.split('|');
    const h = d.docker.find((x) => x.nom === hote);
    const c = h?.conteneurs.find((x) => x.id === id);
    if (!h || !c) return undefined;
    const cible = `${hote} ${id}`;
    return {
        titre: [{ t: '● ', c: c.enMarche ? '#4ade80' : 'gray' }, { t: c.nom, gras: true }, { t: `  ${h.serveur ? `sur ${h.nom}` : 'ce poste'} · ${c.image}`, c: 'gray' }],
        boutons: [RETOUR, { label: '≡ Logs', action: `/conteneur logs ${cible}` },
            ...(c.enMarche ? [{ label: '❯ Shell', action: `/conteneur shell ${cible}` }, { label: '↻ Redémarrer', action: `/conteneur restart ${cible}` },
                { label: '■ Arrêter', action: `/conteneur stop ${cible}` }, { label: '◉ Surveiller', action: `/surveiller-logs ${id}` }]
                : [{ label: '▶ Démarrer', action: `/conteneur start ${cible}` }])],
        lignes: [
            ligne('État', `${c.etat} · ${c.statut}${c.sante ? ` · santé : ${c.sante}` : ''}`, c.enMarche ? '#4ade80' : 'gray'),
            ligne('Ports', c.ports || '—'),
            ligne('CPU / mémoire', c.enMarche ? `${c.cpu ?? '…'} · ${c.memoire ?? '…'}` : '—'),
            ligne('Projet compose', c.projet ? `${c.projet}${c.service ? ` (service ${c.service})` : ''}` : '—'),
            ligne('Dossier', c.dossier ?? '—'),
            ligne('Identifiant', c.id),
        ],
    };
}

export function VueDetail({ contenu, boutons, largeur, hauteur, survol }: { contenu: ContenuDetail; boutons: Bouton[]; largeur: number; hauteur: number; survol?: string }) {
    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Box height={1} flexShrink={0} overflow="hidden">
                <Text wrap="truncate-end">{contenu.titre.map((m, i) => <Text key={i} color={m.c} bold={m.gras}>{m.t}</Text>)}</Text>
            </Box>
            <Box height={1} flexShrink={0} overflow="hidden">
                {boutons.map((b) => (
                    <Box key={b.action} marginRight={1} flexShrink={0}>
                        <Text backgroundColor={survol === `detail:${b.action}` ? fond.panneauActif : fond.selection} bold={survol === `detail:${b.action}`}
                            color={b.action === 'retour' ? fond.eteint : theme.secondaire}>{` ${b.label} `}</Text>
                    </Box>
                ))}
            </Box>
            <Box height={1} flexShrink={0}><Text color={fond.bordure}>{'─'.repeat(Math.max(0, largeur - 2))}</Text></Box>
            {contenu.lignes.slice(0, hauteur - 3).map((l, i) => (
                <Box key={i} height={1} overflow="hidden"><Text wrap="truncate-end">{l.map((m, k) => <Text key={k} color={m.c} bold={m.gras}>{m.t || ' '}</Text>)}</Text></Box>
            ))}
        </Box>
    );
}

import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { etatMaitre } from '../maitre.js';

type EtatMaitre = ReturnType<typeof etatMaitre>;
import { SessionVue, Activite, Statut } from '../agents.js';
import { Donnees, decrireConnexion } from './donnees.js';
import { ilYa } from './Panneau.js';
import stringWidth from 'string-width';
import { CARTE } from './mise.js';
import { theme, couleurProjet, c, fond } from '../theme.js';
import { Serveur } from '../ssh.js';
import { grouperConteneurs, portsCourts } from '../docker.js';
import { Equipe, avancement, agentsDesEquipes } from '../equipe.js';
import { serveursLateraux, dockerLateral, miseLateraleDe, sectionRepliee } from './sections.js';

// Colonne où commence « ❯ Terminal » sur la ligne « + Session » (marge 1 + « + Session » + 3 espaces)
export const X_TERMINAL = 1 + '+ Session'.length + 3;

// Ce que montre la colonne de gauche : une carte par équipe d'agents (ses agents n'ont pas leur propre carte),
// puis une carte par session
export type CarteLaterale = { type: 'equipe'; e: Equipe } | { type: 'session'; s: SessionVue };
export function cartesLaterales(d: Donnees): CarteLaterale[] {
    const membres = agentsDesEquipes();
    return [
        ...d.equipes.map((e): CarteLaterale => ({ type: 'equipe', e })),
        ...d.agents.filter((s) => !s.id || !membres.has(s.id)).map((s): CarteLaterale => ({ type: 'session', s })),
    ];
}

// Lignes de la section Docker : un projet compose en marche par ligne, ou un résumé
export function lignesDocker(d: Donnees): string[] {
    const lignes: string[] = [];
    for (const h of d.docker) {
        const prefixe = h.serveur ? c.secondaire(`${h.nom} › `) : '';
        if (h.erreur) {
            lignes.push(`${prefixe}${c.erreur('✕')} ${c.discret(h.erreur)}`);
            continue;
        }
        const groupes = grouperConteneurs(h.conteneurs);
        const actifs = groupes.filter((g) => g.conteneurs.some((x) => x.enMarche));
        for (const g of actifs) {
            const n = g.conteneurs.filter((x) => x.enMarche).length;
            const malade = g.conteneurs.some((x) => x.sante === 'unhealthy');
            const ports = portsCourts(g.conteneurs.map((x) => x.ports).join(', '));
            lignes.push(`${prefixe}${malade ? c.alerte('●') : c.succes('●')} ${g.nom} ${c.discret(`${n}/${g.conteneurs.length}`)} ${c.accent(ports)}`);
        }
        const arretes = h.conteneurs.filter((x) => !x.enMarche).length;
        if (!actifs.length) lignes.push(`${prefixe}${c.discret(`○ rien en marche · ${arretes} arrêté${arretes > 1 ? 's' : ''}`)}`);
    }
    return lignes;
}

const COULEURS: Record<Statut, string> = { travaille: '#4ade80', attend: '#facc15', bloquee: '#fb923c', terminee: '#94a3b8' };
const LIBELLES: Record<Statut, string> = { travaille: 'travaille', attend: 't\'attend', bloquee: 'bloquée', terminee: 'terminée' };
const ANIM = ['✻', '✼', '✽', '✾', '✿', '❀'];

const une = (s: string) => s.replace(/\s+/g, ' ').trim();

function Carte({ s, a, active, largeur, tic }: { s: SessionVue; a?: Activite; active: boolean; largeur: number; tic: number }) {
    const couleur = COULEURS[s.statut];
    const icone = s.statut === 'travaille' ? ANIM[tic % ANIM.length] : s.statut === 'bloquee' ? '!' : s.statut === 'terminee' ? '✓' : '○';
    const interieur = largeur - 4;
    // Ligne 2 : l'action en cours (outil) ou la dernière réponse de Claude
    // Ligne 2 : l'action en cours (outil), sinon la dernière réponse de Claude, sinon le titre de la session
    const action = s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : a?.dernierTexte ? une(a.dernierTexte) : s.titre || 'pas encore d\'activité';
    return (
        <Box height={CARTE} flexShrink={0} width={largeur} flexDirection="column" borderStyle="round" paddingX={1}
            borderColor={active ? theme.accent : s.statut === 'travaille' ? '#166534' : s.statut === 'bloquee' ? '#9a3412' : fond.bordure}>
            {/* Lignes de hauteur 1 fixe, la partie droite ne rétrécit jamais : une carte ne déborde pas */}
            <Box height={1} width={interieur} overflow="hidden">
                <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text wrap="truncate-end">
                        <Text color={couleurProjet(s.nom)}>● </Text>
                        <Text bold>{s.nom}</Text>
                        <Text color="gray">{s.arrierePlan ? ' ⧉' : ''}</Text>
                    </Text>
                </Box>
                <Box flexShrink={0}><Text color={couleur}>{` ${icone} ${LIBELLES[s.statut]}`}</Text></Box>
            </Box>
            <Box height={1} width={interieur} overflow="hidden">
                <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text wrap="truncate-end" color={s.question ? '#fb923c' : a?.outil ? theme.secondaire : 'gray'}>{action}</Text>
                </Box>
                <Box flexShrink={0}><Text color={fond.discret}>{a?.date ? ` ${ilYa(a.date)}` : ''}</Text></Box>
            </Box>
            {CARTE > 4 && (
                <Box height={1} width={interieur} overflow="hidden">
                    <Text wrap="truncate-end" color={fond.eteint}>{a?.dernierUser ? `» ${une(a.dernierUser)}` : s.titre}</Text>
                </Box>
            )}
        </Box>
    );
}

// État d'une équipe en quelques mots, avec sa couleur
export function etatEquipe(e: Equipe, tic = 0): { texte: string; couleur: string } {
    const a = avancement(e);
    if (e.etat === 'planification') return { texte: `${ANIM[tic % ANIM.length]} plan…`, couleur: '#c084fc' };
    if (e.etat === 'plan') return { texte: 'plan prêt', couleur: '#facc15' };
    if (a.bloquees) return { texte: `! ${a.bloquees} permission${a.bloquees > 1 ? 's' : ''}`, couleur: '#fb923c' };
    if (e.etat === 'en cours') return { texte: `${ANIM[tic % ANIM.length]} ${a.actives} en cours`, couleur: '#4ade80' };
    if (e.etat === 'prete') return { texte: '✓ à intégrer', couleur: '#22d3ee' };
    if (e.etat === 'integration') return { texte: `${ANIM[tic % ANIM.length]} intégration`, couleur: '#22d3ee' };
    if (e.etat === 'finie') return { texte: '✓ finie', couleur: '#94a3b8' };
    return { texte: '✕ problème', couleur: '#f87171' };
}

function CarteEquipe({ e, largeur, tic }: { e: Equipe; largeur: number; tic: number }) {
    const a = avancement(e);
    const etat = etatEquipe(e, tic);
    const interieur = largeur - 4;
    const legende = a.total ? ` ${a.faites}/${a.total}` : '';
    const barre = Math.max(4, interieur - legende.length - 1);
    const plein = a.total ? Math.round((a.faites / a.total) * barre) : 0;
    return (
        <Box height={CARTE} flexShrink={0} width={largeur} flexDirection="column" borderStyle="double" paddingX={1}
            borderColor={e.etat === 'en cours' || e.etat === 'integration' ? '#7c3aed' : '#4c1d95'}>
            <Box height={1} width={interieur} overflow="hidden">
                <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text wrap="truncate-end"><Text color="#c084fc">◆ </Text><Text bold>{e.nomProjet}</Text></Text>
                </Box>
                <Box flexShrink={0}><Text color={etat.couleur}>{` ${etat.texte}`}</Text></Box>
            </Box>
            <Box height={1} width={interieur} overflow="hidden">
                <Text color="#7c3aed">{'━'.repeat(plein)}</Text>
                <Text color={fond.bordure}>{'━'.repeat(barre - plein)}</Text>
                <Text color="gray">{legende}</Text>
            </Box>
        </Box>
    );
}

// En-tête de section : bande de couleur sur toute la largeur (titre à gauche, info à droite)
function Entete({ titre, droite = '', largeur, couleur = theme.primaire, couleurDroite = 'gray' }:
    { titre: string; droite?: string; largeur: number; couleur?: string; couleurDroite?: string }) {
    const gauche = ` ${titre}`;
    const fin = `${droite} `;
    const espace = Math.max(1, largeur - stringWidth(gauche) - stringWidth(fin));
    return (
        <Box height={1} flexShrink={0} overflow="hidden">
            <Text wrap="truncate-end" backgroundColor={FOND_ENTETE}>
                <Text bold color={couleur}>{gauche}</Text>{' '.repeat(espace)}<Text color={couleurDroite}>{fin}</Text>
            </Text>
        </Box>
    );
}
const FOND_ENTETE = fond.entete;
const vide = <Box height={1} flexShrink={0} />;

// ─── Le maître ───────────────────────────────────────────────────────────────

const VIOLET = '#a78bfa';
// Exemples avec le nom d'un vrai projet en cours, quand il y en a un
const exemples = (projet = 'mon-projet') => ['« ferme les sessions finies »', `« où en est ${projet} ? »`, `« lance les tests sur ${projet} »`];

function Maitre({ etat, actif, hauteur, largeur, tic, claude, projet }: { etat: EtatMaitre; actif: boolean; hauteur: number; largeur: number; tic: number; claude: string; projet?: string }) {
    const dernier = etat.historique.at(-1);
    const corps: { texte: string; couleur?: string }[] = [];
    // Claude Code absent ou pas connecté : rien ne marchera sans lui, on le dit ici (clic = corriger)
    if (claude === 'absent' || claude === 'deconnecte') {
        const lignes = claude === 'absent'
            ? [{ texte: '! Claude Code n\'est pas installé', couleur: '#fb923c' }, { texte: '▸ clic ici pour l\'installer', couleur: theme.accent }]
            : [{ texte: '! Pas connecté à Claude', couleur: '#fb923c' }, { texte: '▸ clic ici pour te connecter', couleur: theme.accent }];
        return (
            <Box flexDirection="column" height={hauteur} overflow="hidden">
                <Entete titre="◇ MAÎTRE" largeur={largeur} couleur={VIOLET} />
                {lignes.slice(0, hauteur - 1).map((l, i) => <Box key={i} height={1} overflow="hidden" paddingX={1}><Text wrap="truncate-end" color={l.couleur}>{l.texte}</Text></Box>)}
            </Box>
        );
    }
    if (!dernier) {
        corps.push({ texte: actif ? 'Écris ta demande en bas ↓' : 'Clique ici, puis demande :', couleur: actif ? VIOLET : 'gray' });
        exemples(projet).forEach((e) => corps.push({ texte: e, couleur: 'gray' }));
    } else {
        corps.push({ texte: `» ${dernier.question}`, couleur: 'gray' });
        if (etat.enCours) corps.push({ texte: `${ANIM[tic % ANIM.length]} réfléchit…`, couleur: VIOLET });
        if (dernier.erreur) corps.push({ texte: `✕ ${dernier.erreur}`, couleur: '#f87171' });
        if (dernier.reponse) wrapAnsi(dernier.reponse, largeur - 2, { hard: true }).split('\n').forEach((l) => corps.push({ texte: l }));
        dernier.commandes?.forEach((c) => corps.push({ texte: `▸ ${c.replace(/ --oui$/, '')}`, couleur: theme.secondaire }));
    }
    // Peu de place : la réponse passe avant le rappel de la question, et on dit où lire la suite
    if (dernier && corps.length > hauteur - 1 && !etat.enCours) corps.shift();
    if (dernier && corps.length > hauteur - 1) corps.splice(hauteur - 2, corps.length, { texte: '… suite dans le journal →', couleur: 'gray' });
    const droite = etat.enCours ? `${ANIM[tic % ANIM.length]}` : actif ? '● à l\'écoute' : etat.pret ? 'Alt+M' : etat.enVeille ? 'en veille' : etat.erreur ? '!' : 'démarre…';
    return (
        <Box flexDirection="column" height={hauteur} overflow="hidden">
            <Entete titre={actif ? '◈ MAÎTRE' : '◇ MAÎTRE'} droite={droite} largeur={largeur} couleur={VIOLET} couleurDroite={actif ? VIOLET : 'gray'} />
            {corps.slice(0, hauteur - 1).map((l, i) => (
                <Box key={i} height={1} overflow="hidden" paddingX={1}><Text wrap="truncate-end" color={l.couleur}>{l.texte || ' '}</Text></Box>
            ))}
        </Box>
    );
}

interface Props {
    donnees: Donnees;
    largeur: number;
    hauteur: number;
    selection?: string;
    decalage: number;
    tic: number;
    maitre: EtatMaitre;
    modeMaitre: boolean;
    claude: string;
}

export function Laterale({ donnees: d, largeur, hauteur, selection, decalage, tic, maitre, modeMaitre, claude }: Props) {
    const serveurs: Serveur[] = serveursLateraux(d);
    const docker = dockerLateral(d);
    const m = miseLateraleDe(hauteur, d);
    const enMarche = d.docker.reduce((n, h) => n + h.conteneurs.filter((x) => x.enMarche).length, 0);
    // Le décalage (molette) ne peut pas dépasser ce qui est caché
    const cartes = cartesLaterales(d);
    const debut = Math.max(0, Math.min(decalage, cartes.length - m.nbCartes));
    const visibles = cartes.slice(debut, debut + m.nbCartes);
    const caches = cartes.length - visibles.length;
    const actives = d.connexions.map((cx) => decrireConnexion(cx, d));
    const enAttente = d.agents.filter((a) => a.statut === 'attend' || a.statut === 'bloquee').length;
    const interieur = largeur - 1;   // la dernière colonne est la ligne verticale
    const fleche = (s: 'docker' | 'ssh') => (sectionRepliee(s) ? ' ▸' : ' ▾');

    return (
        <Box width={largeur} height={hauteur} flexDirection="column" overflow="hidden"
            borderStyle="single" borderTop={false} borderBottom={false} borderLeft={false} borderColor={fond.bordure}>
            {/* Chaque ligne a une hauteur fixe : la géométrie doit correspondre à miseLaterale() pour les clics */}
            <Entete titre="SESSIONS CLAUDE" largeur={interieur}
                droite={`${d.agents.length}${enAttente ? ` · ${enAttente} en attente` : ''}`} couleurDroite={enAttente ? '#facc15' : 'gray'} />
            {visibles.map((x) => (x.type === 'equipe'
                ? <CarteEquipe key={`equipe-${x.e.id}`} e={x.e} largeur={interieur} tic={tic} />
                : <Carte key={x.s.cle} s={x.s} a={d.activites.get(x.s.sessionId)} active={x.s.cle === selection} largeur={interieur} tic={tic} />
            ))}
            {Array.from({ length: m.nbCartes - visibles.length }, (_, i) => <Box key={`vide${i}`} height={CARTE} flexShrink={0} />)}
            <Box height={1} flexShrink={0} paddingX={1}>
                <Text wrap="truncate-end">
                    <Text color={theme.accent}>+ Session</Text>
                    <Text>{'   '}</Text>
                    <Text color={theme.secondaire}>❯ Terminal</Text>
                    <Text color="gray">{caches > 0 ? `  · ${caches} de plus` : ''}</Text>
                </Text>
            </Box>
            {vide}
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
                {m.hauteurMaitre >= 2 && <Maitre etat={maitre} actif={modeMaitre} hauteur={m.hauteurMaitre} largeur={interieur} tic={tic} claude={claude} projet={d.agents.find((a) => a.arrierePlan)?.nom ?? d.agents[0]?.nom} />}
            </Box>
            {m.afficheDocker && vide}
            {m.afficheDocker && (
                <Box flexDirection="column" flexShrink={0}>
                    <Entete titre="DOCKER" largeur={interieur}
                        droite={`${enMarche ? `${enMarche} en marche` : ''}${!sectionRepliee('docker') && docker.length > m.nbDocker ? ` · +${docker.length - m.nbDocker}` : ''}${fleche('docker')}`} />
                    {docker.slice(0, m.nbDocker).map((l, i) => (
                        <Box key={i} height={1} overflow="hidden" paddingX={1}><Text wrap="truncate-end">{l}</Text></Box>
                    ))}
                </Box>
            )}
            {m.afficheServeurs && vide}
            {m.afficheServeurs && (
                <Box flexDirection="column" flexShrink={0}>
                    <Entete titre="SERVEURS SSH" largeur={interieur}
                        droite={`${actives.length ? `⇄ ${actives.length} connecté${actives.length > 1 ? 's' : ''} · ` : ''}${serveurs.length}${fleche('ssh')}`}
                        couleurDroite={actives.length ? theme.accent : 'gray'} />
                    {serveurs.slice(0, m.nbServeurs).map((s) => {
                        const ok = d.joignables.get(s);
                        const connecte = actives.filter((a) => a.serveur === s);
                        const acces = d.acces[s.nom];
                        return (
                            <Box key={s.nom} height={1} overflow="hidden" paddingX={1}>
                                <Text wrap="truncate-end">
                                    <Text color={ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171'}>● </Text>
                                    {s.nom.padEnd(10)}
                                    {acces ? <Text color={acces.ok ? '#4ade80' : '#facc15'}>{acces.ok ? 'clé ' : 'mdp '}</Text> : <Text color="gray">{'    '}</Text>}
                                    {connecte.length
                                        ? <Text color={theme.accent}>⇄ {connecte.map((x) => x.session?.nom ?? 'terminal').join(', ')}</Text>
                                        : <Text color="gray">{(d.usage.get(s) ?? []).length ? `${(d.usage.get(s) ?? []).length} projet(s)` : ''}</Text>}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
}

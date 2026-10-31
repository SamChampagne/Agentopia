import { Box, Text } from 'ink';
import { nomAgentSession } from './identiteSession.js';
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
import { Espace, ESPACES, LigneEspace, lignesEspace } from './espaces.js';
import type { Projet } from '../projets.js';

// Colonne où commence « ❯ Terminal » sur la ligne « + Session » (marge 1 + « + Session » + 3 espaces)
export const X_TERMINAL = 1 + '+ Session'.length + 3;

// Ce que montre la colonne de gauche : une carte par équipe d'agents (ses agents n'ont pas leur propre carte),
// puis une carte par session
export type CarteLaterale = { type: 'equipe'; e: Equipe } | { type: 'session'; s: SessionVue };
export function cartesLaterales(d: Donnees): CarteLaterale[] {
    const membres = agentsDesEquipes();
    return [
        ...d.equipes.map((e): CarteLaterale => ({ type: 'equipe', e })),
        ...d.agents.filter((s) => !s.id || !membres.has(s.id))
            // Les sessions en pause (plus de 12 h d'attente) passent en bas de la liste
            .map((s) => ({ s, pause: enPause(s, d.activites.get(s.sessionId)) }))
            .sort((a, b) => Number(a.pause) - Number(b.pause))
            .map(({ s }): CarteLaterale => ({ type: 'session', s })),
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

// Une ligne de carte : barre d'état à gauche, morceaux de texte coupés à la largeur, partie droite,
// le tout sur le fond de la carte (rempli jusqu'au bord : la carte se détache sans cadre)
type Morceau = { t: string; c?: string; gras?: boolean };
function couperA(texte: string, max: number): string {
    if (stringWidth(texte) <= max) return texte;
    let r = '';
    for (const ch of texte) {
        if (stringWidth(r + ch) > max - 1) break;
        r += ch;
    }
    return r + '…';
}
export function LigneCarte({ barre, couleurBarre, largeur, morceaux, droite, couleurDroite, fondCarte, fondDroite }:
    { barre: string; couleurBarre: string; largeur: number; morceaux: Morceau[]; droite?: string; couleurDroite?: string; fondCarte?: string; fondDroite?: string }) {
    const fin = droite ? ` ${droite} ` : ' ';
    let place = Math.max(0, largeur - stringWidth(barre) - stringWidth(fin));
    const coupes: Morceau[] = [];
    for (const m of morceaux) {
        if (place <= 0) break;
        const t = couperA(m.t, place);
        coupes.push({ ...m, t });
        place -= stringWidth(t);
    }
    return (
        <Box height={1} width={largeur} overflow="hidden">
            <Text backgroundColor={fondCarte}>
                <Text color={couleurBarre}>{barre}</Text>
                {coupes.map((m, i) => <Text key={i} color={m.c} bold={m.gras}>{m.t}</Text>)}
                {' '.repeat(place)}
                <Text color={couleurDroite ?? fond.discret} backgroundColor={fondDroite} bold={!!fondDroite}>{fin}</Text>
            </Text>
        </Box>
    );
}

// Une session qui attend depuis plus de 12 h n'est plus urgente : « en pause », grisée, hors de « À faire »
export const PAUSE = 12 * 3600_000;
export function enPause(s: SessionVue, a?: Activite): boolean {
    return (s.statut === 'bloquee' || s.statut === 'attend') && Date.now() - (a?.date ?? s.debut).getTime() > PAUSE;
}

// Carte de session : barre épaisse, état animé en couleur, textes francs ; les sessions en pause sont grisées
function Carte({ s, a, active, largeur, tic, survole }: { s: SessionVue; a?: Activite; active: boolean; largeur: number; tic: number; survole?: boolean }) {
    const pause = enPause(s, a);
    const couleur = pause ? fond.discret : COULEURS[s.statut];
    const icone = pause ? '◌' : s.statut === 'travaille' ? ANIM[tic % ANIM.length] : s.statut === 'bloquee' ? '!' : s.statut === 'terminee' ? '✓' : '○';
    const etat = pause ? `en pause · ${ilYa(a?.date ?? s.debut)}` : LIBELLES[s.statut];
    const action = s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : a?.dernierTexte ? une(a.dernierTexte) : s.titre || 'pas encore d’activité';
    const fondCarte = active ? fond.panneauActif : survole ? fond.selection : fond.panneau;
    const commun = { barre: '█ ', couleurBarre: active ? theme.accent : couleur, largeur: largeur - 1, fondCarte };
    return (
        <Box height={CARTE} flexShrink={0} width={largeur} flexDirection="column">
            <LigneCarte {...commun} droite={`${icone} ${etat}`} couleurDroite={couleur} morceaux={[
                { t: '● ', c: pause ? fond.discret : couleurProjet(s.nom) }, { t: `${nomAgentSession(s)} · `, c: theme.secondaire }, { t: s.nom, gras: true, c: active ? theme.accent : pause ? fond.eteint : fond.texte },
                { t: s.arrierePlan ? ' ⧉' : '', c: fond.discret },
            ]} />
            <LigneCarte {...commun} droite={!pause && a?.date ? ilYa(a.date) : undefined} morceaux={[
                { t: `  ${action}`, c: pause ? fond.discret : s.question ? '#fdba74' : a?.outil ? theme.secondaire : fond.texte },
            ]} />
            {CARTE > 3 && <LigneCarte {...commun} morceaux={[{ t: `  ${a?.dernierUser ? `» ${une(a.dernierUser)}` : s.titre}`, c: fond.eteint }]} />}
            <Box height={1} flexShrink={0} />
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
    const legende = a.total ? ` ${a.faites}/${a.total}` : '';
    const barre = Math.max(4, largeur - 6 - legende.length);
    const plein = a.total ? Math.round((a.faites / a.total) * barre) : 0;
    const commun = { barre: '▌ ', couleurBarre: e.etat === 'en cours' || e.etat === 'integration' ? '#a78bfa' : '#6d28d9', largeur: largeur - 1, fondCarte: fond.panneau };
    return (
        <Box height={CARTE} flexShrink={0} width={largeur} flexDirection="column">
            <LigneCarte {...commun} droite={etat.texte} couleurDroite={etat.couleur} morceaux={[{ t: '◆ ', c: '#c084fc' }, { t: e.nomProjet, gras: true, c: fond.texte }]} />
            <LigneCarte {...commun} morceaux={[{ t: '  ' }, { t: '━'.repeat(plein), c: '#a78bfa' }, { t: '━'.repeat(Math.max(0, barre - plein)), c: fond.bordure }, { t: legende, c: fond.discret }]} />
            {CARTE > 3 && <LigneCarte {...commun} morceaux={[{ t: `  ${e.objectif}`, c: fond.eteint }]} />}
            <Box height={1} flexShrink={0} />
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
    if (!dernier) {
        // Au repos, une seule ligne : l'invitation (les exemples tournent, un à la fois)
        corps.push(actif ? { texte: 'Écris ta demande en bas ↓', couleur: VIOLET } : { texte: `ex. ${exemples(projet)[Math.floor(Date.now() / 20_000) % 3]}`, couleur: fond.eteint });
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
    const droite = etat.enCours ? `${ANIM[tic % ANIM.length]}` : actif ? '● à l\'écoute' : etat.pret ? 'Alt+M' : etat.enVeille ? 'en veille' : etat.erreur ? '!' : 'à la demande';
    return (
        <Box flexDirection="column" height={hauteur} overflow="hidden">
            <Entete titre={`${actif ? '◈' : '◇'} MAÎTRE · ${etat.fournisseur}`} droite={droite} largeur={largeur} couleur={VIOLET} couleurDroite={actif ? VIOLET : 'gray'} />
            {corps.slice(0, hauteur - 1).map((l, i) => (
                <Box key={i} height={1} overflow="hidden" paddingX={1}><Text wrap="truncate-end" color={l.couleur}>{l.texte || ' '}</Text></Box>
            ))}
        </Box>
    );
}

// Onglets des espaces de travail (ligne 0) ; à droite, les sessions qui attendent une réponse (clic = /questions)
function Onglets({ espace, largeur, survol, attente }: { espace: Espace; largeur: number; survol?: string; attente: number }) {
    const fin = attente ? `? ${attente} ` : '';
    const libres = Math.max(0, largeur - 1 - ESPACES.reduce((n, e) => n + e.label.length + 2, 0) - fin.length);
    return (
        <Box height={1} flexShrink={0} overflow="hidden">
            <Text wrap="truncate-end" backgroundColor={fond.entete}>
                <Text> </Text>
                {ESPACES.map((e) => {
                    const actif = e.cle === espace;
                    const survole = survol === `onglet:${e.cle}`;
                    return <Text key={e.cle}><Text bold={actif} underline={actif} color={actif ? theme.accent : survole ? fond.texte : fond.eteint}>{e.label}</Text>{'  '}</Text>;
                })}
                {' '.repeat(libres)}
                <Text color="#facc15" bold>{fin}</Text>
            </Text>
        </Box>
    );
}

// Liste d'un espace (Projets, SSH, Docker) : une ligne par élément, fond au survol et sur l'élément ouvert
function ListeEspace({ lignes, largeur, hauteur, decalage, survol, ouvert }: { lignes: LigneEspace[]; largeur: number; hauteur: number; decalage: number; survol?: string; ouvert?: string }) {
    const debut = Math.max(0, Math.min(decalage, lignes.length - hauteur));
    return (
        <Box flexDirection="column" height={hauteur} overflow="hidden">
            {lignes.slice(debut, debut + hauteur).map((l, i) => {
                const actif = !!ouvert && l.cle === ouvert;
                const survole = !l.titre && survol === l.cle;
                return (
                    <LigneCarte key={`${l.cle}:${i}`} barre={actif ? '▌ ' : '  '} couleurBarre={theme.accent} largeur={largeur - 1}
                        fondCarte={actif ? fond.panneauActif : survole ? fond.selection : undefined}
                        morceaux={l.morceaux} droite={l.droite} couleurDroite={l.couleurDroite} />
                );
            })}
            {!lignes.length && <Text color="gray">  (rien pour l'instant)</Text>}
        </Box>
    );
}

interface Props {
    espace: Espace;
    survol?: string;            // ce qui est sous la souris (onglet:…, carte:…, projet:…)
    ouvert?: string;            // l'élément dont le détail est ouvert
    projets: Projet[];
    donnees: Donnees;
    largeur: number;
    hauteur: number;
    selection?: string;
    decalage: number;
    tic: number;
    maitre: EtatMaitre;
    modeMaitre: boolean;
    claude: string;
    cote?: 'gauche' | 'droite';   // colonne à droite (/ecran) : la ligne verticale passe à sa gauche
}

export function Laterale({ donnees: d, largeur, hauteur, selection, decalage, tic, maitre, modeMaitre, claude, espace, survol, ouvert, projets, cote = 'gauche' }: Props) {
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
            borderStyle="single" borderTop={false} borderBottom={false} borderLeft={cote === 'droite'} borderRight={cote === 'gauche'} borderColor={fond.bordure}>
            {/* Chaque ligne a une hauteur fixe : la géométrie doit correspondre à miseLaterale() pour les clics */}
            <Onglets espace={espace} largeur={interieur} survol={survol} attente={d.agents.filter((x) => (x.statut === 'bloquee' || (x.arrierePlan && x.statut === 'attend')) && !enPause(x, d.activites.get(x.sessionId))).length} />
            {espace !== 'sessions' && (
                <ListeEspace lignes={lignesEspace(espace, d, projets)} largeur={interieur} hauteur={hauteur - 1} decalage={decalage} survol={survol} ouvert={ouvert} />
            )}
            {espace === 'sessions' && <>
            {visibles.map((x) => (x.type === 'equipe'
                ? <CarteEquipe key={`equipe-${x.e.id}`} e={x.e} largeur={interieur} tic={tic} />
                : <Carte key={x.s.cle} s={x.s} a={d.activites.get(x.s.sessionId)} active={x.s.cle === selection} largeur={interieur} tic={tic} survole={survol === `carte:${x.s.cle}`} />
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
            </>}
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

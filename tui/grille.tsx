import { Ansi } from './ansi.tsx';
import { GRAS, ANIM, couper } from './style.ts';
import { lireTranscript } from '../dist/agents.js';
import { lignesTranscript } from '../dist/ui/Zones.js';
import { enPause } from '../dist/ui/Laterale.js';
import { theme, fond, couleurProjet } from '../dist/theme.js';

// Grille : jusqu'à 4 conversations en direct, chacune dans sa case. Clic = l'ouvrir en grand.
// Les sessions qui travaillent passent en premier, puis les plus récemment actives.

const COULEURS: Record<string, string> = { travaille: '#4ade80', attend: '#facc15', bloquee: '#fb923c', terminee: '#94a3b8' };
const LIBELLES: Record<string, string> = { travaille: 'travaille', attend: 't’attend', bloquee: 'bloquée', terminee: 'terminée' };

export function sessionsGrille(d: any, max = 4): any[] {
    const actives = d.agents.filter((s: any) => s.statut !== 'terminee' && !enPause(s, d.activites.get(s.sessionId)));
    const date = (s: any) => d.activites.get(s.sessionId)?.date?.getTime?.() ?? s.debut.getTime();
    const rang = (s: any) => (s.statut === 'travaille' ? 0 : s.statut === 'bloquee' ? 1 : 2);
    return actives.sort((a: any, b: any) => rang(a) - rang(b) || date(b) - date(a)).slice(0, max);
}

function Case({ s, largeur, hauteur, tic, ouvrir }: any) {
    // Seulement la fin de la conversation : la case montre les dernières lignes, comme un terminal
    const messages = lireTranscript(s.fichier).slice(-40);
    const lignes: string[] = lignesTranscript(messages, Math.max(10, largeur - 4)).slice(-(hauteur - 3));
    const couleur = COULEURS[s.statut] ?? fond.discret;
    const pulse = s.statut === 'travaille' && tic % 2 === 1;
    const bord = s.statut === 'bloquee' ? (tic % 2 ? '#fb923c' : '#7c2d12') : pulse ? couleurProjet(s.nom) : s.statut === 'travaille' ? couleur : fond.bordure;
    const icone = s.statut === 'travaille' ? ANIM[tic % ANIM.length] : s.statut === 'bloquee' ? '!' : '○';
    return (
        <box width={largeur} height={hauteur} border borderStyle="rounded" borderColor={bord} flexDirection="column" onMouseDown={ouvrir}>
            <box height={1} flexDirection="row" paddingLeft={1}>
                <text flexGrow={1} truncate>
                    <span fg={couleurProjet(s.nom)}>● </span>
                    <span fg={fond.texte} attributes={GRAS}>{s.nom}</span>
                    <span fg="gray">{`  ${couper(s.titre || s.id || '', Math.max(0, largeur - s.nom.length - 22))}`}</span>
                </text>
                <text fg={couleur}>{`${icone} ${LIBELLES[s.statut] ?? s.statut} `}</text>
            </box>
            <box flexGrow={1} flexDirection="column" paddingLeft={1} overflow="hidden" justifyContent="flex-end">
                {/* Chaque ligne garde sa hauteur (repliée) : sans ça, les lignes repliées se chevauchent */}
                {lignes.map((l, i) => <box key={i} flexShrink={0}><Ansi texte={l} replier /></box>)}
                {!lignes.length && <text fg={fond.discret}>pas encore de messages</text>}
            </box>
        </box>
    );
}

export function Grille({ d, largeur, hauteur, tic, ouvrir }: { d: any; largeur: number; hauteur: number; tic: number; ouvrir: (cle: string) => void }) {
    const sessions = sessionsGrille(d);
    if (!sessions.length) {
        return (
            <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
                <text fg={theme.primaire} attributes={GRAS}>⊞ Grille</text>
                <text fg={fond.eteint}>aucune session active pour l’instant · lance-en une, elle apparaîtra ici</text>
            </box>
        );
    }
    // 1 : plein cadre · 2 : côte à côte · 3-4 : deux rangées
    const colonnes = sessions.length === 1 ? 1 : 2;
    const rangees = sessions.length <= 2 ? 1 : 2;
    const l = Math.floor(largeur / colonnes);
    const h = Math.floor((hauteur - 1) / rangees);
    return (
        <box flexGrow={1} flexDirection="column">
            <text fg={fond.discret} truncate>{` ⊞ ${sessions.length} conversation${sessions.length > 1 ? 's' : ''} en direct · clic pour l’ouvrir en grand · Échap ou Alt+G pour revenir`}</text>
            {Array.from({ length: rangees }, (_, r) => (
                <box key={r} height={h} flexDirection="row">
                    {sessions.slice(r * colonnes, r * colonnes + colonnes).map((s: any) => (
                        <Case key={s.cle} s={s} largeur={l} hauteur={h} tic={tic} ouvrir={() => ouvrir(s.cle)} />
                    ))}
                </box>
            ))}
        </box>
    );
}

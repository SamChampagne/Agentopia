import { useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useSelectionVisible } from '../listeClavier.ts';
import { GRAS, ANIM, couper } from '../style.ts';
import { useDonnees } from '../donnees.ts';
import { Titre, Boutons } from './commun.tsx';
import { bus } from '../../dist/ui/bus.js';
import { etatEquipe } from '../../dist/ui/Laterale.js';
import { etatTache, boutonsEquipe } from '../../dist/ui/VueEquipe.js';
import {
    role, avancement, lancerEquipe, planifier, integrer, arreterEquipe, terminerEquipe,
    relancerTache, retirerTache, modifsLocales, basculerEcart,
} from '../../dist/equipe.js';
import { theme, fond } from '../../dist/theme.js';

// Équipes d'agents : la liste, puis une équipe (ses tâches, leur état, le détail de la tâche choisie)
const tic = () => Math.floor(Date.now() / 800);
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);

function ListeEquipes({ fermer, ouvrir }: { fermer: () => void; ouvrir: (id: string) => void }) {
    const d = useDonnees();
    const [index, setIndex] = useState(0);
    const { width, height } = useTerminalDimensions();
    const compact = width < 100;
    const defilement = useSelectionVisible(`equipe-${index}`);
    const [survol, setSurvol] = useState<number>();
    const lignes = [undefined, ...d.equipes];
    const choisir = (i: number) => {
        const e = lignes[i];
        if (e) return ouvrir(e.id);
        fermer();
        bus.emit('lancer', d.erreurEquipes ? '/equipes-recuperer' : '/equipe nouvelle');
    };
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') setIndex((i) => Math.max(0, i - 1));
        if (k.name === 'down') setIndex((i) => Math.min(lignes.length - 1, i + 1));
        if (k.name === 'pageup') setIndex((i) => Math.max(0, i - Math.max(1, Math.floor((height - 8) / (compact ? 2 : 1)))));
        if (k.name === 'pagedown') setIndex((i) => Math.min(lignes.length - 1, i + Math.max(1, Math.floor((height - 8) / (compact ? 2 : 1)))));
        if (k.name === 'return') choisir(index);
    });
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="ÉQUIPES D'AGENTS" droite="clic = ouvrir · Échap fermer" />
            <text fg={d.erreurEquipes ? '#facc15' : 'gray'} wrapMode="word">{d.erreurEquipes || 'Choisis un parcours ou un modèle. Le moteur poursuit les tâches même après fermeture de la fenêtre, tant que le PC reste allumé. L’intégration se lance après ta revue.'}</text>
            <text fg={theme.accent} onMouseDown={() => choisir(0)}>{d.erreurEquipes ? '↻ Récupérer les équipes · commande /equipes-recuperer' : '+ Parcours guidé ou modèle réutilisable · commande /equipe nouvelle'}</text>
            <text> </text>
            <scrollbox ref={defilement} verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {lignes.map((e: any, i) => {
                    const actif = i === index;
                    const etat = e ? etatEquipe(e, tic()) : undefined;
                    const av = e ? avancement(e) : undefined;
                    return (
                        <box key={e?.id ?? 'nouvelle'} id={`equipe-${i}`} height={compact && e ? 2 : 1} flexDirection="column" backgroundColor={actif ? fond.selection : survol === i ? fond.panneau : undefined}
                            onMouseOver={() => setSurvol(i)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => choisir(i)}>
                            <text truncate>
                                <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                {e ? <>
                                    <span fg="#c084fc">◆ </span>
                                    <span attributes={actif ? GRAS : 0}>{compact ? `${e.nomProjet} · ` : colonne(e.nomProjet, 18)}</span>
                                    <span fg={etat!.couleur}>{colonne(etat!.texte, 24)}</span>
                                    {!compact && <span fg="gray">{colonne(`${av!.faites}/${av!.total}`, 6)}{e.objectif}</span>}
                                </> : <span fg={theme.accent} attributes={GRAS}>{d.erreurEquipes ? '↻ Récupérer les équipes…' : '+ Nouvelle équipe sur un projet…'}</span>}
                            </text>
                            {compact && e && <text truncate fg="gray">{`  ${av!.faites}/${av!.total} · ${e.objectif}`}</text>}
                        </box>
                    );
                })}
            </scrollbox>
        </box>
    );
}

function CorpsEquipe({ e, fermer, retour }: { e: any; fermer: () => void; retour?: () => void }) {
    const { width, height } = useTerminalDimensions();
    const compact = width < 100;
    const [choix, setChoix] = useState<string>();
    const [survol, setSurvol] = useState<string>();
    const [message, setMessage] = useState('');
    const [aConfirmer, setAConfirmer] = useState<string>();
    const taches = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])];
    const courante = taches.find((t: any) => t.id === choix) ?? taches[0];
    const index = Math.max(0, taches.indexOf(courante));
    const defilement = useSelectionVisible(courante ? `tache-${index}` : undefined);
    const t0 = tic();
    const quitter = () => (retour ? retour() : fermer());
    const ouvrirSession = (agentId?: string) => {
        if (!agentId) return setMessage('Cet agent n\'a pas encore démarré');
        fermer();
        bus.emit('selectionner', agentId);
    };

    async function agir(action: string) {
        try { await appliquer(action); } catch (e) { setMessage(`✕ ${(e as Error).message}`); }
    }
    async function appliquer(action: string) {
        setMessage('');
        if (action !== aConfirmer) setAConfirmer(undefined);
        if (action === 'fermer') return quitter();
        if (action === 'bilan-equipe') { fermer(); return void bus.emit('lancer', `/equipe-bilan ${e.id}`); }
        if (action === 'actions-equipe' || (action === 'lancer' && e.mixte)) {
            fermer();
            const commande = action === 'actions-equipe' || e.taches.some((t: any) => ['erreur', 'arretee'].includes(t.etat)) ? 'equipe-actions' : 'equipe-lancer';
            return void bus.emit('lancer', `/${commande} ${e.id}`);
        }
        if (action === 'agent') return ouvrirSession(courante?.agentId);
        if (action === 'integrateur') return ouvrirSession(e.integrateur?.agentId);
        if (action === 'diff' && courante) {
            fermer();
            return void bus.emit('lancer', `/equipe-diff ${e.id} ${courante.id}`);
        }
        if (action === 'ecarter' && courante) {
            const ecartee = await basculerEcart(e.id, courante.id);
            return setMessage(ecartee ? `✕ ${courante.titre} est écartée : l'intégrateur ne fusionnera pas sa branche` : `↺ ${courante.titre} sera fusionnée`);
        }
        if (action === 'lancer') {
            const erreur = courante && (courante.etat === 'erreur' || courante.etat === 'arretee') && e.etat !== 'erreur'
                ? await relancerTache(e.id, courante.id) : await lancerEquipe(e.id);
            return setMessage(erreur ?? `▶ Équipe lancée : ${Math.min(taches.length, 3)} agents démarrent · suis-les ici ou sur la carte ◆`);
        }
        if (action === 'replan') {
            setMessage('Le chef d\'équipe refait le plan…');
            return void planifier(e);
        }
        if (action === 'confiance') {
            fermer();
            return void bus.emit('lancer', `/onglet ${e.projet}`);
        }
        if (action === 'retirer' && courante) return setMessage(await retirerTache(e.id, courante.id) ?? 'Tâche retirée');
        if (action === 'arreter') {
            setMessage('Arrêt des agents…');
            await arreterEquipe(e.id);
            return setMessage(e.mixte ? 'Agents arrêtés · Débloquer → Reprendre conserve le travail en cours' : 'Agents arrêtés · Relancer redémarre les tâches non finies');
        }
        if (action === 'integrer') {
            const modifs = modifsLocales(e);
            if (modifs) {
                setAConfirmer('integrer');
                return setMessage(`! ${e.nomProjet} a ${modifs} fichier(s) non commité(s) : commite-les ou range-les avant d’intégrer`);
            }
            setAConfirmer(undefined);
            setMessage('Démarrage de l\'intégrateur…');
            const erreur = await integrer(e.id);
            return setMessage(erreur ?? '⇄ L\'intégrateur fusionne les branches dans le dossier du projet');
        }
        if (action === 'ranger') {
            // Ranger se confirme par un second clic : les agents sont arrêtés et retirés
            if (aConfirmer !== 'ranger') {
                setAConfirmer('ranger');
                return setMessage('Reclique pour ranger : les agents sont arrêtés et retirés, leurs branches restent dans le dépôt');
            }
            await terminerEquipe(e.id);
            return quitter();
        }
    }
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return quitter();
        if (k.name === 'up') setChoix(taches[Math.max(0, index - 1)]?.id);
        if (k.name === 'down') setChoix(taches[Math.min(taches.length - 1, index + 1)]?.id);
        if (k.name === 'pageup') setChoix(taches[Math.max(0, index - Math.max(1, Math.floor((height - 10) / (compact ? 2 : 1))))]?.id);
        if (k.name === 'pagedown') setChoix(taches[Math.min(taches.length - 1, index + Math.max(1, Math.floor((height - 10) / (compact ? 2 : 1))))]?.id);
        if (k.name === 'return') ouvrirSession(courante?.agentId);
        if (k.sequence === 'l' && (e.etat === 'plan' || e.etat === 'erreur')) void agir('lancer');
        if (k.sequence === 'a') void agir('actions-equipe');
        if (k.sequence === 'b') void agir('bilan-equipe');
    });

    const etat = etatEquipe(e, t0);
    const av = avancement(e);
    const r = courante ? role(courante.role) : undefined;
    const info = message || courante?.preparation?.message || courante?.attenteFile || e.message || (e.resume ? `Plan : ${e.resume}` : '');
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte={`◆ ÉQUIPE · ${e.nomProjet}`} droite={`${av.faites}/${av.total} faites · ${etat.texte}`} />
            <text truncate><span fg="gray">Objectif : </span><span>{e.objectif}</span></text>
            <Boutons boutons={boutonsEquipe(e, courante)} agir={(a) => void agir(a)} />
            <text truncate fg={message.startsWith('!') || e.etat === 'erreur' ? '#facc15' : 'gray'}>{info || ' '}</text>
            <text fg="gray">{compact ? ' Tâche · agent / état · ↑ ↓ Pg↑ Pg↓' : '  ' + colonne('Tâche', 43) + colonne('Agent / rôle', 24) + 'État'}</text>
            <scrollbox ref={defilement} verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {e.etat === 'planification' && <text fg="#c084fc">{`  ${ANIM[t0 % ANIM.length]} Le chef d'équipe prépare le plan…`}</text>}
                {taches.map((t: any) => {
                    const actif = t.id === courante?.id;
                    const rt = role(t.role);
                    const et = etatTache(t, t0);
                    return (
                        <box key={t.id} id={`tache-${taches.indexOf(t)}`} height={compact ? 2 : 1} flexDirection="column" backgroundColor={actif ? fond.selection : survol === t.id ? fond.panneau : undefined}
                            onMouseOver={() => setSurvol(t.id)} onMouseOut={() => setSurvol(undefined)}
                            onMouseDown={() => (actif && t.agentId ? ouvrirSession(t.agentId) : setChoix(t.id))}>
                            <text truncate>
                                <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                <span attributes={actif ? GRAS : 0}>{compact ? `${t.id} ${t.titre}` : colonne(`${t.id === 'integration' ? '⇄' : t.id} ${t.titre}`, 43)}</span>
                                {!compact && <>
                                <span fg={rt.couleur}>{colonne(t.fournisseur ? `${t.fournisseur} · ${rt.nom}` : `${rt.icone} ${rt.nom}`, 24)}</span>
                                <span fg={et.couleur}>{et.texte}</span>
                                </>}
                            </text>
                            {compact && <text truncate fg={et.couleur}>{`  ${et.texte} · ${t.fournisseur || rt.nom}`}</text>}
                        </box>
                    );
                })}
            </scrollbox>
            <box flexShrink={0} maxHeight={Math.max(3, Math.min(12, Math.floor(height / 3)))} flexDirection="column" border={['top']} borderColor={fond.bordure}>
                {!courante
                    ? <text fg="gray" wrapMode="word">{e.etat === 'planification' ? 'Le chef d\'équipe lit le code et découpe l\'objectif en tâches (1 à 3 minutes)…' : e.message ?? ''}</text>
                    : <>
                        <text fg={r!.couleur} truncate>{`${courante.fournisseur || r!.nom} · ${courante.titre}${courante.branche ? `  ⎇ ${courante.branche}` : ''}`}</text>
                        <text wrapMode="word" selectable>{courante.resultat ? `Résultat : ${courante.resultat}` : courante.consigne}</text>
                    </>}
            </box>
        </box>
    );
}

function DetailEquipe({ id, fermer, retour }: { id: string; fermer: () => void; retour?: () => void }) {
    const d = useDonnees();
    const e = d.equipes.find((x: any) => x.id === id);
    useKeyboard((k) => {
        if (!e && (k.name === 'escape' || k.sequence === 'q')) (retour ?? fermer)();
    });
    if (!e) return <box flexGrow={1} paddingLeft={1}><text fg="gray">Équipe introuvable (rangée ?) · Échap</text></box>;
    return <CorpsEquipe e={e} fermer={fermer} retour={retour} />;
}

export function VueEquipe({ fermer, id }: { fermer: () => void; id?: string }) {
    const [ouverte, setOuverte] = useState(id);
    if (ouverte) return <DetailEquipe id={ouverte} fermer={fermer} retour={id ? undefined : () => setOuverte(undefined)} />;
    return <ListeEquipes fermer={fermer} ouvrir={setOuverte} />;
}

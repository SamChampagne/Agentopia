import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { useTailleVue, useClicsVue, LigneBoutons, Separateur, Titre } from './Vues.js';
import { placerBoutons, boutonA } from './mise.js';
import { useDonnees } from './donnees.js';
import { etatEquipe } from './Laterale.js';
import { ilYa } from './Panneau.js';
import { bus } from './bus.js';
import {
    Equipe, Tache, role, avancement, lancerEquipe, planifier, integrer, arreterEquipe, terminerEquipe,
    relancerTache, retirerTache, modifsLocales, estDeConfiance, basculerEcart,
} from '../equipe.js';
import { theme, fond } from '../theme.js';

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, Math.max(0, n - 2)) + '… ' : s.padEnd(n));
const ANIM = ['✻', '✼', '✽', '✾', '✿', '❀'];

export function etatTache(t: Tache, tic: number): { texte: string; couleur: string } {
    const depuis = t.debut ? ` · ${ilYa(new Date(t.debut))}` : '';
    switch (t.etat) {
        case 'attente': return { texte: t.dependances.length ? `○ attend ${t.dependances.join(', ')}` : '○ en attente', couleur: 'gray' };
        case 'en cours': return { texte: `${ANIM[tic % ANIM.length]} travaille${depuis}`, couleur: '#4ade80' };
        case 'bloquee': return { texte: '! attend ta permission', couleur: '#fb923c' };
        case 'faite': return t.ecartee ? { texte: '✕ écartée (pas fusionnée)', couleur: '#f87171' } : { texte: '✓ faite', couleur: '#94a3b8' };
        case 'arretee': return { texte: '■ arrêtée', couleur: '#facc15' };
        default: return { texte: '✕ erreur', couleur: '#f87171' };
    }
}

// ─── Liste des équipes ───────────────────────────────────────────────────────

function ListeEquipes({ fermer, ouvrir }: { fermer: () => void; ouvrir: (id: string) => void }) {
    const { largeur, hauteur } = useTailleVue();
    const d = useDonnees();
    const [index, setIndex] = useState(0);
    const lignes = [undefined, ...d.equipes];
    const choisir = (i: number) => {
        const e = lignes[i];
        if (e) return ouvrir(e.id);
        fermer();
        bus.emit('lancer', '/equipe nouvelle');
    };
    useClicsVue((_, y) => {
        const i = y - 4;
        if (i >= 0 && i < lignes.length) choisir(i);
    }, (sens) => setIndex((i) => Math.max(0, Math.min(lignes.length - 1, i - sens))));
    useInput((input, key) => {
        if (key.escape || input === 'q') return fermer();
        if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
        if (key.downArrow) setIndex((i) => Math.min(lignes.length - 1, i + 1));
        if (key.return) choisir(index);
    });
    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="ÉQUIPES D'AGENTS" droite="clic = ouvrir · Échap fermer" />
            <Box height={2} flexShrink={0}>
                <Text color="gray" wrap="wrap">Choisis un parcours ou un modèle, puis les agents réalisent les tâches selon leurs dépendances. Chaque agent de code a sa branche. Tu relis le résultat avant l’intégration.</Text>
            </Box>
            <Separateur largeur={largeur - 2} />
            {lignes.slice(0, hauteur - 4).map((e, i) => {
                const actif = i === index;
                const etat = e ? etatEquipe(e, tic()) : undefined;
                return (
                    <Box key={e?.id ?? 'nouvelle'} height={1} overflow="hidden">
                        <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                            <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                            {e ? (
                                <>
                                    <Text color="#c084fc">◆ </Text>
                                    <Text bold={actif}>{ajuste(e.nomProjet, 18)}</Text>
                                    <Text color={etat!.couleur}>{ajuste(etat!.texte, 24)}</Text>
                                    <Text color="gray">{ajuste(`${avancement(e).faites}/${avancement(e).total}`, 6)}{e.objectif}</Text>
                                </>
                            ) : <Text color={theme.accent} bold>+ Nouvelle équipe sur un projet…</Text>}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}

// ─── Une équipe ──────────────────────────────────────────────────────────────

function boutonsEquipeBase(e: Equipe, t?: Tache) {
    const fermer = { label: '✕ Fermer', action: 'fermer' };
    // Une tâche finie avec sa branche : lire son diff avant de fusionner, et l'écarter si besoin
    const revue = t?.branche && t.etat === 'faite' && (e.etat === 'prete' || e.etat === 'erreur')
        ? [{ label: '≠ Voir le diff', action: 'diff' }, { label: t.ecartee ? '↺ Garder' : '✕ Écarter', action: 'ecarter' }] : [];
    const ouvrirAgent = t?.agentId ? [{ label: '↵ Voir l\'agent', action: 'agent' }] : [];
    switch (e.etat) {
        case 'planification': return [{ label: '− Abandonner', action: 'ranger' }, fermer];
        case 'plan': return [...(e.mixte || estDeConfiance(e.projet) ? [] : [{ label: '▭ Accepter le dossier', action: 'confiance' }]), { label: '▶ Lancer l\'équipe', action: 'lancer' }, ...(e.mixte ? [] : [{ label: '↻ Refaire le plan', action: 'replan' }]), { label: '− Retirer la tâche', action: 'retirer' }, { label: '− Abandonner', action: 'ranger' }, fermer];
        case 'en cours': return [...ouvrirAgent, { label: '■ Arrêter', action: 'arreter' }, fermer];
        case 'erreur': return [{ label: '↻ Relancer', action: 'lancer' }, ...ouvrirAgent, ...revue, { label: '⇄ Intégrer ce qui est fait', action: 'integrer' }, ...(e.mixte ? [] : [{ label: '↻ Refaire le plan', action: 'replan' }]), { label: '− Ranger', action: 'ranger' }, fermer];
        case 'prete': return [{ label: '⇄ Intégrer', action: 'integrer' }, ...revue, ...ouvrirAgent, { label: '✓ Ranger l\'équipe', action: 'ranger' }, fermer];
        case 'integration': return [{ label: '↵ Voir l\'intégrateur', action: 'integrateur' }, { label: '■ Arrêter', action: 'arreter' }, fermer];
        default: return [{ label: '↵ Voir l\'intégrateur', action: 'integrateur' }, ...ouvrirAgent, { label: '✓ Ranger l\'équipe', action: 'ranger' }, fermer];
    }
}

export function boutonsEquipe(e: Equipe, t?: Tache) {
    const boutons = boutonsEquipeBase(e, t);
    if (e.mixte && ['plan', 'erreur'].includes(e.etat) && e.taches.some((t) => ['erreur', 'arretee'].includes(t.etat))) {
        const i = boutons.findIndex((b) => b.action === 'lancer');
        if (i >= 0) boutons[i] = { label: '↻ Débloquer (a)', action: 'actions-equipe' };
    }
    if (boutons.some((b) => b.action === 'actions-equipe')) return boutons;
    return [boutons[0], { label: '⋯ Actions (a)', action: 'actions-equipe' }, ...boutons.slice(1)];
}

function DetailEquipe({ id, fermer, retour }: { id: string; fermer: () => void; retour?: () => void }) {
    const d = useDonnees();
    const e = d.equipes.find((x) => x.id === id);
    useInput((input, key) => {
        if (!e && (key.escape || input === 'q')) (retour ?? fermer)();
    });
    if (!e) return <Box paddingLeft={1}><Text color="gray">Équipe introuvable (rangée ?) · Échap</Text></Box>;
    return <CorpsEquipe e={e} fermer={fermer} retour={retour} />;
}

// L'animation avance à chaque rafraîchissement de l'écran (l'App redessine pendant qu'une équipe travaille)
const tic = () => Math.floor(Date.now() / 800);

function CorpsEquipe({ e, fermer, retour }: { e: Equipe; fermer: () => void; retour?: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const [choix, setChoix] = useState<string>();
    const [message, setMessage] = useState('');
    const [aConfirmer, setAConfirmer] = useState<string>();

    const taches = [...e.taches, ...(e.integrateur ? [e.integrateur] : [])];
    const courante = taches.find((t) => t.id === choix) ?? taches[0];
    const boutons = placerBoutons(boutonsEquipe(e, courante), 0);
    const detail = Math.max(4, Math.floor((hauteur - 6) * 0.4));
    const zone = Math.max(2, hauteur - 6 - detail - 1);
    const index = Math.max(0, taches.indexOf(courante));
    const premier = Math.max(0, Math.min(index - Math.floor(zone / 2), taches.length - zone));
    const largeurTitre = Math.max(16, Math.min(60, largeur - 2 - 17 - 26));
    const t0 = tic();

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
        if (action === 'fermer') return retour ? retour() : fermer();
        if (action === 'actions-equipe' || (action === 'lancer' && e.mixte)) {
            fermer();
            const commande = action === 'actions-equipe' || e.taches.some((t) => ['erreur', 'arretee'].includes(t.etat)) ? 'equipe-actions' : 'equipe-lancer';
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
        if (action === 'retirer' && courante) return retirerTache(e.id, courante.id);
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
            if (aConfirmer !== 'ranger') {
                setAConfirmer('ranger');
                return setMessage('Reclique pour ranger : les agents sont arrêtés et retirés, leurs branches restent dans le dépôt');
            }
            await terminerEquipe(e.id);
            return retour ? retour() : fermer();
        }
    }

    useClicsVue((x, y) => {
        if (y === 2) {
            const b = boutonA(boutons, x - 1);
            if (b) void agir(b.action);
            return;
        }
        const i = premier + y - 6;
        if (y >= 6 && i < taches.length && y < 6 + zone) {
            if (taches[i].id === courante?.id && taches[i].agentId) return ouvrirSession(taches[i].agentId);
            setChoix(taches[i].id);
        }
    }, (sens) => setChoix(taches[Math.max(0, Math.min(taches.length - 1, index - sens))]?.id));

    useInput((input, key) => {
        if (key.escape || input === 'q') return retour ? retour() : fermer();
        if (key.upArrow) setChoix(taches[Math.max(0, index - 1)]?.id);
        if (key.downArrow) setChoix(taches[Math.min(taches.length - 1, index + 1)]?.id);
        if (key.return) ouvrirSession(courante?.agentId);
        if (input === 'l' && (e.etat === 'plan' || e.etat === 'erreur')) void agir('lancer');
        if (input === 'a') void agir('actions-equipe');
    });

    const etat = etatEquipe(e, t0);
    const r = courante ? role(courante.role) : undefined;
    const texteDetail = !courante
        ? (e.etat === 'planification' ? 'Le chef d\'équipe lit le code et découpe l\'objectif en tâches (1 à 3 minutes)…' : e.message ?? '')
        : [
            `${r!.icone} ${r!.nom} · ${courante.titre}${courante.branche ? `  ⎇ ${courante.branche}` : ''}`,
            '',
            courante.resultat ? `Résultat : ${courante.resultat}` : courante.consigne,
        ].join('\n');
    const lignesDetail = wrapAnsi(texteDetail, Math.max(20, largeur - 3), { hard: true }).split('\n').slice(0, detail);
    const info = message || e.message || (e.resume ? `Plan : ${e.resume}` : '');

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte={`◆ ÉQUIPE · ${e.nomProjet}`} droite={`${avancement(e).faites}/${avancement(e).total} faites · ${etat.texte}`} />
            <Box height={1} flexShrink={0} overflow="hidden"><Text wrap="truncate-end"><Text color="gray">Objectif : </Text>{e.objectif}</Text></Box>
            <LigneBoutons boutons={boutons} />
            <Box height={1} flexShrink={0} overflow="hidden">
                <Text wrap="truncate-end" color={message.startsWith('!') || e.etat === 'erreur' ? '#facc15' : 'gray'}>{info}</Text>
            </Box>
            <Separateur largeur={largeur - 2} />
            <Box height={1} flexShrink={0}>
                <Text color="gray">{'  ' + ajuste('Tâche', largeurTitre) + ajuste('Rôle', 17) + 'État'}</Text>
            </Box>
            <Box flexDirection="column" height={zone} flexShrink={0}>
                {e.etat === 'planification' && <Text color="#c084fc">  {ANIM[(t0) % ANIM.length]} Le chef d'équipe prépare le plan…</Text>}
                {taches.slice(premier, premier + zone).map((t) => {
                    const actif = t.id === courante?.id;
                    const rt = role(t.role);
                    const et = etatTache(t, t0);
                    return (
                        <Box key={t.id} height={1} overflow="hidden">
                            <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                                <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                                <Text bold={actif}>{ajuste(`${t.id === 'integration' ? '⇄' : t.id} ${t.titre}`, largeurTitre)}</Text>
                                <Text color={rt.couleur}>{ajuste(`${rt.icone} ${rt.nom}`, 17)}</Text>
                                <Text color={et.couleur}>{et.texte}</Text>
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Separateur largeur={largeur - 2} />
            <Box flexDirection="column" height={detail} flexShrink={0} overflow="hidden">
                {lignesDetail.map((l, i) => <Text key={i} color={i === 0 && courante ? r!.couleur : undefined} wrap="truncate-end">{l || ' '}</Text>)}
            </Box>
        </Box>
    );
}

export function VueEquipe({ fermer, id }: { fermer: () => void; id?: string }) {
    const [ouverte, setOuverte] = useState(id);
    if (ouverte) return <DetailEquipe id={ouverte} fermer={fermer} retour={id ? undefined : () => setOuverte(undefined)} />;
    return <ListeEquipes fermer={fermer} ouvrir={setOuverte} />;
}

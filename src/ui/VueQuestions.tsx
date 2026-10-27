import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { useTailleVue, useClicsVue, LigneBoutons, Separateur, Titre } from './Vues.js';
import { placerBoutons, boutonA } from './mise.js';
import { useDonnees } from './donnees.js';
import { ilYa } from './Panneau.js';
import { bus } from './bus.js';
import { theme, couleurProjet, fond } from '../theme.js';
import type { SessionVue } from '../agents.js';

// Ce que les sessions attendent de toi, à un seul endroit : leurs questions, la réponse que Claude propose,
// et un clic pour répondre (sans ouvrir chaque conversation)

const BLOC = 6;   // nom, question (2 lignes), suggestion, vide… par session

export const sessionsEnAttente = (agents: SessionVue[]) =>
    agents.filter((a) => a.statut === 'bloquee' || (a.arrierePlan && a.statut === 'attend'))
        .sort((a, b) => Number(!!b.question) - Number(!!a.question));

export function VueQuestions({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const d = useDonnees();
    const liste = sessionsEnAttente(d.agents);
    const [choix, setChoix] = useState<string>();
    const [reponse, setReponse] = useState<string>();
    const courante = liste.find((s) => s.cle === choix) ?? liste[0];
    const index = Math.max(0, liste.indexOf(courante));
    const parPage = Math.max(1, Math.floor((hauteur - 4) / BLOC));
    const premier = Math.max(0, Math.min(index - parPage + 1, liste.length - parPage));
    const boutons = placerBoutons([
        { label: '↵ Envoyer la suggestion', action: 'suggestion' },
        { label: '✎ Répondre', action: 'repondre' },
        { label: '◧ Voir la conversation', action: 'voir' },
        { label: '← Retour', action: 'fermer' },
    ], 0);

    const envoyer = (texte: string) => {
        if (!courante || !texte.trim()) return;
        fermer();
        bus.emit('lancer', `/envoyer ${courante.sessionId} ${texte.trim()}`);
    };

    function agir(action: string) {
        if (action === 'fermer') return fermer();
        if (!courante) return;
        if (action === 'suggestion' && courante.suggestion) return envoyer(courante.suggestion);
        if (action === 'repondre' || action === 'suggestion') return setReponse(action === 'suggestion' ? '' : courante.suggestion ?? '');
        if (action === 'voir') {
            fermer();
            bus.emit('selectionner', courante.id ?? courante.sessionId);
        }
    }

    useClicsVue((x, y) => {
        if (y === 1) {
            const b = boutonA(boutons, x - 1);
            if (b) agir(b.action);
            return;
        }
        const s = liste[premier + Math.floor((y - 4) / BLOC)];
        if (y >= 4 && s) setChoix(s.cle);
    }, (sens) => setChoix(liste[Math.max(0, Math.min(liste.length - 1, index - sens))]?.cle));

    useInput((input, key) => {
        if (reponse !== undefined) {
            if (key.escape) return setReponse(undefined);
            if (key.return) return envoyer(reponse);
            if (key.backspace || key.delete) return setReponse(reponse.slice(0, -1));
            if (input && !key.ctrl && !key.meta) setReponse(reponse + input);
            return;
        }
        if (key.escape || input === 'q') return fermer();
        if (key.upArrow) setChoix(liste[Math.max(0, index - 1)]?.cle);
        if (key.downArrow) setChoix(liste[Math.min(liste.length - 1, index + 1)]?.cle);
        if (key.return) agir(courante?.suggestion ? 'suggestion' : 'repondre');
        if (input === 'r') agir('repondre');
    });

    const largeurTexte = Math.max(20, largeur - 6);
    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="? EN ATTENTE DE TOI" droite={`${liste.filter((s) => s.question).length} question(s) · ${liste.length} session(s)`} />
            <LigneBoutons boutons={boutons} />
            <Box height={1} flexShrink={0} overflow="hidden">
                {reponse !== undefined
                    ? <Text wrap="truncate-start"><Text color={theme.accent}>{`Réponse à ${courante?.nom} : `}</Text>{reponse}<Text inverse> </Text><Text color="gray">  Entrée envoyer · Échap annuler</Text></Text>
                    : <Text color="gray">Entrée = envoyer la suggestion (ou répondre) · r répondre · Échap fermer</Text>}
            </Box>
            <Separateur largeur={largeur - 2} />
            {!liste.length && <Text color="#4ade80">  ✓ Aucune session n'attend de réponse</Text>}
            {liste.slice(premier, premier + parPage).map((s) => {
                const actif = s === courante;
                const bord = actif ? theme.accent : fond.bordure;
                const question = s.question ? wrapAnsi(s.question, largeurTexte, { hard: true }).split('\n').slice(0, 2) : [s.statut === 'bloquee' ? 'attend une permission : « Voir la conversation » puis Rejoindre' : 'a fini et t\'attend'];
                const act = d.activites.get(s.sessionId);
                return (
                    <Box key={s.cle} flexDirection="column" height={BLOC} flexShrink={0}>
                        <Text wrap="truncate-end">
                            <Text color={bord}>{actif ? '▌ ' : '  '}</Text>
                            <Text color={couleurProjet(s.nom)}>● </Text><Text bold>{s.nom}</Text>
                            <Text color="gray">{`  ${s.titre}${act?.date ? ` · il y a ${ilYa(act.date)}` : ''}`}</Text>
                        </Text>
                        {question.map((l, i) => (
                            <Text key={i} wrap="truncate-end"><Text color={bord}>{actif ? '▌ ' : '  '}</Text><Text color={s.question ? '#fb923c' : 'gray'}>{`  ${i ? ' ' : '?'} ${l}`}</Text></Text>
                        ))}
                        <Text wrap="truncate-end">
                            <Text color={bord}>{actif ? '▌ ' : '  '}</Text>
                            {s.suggestion ? <Text color={theme.secondaire}>{`  ↵ suggestion : ${s.suggestion}`}</Text> : <Text color="gray">  (pas de suggestion)</Text>}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}

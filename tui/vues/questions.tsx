import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS } from '../style.ts';
import { useDonnees } from '../donnees.ts';
import { Titre, Boutons } from './commun.tsx';
import { bus } from '../../dist/ui/bus.js';
import { ilYa } from '../../dist/ui/Panneau.js';
import { sessionsEnAttente } from '../../dist/ui/VueQuestions.js';
import { theme, couleurProjet, fond } from '../../dist/theme.js';

// Ce que les sessions attendent de toi, à un seul endroit : leurs questions, la réponse que Claude propose,
// et un clic pour répondre (sans ouvrir chaque conversation)
const BOUTONS = [
    { label: '↵ Envoyer la suggestion', action: 'suggestion' }, { label: '✎ Répondre', action: 'repondre' },
    { label: '◧ Voir la conversation', action: 'voir' }, { label: '← Retour', action: 'fermer' },
];

export function VueQuestions({ fermer }: { fermer: () => void }) {
    const d = useDonnees();
    const liste = sessionsEnAttente(d.agents);
    const [choix, setChoix] = useState<string>();
    const [reponse, setReponse] = useState<string>();
    const courante = liste.find((s: any) => s.cle === choix) ?? liste[0];
    const index = Math.max(0, liste.indexOf(courante));
    const envoyer = (texte: string) => {
        if (!courante || !texte.trim()) return;
        fermer();
        bus.emit('lancer', `/envoyer ${courante.sessionId} ${texte.trim()}`);
    };
    function agir(action: string) {
        if (action === 'fermer') return fermer();
        if (!courante) return;
        if (courante.permission && (action === 'suggestion' || action === 'repondre')) {
            fermer(); bus.emit('lancer', `/autorisation ${courante.id}`); return;
        }
        if (action === 'suggestion' && courante.suggestion) return envoyer(courante.suggestion);
        if (action === 'repondre' || action === 'suggestion') return setReponse(action === 'suggestion' ? '' : courante.suggestion ?? '');
        if (action === 'voir') {
            fermer();
            bus.emit('selectionner', courante.id ?? courante.sessionId);
        }
    }
    useKeyboard((k) => {
        if (reponse !== undefined) {
            if (k.name === 'escape') setReponse(undefined);
            return;   // le champ de réponse gère la frappe et Entrée
        }
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') setChoix(liste[Math.max(0, index - 1)]?.cle);
        if (k.name === 'down') setChoix(liste[Math.min(liste.length - 1, index + 1)]?.cle);
        if (k.name === 'return') agir(courante?.suggestion ? 'suggestion' : 'repondre');
        if (k.sequence === 'r') agir('repondre');
    });
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="? EN ATTENTE DE TOI" droite={`${liste.filter((s: any) => s.question).length} question(s) · ${liste.length} session(s)`} />
            <Boutons boutons={BOUTONS} agir={agir} />
            {reponse !== undefined ? (
                <box height={1} flexDirection="row">
                    <text fg={theme.accent}>{`Réponse à ${courante?.nom} : `}</text>
                    <input flexGrow={1} focused value={reponse} onInput={setReponse} onSubmit={(v: unknown) => { if (typeof v === 'string') envoyer(v); }} />
                    <text fg="gray">  Entrée envoyer · Échap annuler</text>
                </box>
            ) : <text fg="gray">Entrée = envoyer la suggestion (ou répondre) · r répondre · Échap fermer</text>}
            <text> </text>
            {!liste.length && <text fg="#4ade80">  ✓ Aucune session n'attend de réponse</text>}
            <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {liste.map((s: any) => {
                    const actif = s === courante;
                    const bord = <span fg={actif ? theme.accent : fond.bordure}>{actif ? '▌ ' : '  '}</span>;
                    const act = d.activites.get(s.sessionId);
                    return (
                        <box key={s.cle} flexDirection="column" flexShrink={0} marginBottom={1} onMouseDown={() => setChoix(s.cle)}>
                            <text truncate>
                                {bord}<span fg={couleurProjet(s.nom)}>● </span><span attributes={GRAS}>{s.nom}</span>
                                <span fg="gray">{`  ${s.titre ?? ''}${act?.date ? ` · il y a ${ilYa(act.date)}` : ''}`}</span>
                            </text>
                            <text wrapMode="word" fg={s.question ? '#fb923c' : 'gray'}>
                                {bord}{`  ? ${s.question ?? (s.statut === 'bloquee' ? 'attend une permission : « Voir la conversation » puis Rejoindre' : 'a fini et t\'attend')}`}
                            </text>
                            <text truncate>
                                {bord}{s.suggestion ? <span fg={theme.secondaire}>{`  ↵ suggestion : ${s.suggestion}`}</span> : <span fg="gray">  (pas de suggestion)</span>}
                            </text>
                        </box>
                    );
                })}
            </scrollbox>
        </box>
    );
}

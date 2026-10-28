import * as path from 'path';
import { useEffect, useRef, useState } from 'react';
import { GRAS, couper } from './style.ts';
import { modificationsSession } from '../dist/modifications.js';
import { ilYa } from '../dist/ui/Panneau.js';
import { theme, fond } from '../dist/theme.js';

// Diff en direct : la dernière modification de fichier de la session, sous sa conversation.
// Quand Claude modifie un fichier, les lignes retirées apparaissent en rouge puis pâlissent, et les nouvelles s'écrivent en vert.

type Ligne = { t: string; type: '-' | '+' | ' ' };

// Avant / après d'un Edit : on retire les lignes communes au début et à la fin (on en garde une de contexte)
export function lignesDiff(avant: string, apres: string): Ligne[] {
    const a = avant ? avant.split('\n') : [];
    const b = apres ? apres.split('\n') : [];
    let debut = 0;
    while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
    let fin = 0;
    while (fin < a.length - debut && fin < b.length - debut && a[a.length - 1 - fin] === b[b.length - 1 - fin]) fin++;
    const contexteAvant = debut > 0 ? [{ t: a[debut - 1], type: ' ' as const }] : [];
    const contexteApres = fin > 0 ? [{ t: a[a.length - fin], type: ' ' as const }] : [];
    return [
        ...contexteAvant,
        ...a.slice(debut, a.length - fin).map((t) => ({ t, type: '-' as const })),
        ...b.slice(debut, b.length - fin).map((t) => ({ t, type: '+' as const })),
        ...contexteApres,
    ];
}

const DUREE_ROUGE = 450;           // ms : les lignes retirées s'affichent
const VITESSE = 900;               // caractères ajoutés par seconde (2 s au plus)
const RECENTE = 10 * 60_000;       // au-delà, le panneau se cache (sauf si la session travaille)

export function DiffDirect({ s, largeur, lignesMax = 8 }: { s: any; largeur: number; lignesMax?: number }) {
    const [derniere, setDerniere] = useState(() => modificationsSession(s.fichier).derniere);
    const [, setFrame] = useState(0);
    const debutAnim = useRef(0);
    const vue = useRef<string>();
    // Relu chaque seconde (lecture incrémentale : seulement ce qui a été ajouté au transcript)
    useEffect(() => {
        const lire = () => setDerniere(modificationsSession(s.fichier).derniere);
        const t = setInterval(lire, 1000);
        return () => clearInterval(t);
    }, [s.fichier]);
    // Une nouvelle modification (récente) : on lance l'animation
    if (derniere && derniere.cle !== vue.current) {
        vue.current = derniere.cle;
        debutAnim.current = Date.now() - derniere.date < 30_000 ? Date.now() : 0;
    }
    const lignes = derniere ? lignesDiff(derniere.avant, derniere.apres) : [];
    const ajoutes = lignes.filter((l) => l.type === '+').reduce((n, l) => n + l.t.length + 1, 0);
    const duree = DUREE_ROUGE + Math.min(2000, (ajoutes / VITESSE) * 1000);
    const ecoule = debutAnim.current ? Date.now() - debutAnim.current : Infinity;
    const anime = ecoule < duree;
    useEffect(() => {
        if (!anime) return;
        const t = setTimeout(() => setFrame((f) => f + 1), 40);
        return () => clearTimeout(t);
    });
    if (!derniere || (Date.now() - derniere.date > RECENTE && s.statut !== 'travaille')) return null;

    // Combien de caractères verts sont déjà « tapés »
    let budget = ecoule < DUREE_ROUGE ? 0 : Math.floor(((ecoule - DUREE_ROUGE) / 1000) * VITESSE);
    if (!anime) budget = Infinity;
    const visibles = lignes.slice(0, lignesMax);
    const largeurTexte = largeur - 6;
    return (
        <box flexShrink={0} flexDirection="column" border={['top']} borderColor={fond.bordure} paddingLeft={1}>
            <text truncate>
                <span fg={anime ? theme.accent : theme.secondaire} attributes={GRAS}>{anime ? '✎ ' : '± '}</span>
                <span fg={fond.texte} attributes={GRAS}>{path.basename(derniere.chemin)}</span>
                <span fg="gray">{`  ${derniere.outil} · ${ilYa(new Date(derniere.date))}`}</span>
                {lignes.length > lignesMax && <span fg={fond.discret}>{`  · ${lignes.length - lignesMax} ligne(s) de plus`}</span>}
            </text>
            {visibles.map((l, i) => {
                if (l.type === ' ') return <text key={i} fg={fond.discret} truncate>{`  ${couper(l.t, largeurTexte)}`}</text>;
                if (l.type === '-') {
                    // Rouge vif le temps de l'animation, puis pâle (la nouvelle version prend la place)
                    const vif = anime && ecoule < DUREE_ROUGE * 2;
                    return <text key={i} fg={vif ? '#f87171' : '#7f1d1d'} bg={vif ? '#2a0f12' : undefined} truncate>{`- ${couper(l.t, largeurTexte)}`}</text>;
                }
                // Les lignes pas encore atteintes n'apparaissent pas ; le curseur est sur celle qui s'écrit
                if (anime && budget < 0) return null;
                const montre = Math.max(0, Math.min(l.t.length, budget));
                budget -= l.t.length + 1;
                const curseur = anime && budget < 0;
                return (
                    <text key={i} fg="#4ade80" bg={anime ? '#0f2a17' : undefined} truncate>
                        {`+ ${couper(l.t.slice(0, montre), largeurTexte)}`}
                        {curseur && <span fg={fond.texte} bg={theme.accent}> </span>}
                    </text>
                );
            })}
        </box>
    );
}

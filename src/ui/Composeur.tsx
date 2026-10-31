import { useEffect, useState } from 'react';
import { Text, useInput } from 'ink';
import { hauteurComposeur } from './contexteProjet.js';

// Édition Ink de secours : le collage conserve les lignes, Entrée envoie,
// Ctrl+J ou Maj+Entrée ajoute une ligne. Aucun passage par un shell/éditeur externe.
export function Composeur({ value, onChange, onSubmit, focus = true, placeholder = '' }: {
    value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; focus?: boolean; placeholder?: string;
}) {
    const [position, setPosition] = useState(value.length);
    useEffect(() => { setPosition((p) => Math.min(p, value.length)); }, [value]);
    useInput((input, key) => {
        if (key.escape || key.tab || (key.ctrl && input !== 'j')) return;
        const inserer = (texte: string) => { onChange(value.slice(0, position) + texte + value.slice(position)); setPosition(position + texte.length); };
        if ((key.return && key.shift) || (key.ctrl && input === 'j')) return inserer('\n');
        if (key.return && input.length <= 1) return onSubmit(value);
        if (key.leftArrow) return setPosition(Math.max(0, position - 1));
        if (key.rightArrow) return setPosition(Math.min(value.length, position + 1));
        if (key.upArrow || key.downArrow) {
            if (!value.includes('\n')) return;
            const debut = value.lastIndexOf('\n', position - 1) + 1, colonne = position - debut;
            if (key.upArrow && debut > 0) { const avant = value.lastIndexOf('\n', debut - 2) + 1; setPosition(Math.min(debut - 1, avant + colonne)); }
            if (key.downArrow) { const fin = value.indexOf('\n', position); if (fin >= 0) { const suite = value.indexOf('\n', fin + 1); setPosition(Math.min(suite < 0 ? value.length : suite, fin + 1 + colonne)); } }
            return;
        }
        if (key.backspace || key.delete) { if (position) { onChange(value.slice(0, position - 1) + value.slice(position)); setPosition(position - 1); } return; }
        if (input) inserer(input.replace(/\r\n?/g, '\n'));
    }, { isActive: focus });
    const avant = value.slice(0, position), ligne = avant.split('\n').length - 1, hauteur = hauteurComposeur(value);
    const debut = Math.max(0, ligne - hauteur + 1), lignes = value.split('\n');
    if (!value) return <Text dimColor>{placeholder} · Ctrl+J : nouvelle ligne</Text>;
    const visibles = lignes.slice(debut, debut + hauteur);
    const colonne = avant.length - avant.lastIndexOf('\n') - 1;
    return <Text>{visibles.map((texte, i) => <Text key={i}>{i > 0 ? '\n' : ''}{focus && debut + i === ligne
        ? <><Text>{texte.slice(0, colonne)}</Text><Text inverse>{texte[colonne] || ' '}</Text><Text>{texte.slice(colonne + 1)}</Text></> : texte}</Text>)}</Text>;
}

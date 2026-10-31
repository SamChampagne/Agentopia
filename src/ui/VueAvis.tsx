import { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Text, useInput } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { historiqueAvis, heureAvis, texteAvis } from './avis.js';
import { useTailleVue, useClicsVue, LigneBoutons, Titre } from './Vues.js';
import { placerBoutons, boutonA } from './mise.js';
import { copier } from '../lanceurs.js';
import { theme } from '../theme.js';

export function VueAvis({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const liste = useSyncExternalStore(historiqueAvis.abonner, historiqueAvis.lire);
    const [choix, setChoix] = useState<number>();
    const [detail, setDetail] = useState(false), [offset, setOffset] = useState(0), [retour, setRetour] = useState('');
    const courant = liste.find((a) => a.id === choix) ?? liste[0];
    const index = Math.max(0, liste.findIndex((a) => a.id === courant?.id));
    const place = Math.max(1, hauteur - 4), debut = Math.max(0, index - place + 1);
    const lignes = courant ? wrapAnsi(texteAvis(courant), Math.max(10, largeur - 2), { hard: true }).split('\n') : [];
    const boutons = placerBoutons([{ label: detail ? '← Liste' : '← Fermer', action: 'retour' }, { label: 'Copier (c)', action: 'copier' }, { label: 'Lire (Entrée)', action: 'lire' }], 0);
    useEffect(() => historiqueAvis.marquerLus(), []);
    function agir(action: string) {
        if (action === 'retour') return detail ? setDetail(false) : fermer();
        if (!courant) return;
        if (action === 'copier') { copier(texteAvis(courant)); setRetour('Copie demandée · texte complet.'); }
        if (action === 'lire') { setDetail(true); setOffset(0); setRetour(''); }
    }
    const defiler = (sens: number) => detail ? setOffset((v) => Math.max(0, Math.min(Math.max(0, lignes.length - place), v + sens))) : setChoix(liste[Math.max(0, Math.min(liste.length - 1, index + sens))]?.id);
    useInput((input, key) => {
        if (key.escape) return agir('retour');
        if (input === 'q') return fermer();
        if (input === 'c') return agir('copier');
        if (key.return) return agir('lire');
        if (key.upArrow) defiler(-1);
        if (key.downArrow) defiler(1);
        if (key.pageUp) defiler(-place);
        if (key.pageDown) defiler(place);
    });
    useClicsVue((x, y) => {
        if (y === 1) { const b = boutonA(boutons, x - 1); if (b) agir(b.action); }
        if (!detail && y >= 3 && liste[debut + y - 3]) { setChoix(liste[debut + y - 3].id); setDetail(true); setOffset(0); }
    }, (sens) => defiler(-sens));
    return <Box width={largeur} height={hauteur} flexDirection="column" paddingLeft={1}>
        <Titre texte="AVIS ET ERREURS" droite={`${liste.length} / 100`} />
        <LigneBoutons boutons={boutons} />
        <Text color="gray" wrap="truncate-end">{detail ? '↑↓ / Pg↑ Pg↓ défiler · c copier · Échap liste' : '↑↓ choisir · Entrée détail · c copier · Échap fermer'}</Text>
        <Box height={place} flexDirection="column" overflow="hidden">
            {!liste.length && <Text color="gray">Aucun avis pour ce lancement.</Text>}
            {detail ? lignes.slice(offset, offset + place).map((ligne, i) => <Text key={i}>{ligne}</Text>) : liste.slice(debut, debut + place).map((a) =>
                <Text key={a.id} color={a.id === courant?.id ? theme.accent : undefined} wrap="truncate-end">{`${a.id === courant?.id ? '❯' : ' '} ${heureAvis(a.derniereDate)}${a.repetitions > 1 ? ` ×${a.repetitions}` : ''} · ${a.texte.replace(/\s+/g, ' ')}`}</Text>)}
        </Box>
        <Text color="gray" wrap="truncate-end">{retour || 'Mémoire de ce lancement · aucune sauvegarde sur disque'}</Text>
    </Box>;
}

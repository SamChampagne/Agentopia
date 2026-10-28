import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDonnees, rafraichirDocker } from './donnees.js';
import { bus } from './bus.js';
import { useTailleVue, useClicsVue, LigneBoutons, Separateur, Titre } from './Vues.js';
import { placerBoutons, boutonA } from './mise.js';
import { passerLaMain } from './ecran.js';
import { Conteneur, Hote, grouperConteneurs, portsCourts, actionConteneur, commandeInteractive } from '../docker.js';
import { theme, fond } from '../theme.js';

type Ligne =
    | { type: 'hote'; hote: Hote }
    | { type: 'groupe'; nom: string; dossier?: string; enMarche: number; total: number }
    | { type: 'conteneur'; c: Conteneur; hote: Hote };

const BOUTONS = [
    { label: '▶ Démarrer', action: 'start' },
    { label: '■ Arrêter', action: 'stop' },
    { label: '↻ Redémarrer', action: 'restart' },
    { label: '≡ Logs', action: 'logs' },
    { label: '◉ Surveiller', action: 'surveiller' },
    { label: '❯ Shell', action: 'shell' },
    { label: '✕ Fermer', action: 'fermer' },
];

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, n - 2) + '… ' : s.padEnd(n));

export function VueDocker({ fermer }: { fermer: () => void }) {
    const d = useDonnees();
    const { largeur, hauteur } = useTailleVue();
    const [choix, setChoix] = useState<string>();          // id du conteneur sélectionné
    const [message, setMessage] = useState('');
    const [debut, setDebut] = useState(0);

    // Liste à plat : hôte › projet compose › conteneurs
    const lignes: Ligne[] = [];
    for (const h of d.docker) {
        lignes.push({ type: 'hote', hote: h });
        for (const g of grouperConteneurs(h.conteneurs)) {
            lignes.push({ type: 'groupe', nom: g.nom, dossier: g.dossier, enMarche: g.conteneurs.filter((x) => x.enMarche).length, total: g.conteneurs.length });
            g.conteneurs.forEach((c) => lignes.push({ type: 'conteneur', c, hote: h }));
        }
    }
    const conteneurs = lignes.filter((l): l is Extract<Ligne, { type: 'conteneur' }> => l.type === 'conteneur');
    const courant = conteneurs.find((l) => l.c.id === choix) ?? conteneurs[0];
    const indexCourant = lignes.findIndex((l) => l.type === 'conteneur' && l.c.id === courant?.c.id);

    const zone = hauteur - 4;   // titre, boutons, séparateur, ligne de message
    // Fenêtre visible : on part du décalage mémorisé, puis on la déplace juste assez pour montrer la sélection
    let debutFenetre = Math.max(0, Math.min(debut, lignes.length - zone));
    if (indexCourant >= 0 && indexCourant < debutFenetre) debutFenetre = indexCourant;
    if (indexCourant >= debutFenetre + zone) debutFenetre = indexCourant - zone + 1;
    const fenetre = lignes.slice(debutFenetre, debutFenetre + zone);
    if (debutFenetre !== debut) setTimeout(() => setDebut(debutFenetre), 0);

    const boutons = placerBoutons(BOUTONS, 0);
    const actifs = new Set(['fermer', ...(courant ? (courant.c.enMarche ? ['stop', 'restart', 'logs', 'shell', 'surveiller'] : ['start', 'logs']) : [])]);

    async function agir(action: string) {
        if (action === 'fermer') return fermer();
        if (!courant || !actifs.has(action)) return;
        const { c, hote } = courant;
        if (action === 'surveiller') {
            fermer();
            return void bus.emit('lancer', `/surveiller-logs ${c.id}`);
        }
        if (action === 'logs' || action === 'shell') {
            const [programme, args] = commandeInteractive(action, c.id, hote.serveur);
            void passerLaMain(programme, args);
            return;
        }
        setMessage(`${action === 'start' ? 'Démarrage' : action === 'stop' ? 'Arrêt' : 'Redémarrage'} de ${c.nom}…`);
        const res = await actionConteneur(action as 'start' | 'stop' | 'restart', c.id, hote.serveur);
        setMessage(res.ok ? `✓ ${c.nom} : ${action === 'start' ? 'démarré' : action === 'stop' ? 'arrêté' : 'redémarré'}` : `✕ ${res.sortie.split('\n')[0]}`);
        rafraichirDocker();
    }

    const deplacer = (pas: number) => {
        const i = conteneurs.findIndex((l) => l.c.id === courant?.c.id);
        const j = Math.max(0, Math.min(conteneurs.length - 1, i + pas));
        if (conteneurs[j]) setChoix(conteneurs[j].c.id);
    };

    useClicsVue((x, y) => {
        if (y === 1) {
            const b = boutonA(boutons, x);
            if (b) agir(b.action);
            return;
        }
        const l = fenetre[y - 3];
        if (l?.type === 'conteneur') setChoix(l.c.id);
    }, (sens) => deplacer(-sens));

    useInput((input, key) => {
        if (key.escape || input === 'q') return fermer();
        if (key.upArrow) deplacer(-1);
        if (key.downArrow) deplacer(1);
        if (key.return) agir('logs');
        if (input === 's') agir(courant?.c.enMarche ? 'stop' : 'start');
        if (input === 'r') agir('restart');
    });

    const enMarche = d.docker.reduce((n, h) => n + h.conteneurs.filter((x) => x.enMarche).length, 0);
    const total = d.docker.reduce((n, h) => n + h.conteneurs.length, 0);

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="DOCKER" droite={d.docker.length ? `${enMarche} en marche · ${total} conteneurs` : 'lecture…'} />
            <LigneBoutons boutons={boutons} actifs={actifs} />
            <Separateur largeur={largeur - 2} />
            <Box flexDirection="column" height={zone} overflow="hidden">
                {fenetre.map((l, i) => {
                    if (l.type === 'hote') {
                        return (
                            <Box key={`h${i}`} height={1}>
                                <Text bold color={theme.accent}>{l.hote.serveur ? `⇄ ${l.hote.nom}` : '◉ Ce poste'}</Text>
                                {l.hote.erreur ? <Text color="#f87171">{`  ✕ ${l.hote.erreur}`}</Text> : null}
                            </Box>
                        );
                    }
                    if (l.type === 'groupe') {
                        return (
                            <Box key={`g${i}`} height={1} overflow="hidden">
                                <Text wrap="truncate-end">
                                    {'  '}<Text bold color={l.enMarche ? '#4ade80' : 'gray'}>{l.nom}</Text>
                                    <Text color="gray">{`  ${l.enMarche}/${l.total} en marche${l.dossier ? `  ·  ${l.dossier}` : ''}`}</Text>
                                </Text>
                            </Box>
                        );
                    }
                    const c = l.c;
                    const actif = c.id === courant?.c.id;
                    const etat = c.enMarche ? (c.sante === 'unhealthy' ? '#facc15' : '#4ade80') : fond.eteint;
                    return (
                        <Box key={c.id + l.hote.nom} height={1} overflow="hidden">
                            <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                                <Text color={actif ? theme.accent : 'gray'}>{actif ? '  ❯ ' : '    '}</Text>
                                <Text color={etat}>● </Text>
                                {ajuste(c.service ?? c.nom, 22)}
                                <Text color="gray">{ajuste(c.image, 24)}</Text>
                                <Text color={theme.accent}>{ajuste(portsCourts(c.ports), 12)}</Text>
                                <Text color={c.enMarche ? theme.secondaire : 'gray'}>{ajuste(c.enMarche ? `${c.cpu ?? ''} ${c.memoire ?? ''}`.trim() : '', 20)}</Text>
                                <Text color="gray">{c.sante ? `${c.sante} · ` : ''}{c.statut}</Text>
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Box height={1} overflow="hidden">
                <Text color={message.startsWith('✕') ? '#f87171' : message.startsWith('✓') ? '#4ade80' : 'gray'} wrap="truncate-end">
                    {message || 'clic = choisir · ↑↓ · Entrée logs · s démarrer/arrêter · r redémarrer · Échap fermer · /docker distant <serveur>'}
                </Text>
            </Box>
        </Box>
    );
}

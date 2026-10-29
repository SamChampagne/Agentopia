import { citerArgument } from '../ligneCommande.js';
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, LigneBoutons, Separateur, Titre } from './Vues.js';
import { placerBoutons, boutonA } from './mise.js';
import { ilYa } from './Panneau.js';
import { bus } from './bus.js';
import { Depot, DepotDistant, pousser, tirer, commitsAPousser, etatPR } from '../git.js';
import { lireSynchro, synchro, fetchMaintenant, relireProjet } from '../synchro.js';
import { jetonsConfigures } from '../jetons.js';
import { lancerDetache } from '../lanceurs.js';
import { theme, couleurProjet, fond } from '../theme.js';

const DETAIL = 6;   // lignes du panneau de détail en bas

type Ligne =
    | { type: 'local'; d: Depot }
    | { type: 'titre'; texte: string }
    | { type: 'distant'; r: DepotDistant };

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, n - 2) + '… ' : s.padEnd(n));

// Ce qui demande de l'attention d'abord : à tirer, à pousser, modifs ; puis le plus récent
const priorite = (d: Depot) => (d.retard ? 4 : 0) + (d.avance ? 2 : 0) + (d.modifs ? 1 : 0);

export function useSynchro() {
    const [, setV] = useState(0);
    useEffect(() => {
        const f = () => setV((v) => v + 1);
        synchro.on('maj', f);
        return () => {
            synchro.off('maj', f);
        };
    }, []);
    return lireSynchro();
}

export function VueGit({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const s = useSynchro();
    const [choix, setChoix] = useState<string>();
    const [message, setMessage] = useState('');
    const [aConfirmer, setAConfirmer] = useState<string>();
    const [aPousser, setAPousser] = useState<string[]>([]);
    const jetons = jetonsConfigures();

    const locaux = [...s.depots].sort((a, b) => priorite(b) - priorite(a)
        || (b.dernierCommit?.date.getTime() ?? 0) - (a.dernierCommit?.date.getTime() ?? 0));
    const lignes: Ligne[] = [
        ...locaux.map((d): Ligne => ({ type: 'local', d })),
        ...(s.nonClones.length ? [{ type: 'titre', texte: `PAS ENCORE SUR CE POSTE (${s.nonClones.length})` } as Ligne] : []),
        ...[...s.nonClones].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)).map((r): Ligne => ({ type: 'distant', r })),
    ];
    const cle = (l: Ligne) => (l.type === 'local' ? l.d.projet.chemin : l.type === 'distant' ? l.r.url : '');
    const choisissables = lignes.filter((l) => l.type !== 'titre');
    const courant = choisissables.find((l) => cle(l) === choix) ?? choisissables[0];
    const index = Math.max(0, lignes.indexOf(courant));
    const zone = Math.max(3, hauteur - 4 - DETAIL);
    const premier = Math.max(0, Math.min(index - Math.floor(zone / 2), lignes.length - zone));
    const visibles = lignes.slice(premier, premier + zone);
    const local = courant?.type === 'local' ? courant.d : undefined;
    const distant = courant?.type === 'distant' ? courant.r : undefined;

    useEffect(() => {
        if (local) commitsAPousser(local).then(setAPousser);
        else setAPousser([]);
    }, [local?.projet.chemin, local?.avance]);

    const boutons = placerBoutons([
        { label: '↻ Fetch tout', action: 'fetch' },
        { label: '⇡ Pousser', action: 'push' },
        { label: '⇣ Tirer', action: 'pull' },
        { label: '⤓ Cloner', action: 'clone' },
        { label: '◷ PR', action: 'pr' },
        { label: '✎ Corriger la revue', action: 'pr-corriger' },
        { label: '↯ Réparer la CI', action: 'ci' },
        { label: '⧉ Web', action: 'web' },
        { label: '⚿ Jetons', action: 'jetons' },
        { label: '✕ Fermer', action: 'fermer' },
    ], 0);
    const actifs = new Set(['fetch', 'fermer', 'jetons',
        ...(local?.avance || (local && !local.amont && local.remote) ? ['push'] : []),
        ...(local?.retard ? ['pull'] : []),
        ...(distant ? ['clone', 'web'] : []),
        ...(local?.pagePR ? ['pr'] : []), ...(local?.web ? ['web'] : []),
        // GitHub : Claude corrige les commentaires d'une PR, ou répare le pipeline en échec
        ...(local?.hebergeur === 'GitHub' && local.prs?.length ? ['pr-corriger'] : []), ...(local?.hebergeur === 'GitHub' ? ['ci'] : [])]);

    async function agir(action: string) {
        if (action === 'fermer') return fermer();
        if (!actifs.has(action)) return;
        if (action === 'pr-corriger' || action === 'ci') {
            fermer();
            return void bus.emit('lancer', `/${action === 'ci' ? 'ci-reparer' : 'pr-corriger'} ${citerArgument(local!.projet.chemin)}`);
        }
        if (action === 'fetch') {
            setMessage('git fetch sur tous les dépôts…');
            const erreurs = await fetchMaintenant((n) => setMessage(`git fetch… ${n} dépôt(s)`));
            setMessage(erreurs.length ? `✕ ${erreurs.length} échec(s) : ${erreurs[0]}` : '✓ Tous les dépôts sont à jour avec leur remote');
        }
        if (action === 'jetons' || action === 'clone') {
            fermer();
            bus.emit('lancer', action === 'jetons' ? ['/jetons', '/git'] : [`/cloner ${distant!.url}`, '/git']);
            return;
        }
        if (action === 'web') lancerDetache('start', ['', (distant?.web ?? local?.web)!]);
        if (!local) return;
        if (action === 'push') {
            if (aConfirmer !== local.projet.chemin) {
                setAConfirmer(local.projet.chemin);
                setMessage(`Clique encore sur « Pousser » pour envoyer ${local.avance || 'la branche'} commit(s) de ${local.branche} vers ${local.amont ?? 'origin'}`);
                return;
            }
            setAConfirmer(undefined);
            setMessage(`git push ${local.projet.nom}…`);
            const res = await pousser(local);
            await relireProjet(local.projet.chemin);
            setMessage(res.ok ? `✓ ${local.projet.nom} poussé` : `✕ ${res.sortie.split('\n')[0]}`);
        }
        if (action === 'pull') {
            setMessage(`git pull ${local.projet.nom}…`);
            const res = await tirer(local);
            await relireProjet(local.projet.chemin);
            setMessage(res.ok ? `✓ ${local.projet.nom} à jour` : `✕ ${res.sortie.split('\n')[0]}`);
        }
        if (action === 'pr' && local.pagePR) lancerDetache('start', ['', local.pagePR]);
    }

    const choisir = (l?: Ligne) => {
        if (!l || l.type === 'titre') return;
        setChoix(cle(l));
        setAConfirmer(undefined);
        setMessage('');
    };
    const deplacer = (pas: number) => {
        const i = choisissables.indexOf(courant);
        choisir(choisissables[Math.max(0, Math.min(choisissables.length - 1, i + pas))]);
    };

    useClicsVue((x, y) => {
        if (y === 1) {
            const b = boutonA(boutons, x);
            if (b) agir(b.action);
            return;
        }
        choisir(visibles[y - 3]);
    }, (sens) => deplacer(-sens));

    useInput((input, key) => {
        if (key.escape || input === 'q') return fermer();
        if (key.upArrow) deplacer(-1);
        if (key.downArrow) deplacer(1);
        if (input === 'f') agir('fetch');
        if (input === 'p') agir('push');
        if (input === 'l') agir('pull');
        if (input === 'c' && distant) agir('clone');
    });

    const total = (f: (d: Depot) => boolean) => s.depots.filter(f).length;
    const resume = !s.pret ? 'lecture des dépôts…'
        : `${s.depots.length} dépôts · ${total((d) => d.retard > 0)} à tirer · ${total((d) => d.avance > 0)} à pousser · ${total((d) => d.modifs > 0)} modifiés`
            + ` · ${s.activite || (s.dernierFetch ? `fetch il y a ${ilYa(s.dernierFetch)}` : 'synchro en direct')}`;

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="GIT" droite={resume} />
            <LigneBoutons boutons={boutons} actifs={actifs} />
            <Separateur largeur={largeur - 2} />
            <Box flexDirection="column" height={zone} overflow="hidden">
                {visibles.map((l, i) => {
                    if (l.type === 'titre') {
                        return <Box key={`t${i}`} height={1}><Text bold color={theme.primaire}>{`  ${l.texte}`}</Text></Box>;
                    }
                    const actif = l === courant;
                    if (l.type === 'distant') {
                        return (
                            <Box key={l.r.url} height={1} overflow="hidden">
                                <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                                    <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                                    <Text color={fond.eteint}>☁ </Text>
                                    {ajuste(l.r.nom, 34)}
                                    <Text color="gray">{ajuste(l.r.hebergeur, 14)}</Text>
                                    <Text color="gray">{l.r.date ? `activité il y a ${ilYa(l.r.date)}` : ''}</Text>
                                </Text>
                            </Box>
                        );
                    }
                    const d = l.d;
                    const couleur = !d.remote || !d.amont ? fond.eteint : d.retard ? '#f87171' : d.avance || d.modifs ? '#facc15' : '#4ade80';
                    const etat = [d.retard ? `↓${d.retard}` : '', d.avance ? `↑${d.avance}` : '', d.modifs ? `✎${d.modifs}` : '',
                        !d.remote ? 'local' : !d.amont ? 'pas suivie' : ''].filter(Boolean).join(' ') || 'à jour';
                    return (
                        <Box key={d.projet.chemin} height={1} overflow="hidden">
                            <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                                <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                                <Text color={couleur}>● </Text>
                                <Text color={couleurProjet(d.projet.nom)}>{ajuste(d.projet.nom, 24)}</Text>
                                <Text color={theme.secondaire}>{ajuste(`⎇ ${d.branche}`, 30)}</Text>
                                <Text color={couleur}>{ajuste(etat, 14)}</Text>
                                <Text color={d.prs?.length ? theme.accent : 'gray'}>{ajuste(d.prs?.length ? `${d.prs.length} PR` : '', 6)}</Text>
                                <Text color="gray">{d.dernierCommit ? `il y a ${ilYa(d.dernierCommit.date)} · ${d.dernierCommit.sujet}` : ''}</Text>
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Separateur largeur={largeur - 2} />
            <Box flexDirection="column" height={DETAIL - 1} overflow="hidden">
                {distant && (
                    <>
                        <Text wrap="truncate-end"><Text bold>{distant.nom}</Text><Text color="gray">{`  ${distant.hebergeur}${distant.prive ? ' · privé' : ''}`}</Text></Text>
                        <Text wrap="truncate-end" color="gray">{distant.url}</Text>
                        <Text color="#facc15">Pas encore cloné sur ce poste · « ⤓ Cloner » (ou c) le télécharge dans un de tes dossiers de projets</Text>
                    </>
                )}
                {local && (
                    <>
                        <Text wrap="truncate-end">
                            <Text bold>{local.projet.nom}</Text>
                            <Text color="gray">{`  ${local.hebergeur ?? 'sans remote'}  ·  ${local.web ?? local.projet.chemin}`}</Text>
                        </Text>
                        <Text wrap="truncate-end" color="gray">
                            {`⎇ ${local.branche} → ${local.amont ?? 'aucune branche distante suivie'}`}
                            {local.dernierFetch ? `  ·  fetch il y a ${ilYa(local.dernierFetch)}` : '  ·  jamais fetché'}
                        </Text>
                        <Text wrap="truncate-end">
                            <Text color="gray">À pousser : </Text>
                            {aPousser.length ? <Text color="#facc15">{aPousser.slice(0, 3).join('  ·  ')}</Text> : <Text color="gray">rien</Text>}
                        </Text>
                        <Text wrap="truncate-end">
                            <Text color="gray">Pull requests : </Text>
                            {local.prs?.length
                                ? <Text color={theme.accent}>{local.prs.slice(0, 3).map((p) => `#${p.numero} ${p.titre} (${p.auteur}${p.brouillon ? ', brouillon' : ''})`).join('  ·  ')}</Text>
                                : !local.hebergeur || !['GitHub', 'Azure DevOps', 'GitLab'].includes(local.hebergeur)
                                    ? <Text color="gray">« ◷ PR » ouvre la page du dépôt</Text>
                                    : !jetons.includes(local.hebergeur as never)
                                        ? <Text color="gray">{`ajoute un jeton ${local.hebergeur} (⚿ Jetons) : PR et nouveaux dépôts visibles ici`}</Text>
                                        : etatPR[local.hebergeur as 'GitHub'] && etatPR[local.hebergeur as 'GitHub'] !== 'ok'
                                            ? <Text color="#f87171">{`${local.hebergeur} : ${etatPR[local.hebergeur as 'GitHub']} (⚿ Jetons pour le remplacer)`}</Text>
                                            : <Text color="gray">aucune ouverte</Text>}
                        </Text>
                    </>
                )}
            </Box>
            <Box height={1} overflow="hidden">
                <Text color={message.startsWith('✕') ? '#f87171' : message.startsWith('✓') ? '#4ade80' : message ? '#facc15' : 'gray'} wrap="truncate-end">
                    {message || 'synchro en direct · clic = choisir · ↑↓ · f fetch · p pousser · l tirer · c cloner · Échap fermer'}
                </Text>
            </Box>
        </Box>
    );
}

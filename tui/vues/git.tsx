import { useEffect, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS, couper } from '../style.ts';
import { Titre, Boutons } from './commun.tsx';
import { ilYa } from '../../dist/ui/Panneau.js';
import { bus } from '../../dist/ui/bus.js';
import { pousser, tirer, commitsAPousser, etatPR } from '../../dist/git.js';
import { lireSynchro, synchro, fetchMaintenant, relireProjet } from '../../dist/synchro.js';
import { jetonsConfigures } from '../../dist/jetons.js';
import { lancerDetache } from '../../dist/lanceurs.js';
import { theme, couleurProjet, fond } from '../../dist/theme.js';

// Git : tous les dépôts (ce qui demande de l'attention d'abord), ceux pas encore clonés, et le détail du choisi en bas
const BOUTONS = [
    { label: '↻ Fetch tout', action: 'fetch' }, { label: '⇡ Pousser', action: 'push' }, { label: '⇣ Tirer', action: 'pull' },
    { label: '⤓ Cloner', action: 'clone' }, { label: '◷ PR', action: 'pr' }, { label: '✎ Corriger la revue', action: 'pr-corriger' },
    { label: '↯ Réparer la CI', action: 'ci' }, { label: '⧉ Web', action: 'web' }, { label: '⚿ Jetons', action: 'jetons' },
    { label: '✕ Fermer', action: 'fermer' },
];
const priorite = (d: any) => (d.retard ? 4 : 0) + (d.avance ? 2 : 0) + (d.modifs ? 1 : 0);
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);

export function useSynchro() {
    const [, setV] = useState(0);
    useEffect(() => {
        const f = () => setV((v) => v + 1);
        synchro.on('maj', f);
        return () => void synchro.off('maj', f);
    }, []);
    return lireSynchro();
}

export function VueGit({ fermer }: { fermer: () => void }) {
    const s = useSynchro();
    const [choix, setChoix] = useState<string>();
    const [survol, setSurvol] = useState<string>();
    const [message, setMessage] = useState('');
    const [aConfirmer, setAConfirmer] = useState<string>();
    const [aPousser, setAPousser] = useState<string[]>([]);
    const jetons = jetonsConfigures();

    const locaux = [...s.depots].sort((a: any, b: any) => priorite(b) - priorite(a)
        || (b.dernierCommit?.date.getTime() ?? 0) - (a.dernierCommit?.date.getTime() ?? 0));
    const lignes: any[] = [
        ...locaux.map((d) => ({ type: 'local', d })),
        ...(s.nonClones.length ? [{ type: 'titre', texte: `PAS ENCORE SUR CE POSTE (${s.nonClones.length})` }] : []),
        ...[...s.nonClones].sort((a: any, b: any) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)).map((r) => ({ type: 'distant', r })),
    ];
    const cle = (l: any) => (l.type === 'local' ? l.d.projet.chemin : l.type === 'distant' ? l.r.url : '');
    const choisissables = lignes.filter((l) => l.type !== 'titre');
    const courant = choisissables.find((l) => cle(l) === choix) ?? choisissables[0];
    const local = courant?.type === 'local' ? courant.d : undefined;
    const distant = courant?.type === 'distant' ? courant.r : undefined;

    useEffect(() => {
        if (local) commitsAPousser(local).then(setAPousser);
        else setAPousser([]);
    }, [local?.projet.chemin, local?.avance]);

    const actifs = new Set(['fetch', 'fermer', 'jetons',
        ...(local?.avance || (local && !local.amont && local.remote) ? ['push'] : []),
        ...(local?.retard ? ['pull'] : []),
        ...(distant ? ['clone', 'web'] : []),
        ...(local?.pagePR ? ['pr'] : []), ...(local?.web ? ['web'] : []),
        ...(local?.hebergeur === 'GitHub' && local.prs?.length ? ['pr-corriger'] : []), ...(local?.hebergeur === 'GitHub' ? ['ci'] : [])]);

    async function agir(action: string) {
        if (action === 'fermer') return fermer();
        if (!actifs.has(action)) return;
        if (action === 'pr-corriger' || action === 'ci') {
            fermer();
            return void bus.emit('lancer', `/${action === 'ci' ? 'ci-reparer' : 'pr-corriger'} ${local.projet.chemin}`);
        }
        if (action === 'fetch') {
            setMessage('git fetch sur tous les dépôts…');
            const erreurs = await fetchMaintenant((n: number) => setMessage(`git fetch… ${n} dépôt(s)`));
            setMessage(erreurs.length ? `✕ ${erreurs.length} échec(s) : ${erreurs[0]}` : '✓ Tous les dépôts sont à jour avec leur remote');
        }
        if (action === 'jetons' || action === 'clone') {
            fermer();
            return void bus.emit('lancer', action === 'jetons' ? ['/jetons', '/git'] : [`/cloner ${distant.url}`, '/git']);
        }
        if (action === 'web') lancerDetache('start', ['', distant?.web ?? local?.web]);
        if (!local) return;
        if (action === 'push') {
            // Pousser se confirme par un second clic : c'est la seule action qui modifie le dépôt distant
            if (aConfirmer !== local.projet.chemin) {
                setAConfirmer(local.projet.chemin);
                return setMessage(`Clique encore sur « Pousser » pour envoyer ${local.avance || 'la branche'} commit(s) de ${local.branche} vers ${local.amont ?? 'origin'}`);
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
    const choisir = (l?: any) => {
        if (!l || l.type === 'titre') return;
        setChoix(cle(l));
        setAConfirmer(undefined);
        setMessage('');
    };
    const deplacer = (pas: number) => {
        const i = choisissables.indexOf(courant);
        choisir(choisissables[Math.max(0, Math.min(choisissables.length - 1, i + pas))]);
    };
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') deplacer(-1);
        if (k.name === 'down') deplacer(1);
        if (k.sequence === 'f') void agir('fetch');
        if (k.sequence === 'p') void agir('push');
        if (k.sequence === 'l') void agir('pull');
        if (k.sequence === 'c' && distant) void agir('clone');
    });

    const total = (f: (d: any) => boolean) => s.depots.filter(f).length;
    const resume = !s.pret ? 'lecture des dépôts…'
        : `${s.depots.length} dépôts · ${total((d) => d.retard > 0)} à tirer · ${total((d) => d.avance > 0)} à pousser · ${total((d) => d.modifs > 0)} modifiés`
            + ` · ${s.activite || (s.dernierFetch ? `fetch il y a ${ilYa(s.dernierFetch)}` : 'synchro en direct')}`;
    const prs = () => {
        if (local.prs?.length) return <span fg={theme.accent}>{local.prs.slice(0, 3).map((p: any) => `#${p.numero} ${p.titre} (${p.auteur}${p.brouillon ? ', brouillon' : ''})`).join('  ·  ')}</span>;
        if (!local.hebergeur || !['GitHub', 'Azure DevOps', 'GitLab'].includes(local.hebergeur)) return <span fg="gray">« ◷ PR » ouvre la page du dépôt</span>;
        if (!jetons.includes(local.hebergeur)) return <span fg="gray">{`ajoute un jeton ${local.hebergeur} (⚿ Jetons) : PR et nouveaux dépôts visibles ici`}</span>;
        const e = etatPR[local.hebergeur];
        return e && e !== 'ok' ? <span fg="#f87171">{`${local.hebergeur} : ${e} (⚿ Jetons pour le remplacer)`}</span> : <span fg="gray">aucune ouverte</span>;
    };

    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="GIT" droite={resume} />
            <Boutons boutons={BOUTONS} actifs={actifs} agir={(a) => void agir(a)} />
            <text> </text>
            <scrollbox flexGrow={1} scrollY>
                {lignes.map((l, i) => {
                    if (l.type === 'titre') return <text key={`t${i}`} fg={theme.primaire} attributes={GRAS}>{`  ${l.texte}`}</text>;
                    const c = cle(l);
                    const actif = l === courant;
                    const fondLigne = actif ? fond.selection : survol === c ? fond.panneau : undefined;
                    const evenements = { onMouseOver: () => setSurvol(c), onMouseOut: () => setSurvol(undefined), onMouseDown: () => choisir(l) };
                    if (l.type === 'distant') {
                        return (
                            <box key={c} height={1} backgroundColor={fondLigne} {...evenements}>
                                <text truncate>
                                    <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                    <span fg={fond.eteint}>☁ </span><span>{colonne(l.r.nom, 34)}</span>
                                    <span fg="gray">{colonne(l.r.hebergeur, 14)}</span>
                                    <span fg="gray">{l.r.date ? `activité il y a ${ilYa(l.r.date)}` : ''}</span>
                                </text>
                            </box>
                        );
                    }
                    const d = l.d;
                    const couleur = !d.remote || !d.amont ? fond.eteint : d.retard ? '#f87171' : d.avance || d.modifs ? '#facc15' : '#4ade80';
                    const etat = [d.retard ? `↓${d.retard}` : '', d.avance ? `↑${d.avance}` : '', d.modifs ? `✎${d.modifs}` : '',
                        !d.remote ? 'local' : !d.amont ? 'pas suivie' : ''].filter(Boolean).join(' ') || 'à jour';
                    return (
                        <box key={c} height={1} backgroundColor={fondLigne} {...evenements}>
                            <text truncate>
                                <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                <span fg={couleur}>● </span>
                                <span fg={couleurProjet(d.projet.nom)}>{colonne(d.projet.nom, 24)}</span>
                                <span fg={theme.secondaire}>{colonne(`⎇ ${d.branche}`, 30)}</span>
                                <span fg={couleur}>{colonne(etat, 14)}</span>
                                <span fg={d.prs?.length ? theme.accent : 'gray'}>{colonne(d.prs?.length ? `${d.prs.length} PR` : '', 6)}</span>
                                <span fg="gray">{d.dernierCommit ? `il y a ${ilYa(d.dernierCommit.date)} · ${d.dernierCommit.sujet}` : ''}</span>
                            </text>
                        </box>
                    );
                })}
            </scrollbox>
            <box flexShrink={0} height={5} flexDirection="column" border={['top']} borderColor={fond.bordure}>
                {distant && (
                    <>
                        <text truncate><span attributes={GRAS}>{distant.nom}</span><span fg="gray">{`  ${distant.hebergeur}${distant.prive ? ' · privé' : ''}`}</span></text>
                        <text truncate fg="gray">{distant.url}</text>
                        <text fg="#facc15">Pas encore cloné sur ce poste · « ⤓ Cloner » (ou c) le télécharge dans un de tes dossiers de projets</text>
                    </>
                )}
                {local && (
                    <>
                        <text truncate><span attributes={GRAS}>{local.projet.nom}</span><span fg="gray">{`  ${local.hebergeur ?? 'sans remote'}  ·  ${local.web ?? local.projet.chemin}`}</span></text>
                        <text truncate fg="gray">
                            {`⎇ ${local.branche} → ${local.amont ?? 'aucune branche distante suivie'}${local.dernierFetch ? `  ·  fetch il y a ${ilYa(local.dernierFetch)}` : '  ·  jamais fetché'}`}
                        </text>
                        <text truncate><span fg="gray">À pousser : </span>{aPousser.length ? <span fg="#facc15">{aPousser.slice(0, 3).join('  ·  ')}</span> : <span fg="gray">rien</span>}</text>
                        <text truncate><span fg="gray">Pull requests : </span>{prs()}</text>
                    </>
                )}
            </box>
            <text truncate fg={message.startsWith('✕') ? '#f87171' : message.startsWith('✓') ? '#4ade80' : message ? '#facc15' : 'gray'}>
                {message || 'synchro en direct · clic = choisir · ↑↓ · f fetch · p pousser · l tirer · c cloner · Échap fermer'}
            </text>
        </box>
    );
}

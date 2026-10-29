import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS, couper } from '../style.ts';
import { useDonnees } from '../donnees.ts';
import { Titre, Boutons } from './commun.tsx';
import { bus } from '../../dist/ui/bus.js';
import { rafraichirDocker } from '../../dist/ui/donnees.js';
import { passerLaMain } from '../../dist/ui/ecran.js';
import { grouperConteneurs, portsCourts, actionConteneur, commandeInteractive } from '../../dist/docker.js';
import { theme, fond } from '../../dist/theme.js';

// Docker : hôtes › projets compose › conteneurs ; un conteneur choisi (clic, ↑↓) reçoit les actions des boutons
const BOUTONS = [
    { label: '▶ Démarrer', action: 'start' }, { label: '■ Arrêter', action: 'stop' }, { label: '↻ Redémarrer', action: 'restart' },
    { label: '≡ Logs', action: 'logs' }, { label: '◉ Surveiller', action: 'surveiller' }, { label: '❯ Shell', action: 'shell' },
    { label: '✕ Fermer', action: 'fermer' },
];
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);

export function VueDocker({ fermer }: { fermer: () => void }) {
    const d = useDonnees();
    const [choix, setChoix] = useState<string>();
    const [survol, setSurvol] = useState<string>();
    const [message, setMessage] = useState('');
    const lignes: any[] = [];
    for (const h of d.docker) {
        lignes.push({ type: 'hote', hote: h });
        for (const g of grouperConteneurs(h.conteneurs)) {
            lignes.push({ type: 'groupe', nom: g.nom, dossier: g.dossier, enMarche: g.conteneurs.filter((x: any) => x.enMarche).length, total: g.conteneurs.length });
            g.conteneurs.forEach((c: any) => lignes.push({ type: 'conteneur', c, hote: h }));
        }
    }
    const conteneurs = lignes.filter((l) => l.type === 'conteneur');
    const courant = conteneurs.find((l) => l.c.id === choix) ?? conteneurs[0];
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
            return void passerLaMain(programme, args);
        }
        if (action !== 'start' && action !== 'stop' && action !== 'restart') return;
        setMessage(`${action === 'start' ? 'Démarrage' : action === 'stop' ? 'Arrêt' : 'Redémarrage'} de ${c.nom}…`);
        const res = await actionConteneur(action, c.id, hote.serveur);
        setMessage(res.ok ? `✓ ${c.nom} : ${action === 'start' ? 'démarré' : action === 'stop' ? 'arrêté' : 'redémarré'}` : `✕ ${res.sortie.split('\n')[0]}`);
        rafraichirDocker();
    }
    const deplacer = (pas: number) => {
        const i = conteneurs.findIndex((l) => l.c.id === courant?.c.id);
        const j = Math.max(0, Math.min(conteneurs.length - 1, i + pas));
        if (conteneurs[j]) setChoix(conteneurs[j].c.id);
    };
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') deplacer(-1);
        if (k.name === 'down') deplacer(1);
        if (k.name === 'return') void agir('logs');
        if (k.sequence === 's') void agir(courant?.c.enMarche ? 'stop' : 'start');
        if (k.sequence === 'r') void agir('restart');
    });

    const enMarche = d.docker.reduce((n: number, h: any) => n + h.conteneurs.filter((x: any) => x.enMarche).length, 0);
    const total = d.docker.reduce((n: number, h: any) => n + h.conteneurs.length, 0);
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="DOCKER" droite={d.docker.length ? `${enMarche} en marche · ${total} conteneurs` : 'lecture…'} />
            <Boutons boutons={BOUTONS} actifs={actifs} agir={(a) => void agir(a)} />
            <text> </text>
            <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {lignes.map((l, i) => {
                    if (l.type === 'hote') {
                        return (
                            <text key={`h${i}`}>
                                <span fg={theme.accent} attributes={GRAS}>{l.hote.serveur ? `⇄ ${l.hote.nom}` : '◉ Ce poste'}</span>
                                {l.hote.erreur ? <span fg="#f87171">{`  ✕ ${l.hote.erreur}`}</span> : null}
                            </text>
                        );
                    }
                    if (l.type === 'groupe') {
                        return (
                            <text key={`g${i}`} truncate>
                                {'  '}<span fg={l.enMarche ? '#4ade80' : 'gray'} attributes={GRAS}>{l.nom}</span>
                                <span fg="gray">{`  ${l.enMarche}/${l.total} en marche${l.dossier ? `  ·  ${l.dossier}` : ''}`}</span>
                            </text>
                        );
                    }
                    const c = l.c;
                    const cle = c.id + l.hote.nom;
                    const actif = c.id === courant?.c.id;
                    const etat = c.enMarche ? (c.sante === 'unhealthy' ? '#facc15' : '#4ade80') : fond.eteint;
                    return (
                        <box key={cle} height={1} backgroundColor={actif ? fond.selection : survol === cle ? fond.panneau : undefined}
                            onMouseOver={() => setSurvol(cle)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => setChoix(c.id)}>
                            <text truncate>
                                <span fg={actif ? theme.accent : 'gray'}>{actif ? '  ❯ ' : '    '}</span>
                                <span fg={etat}>● </span>
                                <span>{colonne(c.service ?? c.nom, 22)}</span>
                                <span fg="gray">{colonne(c.image, 24)}</span>
                                <span fg={theme.accent}>{colonne(portsCourts(c.ports), 12)}</span>
                                <span fg={c.enMarche ? theme.secondaire : 'gray'}>{colonne(c.enMarche ? `${c.cpu ?? ''} ${c.memoire ?? ''}`.trim() : '', 20)}</span>
                                <span fg="gray">{`${c.sante ? `${c.sante} · ` : ''}${c.statut}`}</span>
                            </text>
                        </box>
                    );
                })}
                {!lignes.length && <text fg="gray">  lecture des conteneurs…</text>}
            </scrollbox>
            <text truncate fg={message.startsWith('✕') ? '#f87171' : message.startsWith('✓') ? '#4ade80' : 'gray'}>
                {message || 'clic = choisir · ↑↓ · Entrée logs · s démarrer/arrêter · r redémarrer · Échap fermer · /docker distant <serveur>'}
            </text>
        </box>
    );
}

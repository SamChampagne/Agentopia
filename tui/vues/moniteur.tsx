import * as os from 'os';
import { useEffect, useRef, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS, couper } from '../style.ts';
import { brancheGit } from '../../dist/projets.js';
import { instantane, arbre, cpuGroupe, cpuMachine, sessionsActives, fermerArbre, formatRam } from '../../dist/systeme.js';
import { serveursDev } from '../../dist/serveurs.js';
import { calculerUsage, formatTokens, sparkline, nomDossierClaude } from '../../dist/usage.js';
import { lancerDetache } from '../../dist/lanceurs.js';
import { theme, couleurProjet, fond } from '../../dist/theme.js';

// Moniteur : CPU et RAM du poste, sessions Claude (CPU, RAM, durée), serveurs de dev en écoute, usage sur 7 jours.
// Fermer une session ou arrêter un serveur demande une confirmation (o/n).
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);
const duree = (d: Date) => {
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
};

function Jauge({ pourcent, largeur = 24 }: { pourcent: number; largeur?: number }) {
    const plein = Math.round((Math.min(100, Math.max(0, pourcent)) / 100) * largeur);
    const couleur = pourcent > 85 ? '#f87171' : pourcent > 60 ? '#facc15' : '#4ade80';
    return <><span fg={couleur}>{'█'.repeat(plein)}</span><span fg="gray">{'░'.repeat(largeur - plein)}</span></>;
}

function Cadre({ titre, actif, children }: { titre: string; actif?: boolean; children: any }) {
    return (
        <box flexDirection="column" flexShrink={0} border borderStyle="rounded" borderColor={actif ? theme.accent : 'gray'} paddingLeft={1} paddingRight={1} marginTop={1}>
            <text fg={theme.primaire} attributes={GRAS}>{titre}</text>
            {children}
        </box>
    );
}

export function Moniteur({ projets, fermer }: { projets: any[]; fermer: () => void }) {
    const [lignes, setLignes] = useState<any[]>([]);
    const [serveurs, setServeurs] = useState<any[]>([]);
    const [usage, setUsage] = useState<any>();
    const [cpu, setCpu] = useState(0);
    const [charge, setCharge] = useState(false);
    const [section, setSection] = useState<'sessions' | 'ports'>('sessions');
    const [selection, setSelection] = useState(0);
    const [confirmation, setConfirmation] = useState<{ texte: string; pid: number }>();
    const [, setTic] = useState(0);
    const precedent = useRef<any>();

    // Un instantané des processus, puis on recommence une seconde plus tard
    useEffect(() => {
        let actif = true;
        (async () => {
            while (actif) {
                try {
                    const snap = await instantane();
                    const sessions = sessionsActives();
                    const avant = precedent.current;
                    precedent.current = snap;
                    if (!actif) return;
                    setCpu(cpuMachine());
                    setLignes(sessions.map((session: any) => {
                        const pids = arbre(snap, session.pid);
                        return { session, cpu: cpuGroupe(avant, snap, pids.map((p: any) => p.pid)), ram: pids.reduce((a: number, p: any) => a + p.ram, 0) };
                    }));
                    setServeurs(serveursDev(snap, projets, sessions));
                    setCharge(true);
                } catch {
                    // on réessaie au tour suivant
                }
                await new Promise((r) => setTimeout(r, 1000));
            }
        })();
        const chargerUsage = () => calculerUsage().then((u: any) => actif && setUsage(u)).catch(() => undefined);
        chargerUsage();
        const minuteur = setInterval(chargerUsage, 60_000);
        const horloge = setInterval(() => setTic((t) => t + 1), 1000);
        return () => {
            actif = false;
            clearInterval(minuteur);
            clearInterval(horloge);
        };
    }, []);

    const nb = section === 'sessions' ? lignes.length : serveurs.length;
    const sel = Math.min(selection, Math.max(0, nb - 1));
    const demanderFermeture = () => {
        if (section === 'sessions' && lignes[sel]) setConfirmation({ texte: `Fermer la session Claude « ${lignes[sel].session.nom} » ?`, pid: lignes[sel].session.pid });
        else if (section === 'ports' && serveurs[sel]) setConfirmation({ texte: `Arrêter le serveur sur le port ${serveurs[sel].port} ?`, pid: serveurs[sel].pid });
    };
    useKeyboard((k) => {
        if (confirmation) {
            if (k.sequence === 'o' || k.sequence === 'y') fermerArbre(confirmation.pid);
            return setConfirmation(undefined);
        }
        if (k.sequence === 'q' || k.name === 'escape') return fermer();
        if (k.name === 'up') setSelection(Math.max(0, sel - 1));
        if (k.name === 'down') setSelection(Math.min(Math.max(0, nb - 1), sel + 1));
        if (k.name === 'tab') {
            setSection((s) => (s === 'sessions' ? 'ports' : 'sessions'));
            setSelection(0);
        }
        if (k.sequence === 'c' && section === 'sessions' && lignes[sel]) lancerDetache('code', [lignes[sel].session.cwd]);
        if (k.sequence === 'k') demanderFermeture();
    });

    const ramTotale = os.totalmem();
    const ramUtilisee = ramTotale - os.freemem();
    const cpuSessions = lignes.reduce((a, l) => a + l.cpu, 0);
    const ramSessions = lignes.reduce((a, l) => a + l.ram, 0);
    const heure = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const choisir = (s: 'sessions' | 'ports', i: number) => {
        setSection(s);
        setSelection(i);
    };
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <box height={1} flexDirection="row">
                <text flexGrow={1} fg={theme.accent} attributes={GRAS}>✻ Moniteur</text>
                <text fg="gray">{`${heure} `}</text>
            </box>
            <text> </text>
            <text>
                <span>CPU </span><Jauge pourcent={cpu} /><span>{` ${cpu.toFixed(0).padStart(3)}%      `}</span>
                <span>RAM </span><Jauge pourcent={(ramUtilisee / ramTotale) * 100} /><span>{` ${formatRam(ramUtilisee)} / ${formatRam(ramTotale)}`}</span>
            </text>
            <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                <Cadre titre={`🤖 Sessions Claude (${lignes.length})`} actif={section === 'sessions'}>
                    <text fg="gray">{'  ' + colonne('Projet', 24) + colonne('Branche', 26) + colonne('Statut', 14) + 'Durée'.padStart(6) + 'CPU'.padStart(7) + 'RAM'.padStart(10)}</text>
                    {!charge && <text fg="gray">  chargement…</text>}
                    {lignes.map((l, i) => {
                        const actif = section === 'sessions' && i === sel;
                        const s = l.session;
                        return (
                            <box key={s.pid} height={1} backgroundColor={actif ? fond.selection : undefined} onMouseDown={() => choisir('sessions', i)}>
                                <text truncate>
                                    <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                    <span fg={couleurProjet(s.nom)}>● </span>
                                    <span>{colonne(s.nom, 22)}</span>
                                    <span fg={theme.secondaire}>{colonne(brancheGit(s.cwd) ?? '', 26)}</span>
                                    {s.statut === 'busy' ? <span fg="#4ade80">{colonne('● travaille', 14)}</span> : <span fg="#facc15">{colonne('○ t\'attend', 14)}</span>}
                                    <span>{duree(s.debut).padStart(6) + (l.cpu.toFixed(0) + '%').padStart(7) + formatRam(l.ram).padStart(10)}</span>
                                </text>
                            </box>
                        );
                    })}
                    {lignes.length > 0 && <text fg="gray">{' '.repeat(2 + 24 + 26 + 14) + 'TOTAL'.padStart(6) + (cpuSessions.toFixed(0) + '%').padStart(7) + formatRam(ramSessions).padStart(10)}</text>}
                </Cadre>
                <Cadre titre={`🌐 Serveurs de dev (${serveurs.length})`} actif={section === 'ports'}>
                    {charge && !serveurs.length && <text fg="gray">  Aucun serveur de dev en écoute</text>}
                    {serveurs.map((sv, i) => {
                        const actif = section === 'ports' && i === sel;
                        return (
                            <box key={sv.port} height={1} backgroundColor={actif ? fond.selection : undefined} onMouseDown={() => choisir('ports', i)}>
                                <text truncate>
                                    <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                    <span fg={theme.accent}>{(':' + sv.port).padEnd(8)}</span>
                                    <span>{colonne(sv.projet ?? '—', 24)}</span>
                                    <span fg="gray">{`${sv.processus} · pid ${sv.pid}`}</span>
                                </text>
                            </box>
                        );
                    })}
                </Cadre>
                <Cadre titre="💰 Usage Claude · 7 jours">
                    {!usage ? <text fg="gray">  calcul…</text> : <>
                        <text>
                            {'  '}<span fg={theme.accent}>{sparkline(usage.jours.map((j: any) => j.tokens))}</span>
                            {'   aujourd\'hui '}<span fg={theme.secondaire}>{formatTokens(usage.jours[usage.jours.length - 1].tokens)}</span>
                            {'   7 jours '}<span fg={theme.secondaire}>{formatTokens(usage.jours.reduce((a: number, j: any) => a + j.tokens, 0))}</span>
                            <span fg="gray">{'   tokens'}</span>
                        </text>
                        <text fg="gray" truncate>{'  top : ' + usage.parProjet.slice(0, 3).map((p: any) => `${nomDossierClaude(p.dossier, projets)} ${formatTokens(p.tokens)}`).join(' · ')}</text>
                    </>}
                </Cadre>
            </scrollbox>
            {confirmation
                ? <text fg="#f87171" attributes={GRAS}>{`${confirmation.texte} (o/n)`}</text>
                : <text fg="gray">↑↓ ou clic choisir · Tab sessions/serveurs · k fermer · c VS Code · q quitter</text>}
        </box>
    );
}

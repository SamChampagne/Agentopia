import * as os from 'os';
import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Projet, brancheGit } from '../projets.js';
import { Instantane, SessionActive, instantane, arbre, cpuGroupe, cpuMachine, sessionsActives, fermerArbre, formatRam } from '../systeme.js';
import { ServeurDev, serveursDev } from '../serveurs.js';
import { Usage, calculerUsage, formatTokens, sparkline, nomDossierClaude } from '../usage.js';
import { theme, couleurProjet, fond } from '../theme.js';
import { lancerDetache } from '../lanceurs.js';

interface LigneSession {
    session: SessionActive;
    cpu: number;
    ram: number;
}

function Jauge({ pourcent, largeur = 24 }: { pourcent: number; largeur?: number }) {
    const plein = Math.round((Math.min(100, Math.max(0, pourcent)) / 100) * largeur);
    const couleur = pourcent > 85 ? '#f87171' : pourcent > 60 ? '#facc15' : '#4ade80';
    return (
        <Text>
            <Text color={couleur}>{'█'.repeat(plein)}</Text>
            <Text color="gray">{'░'.repeat(largeur - plein)}</Text>
        </Text>
    );
}

function Cadre({ titre, children, actif }: { titre: string; children: React.ReactNode; actif?: boolean }) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={actif ? theme.accent : 'gray'} paddingX={1} marginTop={1}>
            <Text bold color={theme.primaire}>{titre}</Text>
            {children}
        </Box>
    );
}

const duree = (d: Date) => {
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
};
// Coupe à n-1 caractères + un espace de séparation entre colonnes
const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, n - 2) + '… ' : s.padEnd(n));

export function Moniteur({ projets, fermer }: { projets: Projet[]; fermer: () => void }) {
    const [lignes, setLignes] = useState<LigneSession[]>([]);
    const [serveurs, setServeurs] = useState<ServeurDev[]>([]);
    const [usage, setUsage] = useState<Usage>();
    const [cpu, setCpu] = useState(0);
    const [charge, setCharge] = useState(false);
    const [section, setSection] = useState<'sessions' | 'ports'>('sessions');
    const [selection, setSelection] = useState(0);
    const [confirmation, setConfirmation] = useState<{ texte: string; pid: number }>();
    const [, setTic] = useState(0);
    const precedent = useRef<Instantane>();

    // Boucle de collecte : un instantané des processus (~2-3 s), puis on recommence
    useEffect(() => {
        let actif = true;
        const boucle = async () => {
            while (actif) {
                try {
                    const snap = await instantane();
                    const sessions = sessionsActives();
                    const avant = precedent.current;
                    precedent.current = snap;
                    if (!actif) return;
                    setCpu(cpuMachine());
                    setLignes(sessions.map((session) => {
                        const pids = arbre(snap, session.pid).map((p) => p);
                        return { session, cpu: cpuGroupe(avant, snap, pids.map((p) => p.pid)), ram: pids.reduce((a, p) => a + p.ram, 0) };
                    }));
                    setServeurs(serveursDev(snap, projets, sessions));
                    setCharge(true);
                } catch {
                    // on réessaie au tour suivant
                }
                await new Promise((r) => setTimeout(r, 1000));
            }
        };
        boucle();
        const chargerUsage = () => calculerUsage().then((u) => actif && setUsage(u)).catch(() => undefined);
        chargerUsage();
        const minuteurUsage = setInterval(chargerUsage, 60_000);
        const horloge = setInterval(() => setTic((t) => t + 1), 1000);
        return () => {
            actif = false;
            clearInterval(minuteurUsage);
            clearInterval(horloge);
        };
    }, []);

    const nb = section === 'sessions' ? lignes.length : serveurs.length;
    const sel = Math.min(selection, Math.max(0, nb - 1));

    useInput((input, key) => {
        if (confirmation) {
            if (input === 'o' || input === 'y') fermerArbre(confirmation.pid);
            setConfirmation(undefined);
            return;
        }
        if (input === 'q' || key.escape) return fermer();
        if (key.upArrow) setSelection(Math.max(0, sel - 1));
        if (key.downArrow) setSelection(Math.min(Math.max(0, nb - 1), sel + 1));
        if (key.tab) {
            setSection((s) => (s === 'sessions' ? 'ports' : 'sessions'));
            setSelection(0);
        }
        if (input === 'c' && section === 'sessions' && lignes[sel]) lancerDetache('code', [lignes[sel].session.cwd]);
        if (input === 'k') {
            if (section === 'sessions' && lignes[sel]) {
                setConfirmation({ texte: `Fermer la session Claude « ${lignes[sel].session.nom} » ?`, pid: lignes[sel].session.pid });
            } else if (section === 'ports' && serveurs[sel]) {
                setConfirmation({ texte: `Arrêter le serveur sur le port ${serveurs[sel].port} ?`, pid: serveurs[sel].pid });
            }
        }
    });

    const ramTotale = os.totalmem();
    const ramUtilisee = ramTotale - os.freemem();
    const cpuSessions = lignes.reduce((a, l) => a + l.cpu, 0);
    const ramSessions = lignes.reduce((a, l) => a + l.ram, 0);
    const heure = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return (
        <Box flexDirection="column">
            <Box justifyContent="space-between">
                <Text bold color={theme.accent}>✻ Moniteur</Text>
                <Text color="gray">{heure}</Text>
            </Box>
            <Box marginTop={1} gap={4}>
                <Text>CPU <Jauge pourcent={cpu} /> {cpu.toFixed(0).padStart(3)}%</Text>
                <Text>RAM <Jauge pourcent={(ramUtilisee / ramTotale) * 100} /> {formatRam(ramUtilisee)} / {formatRam(ramTotale)}</Text>
            </Box>

            <Cadre titre={`🤖 Sessions Claude (${lignes.length})`} actif={section === 'sessions'}>
                <Text color="gray">{'  ' + ajuste('Projet', 24) + ajuste('Branche', 26) + ajuste('Statut', 14) + 'Durée'.padStart(6) + 'CPU'.padStart(7) + 'RAM'.padStart(10)}</Text>
                {!charge && <Text color="gray">  chargement…</Text>}
                {lignes.map((l, i) => {
                    const actif = section === 'sessions' && i === sel;
                    const s = l.session;
                    return (
                        <Text key={s.pid} backgroundColor={actif ? fond.selection : undefined}>
                            <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                            <Text color={couleurProjet(s.nom)}>● </Text>
                            {ajuste(s.nom, 22)}
                            <Text color={theme.secondaire}>{ajuste(brancheGit(s.cwd) ?? '', 26)}</Text>
                            {s.statut === 'busy'
                                ? <Text color="#4ade80">{ajuste('● travaille', 14)}</Text>
                                : <Text color="#facc15">{ajuste('○ t\'attend', 14)}</Text>}
                            {duree(s.debut).padStart(6)}
                            {(l.cpu.toFixed(0) + '%').padStart(7)}
                            {formatRam(l.ram).padStart(10)}
                        </Text>
                    );
                })}
                {lignes.length > 0 && (
                    <Text color="gray">{' '.repeat(2 + 24 + 26 + 14) + 'TOTAL'.padStart(6) + (cpuSessions.toFixed(0) + '%').padStart(7) + formatRam(ramSessions).padStart(10)}</Text>
                )}
            </Cadre>

            <Cadre titre={`🌐 Serveurs de dev (${serveurs.length})`} actif={section === 'ports'}>
                {charge && !serveurs.length && <Text color="gray">  Aucun serveur de dev en écoute</Text>}
                {serveurs.map((sv, i) => {
                    const actif = section === 'ports' && i === sel;
                    return (
                        <Text key={sv.port} backgroundColor={actif ? fond.selection : undefined}>
                            <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                            <Text color={theme.accent}>{(':' + sv.port).padEnd(8)}</Text>
                            {ajuste(sv.projet ?? '—', 24)}
                            <Text color="gray">{sv.processus} · pid {sv.pid}</Text>
                        </Text>
                    );
                })}
            </Cadre>

            <Cadre titre="💰 Usage Claude · 7 jours">
                {!usage ? <Text color="gray">  calcul…</Text> : (
                    <>
                        <Text>
                            {'  '}<Text color={theme.accent}>{sparkline(usage.jours.map((j) => j.tokens))}</Text>
                            {'   aujourd\'hui '}<Text color={theme.secondaire}>{formatTokens(usage.jours[usage.jours.length - 1].tokens)}</Text>
                            {'   7 jours '}<Text color={theme.secondaire}>{formatTokens(usage.jours.reduce((a, j) => a + j.tokens, 0))}</Text>
                            <Text color="gray">{'   tokens'}</Text>
                        </Text>
                        <Text color="gray">
                            {'  top : '}
                            {usage.parProjet.slice(0, 3).map((p) => `${nomDossierClaude(p.dossier, projets)} ${formatTokens(p.tokens)}`).join(' · ')}
                        </Text>
                    </>
                )}
            </Cadre>

            <Box marginTop={1}>
                {confirmation
                    ? <Text color="#f87171" bold>{confirmation.texte} (o/n)</Text>
                    : <Text color="gray">↑↓ choisir · Tab sessions/serveurs · k fermer · c VS Code · q quitter</Text>}
            </Box>
        </Box>
    );
}

import { Box, Text } from 'ink';
import { Donnees, decrireConnexion } from './donnees.js';
import { Serveur } from '../ssh.js';
import { Projet } from '../projets.js';
import { nomDossierClaude } from '../usage.js';
import { theme, couleurProjet } from '../theme.js';

const MAX_LIGNES = 6;

export function ilYa(d: Date): string {
    const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h`;
    return `${Math.floor(s / 86400)} j`;
}

const ajuste = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

function Colonne({ titre, compte, largeur, children }: { titre: string; compte: string; largeur: number; children: React.ReactNode }) {
    return (
        <Box flexDirection="column" width={largeur} borderStyle="round" borderColor="gray" paddingX={1}>
            <Box justifyContent="space-between">
                <Text bold color={theme.primaire}>{titre}</Text>
                <Text color="gray">{compte}</Text>
            </Box>
            {children}
        </Box>
    );
}

// Serveurs à montrer : connectés maintenant, puis utilisés par Claude, puis ceux du ~/.ssh/config
export function serveursPertinents(d: Donnees): Serveur[] {
    const actifs = new Set(d.connexions.map((cx) => decrireConnexion(cx, d).serveur).filter(Boolean));
    const dernierUsage = (s: Serveur) => Math.max(0, ...(d.usage.get(s) ?? []).map((u) => u.dernier.getTime()));
    return d.serveurs
        .filter((s) => actifs.has(s) || d.usage.has(s) || s.configure)
        .sort((a, b) => Number(actifs.has(b)) - Number(actifs.has(a)) || dernierUsage(b) - dernierUsage(a));
}

export function Panneau({ donnees: d, projets, largeur }: { donnees: Donnees; projets: Projet[]; largeur: number }) {
    const demi = Math.floor((largeur - 1) / 2);
    const enAttente = d.sessions.filter((s) => s.statut !== 'busy').length;
    const serveurs = serveursPertinents(d);
    const actives = d.connexions.map((cx) => ({ cx, ...decrireConnexion(cx, d) }));

    return (
        <Box gap={1}>
            <Colonne titre="Sessions Claude" compte={d.sessions.length ? `${d.sessions.length} · ${enAttente} en attente` : ''} largeur={demi}>
                {!d.sessions.length && <Text color="gray">Aucune session ouverte</Text>}
                {d.sessions.slice(0, MAX_LIGNES).map((s) => (
                    <Text key={s.pid} wrap="truncate-end">
                        <Text color={couleurProjet(s.nom)}>● </Text>
                        {ajuste(s.nom, demi - 26)}
                        {s.statut === 'busy'
                            ? <Text color="#4ade80">{' travaille'.padEnd(11)}</Text>
                            : <Text color="#facc15">{' t\'attend'.padEnd(11)}</Text>}
                        <Text color="gray">{ilYa(s.depuisStatut).padStart(7)}</Text>
                    </Text>
                ))}
                {d.sessions.length > MAX_LIGNES && <Text color="gray">+ {d.sessions.length - MAX_LIGNES} autres · /top</Text>}
            </Colonne>

            <Colonne titre="Serveurs SSH" compte={actives.length ? `${actives.length} connexion${actives.length > 1 ? 's' : ''}` : 'aucune connexion'} largeur={demi}>
                {!d.serveurs.length && <Text color="gray">lecture de ~/.ssh…</Text>}
                {serveurs.slice(0, MAX_LIGNES).map((s) => {
                    const ok = d.joignables.get(s);
                    const connexions = actives.filter((a) => a.serveur === s);
                    const acces = d.acces[s.nom];
                    const projetsUsage = (d.usage.get(s) ?? []).map((u) => nomDossierClaude(u.dossier, projets));
                    const detail = connexions.length
                        ? `⇄ ${connexions.map((a) => a.session?.nom ?? 'terminal').join(', ')}`
                        : projetsUsage.join(' · ');
                    return (
                        <Text key={s.nom} wrap="truncate-end">
                            <Text color={ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171'}>● </Text>
                            {ajuste(s.nom, 10)}
                            {acces ? <Text color={acces.ok ? '#4ade80' : '#facc15'}>{acces.ok ? ' clé ' : ' mdp '}</Text> : <Text color="gray">{'  ?  '}</Text>}
                            <Text color={connexions.length ? theme.accent : 'gray'}> {detail}</Text>
                        </Text>
                    );
                })}
                {serveurs.length > MAX_LIGNES && <Text color="gray">+ {serveurs.length - MAX_LIGNES} autres · /ssh</Text>}
            </Colonne>
        </Box>
    );
}

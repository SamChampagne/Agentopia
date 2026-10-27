import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue } from './Vues.js';
import { useDonnees, decrireConnexion } from './donnees.js';
import { ilYa, serveursPertinents } from './Panneau.js';
import { bus } from './bus.js';
import { Detail, Morceau } from './espaces.js';
import { etatEquipe } from './Laterale.js';
import { metriques, metriquesDe, suivreMetriques, barre } from '../metriques.js';
import { avancement } from '../equipe.js';
import { dollars } from '../cout.js';
import { theme, couleurProjet, fond } from '../theme.js';

// Vue globale, en direct : toutes les sessions, les équipes, ce qui se passe dans chaque serveur SSH, et Docker.
// Un clic sur une ligne ouvre la conversation ou le panneau de détail.

type Ligne = { morceaux: Morceau[]; titre?: boolean; session?: string; detail?: Detail };

const ANIM = ['✻', '✼', '✽', '✾', '✿', '❀'];
const STATUTS = { travaille: { t: 'travaille', c: '#4ade80' }, attend: { t: 't\'attend', c: '#facc15' }, bloquee: { t: 'bloquée', c: '#fb923c' }, terminee: { t: 'terminée', c: 'gray' } };
const une = (s: string) => s.replace(/\s+/g, ' ').trim();

export function VueGlobale({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const d = useDonnees();
    const [, setV] = useState(0);
    const tic = Math.floor(Date.now() / 800);

    // Les relevés des serveurs tournent tant que la vue est ouverte
    useEffect(() => {
        const f = () => setV((v) => v + 1);
        metriques.on('maj', f);
        const arreter = suivreMetriques(() => d.serveurs);
        return () => {
            metriques.off('maj', f);
            arreter();
        };
    }, []);

    // ─── Colonne gauche : sessions et équipes ───
    const gauche: Ligne[] = [{ titre: true, morceaux: [{ t: `SESSIONS (${d.agents.length})`, c: theme.primaire, gras: true }] }];
    for (const s of d.agents) {
        const a = d.activites.get(s.sessionId);
        const st = STATUTS[s.statut];
        const cout = d.cout.parSession[s.sessionId];
        gauche.push({
            session: s.id ?? s.sessionId,
            morceaux: [
                { t: s.statut === 'travaille' ? `${ANIM[tic % ANIM.length]} ` : s.statut === 'bloquee' ? '! ' : '○ ', c: st.c },
                { t: '● ', c: couleurProjet(s.nom) }, { t: s.nom.padEnd(16).slice(0, 16), gras: true },
                { t: ` ${st.t.padEnd(10)}`, c: st.c },
                { t: s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : une(a?.dernierTexte ?? s.titre ?? ''), c: s.question ? '#fdba74' : 'gray' },
            ],
        });
        gauche.push({ session: s.id ?? s.sessionId, morceaux: [{ t: `      ${a?.date ? `il y a ${ilYa(a.date)}` : ''}${cout ? ` · ≈ ${dollars(cout)}` : ''}${s.arrierePlan ? ' · arrière-plan' : ' · onglet'}`, c: fond.discret }] });
    }
    if (d.equipes.length) {
        gauche.push({ morceaux: [{ t: '' }] }, { titre: true, morceaux: [{ t: `ÉQUIPES (${d.equipes.length})`, c: theme.primaire, gras: true }] });
        for (const e of d.equipes) {
            const av = avancement(e);
            const et = etatEquipe(e, tic);
            gauche.push({ morceaux: [{ t: '◆ ', c: '#c084fc' }, { t: e.nomProjet.padEnd(16).slice(0, 16), gras: true }, { t: ` ${av.faites}/${av.total} `, c: 'gray' }, { t: et.texte, c: et.couleur }] });
        }
    }

    // ─── Colonne droite : serveurs (ce qui se passe dedans) et Docker ───
    const actives = d.connexions.map((cx) => decrireConnexion(cx, d));
    const serveurs = serveursPertinents(d);
    const droite: Ligne[] = [{ titre: true, morceaux: [{ t: `SERVEURS SSH (${serveurs.length})`, c: theme.primaire, gras: true }] }];
    for (const s of serveurs) {
        const ok = d.joignables.get(s);
        const m = metriquesDe(s.nom);
        const connecte = actives.filter((x) => x.serveur === s).length;
        const detail: Detail = { type: 'serveur', cle: s.nom };
        droite.push({ detail, morceaux: [
            { t: '● ', c: ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171' }, { t: s.nom.padEnd(14).slice(0, 14), gras: true },
            ...(m && !m.erreur ? [
                { t: ` ${barre(Math.min(100, ((m.charge ?? 0) / (m.coeurs ?? 1)) * 100))} ${m.charge?.toFixed(1)}`.padEnd(8), c: theme.secondaire },
                { t: `  RAM ${barre(m.memoire ?? 0)} ${String(m.memoire ?? '?').padStart(2)}%`, c: (m.memoire ?? 0) > 85 ? '#f87171' : theme.secondaire },
                { t: `  disque ${barre(m.disque ?? 0)} ${m.disque ?? '?'}%`, c: (m.disque ?? 0) > 85 ? '#f87171' : theme.secondaire },
            ] : [{ t: ` ${m?.erreur ?? (d.acces[s.nom]?.ok ? 'relevé…' : 'pas de clé : relevés indisponibles')}`, c: 'gray' }]),
        ] });
        droite.push({ detail, morceaux: [{ t: `  ${s.ip ?? s.hote}${m?.depuis ? ` · allumé ${m.depuis}` : ''}${m?.conteneurs ? ` · ◫ ${m.conteneurs}` : ''}${connecte ? ` · ⇄ ${connecte} connecté${connecte > 1 ? 's' : ''}` : ''}`, c: connecte ? theme.accent : fond.discret }] });
    }
    droite.push({ morceaux: [{ t: '' }] });
    const enMarche = d.docker.reduce((n, h) => n + h.conteneurs.filter((c) => c.enMarche).length, 0);
    droite.push({ titre: true, morceaux: [{ t: `DOCKER (${enMarche} en marche)`, c: theme.primaire, gras: true }] });
    for (const h of d.docker) {
        droite.push({ morceaux: [{ t: h.serveur ? `◫ ${h.nom}` : '◫ ce poste', c: theme.secondaire, gras: true }, { t: h.erreur ? `  ${h.erreur}` : `  ${h.conteneurs.filter((c) => c.enMarche).length}/${h.conteneurs.length}`, c: h.erreur ? '#f87171' : 'gray' }] });
        for (const c of h.conteneurs.filter((x) => x.enMarche)) {
            droite.push({ detail: { type: 'conteneur', cle: `${h.nom}|${c.id}` }, morceaux: [
                { t: '  ● ', c: c.sante === 'unhealthy' ? '#facc15' : '#4ade80' }, { t: c.nom.padEnd(22).slice(0, 22) },
                { t: ` ${[c.cpu, c.memoire].filter(Boolean).join(' · ')}`, c: 'gray' },
            ] });
        }
    }

    // Deux colonnes si la place le permet, sinon l'une sous l'autre
    const deux = largeur >= 96;
    const largeurCol = deux ? Math.floor((largeur - 3) / 2) : largeur - 2;
    const zone = hauteur - 2;
    const colonnes = deux ? [gauche, droite] : [[...gauche, { morceaux: [{ t: '' }] }, ...droite]];
    const ouvrir = (l?: Ligne) => {
        if (!l) return;
        if (l.session) {
            fermer();
            bus.emit('selectionner', l.session);
        } else if (l.detail) {
            fermer();
            bus.emit('detail', l.detail);
        }
    };
    useClicsVue((x, y) => {
        const col = deux && x > largeurCol + 1 ? 1 : 0;
        ouvrir(colonnes[col][y - 2]);
    });
    useInput((input, key) => {
        if (key.escape || input === 'q') fermer();
    });

    const total = d.agents.filter((a) => a.statut === 'travaille').length;
    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Box height={1} flexShrink={0} justifyContent="space-between" paddingRight={1}>
                <Text bold color={theme.accent}>{`◉ VUE GLOBALE `}<Text color={fond.discret}>en direct</Text></Text>
                <Text color="gray">{`${total} session${total > 1 ? 's' : ''} au travail · ${enMarche} conteneur${enMarche > 1 ? 's' : ''}${d.cout.total ? ` · ≈ ${dollars(d.cout.total)} auj.` : ''}`}</Text>
            </Box>
            <Box height={1} flexShrink={0}><Text color={fond.bordure}>{'─'.repeat(Math.max(0, largeur - 2))}</Text></Box>
            <Box flexDirection="row" height={zone}>
                {colonnes.map((lignes, c) => (
                    <Box key={c} flexDirection="column" width={largeurCol} marginRight={c === 0 && deux ? 2 : 0} overflow="hidden">
                        {lignes.slice(0, zone - 1).map((l, i) => (
                            <Box key={i} height={1} overflow="hidden">
                                <Text wrap="truncate-end">{l.morceaux.map((m, k) => <Text key={k} color={m.c} bold={m.gras}>{m.t || ' '}</Text>)}</Text>
                            </Box>
                        ))}
                        {lignes.length > zone - 1 && <Text color={fond.discret}>{`  … ${lignes.length - zone + 1} ligne(s) de plus`}</Text>}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

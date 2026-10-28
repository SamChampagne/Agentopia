import { useEffect, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { GRAS, ANIM, une } from '../style.ts';
import { useDonnees } from '../donnees.ts';
import { bus } from '../../dist/ui/bus.js';
import { decrireConnexion, lireDonnees } from '../../dist/ui/donnees.js';
import { ilYa, serveursPertinents } from '../../dist/ui/Panneau.js';
import { etatEquipe } from '../../dist/ui/Laterale.js';
import { metriques, metriquesDe, suivreMetriques, barre } from '../../dist/metriques.js';
import { avancement } from '../../dist/equipe.js';
import { dollars } from '../../dist/cout.js';
import { theme, couleurProjet, fond } from '../../dist/theme.js';

// Vue globale, en direct : toutes les sessions, les équipes, ce qui se passe dans chaque serveur SSH, et Docker.
// Plein écran (la colonne de gauche disparaît) ; un clic ouvre la conversation ou le panneau de détail.

type Ligne = { morceaux: { t: string; c?: string; gras?: boolean }[]; titre?: boolean; session?: string; detail?: any };
const STATUTS: Record<string, { t: string; c: string }> = { travaille: { t: 'travaille', c: '#4ade80' }, attend: { t: 't\'attend', c: '#facc15' }, bloquee: { t: 'bloquée', c: '#fb923c' }, terminee: { t: 'terminée', c: 'gray' } };

export function VueGlobale({ fermer }: { fermer: () => void }) {
    const { width } = useTerminalDimensions();
    const d = useDonnees();
    const [, setV] = useState(0);
    const [survol, setSurvol] = useState<string>();
    const tic = Math.floor(Date.now() / 800);
    useEffect(() => {
        bus.emit('plein-ecran', true);
        const f = () => setV((v) => v + 1);
        metriques.on('maj', f);
        // Les relevés des serveurs tournent tant que la vue est ouverte
        const arreter = suivreMetriques(() => lireDonnees().serveurs);
        return () => {
            bus.emit('plein-ecran', false);
            metriques.off('maj', f);
            arreter();
        };
    }, []);
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') fermer();
    });

    const gauche: Ligne[] = [{ titre: true, morceaux: [{ t: `SESSIONS (${d.agents.length})`, c: theme.primaire, gras: true }] }];
    for (const s of d.agents) {
        const a = d.activites.get(s.sessionId);
        const st = STATUTS[s.statut] ?? STATUTS.terminee;
        const cout = d.cout.parSession[s.sessionId];
        const session = s.id ?? s.sessionId;
        gauche.push({
            session, morceaux: [
                { t: s.statut === 'travaille' ? `${ANIM[tic % ANIM.length]} ` : s.statut === 'bloquee' ? '! ' : '○ ', c: st.c },
                { t: '● ', c: couleurProjet(s.nom) }, { t: s.nom.padEnd(16).slice(0, 16), gras: true },
                { t: ` ${st.t.padEnd(10)}`, c: st.c },
                { t: s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : une(a?.dernierTexte ?? s.titre ?? ''), c: s.question ? '#fdba74' : 'gray' },
            ],
        });
        gauche.push({ session, morceaux: [{ t: `      ${a?.date ? `il y a ${ilYa(a.date)}` : ''}${cout ? ` · ≈ ${dollars(cout)}` : ''}${s.arrierePlan ? ' · arrière-plan' : ' · onglet'}`, c: fond.discret }] });
    }
    if (d.equipes.length) {
        gauche.push({ morceaux: [{ t: '' }] }, { titre: true, morceaux: [{ t: `ÉQUIPES (${d.equipes.length})`, c: theme.primaire, gras: true }] });
        for (const e of d.equipes) {
            const av = avancement(e);
            const et = etatEquipe(e, tic);
            gauche.push({ morceaux: [{ t: '◆ ', c: '#c084fc' }, { t: e.nomProjet.padEnd(16).slice(0, 16), gras: true }, { t: ` ${av.faites}/${av.total} `, c: 'gray' }, { t: et.texte, c: et.couleur }] });
        }
    }
    const actives = d.connexions.map((cx: any) => decrireConnexion(cx, d));
    const serveurs = serveursPertinents(d);
    const droite: Ligne[] = [{ titre: true, morceaux: [{ t: `SERVEURS SSH (${serveurs.length})`, c: theme.primaire, gras: true }] }];
    for (const s of serveurs) {
        const ok = d.joignables.get(s);
        const m = metriquesDe(s.nom);
        const connecte = actives.filter((x: any) => x.serveur === s).length;
        const detail = { type: 'serveur', cle: s.nom };
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
    const enMarche = d.docker.reduce((n: number, h: any) => n + h.conteneurs.filter((c: any) => c.enMarche).length, 0);
    const docker: Ligne[] = [{ titre: true, morceaux: [{ t: `DOCKER (${enMarche} en marche)`, c: theme.primaire, gras: true }] }];
    for (const h of d.docker) {
        docker.push({ morceaux: [{ t: h.serveur ? `◫ ${h.nom}` : '◫ ce poste', c: theme.secondaire, gras: true }, { t: h.erreur ? `  ${h.erreur}` : `  ${h.conteneurs.filter((c: any) => c.enMarche).length}/${h.conteneurs.length}`, c: h.erreur ? '#f87171' : 'gray' }] });
        for (const c of h.conteneurs.filter((x: any) => x.enMarche)) {
            docker.push({ detail: { type: 'conteneur', cle: `${h.nom}|${c.id}` }, morceaux: [
                { t: '  ● ', c: c.sante === 'unhealthy' ? '#facc15' : '#4ade80' }, { t: c.nom.padEnd(22).slice(0, 22) },
                { t: ` ${[c.cpu, c.memoire].filter(Boolean).join(' · ')}`, c: 'gray' },
            ] });
        }
    }
    const vide: Ligne = { morceaux: [{ t: '' }] };
    const colonnes = width >= 150 ? [gauche, droite, docker] : width >= 96 ? [gauche, [...droite, vide, ...docker]] : [[...gauche, vide, ...droite, vide, ...docker]];
    const ouvrir = (l: Ligne) => {
        if (l.session) {
            fermer();
            bus.emit('selectionner', l.session);
        } else if (l.detail) {
            fermer();
            bus.emit('detail', l.detail);
        }
    };
    const total = d.agents.filter((a: any) => a.statut === 'travaille').length;
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <box height={1} flexDirection="row" paddingRight={1}>
                <text flexGrow={1}><span fg={theme.accent} attributes={GRAS}>◉ VUE GLOBALE </span><span fg={fond.discret}>en direct · Échap pour revenir</span></text>
                <text fg="gray">{`${total} session${total > 1 ? 's' : ''} au travail · ${enMarche} conteneur${enMarche > 1 ? 's' : ''}${d.cout.total ? ` · ≈ ${dollars(d.cout.total)} auj.` : ''}`}</text>
            </box>
            <box height={1} border={['bottom']} borderColor={fond.bordure} />
            <box flexGrow={1} flexDirection="row">
                {colonnes.map((lignes, c) => (
                    <scrollbox key={c} flexGrow={1} flexBasis={0} scrollY marginRight={c < colonnes.length - 1 ? 2 : 0}>
                        {lignes.map((l, i) => {
                            const cle = `${c}:${i}`;
                            const cliquable = !!(l.session || l.detail);
                            return (
                                <box key={i} height={1} backgroundColor={cliquable && survol === cle ? fond.selection : undefined}
                                    onMouseOver={() => cliquable && setSurvol(cle)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => ouvrir(l)}>
                                    <text truncate>{l.morceaux.map((m, k) => <span key={k} fg={m.c} attributes={m.gras ? GRAS : 0}>{m.t || ' '}</span>)}</text>
                                </box>
                            );
                        })}
                    </scrollbox>
                ))}
            </box>
        </box>
    );
}

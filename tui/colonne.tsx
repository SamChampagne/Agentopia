import { useState } from 'react';
import { Ansi } from './ansi.tsx';
import { GRAS, SOULIGNE, ANIM, une, couper } from './style.ts';
import { lignesEspace } from '../dist/ui/espaces.js';
import { lignesDocker } from '../dist/ui/Laterale.js';
import { theme, fond, couleurProjet } from '../dist/theme.js';

// Colonne de gauche : onglets Sessions / Projets, cartes de session, maître ; Docker et Serveurs SSH en bas.
// Le survol et les clics sont portés par chaque élément (pas de géométrie calculée à la main).

const COULEURS: Record<string, string> = { travaille: '#4ade80', attend: '#facc15', bloquee: '#fb923c', terminee: '#94a3b8' };
const LIBELLES: Record<string, string> = { travaille: 'travaille', attend: 't’attend', bloquee: 'bloquée', terminee: 'terminée' };

function Carte({ s, a, active, survole, largeur, tic, choisir, survoler }: any) {
    const couleur = COULEURS[s.statut] ?? fond.discret;
    const icone = s.statut === 'travaille' ? ANIM[tic % ANIM.length] : s.statut === 'bloquee' ? '!' : s.statut === 'terminee' ? '✓' : '○';
    const action = s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : a?.dernierTexte ? une(a.dernierTexte) : s.titre || 'pas encore d’activité';
    const bg = active ? fond.panneauActif : survole ? fond.selection : fond.panneau;
    const barre = active ? theme.accent : couleur;
    return (
        <box height={3} flexShrink={0} onMouseDown={choisir} onMouseOver={() => survoler(true)} onMouseOut={() => survoler(false)}>
            <box height={1} backgroundColor={bg} flexDirection="row">
                <text fg={barre}>▌ </text>
                <text flexGrow={1} truncate><span fg={couleurProjet(s.nom)}>● </span><span fg={fond.texte} attributes={GRAS}>{s.nom}</span></text>
                <text fg={couleur}>{`${icone} ${LIBELLES[s.statut] ?? s.statut} `}</text>
            </box>
            <box height={1} backgroundColor={bg} flexDirection="row">
                <text fg={barre}>▌ </text>
                <text fg="#94a3b8" truncate>{'  ' + couper(action, largeur - 5)}</text>
            </box>
        </box>
    );
}

export function Entete({ titre, droite = '', clic }: { titre: string; droite?: string; clic?: () => void }) {
    return (
        <box height={1} flexShrink={0} backgroundColor={fond.entete} flexDirection="row" onMouseDown={clic}>
            <text fg={theme.primaire} attributes={GRAS} flexGrow={1}>{` ${titre}`}</text>
            <text fg="gray">{`${droite} `}</text>
        </box>
    );
}

export function Colonne({ d, largeur, selection, choisir, tic, espace, setEspace, projets, lancer }: any) {
    const [survol, setSurvol] = useState<string>();
    const [replie, setReplie] = useState<Record<string, boolean>>({ ssh: false, docker: false });
    const docker: string[] = lignesDocker(d);
    const serveurs = d.serveurs.slice(0, 6);
    const survoler = (cle: string) => ({ onMouseOver: () => setSurvol(cle), onMouseOut: () => setSurvol(undefined) });
    return (
        <box width={largeur} flexShrink={0} flexDirection="column" border={['right']} borderColor={fond.bordure}>
            <box height={1} flexShrink={0} backgroundColor={fond.entete} flexDirection="row">
                <text> </text>
                {['sessions', 'projets'].map((e) => (
                    <text key={e} onMouseDown={() => setEspace(e)} {...survoler(`onglet:${e}`)}
                        fg={espace === e ? theme.accent : survol === `onglet:${e}` ? fond.texte : fond.eteint}
                        attributes={espace === e ? GRAS | SOULIGNE : 0}>{e === 'sessions' ? 'Sessions' : 'Projets'}  </text>
                ))}
            </box>
            {espace === 'projets' ? (
                <scrollbox flexGrow={1} scrollY>
                    {lignesEspace('projets', d, projets).map((l: any) => (
                        <box key={l.cle} height={1} flexDirection="row" backgroundColor={survol === l.cle ? fond.selection : undefined} {...survoler(l.cle)}>
                            <text flexGrow={1} truncate>{'  '}{l.morceaux.map((m: any, i: number) => <span key={i} fg={m.c} attributes={m.gras ? GRAS : 0}>{m.t}</span>)}</text>
                            <text fg={l.couleurDroite}>{`${l.droite ?? ''} `}</text>
                        </box>
                    ))}
                </scrollbox>
            ) : (
                <box flexGrow={1} flexDirection="column">
                    <scrollbox flexGrow={1} scrollY>
                        {d.agents.map((s: any) => (
                            <Carte key={s.cle} s={s} a={d.activites.get(s.sessionId)} active={s.cle === selection} survole={survol === s.cle}
                                largeur={largeur - 1} tic={tic} choisir={() => choisir(s.cle === selection ? undefined : s.cle)}
                                survoler={(v: boolean) => setSurvol(v ? s.cle : undefined)} />
                        ))}
                    </scrollbox>
                    <box height={1} flexDirection="row">
                        <text> </text>
                        <text fg={theme.accent} attributes={survol === 'nouvelle' ? GRAS : 0} onMouseDown={() => lancer('/nouvelle', true)} {...survoler('nouvelle')}>+ Session</text>
                        <text>{'   '}</text>
                        <text fg={theme.secondaire} attributes={survol === 'terminal' ? GRAS : 0} onMouseDown={() => lancer('/terminal', true)} {...survoler('terminal')}>❯ Terminal</text>
                    </box>
                    <text> </text>
                    <Entete titre="◇ MAÎTRE" droite="Alt+M" />
                    <text fg="gray">{' ex. « lance les tests sur dev »'}</text>
                </box>
            )}
            <text> </text>
            <Entete titre="DOCKER" droite={replie.docker ? '▸' : '▾'} clic={() => setReplie((r) => ({ ...r, docker: !r.docker }))} />
            {!replie.docker && docker.slice(0, 4).map((l, i) => (
                <box key={i} height={1} paddingLeft={1} onMouseDown={() => lancer('/docker', true)}><Ansi texte={l} /></box>
            ))}
            <text> </text>
            <Entete titre="SERVEURS SSH" droite={`${d.serveurs.length} ${replie.ssh ? '▸' : '▾'}`} clic={() => setReplie((r) => ({ ...r, ssh: !r.ssh }))} />
            {!replie.ssh && serveurs.map((s: any) => {
                const ok = d.joignables.get(s);
                const acces = d.acces[s.nom];
                return (
                    <box key={s.nom} height={1} paddingLeft={1} flexDirection="row" backgroundColor={survol === `ssh:${s.nom}` ? fond.selection : undefined}
                        {...survoler(`ssh:${s.nom}`)} onMouseDown={() => lancer(`/ssh vue ${s.nom}`, true)}>
                        <text truncate>
                            <span fg={ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171'}>● </span>
                            <span>{couper(s.nom, 24).padEnd(24)}</span>
                            <span fg={acces ? (acces.ok ? '#4ade80' : '#facc15') : 'gray'}>{acces ? (acces.ok ? 'clé' : 'mdp') : ''}</span>
                        </text>
                    </box>
                );
            })}
        </box>
    );
}

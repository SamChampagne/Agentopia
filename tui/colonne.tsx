import { useState } from 'react';
import { Ansi } from './ansi.tsx';
import { GRAS, SOULIGNE, ANIM, une, couper } from './style.ts';
import { lignesEspace } from '../dist/ui/espaces.js';
import { lignesDocker, cartesLaterales, enPause, etatEquipe } from '../dist/ui/Laterale.js';
import { avancement } from '../dist/equipe.js';
import { rythme, limiteContexte } from '../dist/agents.js';
import { ilYa } from '../dist/ui/Panneau.js';
import { theme, fond, couleurProjet } from '../dist/theme.js';
import { menuSession, menuServeur, menuDocker } from './menus.ts';

const VIOLET = '#a78bfa';
const droit = (e: any) => e?.button === 2;

// Colonne de gauche : onglets Sessions / Projets, cartes de session, maître ; Docker et Serveurs SSH en bas.
// Le survol et les clics sont portés par chaque élément (pas de géométrie calculée à la main).

const COULEURS: Record<string, string> = { travaille: '#4ade80', attend: '#facc15', bloquee: '#fb923c', terminee: '#94a3b8' };
const LIBELLES: Record<string, string> = { travaille: 'travaille', attend: 't’attend', bloquee: 'bloquée', terminee: 'terminée' };

const BLOCS = ' ▁▂▃▄▅▆▇█';
// Rythme des 10 dernières minutes, une colonne par minute
const etincelle = (valeurs: number[]) => {
    const max = Math.max(1, ...valeurs);
    return valeurs.map((v) => BLOCS[v ? Math.max(1, Math.round((v / max) * 8)) : 0]).join('');
};
// Jauge du contexte : verte, jaune passé la moitié, rouge passé 80 %
function jaugeContexte(jetons: number, largeur: number) {
    const part = Math.min(1, jetons / limiteContexte(jetons));
    const plein = Math.round(part * largeur);
    return { plein: '▰'.repeat(plein), vide: '▱'.repeat(largeur - plein), couleur: part > 0.8 ? '#f87171' : part > 0.5 ? '#facc15' : '#4ade80', texte: `${Math.round(jetons / 1000)}k` };
}

// Une session bloquée sur une question (pas une permission) : on peut répondre sans la rejoindre
function Reponses({ s, largeur, lancer }: any) {
    const [survol, setSurvol] = useState<string>();
    const bouton = (cle: string, label: string, cmd: string, fg: string) => (
        <text key={cle} fg={survol === cle ? fond.texte : fg} attributes={survol === cle ? GRAS : 0}
            onMouseOver={() => setSurvol(cle)} onMouseOut={() => setSurvol(undefined)}
            onMouseDown={(e: any) => {
                e?.stopPropagation?.();
                lancer(cmd);
            }}>{label}</text>
    );
    const suggestion = s.suggestion ? couper(`✓ « ${une(s.suggestion)} »`, Math.max(12, largeur - 26)) : undefined;
    return (
        <>
            {suggestion && bouton('ok', suggestion, `/envoyer ${s.sessionId} ${une(s.suggestion)}`, '#4ade80')}
            {suggestion && <text>{'  '}</text>}
            {bouton('rep', '✎ Répondre', `/repondre ${s.sessionId}`, theme.accent)}
            <text>{'  '}</text>
            {bouton('rej', '⤢', `/rejoindre ${s.id}`, fond.eteint)}
        </>
    );
}

function Carte({ s, a, active, survole, largeur, tic, choisir, survoler, menu, lancer }: any) {
    // En pause : plus de 12 h sans activité (grisée, rangée en bas de la liste)
    const pause = enPause(s, a);
    const couleur = pause ? fond.discret : COULEURS[s.statut] ?? fond.discret;
    const icone = pause ? '◌' : s.statut === 'travaille' ? ANIM[tic % ANIM.length] : s.statut === 'bloquee' ? '!' : s.statut === 'terminee' ? '✓' : '○';
    const etat = pause ? `en pause · ${ilYa(a?.date ?? s.debut)}` : LIBELLES[s.statut] ?? s.statut;
    const action = s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : a?.dernierTexte ? une(a.dernierTexte) : s.titre || 'pas encore d’activité';
    // 3e ligne : ta dernière demande à cette session, sinon depuis quand elle est là
    const demande = a?.dernierUser ? `❯ ${une(a.dernierUser)}` : `depuis ${ilYa(a?.date ?? s.debut)}${s.arrierePlan ? ' · arrière-plan' : ' · onglet'}`;
    const bg = active ? fond.panneauActif : survole ? fond.selection : fond.panneau;
    // Le bord pulse pendant que Claude travaille ; il clignote doucement quand une session t'attend
    const pulse = !pause && (s.statut === 'travaille' || s.statut === 'bloquee') && tic % 2 === 1;
    const barre = active ? theme.accent : pulse ? (s.statut === 'travaille' ? '#166534' : '#7c2d12') : couleur;
    const repondable = !pause && s.statut === 'bloquee' && s.arrierePlan && s.question && !/permission/i.test(s.question);
    const ctx = a?.contexte ? jaugeContexte(a.contexte, 6) : undefined;
    return (
        <box height={pause ? 4 : 5} flexShrink={0} onMouseDown={(e: any) => (droit(e) ? menu() : choisir())} onMouseOver={() => survoler(true)} onMouseOut={() => survoler(false)}>
            <box height={1} backgroundColor={bg} flexDirection="row">
                <text fg={barre}>▌ </text>
                <text flexGrow={1} truncate><span fg={couleurProjet(s.nom)}>● </span><span fg={fond.texte} attributes={GRAS}>{s.nom}</span></text>
                <text fg={couleur}>{`${icone} ${etat} `}</text>
            </box>
            <box height={1} backgroundColor={bg} flexDirection="row">
                <text fg={barre}>▌ </text>
                <text fg="#94a3b8" truncate>{'  ' + couper(action, largeur - 5)}</text>
            </box>
            <box height={1} backgroundColor={bg} flexDirection="row">
                <text fg={barre}>▌ </text>
                <text fg={a?.dernierUser ? theme.secondaire : fond.discret} truncate>{'  ' + couper(demande, largeur - 5)}</text>
            </box>
            {!pause && (
                <box height={1} backgroundColor={bg} flexDirection="row">
                    <text fg={barre}>▌ </text>
                    <text>{'  '}</text>
                    {repondable ? <Reponses s={s} largeur={largeur} lancer={lancer} /> : (
                        <>
                            <text fg={couleurProjet(s.nom)} flexGrow={1}>{etincelle(rythme(a?.horaires))}</text>
                            {ctx && <text><span fg={fond.discret}>ctx </span><span fg={ctx.couleur}>{ctx.plein}</span><span fg={fond.discret}>{ctx.vide}</span><span fg="gray">{` ${ctx.texte} `}</span></text>}
                        </>
                    )}
                </box>
            )}
        </box>
    );
}

// Une équipe d'agents : son nom, son état et une barre d'avancement ; clic = ouvrir l'équipe
function CarteEquipe({ e, largeur, tic, ouvrir }: any) {
    const a = avancement(e);
    const et = etatEquipe(e, tic);
    const legende = a.total ? ` ${a.faites}/${a.total}` : '';
    const barre = Math.max(4, largeur - 6 - legende.length);
    const plein = a.total ? Math.round((a.faites / a.total) * barre) : 0;
    const couleurBarre = e.etat === 'en cours' || e.etat === 'integration' ? VIOLET : '#6d28d9';
    return (
        <box height={3} flexShrink={0} onMouseDown={ouvrir}>
            <box height={1} backgroundColor={fond.panneau} flexDirection="row">
                <text fg={couleurBarre}>▌ </text>
                <text flexGrow={1} truncate><span fg="#c084fc">◆ </span><span fg={fond.texte} attributes={GRAS}>{e.nomProjet}</span></text>
                <text fg={et.couleur}>{`${et.texte} `}</text>
            </box>
            <box height={1} backgroundColor={fond.panneau} flexDirection="row">
                <text fg={couleurBarre}>▌ </text>
                <text>{'  '}<span fg={VIOLET}>{'━'.repeat(plein)}</span><span fg={fond.discret}>{'─'.repeat(barre - plein)}</span><span fg="gray">{legende}</span></text>
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

// Zone du maître : son état, la dernière question, sa réponse et les commandes qu'il a lancées ; clic = lui parler
function Maitre({ etat, actif, tic, basculer, claude }: any) {
    const dernier = etat.historique.at(-1);
    const lignes: { t: string; c?: string }[] = [];
    if (claude === 'absent') lignes.push({ t: '! Claude Code n’est pas installé', c: '#fb923c' }, { t: '▸ /installer-claude', c: theme.accent });
    else if (claude === 'deconnecte') lignes.push({ t: '! Pas connecté à Claude', c: '#fb923c' }, { t: '▸ /connexion-claude', c: theme.accent });
    else if (!dernier) lignes.push(actif ? { t: 'Écris ta demande en bas ↓', c: VIOLET } : { t: 'ex. « ferme les sessions finies »', c: fond.eteint });
    else {
        lignes.push({ t: `» ${dernier.question}`, c: 'gray' });
        if (etat.enCours) lignes.push({ t: `${ANIM[tic % ANIM.length]} réfléchit…`, c: VIOLET });
        if (dernier.erreur) lignes.push({ t: `✕ ${dernier.erreur}`, c: '#f87171' });
        if (dernier.reponse) lignes.push({ t: dernier.reponse });
        dernier.commandes?.forEach((x: string) => lignes.push({ t: `▸ ${x.replace(/ --oui$/, '')}`, c: theme.secondaire }));
    }
    const droite = etat.enCours ? ANIM[tic % ANIM.length] : actif ? '● à l’écoute' : etat.pret ? 'Alt+M' : etat.enVeille ? 'en veille' : etat.erreur ? '!' : 'démarre…';
    return (
        <box flexShrink={0} flexDirection="column" maxHeight={8} onMouseDown={basculer}>
            <box height={1} backgroundColor={fond.entete} flexDirection="row">
                <text fg={VIOLET} attributes={GRAS} flexGrow={1}>{actif ? ' ◈ MAÎTRE' : ' ◇ MAÎTRE'}</text>
                <text fg={actif ? VIOLET : 'gray'}>{`${droite} `}</text>
            </box>
            {lignes.map((l, i) => <text key={i} fg={l.c} wrapMode="word">{` ${l.t}`}</text>)}
        </box>
    );
}

// Une session active : ni terminée, ni en pause (plus de 12 h sans activité)
const active = (d: any, x: any) => x.type !== 'session' || (x.s.statut !== 'terminee' && !enPause(x.s, d.activites.get(x.s.sessionId)));

export function Colonne({ d, largeur, selection, choisir, tic, espace, setEspace, projets, lancer, ouvrirMenu, maitre, ouvrirDetail, detail, cote = 'gauche', bord }: any) {
    const [survol, setSurvol] = useState<string>();
    const [replie, setReplie] = useState<Record<string, boolean>>({ ssh: false, docker: false });
    // Seulement les sessions actives ; les terminées et en pause se montrent sur demande
    const [inactives, setInactives] = useState(false);
    const cartes = cartesLaterales(d);
    const visibles = inactives ? cartes : cartes.filter((x: any) => active(d, x));
    const cachees = cartes.length - cartes.filter((x: any) => active(d, x)).length;
    const docker: string[] = lignesDocker(d);
    const serveurs = d.serveurs.slice(0, 6);
    const survoler = (cle: string) => ({ onMouseOver: () => setSurvol(cle), onMouseOut: () => setSurvol(undefined) });
    return (
        <box width={largeur} flexShrink={0} flexDirection="column" border={[cote === 'droite' ? 'left' : 'right']} borderColor={fond.bordure}
            // Glisser la bordure élargit ou rétrécit la colonne
            onMouseDown={bord?.debut} onMouseDrag={bord?.glisser} onMouseDragEnd={bord?.fin} onMouseUp={bord?.fin}>
            <box height={1} flexShrink={0} backgroundColor={fond.entete} flexDirection="row">
                <text> </text>
                {['sessions', 'projets'].map((e) => (
                    <text key={e} onMouseDown={() => setEspace(e)} {...survoler(`onglet:${e}`)}
                        fg={espace === e ? theme.accent : survol === `onglet:${e}` ? fond.texte : fond.eteint}
                        attributes={espace === e ? GRAS | SOULIGNE : 0}>{e === 'sessions' ? 'Sessions' : 'Projets'}  </text>
                ))}
            </box>
            {espace === 'projets' ? (
                <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                    {lignesEspace('projets', d, projets).map((l: any) => (
                        <box key={l.cle} height={1} flexDirection="row" backgroundColor={detail && l.detail?.cle === detail.cle ? fond.panneauActif : survol === l.cle ? fond.selection : undefined}
                            {...survoler(l.cle)} onMouseDown={() => l.detail && ouvrirDetail(l.detail)}>
                            <text flexGrow={1} truncate>{'  '}{l.morceaux.map((m: any, i: number) => <span key={i} fg={m.c} attributes={m.gras ? GRAS : 0}>{m.t}</span>)}</text>
                            <text fg={l.couleurDroite}>{`${l.droite ?? ''} `}</text>
                        </box>
                    ))}
                </scrollbox>
            ) : (
                <box flexGrow={1} flexDirection="column">
                    <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                        {/* Mêmes cartes que l'interface Ink : équipes, puis sessions (membres d'équipe exclus, en pause à la fin) */}
                        {visibles.map((x: any) => (x.type === 'equipe'
                            ? <CarteEquipe key={`equipe-${x.e.id}`} e={x.e} largeur={largeur - 1} tic={tic} ouvrir={() => lancer(`/equipe ${x.e.id}`)} />
                            : <Carte key={x.s.cle} s={x.s} a={d.activites.get(x.s.sessionId)} active={x.s.cle === selection} survole={survol === x.s.cle}
                                largeur={largeur - 1} tic={tic} choisir={() => choisir(x.s.cle === selection ? undefined : x.s.cle)}
                                survoler={(v: boolean) => setSurvol(v ? x.s.cle : undefined)}
                                menu={() => ouvrirMenu(menuSession(x.s, () => choisir(x.s.cle)))} lancer={lancer} />))}
                        {!visibles.length && <text fg={fond.discret}>  aucune session active</text>}
                        {cachees > 0 && (
                            <box height={1} onMouseDown={() => setInactives((v) => !v)} {...survoler('inactives')}>
                                <text fg={survol === 'inactives' ? fond.texte : fond.discret}>
                                    {inactives ? `  − cacher les ${cachees} inactive${cachees > 1 ? 's' : ''}` : `  + ${cachees} inactive${cachees > 1 ? 's' : ''} (terminées, en pause)`}
                                </text>
                            </box>
                        )}
                    </scrollbox>
                    <box height={1} flexDirection="row">
                        <text> </text>
                        <text fg={theme.accent} attributes={survol === 'nouvelle' ? GRAS : 0} onMouseDown={() => lancer('/nouvelle', true)} {...survoler('nouvelle')}>+ Session</text>
                        <text>{'   '}</text>
                        <text fg={theme.secondaire} attributes={survol === 'terminal' ? GRAS : 0} onMouseDown={() => lancer('/terminal', true)} {...survoler('terminal')}>❯ Terminal</text>
                    </box>
                    <text> </text>
                    <Maitre {...maitre} tic={tic} />
                </box>
            )}
            <text> </text>
            <Entete titre="DOCKER" droite={replie.docker ? '▸' : '▾'} clic={() => setReplie((r) => ({ ...r, docker: !r.docker }))} />
            {!replie.docker && docker.slice(0, 4).map((l, i) => (
                <box key={i} height={1} paddingLeft={1} onMouseDown={(e: any) => (droit(e) ? ouvrirMenu(menuDocker()) : lancer('/docker', true))}><Ansi texte={l} /></box>
            ))}
            <text> </text>
            <Entete titre="SERVEURS SSH" droite={`${d.serveurs.length} ${replie.ssh ? '▸' : '▾'}`} clic={() => setReplie((r) => ({ ...r, ssh: !r.ssh }))} />
            {!replie.ssh && serveurs.map((s: any) => {
                const ok = d.joignables.get(s);
                const acces = d.acces[s.nom];
                return (
                    <box key={s.nom} height={1} paddingLeft={1} flexDirection="row" backgroundColor={survol === `ssh:${s.nom}` ? fond.selection : undefined}
                        {...survoler(`ssh:${s.nom}`)} onMouseDown={(e: any) => (droit(e) ? ouvrirMenu(menuServeur(s)) : ouvrirDetail({ type: 'serveur', cle: s.nom }))}>
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

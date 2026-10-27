import * as path from 'path';
import type { Donnees } from './donnees.js';
import { decrireConnexion } from './donnees.js';
import { serveursPertinents } from './Panneau.js';
import { depotDe, lireSynchro } from '../synchro.js';
import { metriquesDe } from '../metriques.js';
import { theme, couleurProjet, fond } from '../theme.js';
import type { Projet } from '../projets.js';

// Espaces de travail de la colonne de gauche : une seule chose à la fois (Sessions, Projets, SSH, Docker)

export type Espace = 'sessions' | 'projets' | 'serveurs' | 'docker';
export const ESPACES: { cle: Espace; label: string }[] = [
    { cle: 'sessions', label: 'Sessions' },
    { cle: 'projets', label: 'Projets' },
    { cle: 'serveurs', label: 'SSH' },
    { cle: 'docker', label: 'Docker' },
];

// Position des onglets (ligne 0 de la colonne) : marge de 1, puis libellé + 2 espaces
export function ongletsPositions(): { cle: Espace; x: number; largeur: number }[] {
    let x = 1;
    return ESPACES.map((e) => {
        const o = { cle: e.cle, x, largeur: e.label.length };
        x += e.label.length + 2;
        return o;
    });
}

export type Detail = { type: 'projet' | 'serveur' | 'conteneur'; cle: string };
export type Morceau = { t: string; c?: string; gras?: boolean };

export interface LigneEspace {
    cle: string;               // identifiant de la ligne (survol, sélection)
    morceaux: Morceau[];
    droite?: string;
    couleurDroite?: string;
    titre?: boolean;           // en-tête de groupe (pas de fond)
    detail?: Detail;           // ce que le clic ouvre
    commande?: string;         // ou la commande qu'il lance
}

const etatCourt = (chemin: string): string => {
    const d = depotDe(chemin);
    if (!d) return '';
    return [d.modifs ? `✎${d.modifs}` : '', d.retard ? `↓${d.retard}` : '', d.avance ? `↑${d.avance}` : ''].filter(Boolean).join(' ') || '✓';
};

export function lignesEspace(espace: Espace, d: Donnees, projets: Projet[]): LigneEspace[] {
    if (espace === 'projets') {
        // Les plus actifs d'abord (dernier commit), une session Claude en cours marquée ✻
        const date = (p: Projet) => depotDe(p.chemin)?.dernierCommit?.date.getTime() ?? 0;
        return [...projets].sort((a, b) => date(b) - date(a)).map((p) => {
            const d2 = depotDe(p.chemin);
            const sessions = d.agents.filter((a) => path.resolve(a.cwd).toLowerCase().startsWith(path.resolve(p.chemin).toLowerCase())).length;
            const etat = etatCourt(p.chemin);
            return {
                cle: `projet:${p.chemin}`,
                morceaux: [{ t: '● ', c: couleurProjet(p.nom) }, { t: p.nom, gras: true, c: fond.texte }, { t: sessions ? `  ✻${sessions}` : '', c: theme.accent }],
                droite: d2 ? `⎇ ${d2.branche.length > 14 ? d2.branche.slice(0, 13) + '…' : d2.branche} ${etat}` : '',
                couleurDroite: etat === '✓' ? fond.discret : '#facc15',
                detail: { type: 'projet', cle: p.chemin },
            };
        });
    }
    if (espace === 'serveurs') {
        const pertinents = serveursPertinents(d);
        const tous = [...pertinents, ...d.serveurs.filter((s) => !pertinents.includes(s))];
        const actives = d.connexions.map((cx) => decrireConnexion(cx, d));
        return tous.flatMap((s): LigneEspace[] => {
            const ok = d.joignables.get(s);
            const acces = d.acces[s.nom];
            const m = metriquesDe(s.nom);
            const connecte = actives.filter((a) => a.serveur === s).length;
            const usage = (d.usage.get(s) ?? []).length;
            const detail: Detail = { type: 'serveur', cle: s.nom };
            return [
                {
                    cle: `serveur:${s.nom}`, detail,
                    morceaux: [{ t: '● ', c: ok === undefined ? fond.eteint : ok ? '#4ade80' : '#f87171' }, { t: s.nom, gras: true, c: fond.texte }],
                    droite: `${connecte ? '⇄ ' : ''}${acces ? (acces.ok ? 'clé' : 'mdp') : ''}`,
                    couleurDroite: connecte ? theme.accent : acces?.ok ? '#4ade80' : fond.discret,
                },
                {
                    cle: `serveur:${s.nom}`, detail,
                    morceaux: [{
                        t: m && !m.erreur
                            ? `  charge ${m.charge?.toFixed(1)} · RAM ${m.memoire ?? '?'}% · disque ${m.disque ?? '?'}%${m.conteneurs ? ` · ◫ ${m.conteneurs}` : ''}`
                            : `  ${s.ip ?? s.hote}${usage ? ` · ${usage} projet${usage > 1 ? 's' : ''}` : ''}`,
                        c: 'gray',
                    }],
                },
            ];
        });
    }
    // Docker : un groupe par hôte (ce poste, puis les serveurs surveillés), conteneurs en marche d'abord
    return d.docker.flatMap((h): LigneEspace[] => {
        const en = h.conteneurs.filter((c) => c.enMarche).length;
        const titre: LigneEspace = {
            cle: `hote:${h.nom}`, titre: true, commande: '/docker',
            morceaux: [{ t: h.serveur ? `◫ ${h.nom}` : '◫ ce poste', gras: true, c: theme.primaire }],
            droite: h.erreur ? h.erreur : `${en}/${h.conteneurs.length}`, couleurDroite: h.erreur ? '#f87171' : fond.discret,
        };
        const conteneurs = [...h.conteneurs].sort((a, b) => Number(b.enMarche) - Number(a.enMarche)).map((c): LigneEspace => ({
            cle: `conteneur:${h.nom}|${c.id}`,
            detail: { type: 'conteneur', cle: `${h.nom}|${c.id}` },
            morceaux: [
                { t: '● ', c: !c.enMarche ? fond.eteint : c.sante === 'unhealthy' ? '#facc15' : '#4ade80' },
                { t: c.nom, c: c.enMarche ? fond.texte : fond.eteint, gras: c.enMarche },
            ],
            droite: c.enMarche ? [c.cpu, c.memoire].filter(Boolean).join(' · ') : 'arrêté',
            couleurDroite: fond.discret,
        }));
        return [titre, ...conteneurs];
    });
}

export const totalSynchro = () => lireSynchro().depots.length;

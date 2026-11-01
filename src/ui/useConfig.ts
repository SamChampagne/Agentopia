import { compteClaude, type CompteClaude } from '../configCommandes.js';
import { etatCompteGitHub, type EtatCompteGitHub } from '../compteGitHub.js';
import { lireEtatConfig, lignesConfig, type LigneConfig } from './configModele.js';
import { bus } from './bus.js';

const normaliser = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
export function filtrerConfig(lignes: LigneConfig[], recherche: string): LigneConfig[] {
    if (!recherche.trim()) return lignes;
    const mots = normaliser(recherche).trim().split(/\s+/), resultat: LigneConfig[] = [];
    let section: Extract<LigneConfig, { type: 'section' }> | undefined, ajoutee = false;
    for (const ligne of lignes) {
        if (ligne.type === 'section') { section = ligne; ajoutee = false; continue; }
        const texte = normaliser(`${section?.texte || ''} ${ligne.label} ${ligne.valeur} ${ligne.aide}`);
        if (!mots.every(m => texte.includes(m))) continue;
        if (section && !ajoutee) { resultat.push(section); ajoutee = true; }
        resultat.push(ligne);
    }
    return resultat;
}
// Ink et OpenTUI utilisent deux versions de React : les hooks viennent du rendu appelant.
export function creerUseConfig(hooks: Pick<typeof import('react'), 'useEffect' | 'useRef' | 'useState'>) {
    const { useEffect, useRef, useState } = hooks;
    return function useConfig(fermer: () => void) {
        const [etat] = useState(lireEtatConfig);
        const [claude, setClaude] = useState<CompteClaude>();
        const [github, setGitHub] = useState<EtatCompteGitHub>();
        const [recherche, setRecherche] = useState(''), [edition, setEdition] = useState(false), [position, setPosition] = useState(0);
        const texteClavier = useRef(''), editionClavier = useRef(false), positionClavier = useRef(0);
        // Une nouvelle demande peut réutiliser le composant dans la même frame React.
        const fermetureDemandee = useRef<(() => void) | undefined>(undefined);
        const estFermee = () => fermetureDemandee.current === fermer;
        const quitter = () => { if (!estFermee()) { fermetureDemandee.current = fermer; fermer(); } };
        useEffect(() => {
            let actif = true;
            void compteClaude().then(v => { if (actif) setClaude(v); }).catch(() => { if (actif) setClaude({ connecte: false }); });
            void etatCompteGitHub().then(v => { if (actif) setGitHub(v); }).catch(() => { if (actif) setGitHub({ ok: false, texte: 'Connexion à vérifier' }); });
            return () => { actif = false; };
        }, []);
        const toutes = lignesConfig(etat, claude, github), refLignes = useRef(toutes); refLignes.current = toutes;
        const lignes = filtrerConfig(toutes, recherche);
        const indices = lignes.flatMap((l, i) => l.type === 'reglage' ? [i] : []);
        const courant = indices[Math.min(position, Math.max(0, indices.length - 1))] ?? -1;
        const selection = lignes[courant];
        const deplacer = (p: number) => { positionClavier.current = p; setPosition(p); };
        const filtrer = (t: string) => { texteClavier.current = t.slice(0, 120); setRecherche(texteClavier.current); deplacer(0); };
        const editer = (v: boolean) => { editionClavier.current = v; setEdition(v); };
        const activer = (index?: number) => {
            if (estFermee()) return;
            const actuelles = filtrerConfig(refLignes.current, texteClavier.current);
            const choix = actuelles.filter(l => l.type === 'reglage');
            const l = index === undefined ? choix[Math.min(positionClavier.current, choix.length - 1)] : actuelles[index];
            if (l?.type !== 'reglage') return;
            quitter(); bus.emit('lancer', [l.commande, '/config']);
        };
        const naviguer = (delta: number) => {
            if (estFermee()) return;
            const n = filtrerConfig(refLignes.current, texteClavier.current).filter(l => l.type === 'reglage').length;
            deplacer(Math.max(0, Math.min(n - 1, positionClavier.current + delta)));
        };
        const clavier = (texte: string, touche: string, ctrl = false, meta = false) => {
            if (estFermee()) return;
            if (touche === 'escape') {
                if (editionClavier.current || texteClavier.current) { editer(false); filtrer(''); } else quitter();
                return;
            }
            if (touche === 'up') return naviguer(-1);
            if (touche === 'down') return naviguer(1);
            if (touche === 'return') return activer();
            if (!editionClavier.current) {
                if (texte === '/') editer(true);
                else if (texte === 'q') quitter();
                return;
            }
            if (touche === 'backspace' || touche === 'delete') return filtrer(Array.from(texteClavier.current).slice(0, -1).join(''));
            if (ctrl && texte === 'u') return filtrer('');
            if (!ctrl && !meta && texte && !/[\x00-\x1f\x7f]/.test(texte)) filtrer(texteClavier.current + texte);
        };
        return { lignes, courant, selection, recherche, edition, activer, naviguer, clavier };
    }
}

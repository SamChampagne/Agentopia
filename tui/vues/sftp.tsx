import { useConnexionSftp } from '../connexionSftp.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS, couper } from '../style.ts';
import { Titre, Boutons } from './commun.tsx';
import { ilYa } from '../../dist/ui/Panneau.js';
import { Sftp, cheminCopieSftp, tailleLisible } from '../../dist/sftp.js';
import { lancerDetache } from '../../dist/lanceurs.js';
import { theme, fond } from '../../dist/theme.js';

// Fichiers d'un serveur (SFTP) : parcourir, ouvrir dans VS Code (copie locale), télécharger, envoyer, créer, supprimer
const posix = path.posix;
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);
const TELECHARGEMENTS = path.join(os.homedir(), 'Downloads');
const BOUTONS = [
    { label: '↑ Parent', action: 'parent' }, { label: '◧ Ouvrir', action: 'ouvrir' }, { label: '⤓ Télécharger', action: 'telecharger' },
    { label: '⤒ Envoyer', action: 'envoyer' }, { label: '+ Dossier', action: 'dossier' }, { label: '− Supprimer', action: 'supprimer' },
    { label: '↻', action: 'rafraichir' }, { label: '← Retour', action: 'fermer' },
];

export function VueSftp({ fermer, cible, creerConnexion }: { fermer: () => void; cible: any; creerConnexion?: (cible: any) => Sftp }) {
    const [chemin, setChemin] = useState('');
    const [entrees, setEntrees] = useState<any[]>();
    const [index, setIndex] = useState(0);
    const [survol, setSurvol] = useState<number>();
    const [message, setMessage] = useState(`Connexion à ${cible.utilisateur}@${cible.hote}…`);
    const [erreur, setErreur] = useState(false);
    const [saisie, setSaisie] = useState<{ quoi: 'envoyer' | 'dossier'; texte: string }>();
    const [aConfirmer, setAConfirmer] = useState<string>();
    const dire = (texte: string, estErreur = false) => {
        setMessage(texte);
        setErreur(estErreur);
    };
    async function ouvrirDossier(dossier: string) {
        try {
            const liste = await sftp.current!.lister(dossier);
            setChemin(dossier);
            setEntrees(liste);
            setIndex(0);
            dire(`${liste.length} élément${liste.length > 1 ? 's' : ''}`);
            return true;
        } catch (e) {
            dire(`✕ ${(e as Error).message}`, true);
            return false;
        }
    }
    const { sftp, confiance, accepter, refuser } = useConnexionSftp(cible, async (s) => {
        return ouvrirDossier(await s.reel(cible.dossier || '.'));
    }, dire, creerConnexion);

    const liste = entrees ?? [];
    const courante = liste[index];
    async function ouvrir(e?: any) {
        if (!e || !sftp.current) return;
        const distant = posix.join(chemin, e.nom);
        if (e.dossier || (e.lien && (await sftp.current.estDossier(distant)))) return ouvrirDossier(distant);
        // Fichier : copie locale, ouverte dans VS Code
        const local = cheminCopieSftp(cible.nom, distant);
        dire(`Téléchargement de ${e.nom}…`);
        try {
            await sftp.current.telecharger(distant, local);
            lancerDetache('code', [local]);
            dire(`✓ ${e.nom} ouvert dans VS Code (copie locale : ${local}) · « ⤒ Envoyer » pour renvoyer une version modifiée`);
        } catch (err) {
            dire(`✕ ${(err as Error).message}`, true);
        }
    }
    async function agir(action: string) {
        if (action === 'accepter-cle') return accepter();
        if (action === 'refuser-cle') return refuser();
        if (confiance && action !== 'fermer') return;
        if (action !== aConfirmer) setAConfirmer(undefined);
        if (action === 'fermer') return fermer();
        if (!sftp.current || entrees === undefined) return;
        if (action === 'parent') return ouvrirDossier(posix.dirname(chemin));
        if (action === 'rafraichir') return ouvrirDossier(chemin);
        if (action === 'ouvrir') return ouvrir(courante);
        if (action === 'envoyer') return setSaisie({ quoi: 'envoyer', texte: TELECHARGEMENTS + path.sep });
        if (action === 'dossier') return setSaisie({ quoi: 'dossier', texte: '' });
        if (!courante) return;
        const distant = posix.join(chemin, courante.nom);
        if (action === 'telecharger') {
            if (courante.dossier) return dire('Seuls les fichiers se téléchargent (ouvre le dossier et choisis un fichier)', true);
            const local = path.join(TELECHARGEMENTS, courante.nom);
            dire(`Téléchargement de ${courante.nom}…`);
            try {
                await sftp.current.telecharger(distant, local);
                dire(`✓ ${courante.nom} → ${local}`);
            } catch (e) {
                dire(`✕ ${(e as Error).message}`, true);
            }
        }
        if (action === 'supprimer') {
            // Supprimer se confirme par un second clic
            if (aConfirmer !== 'supprimer') {
                setAConfirmer('supprimer');
                return dire(`! Supprimer ${courante.nom} sur ${cible.nom} ? Reclique « − Supprimer » pour confirmer`, true);
            }
            setAConfirmer(undefined);
            try {
                await sftp.current.supprimer(distant, courante.dossier);
                await ouvrirDossier(chemin);
                dire(`✓ ${courante.nom} supprimé`);
            } catch (e) {
                dire(`✕ ${(e as Error).message}${courante.dossier ? ' (un dossier doit être vide)' : ''}`, true);
            }
        }
    }
    async function validerSaisie(quoi: 'envoyer' | 'dossier', texte: string) {
        setSaisie(undefined);
        if (!sftp.current || !texte.trim()) return;
        if (quoi === 'dossier') {
            try {
                await sftp.current.creerDossier(posix.join(chemin, texte.trim()));
                await ouvrirDossier(chemin);
                dire(`✓ Dossier ${texte.trim()} créé`);
            } catch (e) {
                dire(`✕ ${(e as Error).message}`, true);
            }
            return;
        }
        const local = texte.trim().replace(/^"|"$/g, '');
        if (!fs.existsSync(local) || fs.statSync(local).isDirectory()) return dire(`✕ Fichier introuvable : ${local}`, true);
        dire(`Envoi de ${path.basename(local)}…`);
        try {
            await sftp.current.envoyer(local, posix.join(chemin, path.basename(local)));
            await ouvrirDossier(chemin);
            dire(`✓ ${path.basename(local)} envoyé dans ${chemin}`);
        } catch (e) {
            dire(`✕ ${(e as Error).message}`, true);
        }
    }
    useKeyboard((k) => {
        if (confiance) { if (k.name === 'escape' || k.sequence === 'q') return refuser(); if (k.sequence === 'o' && !k.ctrl && !k.meta) accepter(); return; }

        if (saisie) {
            if (k.name === 'escape') setSaisie(undefined);
            return;   // le champ gère la frappe et Entrée
        }
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') setIndex((i) => Math.max(0, i - 1));
        if (k.name === 'down') setIndex((i) => Math.min(liste.length - 1, i + 1));
        if (k.name === 'return') void ouvrir(courante);
        if (k.name === 'backspace' || k.name === 'left') void agir('parent');
    });
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte={`⇅ FICHIERS · ${cible.nom}`} droite={`${cible.utilisateur}@${cible.hote} · ${chemin || '…'}`} />
            <Boutons boutons={confiance ? [{ label: 'Annuler (Échap)', action: 'refuser-cle' }, { label: 'Accepter la clé (o)', action: 'accepter-cle' }] : BOUTONS} agir={(a) => void agir(a)} />
            {confiance && <box flexShrink={0} flexDirection="column">
                <text wrapMode="word" fg={theme.accent}>Première connexion · {confiance.serveur}</text>
                <text wrapMode="word" selectable>{confiance.empreinte}</text>
                <text wrapMode="word">Compare cette empreinte avec celle fournie par l’administrateur du serveur. Aucun identifiant n’a encore été envoyé.</text>
            </box>}
            {saisie ? (
                <box height={1} flexDirection="row">
                    <text fg={theme.accent}>{saisie.quoi === 'envoyer' ? 'Fichier local à envoyer : ' : 'Nom du nouveau dossier : '}</text>
                    <input flexGrow={1} focused value={saisie.texte} onSubmit={(v: unknown) => { if (typeof v === 'string') void validerSaisie(saisie.quoi, v); }} />
                    <text fg="gray">  Entrée valider · Échap annuler</text>
                </box>
            ) : <text truncate fg={erreur ? '#f87171' : message.startsWith('✓') ? '#4ade80' : 'gray'}>{message}</text>}
            <text fg="gray">{'  ' + colonne('Nom', 60) + colonne('Taille', 12) + 'Modifié'}</text>
            <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {entrees === undefined && !erreur && <text fg="gray">  connexion…</text>}
                {liste.map((e, i) => {
                    const actif = i === index;
                    return (
                        <box key={e.nom} height={1} backgroundColor={actif ? fond.selection : survol === i ? fond.panneau : undefined}
                            onMouseOver={() => setSurvol(i)} onMouseOut={() => setSurvol(undefined)}
                            onMouseDown={() => (actif ? void ouvrir(e) : setIndex(i))}>
                            <text truncate>
                                <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                <span fg={e.dossier ? theme.primaire : undefined} attributes={e.dossier ? GRAS : 0}>{colonne(`${e.dossier ? '▸ ' : e.lien ? '↪ ' : '· '}${e.nom}${e.dossier ? '/' : ''}`, 60)}</span>
                                <span fg="gray">{colonne(e.dossier ? '—' : tailleLisible(e.taille), 12)}</span>
                                <span fg="gray">{`il y a ${ilYa(e.date)}`}</span>
                            </text>
                        </box>
                    );
                })}
                {entrees?.length === 0 && <text fg="gray">  (dossier vide)</text>}
            </scrollbox>
        </box>
    );
}

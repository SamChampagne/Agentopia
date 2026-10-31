import { useConnexionSftp } from './connexionSftp.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, LigneBoutons, Separateur, Titre } from './Vues.js';
import { placerBoutons, boutonA } from './mise.js';
import { ilYa } from './Panneau.js';
import { Sftp, ConnexionSftp, Entree, cheminCopieSftp, tailleLisible } from '../sftp.js';
import { lancerDetache } from '../lanceurs.js';
import { theme, fond } from '../theme.js';

const posix = path.posix;
const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, Math.max(0, n - 2)) + '… ' : s.padEnd(n));
const TELECHARGEMENTS = path.join(os.homedir(), 'Downloads');

// Petite saisie dans la vue (chemin à envoyer, nom de dossier) : la vue reste ouverte
type Saisie = { quoi: 'envoyer' | 'dossier'; texte: string };

export function VueSftp({ fermer, cible }: { fermer: () => void; cible: ConnexionSftp }) {
    const { largeur, hauteur } = useTailleVue();
    const [chemin, setChemin] = useState('');
    const [entrees, setEntrees] = useState<Entree[]>();
    const [index, setIndex] = useState(0);
    const [message, setMessage] = useState(`Connexion à ${cible.utilisateur}@${cible.hote}…`);
    const [erreur, setErreur] = useState(false);
    const [saisie, setSaisie] = useState<Saisie>();
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
    }, dire);

    const liste = entrees ?? [];
    const courante = liste[index];
    const zone = Math.max(3, hauteur - 6);
    const premier = Math.max(0, Math.min(index - Math.floor(zone / 2), liste.length - zone));
    const boutons = placerBoutons(confiance ? [{ label: 'Annuler (Échap)', action: 'refuser-cle' }, { label: 'Accepter la clé (o)', action: 'accepter-cle' }] : [
        { label: '↑ Parent', action: 'parent' },
        { label: '◧ Ouvrir', action: 'ouvrir' },
        { label: '⤓ Télécharger', action: 'telecharger' },
        { label: '⤒ Envoyer', action: 'envoyer' },
        { label: '+ Dossier', action: 'dossier' },
        { label: '− Supprimer', action: 'supprimer' },
        { label: '↻', action: 'rafraichir' },
        { label: '← Retour', action: 'fermer' },
    ], 0);

    async function ouvrir(e?: Entree) {
        if (!e || !sftp.current) return;
        const distant = posix.join(chemin, e.nom);
        if (e.dossier || (e.lien && (await sftp.current.estDossier(distant)))) return ouvrirDossier(distant);
        // Fichier : copie locale, ouverte dans VS Code (ou l'application par défaut)
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

    async function validerSaisie(s: Saisie) {
        setSaisie(undefined);
        if (!sftp.current || !s.texte.trim()) return;
        if (s.quoi === 'dossier') {
            try {
                await sftp.current.creerDossier(posix.join(chemin, s.texte.trim()));
                await ouvrirDossier(chemin);
                dire(`✓ Dossier ${s.texte.trim()} créé`);
            } catch (e) {
                dire(`✕ ${(e as Error).message}`, true);
            }
            return;
        }
        const local = s.texte.trim().replace(/^"|"$/g, '');
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

    useClicsVue((x, y) => {
        if (y === 1) {
            const b = boutonA(boutons, x - 1);
            if (b) void agir(b.action);
            return;
        }
        const i = premier + y - 5;
        if (y >= 5 && i < liste.length) {
            if (i === index) return void ouvrir(liste[i]);   // 2e clic sur la même ligne : ouvrir
            setIndex(i);
        }
    }, (sens) => setIndex((i) => Math.max(0, Math.min(liste.length - 1, i - sens * 3))));

    useInput((input, key) => {
        if (confiance) { if (key.escape || input === 'q') return refuser(); if (input === 'o' && !key.ctrl && !key.meta) accepter(); return; }

        if (saisie) {
            if (key.escape) return setSaisie(undefined);
            if (key.return) return void validerSaisie(saisie);
            if (key.backspace || key.delete) return setSaisie({ ...saisie, texte: saisie.texte.slice(0, -1) });
            if (input && !key.ctrl && !key.meta) setSaisie({ ...saisie, texte: saisie.texte + input });
            return;
        }
        if (key.escape || input === 'q') return fermer();
        if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
        if (key.downArrow) setIndex((i) => Math.min(liste.length - 1, i + 1));
        if (key.return) void ouvrir(courante);
        if (key.backspace || key.leftArrow) void agir('parent');
    });

    const largeurNom = Math.max(20, largeur - 2 - 12 - 16);
    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte={`⇅ FICHIERS · ${cible.nom}`} droite={`${cible.utilisateur}@${cible.hote} · ${chemin || '…'}`} />
            <LigneBoutons boutons={boutons} />
            {confiance && <Box flexDirection="column" flexShrink={0}>
                <Text color={theme.accent}>Première connexion · {confiance.serveur}</Text>
                <Text>{confiance.empreinte}</Text>
                <Text>Compare l’empreinte avec celle de l’administrateur du serveur. Aucun identifiant envoyé.</Text>
            </Box>}
            <Box height={1} flexShrink={0} overflow="hidden">
                {saisie
                    ? <Text wrap="truncate-start"><Text color={theme.accent}>{saisie.quoi === 'envoyer' ? 'Fichier local à envoyer : ' : 'Nom du nouveau dossier : '}</Text>{saisie.texte}<Text inverse> </Text><Text color="gray">  Entrée valider · Échap annuler</Text></Text>
                    : <Text wrap="truncate-end" color={erreur ? '#f87171' : message.startsWith('✓') ? '#4ade80' : 'gray'}>{message}</Text>}
            </Box>
            <Separateur largeur={largeur - 2} />
            <Box height={1} flexShrink={0}><Text color="gray">{'  ' + ajuste('Nom', largeurNom) + ajuste('Taille', 12) + 'Modifié'}</Text></Box>
            <Box flexDirection="column" height={zone} flexShrink={0} overflow="hidden">
                {entrees === undefined && !erreur && <Text color="gray">  connexion…</Text>}
                {liste.slice(premier, premier + zone).map((e, i) => {
                    const actif = premier + i === index;
                    return (
                        <Box key={e.nom} height={1} overflow="hidden">
                            <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                                <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                                <Text color={e.dossier ? theme.primaire : undefined} bold={e.dossier}>{ajuste(`${e.dossier ? '▸ ' : e.lien ? '↪ ' : '· '}${e.nom}${e.dossier ? '/' : ''}`, largeurNom)}</Text>
                                <Text color="gray">{ajuste(e.dossier ? '—' : tailleLisible(e.taille), 12)}</Text>
                                <Text color="gray">{`il y a ${ilYa(e.date)}`}</Text>
                            </Text>
                        </Box>
                    );
                })}
                {entrees?.length === 0 && <Text color="gray">  (dossier vide)</Text>}
            </Box>
        </Box>
    );
}

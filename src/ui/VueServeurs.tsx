import * as os from 'os';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDonnees, decrireConnexion, rafraichirAcces, rafraichirDocker } from './donnees.js';
import { useTailleVue, useClicsVue, LigneBoutons, Separateur, Titre } from './Vues.js';
import { serveursPertinents, ilYa } from './Panneau.js';
import { placerBoutons, boutonA } from './mise.js';
import { Serveur, testerAcces, lireAcces, sauverAcces } from '../ssh.js';
import { sauverConfig } from '../config.js';
import { config } from '../commandes.js';
import { nomDossierClaude } from '../usage.js';
import { ouvrirOnglet } from '../lanceurs.js';
import { useProjets } from './projets.js';
import { theme, fond } from '../theme.js';
import { bus } from './bus.js';

// Un bloc de 4 lignes + 1 vide par serveur
const BLOC = 5;

const BOUTONS = [
    { label: '⇄ Se connecter', action: 'connecter' },
    { label: '⇅ Fichiers', action: 'fichiers' },
    { label: '✓ Tester', action: 'tester' },
    { label: '⚿ Installer ma clé', action: 'cle' },
    { label: '◫ Docker', action: 'docker' },
    { label: '+ Ajouter', action: 'ajouter' },
    { label: '✎ Modifier', action: 'modifier' },
    { label: '− Retirer', action: 'supprimer' },
    { label: '← Retour', action: 'fermer' },
];
// Ces actions posent des questions (formulaire) : la vue se ferme et la commande prend le relais
const PAR_COMMANDE: Record<string, (s?: Serveur) => string> = {
    ajouter: () => '/ssh-ajouter',
    modifier: (s) => `/ssh-modifier ${s?.nom ?? ''}`,
    supprimer: (s) => `/ssh-supprimer ${s?.nom ?? ''}`,
    cle: (s) => `/ssh-cle ${s?.nom ?? ''}`,
    fichiers: (s) => `/sftp ${s?.configure ? s.nom : ''}`,
};

const cible = (s: Serveur) => (s.configure ? s.nom : `${s.utilisateur ? s.utilisateur + '@' : ''}${s.hote}`);

export function VueServeurs({ fermer, initial }: { fermer: () => void; initial?: string }) {
    const d = useDonnees();
    const { largeur, hauteur } = useTailleVue();
    const [tous, setTous] = useState(false);
    const [choix, setChoix] = useState<string | undefined>(initial);
    const [message, setMessage] = useState('');
    const [debut, setDebut] = useState(0);

    const liste = tous ? d.serveurs : serveursPertinents(d);
    const courant = liste.find((s) => s.nom === choix) ?? liste[0];
    const index = Math.max(0, liste.indexOf(courant));
    const parPage = Math.max(1, Math.floor((hauteur - 4) / BLOC));
    let premier = Math.max(0, Math.min(debut, liste.length - parPage));
    if (index < premier) premier = index;
    if (index >= premier + parPage) premier = index - parPage + 1;
    const visibles = liste.slice(premier, premier + parPage);
    const boutons = placerBoutons(BOUTONS, 0);

    async function agir(action: string) {
        if (action === 'fermer') return fermer();
        if (action === 'ajouter' || (courant && PAR_COMMANDE[action])) {
            if (courant && !courant.configure && ['modifier', 'supprimer', 'cle'].includes(action)) {
                return setMessage(`✕ ${courant.nom} n'est que dans known_hosts : « + Ajouter » pour le configurer`);
            }
            fermer();
            return void bus.emit('lancer', PAR_COMMANDE[action](courant).trim());
        }
        if (!courant) return;
        if (action === 'connecter') {
            ouvrirOnglet(os.homedir(), `⇄ ${courant.nom}`, `ssh ${cible(courant)}`);
            setMessage(`✓ Connexion à ${courant.nom} dans un nouvel onglet`);
        }
        if (action === 'tester') {
            setMessage(`Test de la connexion par clé sur ${courant.nom}…`);
            const res = await testerAcces(courant);
            const acces = lireAcces();
            acces[courant.nom] = res;
            sauverAcces(acces);
            rafraichirAcces();
            setMessage(res.ok ? `✓ ${courant.nom} : Claude peut s'y connecter seul (clé)` : `✕ ${courant.nom} : ${res.message}`);
        }
        if (action === 'docker') {
            const actif = config.dockerDistant.includes(courant.nom);
            config.dockerDistant = actif ? config.dockerDistant.filter((n) => n !== courant.nom) : [...config.dockerDistant, courant.nom];
            sauverConfig(config);
            setMessage(actif ? `Docker de ${courant.nom} n'est plus surveillé` : `Lecture des conteneurs de ${courant.nom}…`);
            await rafraichirDocker();
            if (!actif) {
                const h = (await import('./donnees.js')).lireDonnees().docker.find((x) => x.nom === courant.nom);
                setMessage(h?.erreur ? `✕ Docker sur ${courant.nom} : ${h.erreur}` : `✓ ${h?.conteneurs.length ?? 0} conteneurs sur ${courant.nom} · visibles dans la section Docker`);
            }
        }
    }

    useClicsVue((x, y) => {
        if (y === 1) {
            const b = boutonA(boutons, x);
            if (b) agir(b.action);
            return;
        }
        if (y === hauteur - 1 && !tous) return setTous(true);
        const s = visibles[Math.floor((y - 3) / BLOC)];
        if (s) setChoix(s.nom);
    }, (sens) => setChoix(liste[Math.max(0, Math.min(liste.length - 1, index - sens))]?.nom));

    useInput((input, key) => {
        if (key.escape || input === 'q') return fermer();
        if (key.upArrow) setChoix(liste[Math.max(0, index - 1)]?.nom);
        if (key.downArrow) setChoix(liste[Math.min(liste.length - 1, index + 1)]?.nom);
        if (key.return) agir('connecter');
        if (input === 't') agir('tester');
        if (input === 'f') agir('fichiers');
        if (premier !== debut) setDebut(premier);
    });

    const projets = useProjets();
    const caches = d.serveurs.length - liste.length;

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="SERVEURS SSH" droite={`${liste.length} serveur${liste.length > 1 ? 's' : ''}`} />
            <LigneBoutons boutons={boutons} />
            <Separateur largeur={largeur - 2} />
            <Box flexDirection="column" height={hauteur - 4} overflow="hidden">
                {!liste.length && <Text color="gray">Aucun serveur dans ~/.ssh/config ni known_hosts</Text>}
                {visibles.map((s) => {
                    const actif = s === courant;
                    const ok = d.joignables.get(s);
                    const acces = d.acces[s.nom];
                    const connexions = d.connexions.map((cx) => decrireConnexion(cx, d)).filter((x) => x.serveur === s);
                    const usage = d.usage.get(s) ?? [];
                    const docker = d.docker.find((h) => h.nom === s.nom);
                    const bord = actif ? theme.accent : fond.bordure;
                    return (
                        <Box key={s.nom} flexDirection="column" height={BLOC} flexShrink={0}>
                            {/* 1. Nom, adresse, état du port */}
                            <Box height={1} overflow="hidden">
                                <Text wrap="truncate-end">
                                    <Text color={bord}>{actif ? '▌ ' : '  '}</Text>
                                    <Text color={ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171'}>● </Text>
                                    <Text bold color={actif ? fond.texte : undefined}>{s.nom}</Text>
                                    <Text color="gray">{`   ${s.ip ?? s.hote}`}</Text>
                                    <Text color={ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171'}>
                                        {ok === undefined ? '   vérification…' : ok ? '   en ligne' : '   hors ligne'}
                                    </Text>
                                </Text>
                            </Box>
                            {/* 2. Accès de Claude + connexion en cours */}
                            <Box height={1} overflow="hidden">
                                <Text wrap="truncate-end">
                                    <Text color={bord}>{actif ? '▌ ' : '  '}</Text>
                                    <Text color="gray">{'  Claude : '}</Text>
                                    {!acces ? <Text color="gray">accès pas encore testé</Text>
                                        : acces.ok ? <Text color="#4ade80">peut s'y connecter seul (clé SSH)</Text>
                                            : <Text color="#facc15">{acces.message}</Text>}
                                    {connexions.length ? <Text color={theme.accent}>{`   ⇄ connecté maintenant : ${connexions.map((x) => x.session?.nom ?? 'un terminal').join(', ')}`}</Text> : null}
                                </Text>
                            </Box>
                            {/* 3. Projets d'où Claude l'utilise */}
                            <Box height={1} overflow="hidden">
                                <Text wrap="truncate-end">
                                    <Text color={bord}>{actif ? '▌ ' : '  '}</Text>
                                    <Text color="gray">{'  Utilisé depuis : '}</Text>
                                    {usage.length
                                        ? <Text>{usage.slice(0, 4).map((u) => `${nomDossierClaude(u.dossier, projets)} (${u.nombre} commandes, il y a ${ilYa(u.dernier)})`).join('  ·  ')}</Text>
                                        : <Text color="gray">aucun projet</Text>}
                                </Text>
                            </Box>
                            {/* 4. Compte et Docker */}
                            <Box height={1} overflow="hidden">
                                <Text wrap="truncate-end">
                                    <Text color={bord}>{actif ? '▌ ' : '  '}</Text>
                                    <Text color="gray">{`  Compte : ${s.utilisateur ?? '(par défaut)'}   ·   Docker : `}</Text>
                                    {!config.dockerDistant.includes(s.nom) ? <Text color="gray">non surveillé</Text>
                                        : docker?.erreur ? <Text color="#f87171">{docker.erreur}</Text>
                                            : <Text color="#4ade80">{`${docker?.conteneurs.filter((c) => c.enMarche).length ?? '…'} en marche / ${docker?.conteneurs.length ?? '…'}`}</Text>}
                                </Text>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            <Box height={1} overflow="hidden">
                <Text color={message.startsWith('✕') ? '#f87171' : message.startsWith('✓') ? '#4ade80' : 'gray'} wrap="truncate-end">
                    {message || `clic = choisir · Entrée se connecter · f fichiers · t tester · Échap fermer${!tous && caches ? `   ·   + ${caches} autres serveurs connus (clic ici)` : ''}`}
                </Text>
            </Box>
        </Box>
    );
}

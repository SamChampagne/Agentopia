import * as os from 'os';
import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS } from '../style.ts';
import { useDonnees } from '../donnees.ts';
import { Titre, Boutons } from './commun.tsx';
import { bus } from '../../dist/ui/bus.js';
import { decrireConnexion, rafraichirAcces, rafraichirDocker, lireDonnees } from '../../dist/ui/donnees.js';
import { serveursPertinents, ilYa } from '../../dist/ui/Panneau.js';
import { testerAcces, lireAcces, sauverAcces } from '../../dist/ssh.js';
import { sauverConfig } from '../../dist/config.js';
import { config, getProjets } from '../../dist/commandes.js';
import { nomDossierClaude } from '../../dist/usage.js';
import { ouvrirOnglet } from '../../dist/lanceurs.js';
import { theme, fond } from '../../dist/theme.js';

// Serveurs SSH : un bloc par serveur (état, accès de Claude, projets qui l'utilisent, compte et Docker)
const BOUTONS = [
    { label: '⇄ Se connecter', action: 'connecter' }, { label: '⇅ Fichiers', action: 'fichiers' }, { label: '✓ Tester', action: 'tester' },
    { label: '⚿ Installer ma clé', action: 'cle' }, { label: '◫ Docker', action: 'docker' }, { label: '+ Ajouter', action: 'ajouter' },
    { label: '✎ Modifier', action: 'modifier' }, { label: '− Retirer', action: 'supprimer' }, { label: '← Retour', action: 'fermer' },
];
// Ces actions posent des questions (formulaire) : la vue se ferme et la commande prend le relais
const PAR_COMMANDE: Record<string, (s?: any) => string> = {
    ajouter: () => '/ssh-ajouter',
    modifier: (s) => `/ssh-modifier ${s?.nom ?? ''}`,
    supprimer: (s) => `/ssh-supprimer ${s?.nom ?? ''}`,
    cle: (s) => `/ssh-cle ${s?.nom ?? ''}`,
    fichiers: (s) => `/sftp ${s?.configure ? s.nom : ''}`,
};
const cible = (s: any) => (s.configure ? s.nom : `${s.utilisateur ? s.utilisateur + '@' : ''}${s.hote}`);

export function VueServeurs({ fermer, initial }: { fermer: () => void; initial?: string }) {
    const d = useDonnees();
    const [tous, setTous] = useState(false);
    const [choix, setChoix] = useState<string | undefined>(initial);
    const [message, setMessage] = useState('');
    const liste: any[] = tous ? d.serveurs : serveursPertinents(d);
    const courant = liste.find((s) => s.nom === choix) ?? liste[0];
    const index = Math.max(0, liste.indexOf(courant));

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
            config.dockerDistant = actif ? config.dockerDistant.filter((n: string) => n !== courant.nom) : [...config.dockerDistant, courant.nom];
            sauverConfig(config);
            setMessage(actif ? `Docker de ${courant.nom} n'est plus surveillé` : `Lecture des conteneurs de ${courant.nom}…`);
            await rafraichirDocker();
            if (!actif) {
                const h = lireDonnees().docker.find((x: any) => x.nom === courant.nom);
                setMessage(h?.erreur ? `✕ Docker sur ${courant.nom} : ${h.erreur}` : `✓ ${h?.conteneurs.length ?? 0} conteneurs sur ${courant.nom} · visibles dans la section Docker`);
            }
        }
    }
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') setChoix(liste[Math.max(0, index - 1)]?.nom);
        if (k.name === 'down') setChoix(liste[Math.min(liste.length - 1, index + 1)]?.nom);
        if (k.name === 'return') void agir('connecter');
        if (k.sequence === 't') void agir('tester');
        if (k.sequence === 'f') void agir('fichiers');
    });

    const projets = getProjets();
    const caches = d.serveurs.length - liste.length;
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="SERVEURS SSH" droite={`${liste.length} serveur${liste.length > 1 ? 's' : ''}`} />
            <Boutons boutons={BOUTONS} agir={(a) => void agir(a)} />
            <text> </text>
            <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {!liste.length && <text fg="gray">Aucun serveur dans ~/.ssh/config ni known_hosts</text>}
                {liste.map((s) => {
                    const actif = s === courant;
                    const ok = d.joignables.get(s);
                    const acces = d.acces[s.nom];
                    const connexions = d.connexions.map((cx: any) => decrireConnexion(cx, d)).filter((x: any) => x.serveur === s);
                    const usage = d.usage.get(s) ?? [];
                    const docker = d.docker.find((h: any) => h.nom === s.nom);
                    const bord = <span fg={actif ? theme.accent : fond.bordure}>{actif ? '▌ ' : '  '}</span>;
                    const couleurEtat = ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171';
                    return (
                        <box key={s.nom} flexDirection="column" flexShrink={0} marginBottom={1} onMouseDown={() => setChoix(s.nom)}>
                            <text truncate>
                                {bord}<span fg={couleurEtat}>● </span>
                                <span fg={actif ? fond.texte : undefined} attributes={GRAS}>{s.nom}</span>
                                <span fg="gray">{`   ${s.ip ?? s.hote}`}</span>
                                <span fg={couleurEtat}>{ok === undefined ? '   vérification…' : ok ? '   en ligne' : '   hors ligne'}</span>
                            </text>
                            <text truncate>
                                {bord}<span fg="gray">{'  Claude : '}</span>
                                {!acces ? <span fg="gray">accès pas encore testé</span>
                                    : acces.ok ? <span fg="#4ade80">peut s'y connecter seul (clé SSH)</span> : <span fg="#facc15">{acces.message}</span>}
                                {connexions.length ? <span fg={theme.accent}>{`   ⇄ connecté maintenant : ${connexions.map((x: any) => x.session?.nom ?? 'un terminal').join(', ')}`}</span> : null}
                            </text>
                            <text truncate>
                                {bord}<span fg="gray">{'  Utilisé depuis : '}</span>
                                {usage.length
                                    ? <span>{usage.slice(0, 4).map((u: any) => `${nomDossierClaude(u.dossier, projets)} (${u.nombre} commandes, il y a ${ilYa(u.dernier)})`).join('  ·  ')}</span>
                                    : <span fg="gray">aucun projet</span>}
                            </text>
                            <text truncate>
                                {bord}<span fg="gray">{`  Compte : ${s.utilisateur ?? '(par défaut)'}   ·   Docker : `}</span>
                                {!config.dockerDistant.includes(s.nom) ? <span fg="gray">non surveillé</span>
                                    : docker?.erreur ? <span fg="#f87171">{docker.erreur}</span>
                                        : <span fg="#4ade80">{`${docker?.conteneurs.filter((c: any) => c.enMarche).length ?? '…'} en marche / ${docker?.conteneurs.length ?? '…'}`}</span>}
                            </text>
                        </box>
                    );
                })}
            </scrollbox>
            <box height={1} onMouseDown={() => !tous && caches && setTous(true)}>
                <text truncate fg={message.startsWith('✕') ? '#f87171' : message.startsWith('✓') ? '#4ade80' : 'gray'}>
                    {message || `clic = choisir · Entrée se connecter · f fichiers · t tester · Échap fermer${!tous && caches ? `   ·   + ${caches} autres serveurs connus (clic ici)` : ''}`}
                </text>
            </box>
        </box>
    );
}

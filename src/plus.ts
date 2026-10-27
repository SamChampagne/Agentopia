import type { Commande } from './commandes.js';
import { Config } from './config.js';
import { afficherVue } from './ui/bus.js';

// Commandes des améliorations « confort et utilité » : questions en attente, palette, reprise, coûts,
// modèles d'équipe, tâches planifiées, PR / CI, surveillance des logs, export / import…

async function vue<P extends object>(module: Promise<Record<string, unknown>>, nom: string, props: P = {} as P): Promise<void> {
    const m = await module;
    const React = await import('react');
    const Composant = m[nom] as (p: P & { fermer: () => void }) => JSX.Element;
    await afficherVue((fermer) => React.createElement(Composant, { ...props, fermer }));
}

// ─── Palette (Ctrl+K) : tout ce qu'on peut faire, une recherche floue ────────

const ACTIONS_PROJET: [string, string][] = [
    ['✻ Session Claude', '/claude'], ['✓ Commit', '/commit'], ['⌕ Revue du diff', '/revue'], ['⇣ Pull', '/pull'],
    ['◧ VS Code', '/code'], ['❯ Terminal', '/terminal defaut'], ['◆ Équipe', '/equipe nouvelle'], ['▤ Explorateur', '/ouvrir'], ['≡ Toutes les actions', '/actions'],
];

async function palette(): Promise<void> {
    const { COMMANDES, getProjets, executerLigne } = await import('./commandes.js');
    const { lireDonnees } = await import('./ui/donnees.js');
    const { lireEquipes } = await import('./equipe.js');
    const { choisir } = await import('./ui/bus.js');
    const d = lireDonnees();
    const choix: { label: string; valeur: string; description?: string }[] = [
        ...d.agents.map((s) => ({ label: `● ${s.nom}`, valeur: `/voir ${s.id ?? s.sessionId}`, description: `session · ${s.titre}` })),
        ...lireEquipes().map((e) => ({ label: `◆ Équipe ${e.nomProjet}`, valeur: `/equipe ${e.id}`, description: e.objectif })),
        ...COMMANDES.filter((c) => !c.cache).map((c) => ({ label: `/${c.nom}`, valeur: `/${c.nom}`, description: c.description })),
        ...d.serveurs.map((s) => ({ label: `⇄ ${s.nom}`, valeur: `/ssh ${s.nom}`, description: `se connecter · ${s.hote}` })),
        ...d.serveurs.filter((s) => s.configure).map((s) => ({ label: `⇅ Fichiers ${s.nom}`, valeur: `/sftp ${s.nom}`, description: 'SFTP' })),
        ...getProjets().flatMap((p) => ACTIONS_PROJET.map(([action, cmd]) => ({ label: `${action} · ${p.nom}`, valeur: `${cmd} ${p.chemin}`, description: p.racine }))),
    ];
    const commande = await choisir('⌘ Que veux-tu faire ? (plusieurs mots : « proj com » → Commit · mon-projet)', choix, true);
    await executerLigne(commande);
}

async function copierDe(sessionId: string, quoi: 'code' | 'reponse'): Promise<void> {
    const { lireDonnees } = await import('./ui/donnees.js');
    const { lireTranscript, dernierBlocCode, derniereReponse } = await import('./agents.js');
    const { copier } = await import('./lanceurs.js');
    const { bus } = await import('./ui/bus.js');
    const s = lireDonnees().agents.find((a) => a.sessionId === sessionId || a.id === sessionId);
    if (!s) return void bus.emit('notice', '✕ Session introuvable');
    const messages = lireTranscript(s.fichier);
    const code = quoi === 'code' ? dernierBlocCode(messages) : undefined;
    const texte = code ?? derniereReponse(messages);
    if (!texte) return void bus.emit('notice', '✕ Rien à copier dans cette conversation');
    copier(texte);
    const lignes = texte.split('\n').length;
    bus.emit('notice', `⎘ ${code ? 'Bloc de code' : quoi === 'code' ? 'Pas de bloc de code : dernière réponse' : 'Dernière réponse'} copié (${lignes} ligne${lignes > 1 ? 's' : ''})`);
}

export function commandesPlus(config: Config): Commande[] {
    const sauver = async () => (await import('./config.js')).sauverConfig(config);
    return [
        {
            nom: 'planifier', groupe: 'Claude',
            description: 'Planifier une session Claude chaque jour à une heure donnée (ex. revue des PR à 8 h)',
            executer: async () => {
                const { getProjets } = await import('./commandes.js');
                const { choisir, saisir } = await import('./ui/bus.js');
                const { c } = await import('./theme.js');
                const nom = (await saisir('Nom de la tâche (ex. Revue des PR du matin)')).trim();
                if (!nom) return;
                const projet = await choisir('Sur quel projet ?', getProjets().map((p) => ({ label: p.nom, valeur: p.chemin, description: p.racine })), true);
                const depart = await choisir('Consigne', [
                    { label: '✎ Écrire la consigne', valeur: '' },
                    { label: '◷ Revue des pull requests ouvertes', valeur: 'Fais la revue des pull requests ouvertes de ce dépôt : résume chacune, signale les problèmes, propose des corrections.' },
                    { label: '! npm audit / dépendances vulnérables', valeur: 'Vérifie les dépendances vulnérables du projet (npm audit ou équivalent), corrige ce qui peut l\'être sans risque, liste le reste.' },
                    { label: '⇣ Tirer et vérifier le build', valeur: 'Fais git pull, installe les dépendances, lance la compilation et les tests, et corrige ce qui casse.' },
                    ...Object.entries(config.prompts).map(([n, t]) => ({ label: `★ @${n}`, valeur: t, description: t })),
                ], false);
                const consigne = (await saisir('Consigne pour Claude', depart)).trim();
                if (!consigne) return;
                const heure = (await saisir('Heure (HH:MM)', '08:00')).trim().replace('h', ':').padStart(5, '0');
                if (!/^\d\d:\d\d$/.test(heure)) return console.log(c.alerte('Heure invalide (ex. 08:00)'));
                const jours = await choisir('Quels jours ?', [
                    { label: 'Du lundi au vendredi', valeur: [1, 2, 3, 4, 5] },
                    { label: 'Tous les jours', valeur: [] as number[] },
                    { label: 'Le lundi seulement', valeur: [1] },
                    { label: 'Le vendredi seulement', valeur: [5] },
                ], false);
                config.planifications = [...(config.planifications ?? []), { id: Math.random().toString(16).slice(2, 8), nom, heure, jours, projet, consigne, actif: true }];
                await sauver();
                const { decrireJours } = await import('./planificateur.js');
                console.log(c.succes(`◴ « ${nom} » : ${decrireJours(jours)} à ${heure} · /planifications pour gérer`));
                console.log(c.discret('Elle tourne pendant que Claudetopia est ouvert ; si l\'heure est passée pendant qu\'il était fermé, elle part au lancement suivant (le même jour).'));
            },
        },
        {
            nom: 'planifications', groupe: 'Claude',
            description: 'Tâches planifiées : lancer maintenant, activer / désactiver, supprimer',
            executer: async () => {
                const { choisir } = await import('./ui/bus.js');
                const { c } = await import('./theme.js');
                const { decrireJours, dernierLancement, lancerPlanification } = await import('./planificateur.js');
                const liste = config.planifications ?? [];
                const p = await choisir<import('./planificateur.js').Planification | 'nouvelle'>('Tâches planifiées', [
                    { label: '+ Nouvelle tâche planifiée', valeur: 'nouvelle' },
                    ...liste.map((x) => ({ label: `${x.actif ? '◴' : '○'} ${x.nom}`, valeur: x, description: `${decrireJours(x.jours)} à ${x.heure} · ${x.projet.split(/[\\/]/).pop()} · dernier : ${dernierLancement(x.id) ?? 'jamais'}` })),
                ], false);
                if (p === 'nouvelle') {
                    const { COMMANDES } = await import('./commandes.js');
                    return COMMANDES.find((x) => x.nom === 'planifier')!.executer({ args: [], reste: '', apresProjet: '' });
                }
                const action = await choisir(p.nom, [
                    { label: '▶ Lancer maintenant', valeur: 'lancer' },
                    { label: p.actif ? '○ Désactiver' : '◴ Activer', valeur: 'basculer' },
                    { label: '− Supprimer', valeur: 'supprimer' },
                ], false);
                if (action === 'lancer') {
                    const r = await lancerPlanification(p);
                    return console.log(r.ok ? c.succes(`✓ ${r.message}`) : c.erreur(`✕ ${r.message}`));
                }
                if (action === 'basculer') p.actif = !p.actif;
                if (action === 'supprimer') config.planifications = liste.filter((x) => x !== p);
                await sauver();
                console.log(c.succes(action === 'supprimer' ? `« ${p.nom} » supprimée` : `« ${p.nom} » ${p.actif ? 'activée' : 'désactivée'}`));
            },
        },
        {
            nom: 'budget', args: '[montant $]', groupe: 'Config',
            description: 'Budget du jour (équivalent API) : alerte quand il est dépassé · 0 = aucun',
            executer: async ({ args }) => {
                const { lireCoutJour, dollars } = await import('./cout.js');
                const { saisir } = await import('./ui/bus.js');
                const texte = args[0] ?? await saisir(`Budget du jour en $ (aujourd'hui : ${dollars(lireCoutJour().total)}) · 0 = aucun`, String(config.budgetJour ?? 0));
                const montant = Number(texte.replace(',', '.').replace(/[^\d.]/g, ''));
                if (!Number.isFinite(montant)) return console.log('Montant invalide');
                config.budgetJour = montant;
                await sauver();
                console.log(montant ? `Budget du jour : ${dollars(montant)} · alerte (notification) au dépassement` : 'Aucun budget');
            },
        },
        {
            nom: 'cout', alias: ['couts'], groupe: 'Claude',
            description: 'Coût du jour par session (équivalent API : ce que coûterait ta consommation au tarif public)',
            executer: async () => {
                const { mettreAJourCout, dollars } = await import('./cout.js');
                const { lireDonnees } = await import('./ui/donnees.js');
                const { c } = await import('./theme.js');
                const jour = await mettreAJourCout();
                const noms = new Map(lireDonnees().agents.map((a) => [a.sessionId, `${a.nom} · ${a.titre}`]));
                console.log(c.primaire(`Aujourd'hui : ≈ ${dollars(jour.total)} · ${jour.jetons.toLocaleString('fr-CA')} jetons${config.budgetJour ? ` · budget ${dollars(config.budgetJour)}` : ''}`));
                console.log(c.discret('Équivalent API (tarif public) : avec un abonnement Claude, ce n\'est pas ta facture, mais ça mesure ta consommation.'));
                for (const [id, v] of [...jour.parSession].sort((a, b) => b[1].cout - a[1].cout).slice(0, 15)) {
                    console.log(`  ${dollars(v.cout).padStart(9)}  ${String(v.jetons.toLocaleString('fr-CA')).padStart(11)} jetons  ${noms.get(id) ?? c.discret(`session fermée ${id.slice(0, 8)}`)}`);
                }
            },
        },
        {
            nom: 'mode', args: '<clair|sombre>', groupe: 'Config',
            description: 'Fond du terminal : sombre (défaut) ou clair (terminal à fond blanc)',
            executer: async ({ args }) => {
                const { appliquerMode, appliquerTheme, PALETTES, c } = await import('./theme.js');
                const clair = args[0] ? args[0] === 'clair' : !config.modeClair;
                config.modeClair = clair;
                appliquerMode(clair);
                // En clair, des couleurs foncées pour rester lisible ; en sombre, la palette par défaut
                const palette = clair ? PALETTES['Clair'] : PALETTES['Océan'];
                appliquerTheme(palette);
                config.theme = { ...palette };
                await sauver();
                console.log(c.succes(`Mode ${clair ? 'clair' : 'sombre'} · /theme pour une autre palette`));
            },
        },
        {
            nom: 'cartes', args: '<compactes|detaillees>', groupe: 'Config',
            description: 'Cartes de session : compactes (2 lignes) ou détaillées (3 lignes, avec ta dernière demande)',
            executer: async ({ args }) => {
                const { choisirTailleCartes } = await import('./ui/mise.js');
                const detaillees = args[0] ? args[0].startsWith('d') : !config.cartesDetaillees;
                config.cartesDetaillees = detaillees;
                choisirTailleCartes(detaillees);
                await sauver();
                console.log(`Cartes ${detaillees ? 'détaillées (3 lignes)' : 'compactes (2 lignes)'}`);
            },
        },
        {
            nom: 'copier-code', args: '<session>', groupe: 'Claude', cache: true,
            description: 'Copier le dernier bloc de code de Claude (sinon sa dernière réponse)',
            executer: ({ args }) => copierDe(args[0], 'code'),
        },
        {
            nom: 'copier-reponse', args: '<session>', groupe: 'Claude', cache: true,
            description: 'Copier la dernière réponse de Claude',
            executer: ({ args }) => copierDe(args[0], 'reponse'),
        },
        {
            nom: 'palette', alias: ['k'], groupe: 'Système',
            description: 'Palette (Ctrl+K) : chercher et lancer n\'importe quoi (projet + action, session, commande, serveur)',
            executer: palette,
        },
        {
            nom: 'equipe-diff', args: '<équipe> <tâche>', groupe: 'Claude', cache: true,
            description: 'Ce que la branche d\'une tâche d\'équipe change (avant de fusionner)',
            executer: async ({ args }) => {
                const { diffTache, equipeDe } = await import('./equipe.js');
                const { c } = await import('./theme.js');
                const d = diffTache(args[0], args[1]);
                const t = equipeDe(args[0])?.taches.find((x) => x.id === args[1]);
                if (!d || !t) return console.log(c.alerte('Tâche introuvable ou sans branche'));
                console.log(c.primaire(`≠ ${t.titre} · ${t.branche}`));
                console.log(d.resume.trim() || c.discret('(aucun changement par rapport au dossier du projet)'));
                const lignes = d.diff.split('\n');
                lignes.slice(0, 600).forEach((l) => console.log(l));
                if (lignes.length > 600) console.log(c.discret(`… ${lignes.length - 600} lignes de plus · git diff HEAD...${t.branche} pour tout voir`));
                console.log(c.discret(`Pour l'écarter de la fusion : /equipe ${args[0]} → la tâche → « ✕ Écarter »`));
            },
        },
        {
            nom: 'menu-principal', groupe: 'Système', cache: true,
            description: 'Le menu ≡ : ce qui n\'est pas dans la barre du haut',
            executer: async () => {
                const { choisir } = await import('./ui/bus.js');
                const { executerLigne } = await import('./commandes.js');
                const choix = await choisir('≡ Menu', [
                    { label: '▸ Un projet : ses actions', valeur: '', description: 'session, onglet, commit, revue, worktree…' },
                    { label: '⌘ Palette (Ctrl+K)', valeur: '/palette', description: 'chercher et lancer n\'importe quoi' },
                    { label: '? Ce que les sessions attendent', valeur: '/questions' },
                    { label: '▤ Moniteur', valeur: '/top', description: 'CPU, mémoire, sessions, serveurs' },
                    { label: '≡ Journal', valeur: '/journal', description: 'ce qui a été fait, par jour' },
                    { label: '◷ Récents', valeur: '/recents' },
                    { label: '$ Coût du jour', valeur: '/cout' },
                    { label: '◴ Tâches planifiées', valeur: '/planifications' },
                    { label: '◉ Logs surveillés', valeur: '/surveillances' },
                    { label: '⚿ Connexions', valeur: '/connexions' },
                    { label: '⇅ Exporter / importer la config', valeur: '/exporter', description: '/importer pour l\'autre sens' },
                    { label: '✎ Apparence du terminal', valeur: '/apparence' },
                    { label: '? Aide et raccourcis', valeur: '/aide' },
                ], false);
                await executerLigne(choix);
            },
        },
        {
            nom: 'questions', alias: ['attente', 'todo'], groupe: 'Claude',
            description: 'Ce que les sessions attendent de toi : leurs questions, la réponse proposée, répondre en un clic',
            executer: () => vue(import('./ui/VueQuestions.js'), 'VueQuestions'),
        },
    ];
}

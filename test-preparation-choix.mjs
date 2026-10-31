import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-choix-preparation-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
fs.writeFileSync(path.join(racine, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const { ouvrirPreparation, preparerPoste, revoirAgentsPreparation, lirePreparation, projetsIgnores } = await import('./dist/preparation.js');
const { Annule, bus } = await import('./dist/ui/bus.js');
const { CHEMINS } = await import('./dist/chemins.js');
after(() => {
    const rel = path.relative(os.tmpdir(), racine);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(racine, { recursive: true, force: true });
});
const config = () => ({ racines: [], extras: [], fournisseurDefaut: 'codex', maitre: { actif: false } });
// Une activité commune garde l'ordre de la fixture indépendant du passage d'une milliseconde.
const activiteProjets = new Date();
const projet = (nom) => ({ nom, chemin: path.join(racine, nom), activite: activiteProjets, types: [], worktree: false });
const fixture = (nom, extra = {}) => {
    const fichier = path.join(racine, `${nom}.json`);
    const etat = { version: 1, selection: ['codex', 'claude'], ignores: ['claude'], projetsVus: [], projetsTermines: true, terminee: true,
        etats: { codex: { pret: true, texte: 'Compte connecté', date: 10 }, claude: { pret: false, texte: 'Clé API manquante', date: 20 } }, ...extra };
    fs.writeFileSync(fichier, JSON.stringify(etat)); return { fichier, etat, avant: fs.readFileSync(fichier, 'utf8') };
};
const interdit = (nom) => async () => assert.fail(`Action inattendue : ${nom}`);
const services = (s = {}) => ({ scanner: interdit('scanner'), choisir: interdit('choisir'), choisirPlusieurs: interdit('choisirPlusieurs'),
    verifier: interdit('verifier'), connecter: interdit('connecter'), installer: interdit('installer'),
    present: () => 'fixture.exe', disponibilite: () => ({ pret: false, texte: 'Fixture' }), sauvegarderConfig() {}, rafraichir: async () => {}, historique: interdit('historique'), ...s });

test('premier lancement : préparation directe sans menu de révision supplémentaire', async () => {
    const fichier = path.join(racine, 'premier-lancement.json');
    const r = await ouvrirPreparation(config(), { fichier }, services({ scanner: async () => ({ projets: [] }),
        choisirPlusieurs: async (question) => { assert.match(question, /Quels agents/); return []; }, historique: async () => ({ conversations: [], date: 0 }),
    }));
    assert.equal(r.terminee, true); assert.equal(r.projetsTermines, true); assert.deepEqual(r.selection, []);
});

test('préparation terminée : garder ou annuler conserve le reçu, sans aucun scan ni contrôle', async () => {
    for (const annuler of [false, true]) {
        const f = fixture(`menu-${annuler}`), c = config();
        const action = ouvrirPreparation(c, { fichier: f.fichier }, services({ choisir: async (_, choix) => {
            assert.equal(choix[0].valeur, 'garder');
            if (annuler) throw new Annule(); return 'garder';
        } }));
        if (annuler) await assert.rejects(action, { name: 'Annule' }); else await action;
        assert.equal(fs.readFileSync(f.fichier, 'utf8'), f.avant); assert.equal(c.fournisseurDefaut, 'codex');
    }
});

test('revoir les projets : annulation intacte puis ajout ciblé, projets suivis et refus conservés', async () => {
    const suivi = projet('suivi'), ignore = projet('ignore'), autre = projet('autre');
    const f = fixture('projets', { projetsVus: [suivi.chemin, ignore.chemin, autre.chemin] }), c = config(); c.extras = [suivi.chemin];
    const commun = { scanner: async () => ({ projets: [suivi, ignore, autre] }) };
    await assert.rejects(ouvrirPreparation(c, { fichier: f.fichier, action: 'projets' }, services({ ...commun, choisirPlusieurs: async (_, choix) => {
        assert.deepEqual(choix.map((v) => v.valeur), [ignore.chemin, autre.chemin]); assert.ok(choix.every((v) => !v.coche)); throw new Annule();
    } })), { name: 'Annule' });
    assert.deepEqual(c.extras, [suivi.chemin]); assert.equal(fs.readFileSync(f.fichier, 'utf8'), f.avant);
    await ouvrirPreparation(c, { fichier: f.fichier, action: 'projets' }, services({ ...commun, choisirPlusieurs: async () => [ignore.chemin] }));
    assert.deepEqual(c.extras, [suivi.chemin, ignore.chemin]);
    const etat = lirePreparation(f.fichier); assert.deepEqual(projetsIgnores(etat, c), [autre.chemin]);
    assert.deepEqual(etat.ignores, ['claude']); assert.deepEqual(etat.etats, f.etat.etats); assert.equal(etat.terminee, true);
});

test('scan sans ignorés : filtre conservé et aucune question supplémentaire ni contrôle fournisseur', async () => {
    const f = fixture('scan-filtre'), c = config(), cible = projet('Pulsar'), autre = projet('Autre');
    const notices = [], recevoir = (texte) => notices.push(texte); bus.on('notice', recevoir);
    try {
        await ouvrirPreparation(c, { fichier: f.fichier, rescan: true, filtre: 'Pulsar' }, services({ scanner: async () => ({ projets: [cible, autre] }),
            choisirPlusieurs: async (_, choix) => { assert.deepEqual(choix.map((v) => v.valeur), [cible.chemin]); return [cible.chemin]; },
        }));
        assert.match(notices.at(-1), /filtre « Pulsar ».*1 projet/);
        await ouvrirPreparation(c, { fichier: f.fichier, rescan: true }, services({ scanner: async () => ({ projets: [] }) }));
        assert.match(notices.at(-1), /aucun projet ajouté/);
    } finally { bus.off('notice', recevoir); }
    assert.deepEqual(c.extras, [cible.chemin]); assert.deepEqual(lirePreparation(f.fichier).etats, f.etat.etats);
});

test('scan avec ignorés : choix par défaut ne les repropose pas, annulation ne modifie rien', async () => {
    const ignore = projet('ancien-ignore'), nouveau = projet('nouveau'), f = fixture('scan-choix', { projetsVus: [ignore.chemin] }), c = config();
    await assert.rejects(ouvrirPreparation(c, { fichier: f.fichier, rescan: true }, services({ choisir: async () => { throw new Annule(); } })), { name: 'Annule' });
    assert.equal(fs.readFileSync(f.fichier, 'utf8'), f.avant);
    await ouvrirPreparation(c, { fichier: f.fichier, rescan: true }, services({ choisir: async (_, choix) => { assert.equal(choix[0].valeur, false); return false; },
        scanner: async () => ({ projets: [ignore, nouveau] }), choisirPlusieurs: async (_, choix) => { assert.deepEqual(choix.map((v) => v.valeur), [nouveau.chemin]); return []; },
    }));
    assert.deepEqual(c.extras, []); assert.deepEqual(lirePreparation(f.fichier).projetsVus, [ignore.chemin, nouveau.chemin]);
});

test('agents reportés : dernier résultat lisible, aucun agent recoché par défaut, annulation intacte', async () => {
    const f = fixture('reportes-annule');
    await assert.rejects(ouvrirPreparation(config(), { fichier: f.fichier, action: 'agents' }, services({ choisirPlusieurs: async (_, choix) => {
        assert.deepEqual(choix.map((v) => v.valeur), ['claude']); assert.equal(choix[0].coche, false);
        assert.match(choix[0].description, /Clé API manquante/); throw new Annule();
    } })), { name: 'Annule' });
    assert.equal(fs.readFileSync(f.fichier, 'utf8'), f.avant);
    await ouvrirPreparation(config(), { fichier: f.fichier, action: 'agents' }, services({ choisirPlusieurs: async () => [] }));
    assert.equal(fs.readFileSync(f.fichier, 'utf8'), f.avant);
});

test('agent reporté repris puis interrompu : progression durable, autre report conservé et reprise sans rechoisir', async () => {
    const f = fixture('reportes-reprise', { selection: ['codex', 'claude', 'perplexity'], ignores: ['claude', 'perplexity'] }), c = config();
    await assert.rejects(ouvrirPreparation(c, { fichier: f.fichier, action: 'agents' }, services({ choisirPlusieurs: async () => ['claude'],
        verifier: async (f) => { assert.equal(f, 'claude'); return { pret: false, texte: 'À connecter' }; }, choisir: async () => { throw new Annule(); },
    })), { name: 'Annule' });
    const interrompu = lirePreparation(f.fichier); assert.deepEqual(interrompu.ignores, ['perplexity']); assert.equal(interrompu.terminee, false);
    assert.deepEqual(interrompu.etats.codex, f.etat.etats.codex); assert.equal(c.fournisseurDefaut, 'codex');
    const controles = [];
    const termine = await ouvrirPreparation(c, { fichier: f.fichier }, services({ verifier: async (f) => { controles.push(f); return { pret: true, texte: 'Connecté' }; }, historique: async () => ({ conversations: [], date: 0 }) }));
    assert.deepEqual(controles, ['codex', 'claude']); assert.equal(termine.terminee, true); assert.deepEqual(termine.ignores, ['perplexity']);
});

test('changer les agents : choix existants cochés, validation inchangée sans opération, ajout ciblé', async () => {
    const f = fixture('choisir'), c = config();
    await revoirAgentsPreparation(c, { fichier: f.fichier, tous: true }, services({ choisirPlusieurs: async (_, choix) => {
        assert.deepEqual(choix.filter((v) => v.coche).map((v) => v.valeur), ['claude', 'codex']);
        assert.match(choix.find((v) => v.valeur === 'claude').description, /Reste reporté.*preparer agents/); return ['claude', 'codex'];
    } }));
    assert.equal(fs.readFileSync(f.fichier, 'utf8'), f.avant);
    const r = await revoirAgentsPreparation(c, { fichier: f.fichier, tous: true }, services({ choisirPlusieurs: async () => ['claude', 'codex', 'perplexity'],
        verifier: async (f) => { assert.equal(f, 'perplexity'); return { pret: true, texte: 'Catalogue accessible' }; },
    }));
    assert.deepEqual(r.ignores, ['claude']); assert.deepEqual(r.etats.codex, f.etat.etats.codex); assert.equal(r.terminee, true); assert.equal(c.fournisseurDefaut, 'codex');
});

test('Codex manquant : reporter évite installation et contrôle, annuler permet une reprise confirmée', async () => {
    const f = fixture('codex-install', { selection: [], ignores: [], etats: {} });
    await assert.rejects(revoirAgentsPreparation(config(), { fichier: f.fichier, tous: true }, services({ choisirPlusieurs: async () => ['codex'],
        present: (outil) => outil === 'git' ? 'fixture.exe' : undefined, choisir: async () => { throw new Annule(); },
    })), { name: 'Annule' });
    assert.deepEqual(lirePreparation(f.fichier).selection, ['codex']); assert.equal(lirePreparation(f.fichier).terminee, false);
    const r = await preparerPoste(config(), { fichier: f.fichier }, services({ present: (outil) => outil === 'git' ? 'fixture.exe' : undefined,
        choisir: async (_, choix) => { assert.equal(choix[0].valeur, 'installer'); return 'passer'; }, historique: async () => ({ conversations: [], date: 0 }),
    }));
    assert.deepEqual(r.ignores, ['codex']); assert.equal(r.terminee, true);
});

test('commandes et Config : accès aux choix différés ; annuler /choisir-agents ne réinitialise pas le reçu', async () => {
    const f = fixture('commandes', { projetsVus: [projet('laisse-de-cote').chemin] }); fs.copyFileSync(f.fichier, CHEMINS.preparation);
    const { chargerConfig } = await import('./dist/config.js'); const c = chargerConfig();
    const { lignesConfig } = await import('./dist/ui/VueConfig.js');
    const lignes = lignesConfig({ config: c, preparation: f.etat, git: { nom: 'Fixture', email: 'fixture@example.test' }, jetons: [], raccourci: false });
    assert.ok(lignes.some((l) => l.commande === '/preparer projets')); assert.ok(lignes.some((l) => l.commande === '/preparer agents'));
    const { commandesSessions } = await import('./dist/sessionsCommandes.js');
    bus.once('demande', (demande) => queueMicrotask(() => demande.resoudre(undefined)));
    await assert.rejects(commandesSessions(c).find((v) => v.nom === 'choisir-agents').executer({}), { name: 'Annule' });
    assert.equal(fs.readFileSync(CHEMINS.preparation, 'utf8'), f.avant);
});

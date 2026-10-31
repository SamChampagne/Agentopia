import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-comptes-github-'));
process.env.CLAUDETOPIA_DATA_DIR = tmp;
process.env.CLAUDETOPIA_SANS_REPRISE = '1'; process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.GH_CONFIG_DIR = path.join(tmp, 'gh'); fs.mkdirSync(process.env.GH_CONFIG_DIR);
const { normaliserConfig, sauverConfig, chargerConfig } = await import('./dist/config.js');
const { environnementGhLocal, lireComptesGitHubJson, listerComptesGitHub, jetonCompteGitHub, verifierCompteGitHub } = await import('./dist/githubLocal.js');
const { reponseCredentialGitHub } = await import('./dist/githubCredential.js');
const { argumentsGitCompte } = await import('./dist/authGitReseau.js');
const { choisirCompteGitHub } = await import('./dist/compteGitHubCommande.js');
const { bus } = await import('./dist/ui/bus.js');
const { cleGitHub } = await import('./dist/compteGitHub.js');
const { surPath } = await import('./dist/chemins.js');
const comptes = [{ login: 'SamChampagne', actif: true, valide: true }, { login: 'SamChampagneIntebec', actif: false, valide: true }];
const secretFixture = 'github_fixture_ne_jamais_utiliser_123456789';
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('découverte : noms sûrs, hôte exact et aucun secret dans le résultat', async () => {
    const json = JSON.stringify({ hosts: { 'github.com': comptes.map(c => ({ host: 'github.com', login: c.login, active: c.actif, state: 'success', token: secretFixture })), 'github.attacker.invalid': [{ login: 'Intrus' }] } });
    let args;
    assert.deepEqual(await listerComptesGitHub(async a => { args = a; return json; }), comptes);
    assert.deepEqual(args, ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts']);
    assert.ok(!JSON.stringify(lireComptesGitHubJson(json)).includes(secretFixture));
    assert.throws(() => lireComptesGitHubJson(secretFixture), /illisible/);
    for (const compteGitHub of ['', '-x', 'x\npassword=secret', '$(bad)', 'a'.repeat(40)]) assert.throws(() => normaliserConfig({ compteGitHub }), /Compte GitHub invalide/);
});

test('lecture : utilisateur explicite, environnement prioritaire retiré et erreurs sans secret', async () => {
    let args;
    assert.equal(await jetonCompteGitHub('SamChampagneIntebec', async a => { args = a; return secretFixture; }, async () => 'SamChampagneIntebec'), secretFixture);
    assert.deepEqual(args, ['auth', 'token', '--hostname', 'github.com', '--user', 'SamChampagneIntebec']);
    await assert.rejects(jetonCompteGitHub('SamChampagneIntebec', async () => secretFixture, async () => 'SamChampagne'), /identité différente/);
    await assert.rejects(jetonCompteGitHub('SamChampagneIntebec', async () => { throw new Error('indisponible'); }), /indisponible/);
    const sauvegarde = { ...process.env };
    try {
        process.env.GH_TOKEN = secretFixture; process.env.GITHUB_TOKEN = 'autre'; process.env.GH_DEBUG = 'api';
        const env = environnementGhLocal();
        assert.equal(env.GH_TOKEN, undefined); assert.equal(env.GITHUB_TOKEN, undefined); assert.equal(env.GH_DEBUG, undefined);
        assert.equal(process.env.GH_TOKEN, secretFixture); assert.equal(env.GH_CONFIG_DIR, process.env.GH_CONFIG_DIR);
    } finally { for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_DEBUG']) { if (sauvegarde[k] === undefined) delete process.env[k]; else process.env[k] = sauvegarde[k]; } }
    await assert.rejects(verifierCompteGitHub(secretFixture, async (_u, init) => { assert.equal(init.redirect, 'error'); throw new Error(secretFixture); }), e => !e.message.includes(secretFixture));
});

async function selection(valeur, services, config = normaliserConfig({ racines: [], extras: [] })) {
    const recevoir = d => { if (d) d.resoudre(valeur); }; bus.on('demande', recevoir);
    try { return await choisirCompteGitHub(config, services); } finally { bus.off('demande', recevoir); }
}

test('sélection : vérification avant écriture, préférence sans clé et mise à jour des résultats', async () => {
    const appels = [], config = normaliserConfig({ racines: [], extras: [], compteGitHub: 'SamChampagne' }); sauverConfig(config);
    const services = { lister: async () => comptes, jeton: async login => { appels.push(login); return secretFixture; }, verifier: async t => { assert.equal(t, secretFixture); return 'SamChampagneIntebec'; }, actualiser: async () => appels.push('actualiser') };
    await selection('local:SamChampagneIntebec', services, config);
    assert.equal(config.compteGitHub, 'SamChampagneIntebec'); assert.equal(chargerConfig().compteGitHub, 'SamChampagneIntebec');
    assert.deepEqual(appels, ['SamChampagneIntebec', 'actualiser']);
    assert.ok(!fs.readFileSync(path.join(tmp, 'claudetopia.json'), 'utf8').includes(secretFixture));
    const avant = fs.readFileSync(path.join(tmp, 'claudetopia.json'), 'utf8');
    await assert.rejects(selection(undefined, services, config), { name: 'Annule' });
    await assert.rejects(selection('local:Inconnu', services, config), /liste locale/);
    await assert.rejects(selection('local:SamChampagne', { ...services, verifier: async () => 'Autre' }, config), /différente/);
    await assert.rejects(selection('local:SamChampagne', { ...services, jeton: async () => { throw new Error('Compte expiré'); } }, config), /expiré/);
    assert.equal(fs.readFileSync(path.join(tmp, 'claudetopia.json'), 'utf8'), avant);
    await selection('auto', services, config); assert.equal(chargerConfig().compteGitHub, undefined);
});

test('credential Git : ni HTTP, ni autre domaine, ni doublon ; get seul lit la clé', async () => {
    const appels = [], lire = async login => { appels.push(login); return secretFixture; };
    for (const entree of ['protocol=http\nhost=github.com\n', 'protocol=https\nhost=evil.invalid\n', 'protocol=https\nhost=github.com.evil.invalid\n', 'protocol=https\nhost=github.com:444\n']) assert.equal(await reponseCredentialGitHub(entree, 'SamChampagneIntebec', 'get', lire), '');
    assert.equal(await reponseCredentialGitHub('password=' + secretFixture, 'SamChampagneIntebec', 'store', lire), '');
    assert.deepEqual(appels, []);
    await assert.rejects(reponseCredentialGitHub('protocol=https\nhost=github.com\nhost=evil\n', 'SamChampagneIntebec', 'get', lire), /invalide/);
    assert.equal(await reponseCredentialGitHub('protocol=https\nhost=github.com\nusername=Autre\n', 'SamChampagneIntebec', 'get', lire), `username=SamChampagneIntebec\npassword=${secretFixture}\n\n`);
    assert.deepEqual(appels, ['SamChampagneIntebec']);
    assert.deepEqual(argumentsGitCompte(['status'], 'SamChampagneIntebec'), ['status']);
    const args = argumentsGitCompte(['push'], 'SamChampagneIntebec');
    assert.ok(args.includes('credential.https://github.com.helper=')); assert.ok(!args.join(' ').includes(secretFixture));
});

test('vrai Git credential : helper sélectionné, aucun réglage global écrit et aucun accès au coffre personnel', { skip: !surPath('git') }, async () => {
    // GH_CONFIG_DIR ne sépare pas le coffre système. Intercepter le module dans
    // le sous-processus Node garantit qu'aucune clé personnelle ne peut être lue.
    const chargeur = path.join(tmp, 'fixture-loader.mjs');
    const source = `export const loginGitHubValide = v => /^[a-zA-Z0-9-]+$/.test(v); export const jetonCompteGitHub = async login => { if(login !== 'FixtureAgentopia') throw new Error('Compte factice absent'); return ${JSON.stringify(secretFixture)}; };`;
    fs.writeFileSync(chargeur, `import { registerHooks } from 'node:module'; registerHooks({load(url, ctx, next) { if(url.endsWith('/githubLocal.js')) return { format: 'module', source: ${JSON.stringify(source)}, shortCircuit: true }; return next(url,ctx); }});`);
    const opts = { cwd: tmp, encoding: 'utf8', timeout: 20_000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: `--import="${pathToFileURL(chargeur).href}"`, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GH_TOKEN: 'mauvais_compte' } };
    // Réutilise les options du vrai lancement réseau avec credential fill pour tester le dialogue réel de Git.
    const args = [...argumentsGitCompte(['push'], 'FixtureAgentopia').slice(0, -1), 'credential', 'fill'];
    const r = spawnSync('git', args, { ...opts, input: 'protocol=https\nhost=github.com\n\n' });
    assert.equal(r.status, 0, r.stderr); assert.ok(r.stdout.replaceAll('\r\n', '\n').includes(`username=FixtureAgentopia\npassword=${secretFixture}`));
    assert.equal(fs.existsSync(path.join(tmp, 'gitconfig')), false);
    const mauvais = spawnSync('git', [...argumentsGitCompte(['push'], 'AbsentFixture').slice(0, -1), 'credential', 'fill'], { ...opts, input: 'protocol=https\nhost=github.com\n\n' });
    assert.notEqual(mauvais.status, 0); assert.ok(!mauvais.stdout.includes('password='));
});

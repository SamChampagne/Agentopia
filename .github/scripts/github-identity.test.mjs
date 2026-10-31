import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryIdentity, projectIdentity, selectProjectAccess } from './github-identity.mjs';
import { GitHub } from './project-workflow.mjs';
import { compareSnapshots, destinationAccess } from './migration-audit.mjs';
const config = {
  repositoryId: 42,
  owner: 'SamChampagne',
  repository: 'Repo',
  id: 'PVT_42',
  migration: {
    allowedOwners: ['SamChampagne', 'Intebec'],
    destinationOwner: 'Intebec',
    destinationAccount: 'SamChampagneIntebec',
  },
};
const repo = (owner) => ({
  id: 42,
  owner: { login: owner },
  name: 'Repo',
  full_name: `${owner}/Repo`,
  html_url: `https://github.com/${owner}/Repo`,
  default_branch: 'main',
});
const project = (owner) => ({
  id: 'PVT_42',
  owner: { login: owner, __typename: owner === 'Intebec' ? 'Organization' : 'User' },
  number: owner === 'Intebec' ? 9 : 3,
  url: `https://github.com/${owner === 'Intebec' ? 'orgs' : 'users'}/${owner}/projects/${owner === 'Intebec' ? 9 : 3}`,
  closed: false,
});
test('identité stable avant et après transfert; contexte Actions lié au même dépôt', () => {
  for (const owner of ['SamChampagne', 'Intebec'])
    assert.equal(
      repositoryIdentity(config, repo(owner), {
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY_ID: '42',
        GITHUB_REPOSITORY: `${owner}/Repo`,
      }).owner,
      owner,
    );
  assert.throws(() => repositoryIdentity(config, { ...repo('Intebec'), id: 99 }), /Identité/);
  assert.throws(() => repositoryIdentity(config, repo('Intrus')), /Propriétaire/);
  assert.throws(
    () =>
      repositoryIdentity(config, repo('Intebec'), {
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY_ID: '43',
        GITHUB_REPOSITORY: 'Intebec/Repo',
      }),
    /contexte/,
  );
  assert.throws(
    () =>
      repositoryIdentity(config, repo('Intebec'), {
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY_ID: '42',
        GITHUB_REPOSITORY: 'Autre/Repo',
      }),
    /contexte/,
  );
});
test('tableau transféré avec nouveau numéro/URL et même ID; copies et propriétaires inattendus refusés', () => {
  assert.equal(projectIdentity(config, project('SamChampagne')).number, 3);
  assert.equal(projectIdentity(config, project('Intebec')).number, 9);
  assert.throws(() => projectIdentity(config, { ...project('Intebec'), id: 'copie' }), /remplacé/);
  assert.throws(() => projectIdentity(config, { ...project('Intebec'), closed: true }), /fermé/);
  assert.throws(
    () => projectIdentity(config, { ...project('Intebec'), owner: { login: 'Intrus' } }),
    /Propriétaire/,
  );
  assert.throws(
    () =>
      projectIdentity(config, { ...project('Intebec'), url: 'https://github.com/evil/projects/9' }),
    /incohérente/,
  );
});
test('dépôt et tableau peuvent être déplacés séparément sans utiliser un jeton au mauvais endroit', async () => {
  const candidates = [
    { name: 'future', token: 'fixture-future' },
    { name: 'source', token: 'fixture-source' },
  ];
  const calls = [];
  const current = await selectProjectAccess(config, candidates, async (token) => {
    calls.push(token);
    return token === 'fixture-source' ? project('SamChampagne') : null;
  });
  assert.equal(current.name, 'source');
  assert.deepEqual(calls, ['fixture-future', 'fixture-source']);
  const moved = await selectProjectAccess(config, candidates, async (token) =>
    token === 'fixture-future' ? project('Intebec') : null,
  );
  assert.equal(moved.identity.projectOwner, 'Intebec');
  assert.equal(moved.name, 'future');
  await assert.rejects(
    selectProjectAccess(config, [], async () => project('Intebec')),
    /Accès au tableau impossible/,
  );
  await assert.rejects(
    selectProjectAccess(config, candidates, async () => {
      throw new Error('secret-fixture-not-to-log');
    }),
    (error) =>
      !error.message.includes('secret-fixture-not-to-log') &&
      error.message.includes('Accès au tableau impossible'),
  );
});
test('le dépôt déplacé est résolu par ID et les écritures utilisent sa nouvelle route', async () => {
  const api = new GitHub(structuredClone(config), 'repo-token', 'project-token');
  const calls = [];
  api.request = async (path, method, body, token) => {
    calls.push({ path, method, token });
    if (path === '/repositories/42') return repo('Intebec');
    return [];
  };
  await api.initialize({});
  await api.issues();
  assert.equal(api.repository, 'Intebec/Repo');
  assert.ok(calls[1].path.startsWith('/repos/Intebec/Repo/issues'));
  assert.equal(calls[0].path, '/repositories/42');
});
test('accès futur : compte propriétaire exact et scope Projects effectivement utilisable', async () => {
  const api = {
    config,
    request: async (path) =>
      path === '/user'
        ? { login: 'SamChampagneIntebec' }
        : path === '/graphql'
          ? { data: { organization: { login: 'Intebec' } } }
          : { state: 'active', role: 'admin' },
  };
  assert.equal((await destinationAccess(api, 'fixture')).projectsReadable, true);
  await assert.rejects(destinationAccess(api, ''), /absent/);
  await assert.rejects(
    destinationAccess({ ...api, request: async () => ({ login: 'SamChampagne' }) }, 'fixture'),
    /autre compte/,
  );
  await assert.rejects(
    destinationAccess(
      {
        ...api,
        request: async (path) =>
          path === '/graphql' ? { errors: [{ message: 'denied' }] } : api.request(path),
      },
      'fixture',
    ),
    /Projects/,
  );
});
const snapshot = () => ({
  repository: {
    id: 42,
    fullName: 'SamChampagne/Repo',
    private: true,
    defaultBranch: 'main',
    settings: {},
  },
  project: {
    id: 'PVT_42',
    owner: 'SamChampagne',
    items: [{ id: 'item', values: [2] }],
    fields: ['status'],
  },
  branches: [{ name: 'main', sha: 'abc' }],
  tags: [],
  issues: [{ id: 'issue', number: 1, bodyHash: 'abc' }],
  pulls: [],
  releases: [],
  secrets: { available: true, value: ['PROJECTS_TOKEN', 'PROJECTS_TOKEN_INTEBEC'] },
  variables: { available: true, value: [] },
  protection: { available: true, value: { url: 'old', enforce_admins: { enabled: true } } },
  actions: { available: true, value: { enabled: true } },
  environments: { available: true, value: [] },
  hooks: { available: true, value: [] },
  keys: { available: true, value: [] },
  manualChecks: ['External services'],
});
test('comparaison accepte les nouvelles URLs mais refuse pertes de données, champs, règles et secrets', () => {
  const before = snapshot(),
    after = structuredClone(before);
  after.repository.fullName = 'Intebec/Repo';
  after.project.owner = 'Intebec';
  after.protection.value.url = 'new';
  assert.equal(compareSnapshots(before, after).automatedComparisonPassed, true);
  for (const mutate of [
    (s) => (s.issues = []),
    (s) => (s.project.items = []),
    (s) => (s.project.id = 'copie'),
    (s) => (s.secrets.value = []),
    (s) => (s.branches[0].sha = 'other'),
    (s) => (s.protection.value.enforce_admins.enabled = false),
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    assert.equal(compareSnapshots(before, changed).automatedComparisonPassed, false);
  }
  const unknown = structuredClone(after);
  unknown.protection = { available: false, error: '403' };
  assert.equal(compareSnapshots(before, unknown).automatedComparisonPassed, false);
  assert.ok(compareSnapshots(before, unknown).warnings.length);
});

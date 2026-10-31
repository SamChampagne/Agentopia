import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHub,
  LABELS,
  inspectIssue,
  inspectPull,
  closingNumbers,
  desiredStatus,
  validateTrackedPull,
  synchronize,
} from './project-workflow.mjs';

const config = {
  owner: 'owner',
  repository: 'repo',
  id: 'project',
  statusFieldId: 'status',
  statusOptions: {
    Todo: 'todo',
    'In Progress': 'doing',
    'In Review': 'review',
    Blocked: 'blocked',
    Done: 'done',
  },
  priorityFieldId: 'priority',
  priorityOptions: { P1: 'p1', P2: 'p2', P3: 'p3' },
  estimateFieldId: 'estimate',
  estimateMaxHours: 80,
  statusContext: 'workflow-projet',
  adoptedAt: '2026-10-31T00:00:00Z',
  url: 'https://github.com/users/owner/projects/1',
};
const validBody = `## Description
Corriger le scénario utilisateur observé sans modifier les données personnelles.
## Critères d’acceptation
- [ ] Le parcours complet réussit et conserve les données existantes.
## Estimation (heures)
2
## Hypothèses de l’estimation
Réutilisation du service existant; attente humaine exclue et estimation révisable.
## Validation prévue
Exécuter le scénario ciblé sur un environnement isolé et relire les résultats.
## Priorité
P1`;
const issue = (extra = {}) => ({
  number: 1,
  node_id: 'issue1',
  body: validBody,
  state: 'open',
  labels: [],
  created_at: '2026-10-31T12:00:00Z',
  ...extra,
});
const pull = (extra = {}) => ({
  number: 2,
  body: 'Closes #1\n\n## Validation\nLes tests ciblés réussissent dans un environnement isolé.\n\n## Limites\nAucune validation du fournisseur externe exécutée.',
  draft: false,
  head: { sha: 'a'.repeat(40) },
  ...extra,
});
const item = (extra = {}) => ({
  id: 'item1',
  number: 1,
  archived: false,
  values: { status: 'review', estimate: 2, priority: 'p1' },
  ...extra,
});

test('contrat complet : accents, apostrophes et estimation décimale française', () => {
  assert.deepEqual(inspectIssue(issue()).errors, []);
  const value = inspectIssue(issue({ body: validBody.replace('\n2\n', '\n0,5\n') }));
  assert.equal(value.estimate, 0.5);
  assert.deepEqual(value.errors, []);
});
test('estimations absentes, non numériques, nulles, négatives ou trop grandes refusées', () => {
  for (const value of ['', '0', '-1', 'NaN', 'Infinity', '81', '2 heures']) {
    assert.ok(
      inspectIssue(issue({ body: validBody.replace('\n2\n', `\n${value}\n`) })).errors.some((e) =>
        e.includes('Estimation'),
      ),
    );
  }
});
test('description placeholder, faux critère et contenu caché ne satisfont pas le contrat', () => {
  assert.ok(
    inspectIssue(
      issue({
        body: validBody.replace(
          'Corriger le scénario utilisateur observé sans modifier les données personnelles.',
          'TODO : description à compléter plus tard par le prochain agent.',
        ),
      }),
    ).errors.length,
  );
  assert.ok(
    inspectIssue(
      issue({
        body: validBody.replace(
          '- [ ] Le parcours complet réussit et conserve les données existantes.',
          'Tout devrait fonctionner correctement après le travail.',
        ),
      }),
    ).errors.length,
  );
  assert.ok(inspectIssue(issue({ body: `<!-- ${validBody} -->` })).errors.length);
});
test('un bug exige une reproduction ou une preuve datée', () => {
  assert.ok(
    inspectIssue(issue({ labels: [{ name: 'bug' }] })).errors.some((e) =>
      e.includes('reproduction'),
    ),
  );
  assert.deepEqual(
    inspectIssue(
      issue({
        labels: [{ name: 'bug' }],
        body:
          validBody +
          '\n## Reproduction\nLe run GitHub daté reproduit le scénario décrit dans la demande.',
      }),
    ).errors,
    [],
  );
});
test('les références cachées ou présentées comme exemple ne ferment pas une issue', () => {
  assert.deepEqual(
    closingNumbers('<!-- Closes #9 -->\n```md\nFixes #8\n```\n`Closes #7`\nCloses #1\nResolves #2'),
    [1, 2],
  );
  assert.ok(inspectPull(pull({ body: 'Closes #1' })).errors.length);
});
test('la PR exige la vraie liaison GitHub, une issue ouverte et une carte cohérente', () => {
  const issues = new Map([[1, issue()]]),
    items = new Map([['issue1', item()]]);
  assert.deepEqual(validateTrackedPull(pull(), issues, items, config, [1]).errors, []);
  assert.ok(
    validateTrackedPull(pull(), issues, items, config, []).errors.some((e) =>
      e.includes('nativement'),
    ),
  );
  assert.ok(
    validateTrackedPull(
      pull(),
      new Map([[1, issue({ state: 'closed' })]]),
      items,
      config,
      [1],
    ).errors.some((e) => e.includes('fermée')),
  );
  assert.ok(
    validateTrackedPull(pull(), new Map([[1, issue({ pull_request: {} })]]), items, config, [1])
      .errors.length,
  );
});
test('projet absent, archivé, mauvaise estimation, priorité ou statut bloquent la PR', () => {
  const issues = new Map([[1, issue()]]);
  for (const target of [
    undefined,
    item({ archived: true }),
    item({ values: { status: 'review', estimate: 0, priority: 'p1' } }),
    item({ values: { status: 'blocked', estimate: 2, priority: 'p1' } }),
    item({ values: { status: 'review', estimate: 2, priority: 'p3' } }),
  ]) {
    assert.ok(
      validateTrackedPull(pull(), issues, new Map(target ? [['issue1', target]] : []), config, [1])
        .errors.length,
    );
  }
});
test('statuts : démarrage, brouillon, revue, blocage prioritaire et clôture', () => {
  assert.equal(desiredStatus(issue(), []), 'Todo');
  assert.equal(desiredStatus(issue({ labels: [{ name: LABELS.started }] }), []), 'In Progress');
  assert.equal(desiredStatus(issue(), [pull({ draft: true })]), 'In Progress');
  assert.equal(desiredStatus(issue(), [pull()]), 'In Review');
  assert.equal(desiredStatus(issue({ labels: [{ name: LABELS.blocked }] }), [pull()]), 'Blocked');
  assert.equal(desiredStatus(issue({ state: 'closed' }), []), 'Done');
});

class FakeGitHub {
  constructor({
    issues = [issue()],
    pulls = [pull()],
    items = new Map(),
    inaccessible = false,
  } = {}) {
    this.issueList = issues;
    this.pullList = pulls;
    this.items = items;
    this.inaccessible = inaccessible;
    this.statuses = [];
    this.added = [];
  }
  async pulls() {
    return this.pullList;
  }
  async issues() {
    return this.issueList;
  }
  async project() {
    if (this.inaccessible) throw new Error('PROJECTS_TOKEN absent');
    return this.items;
  }
  async nativeLinks(pr) {
    return closingNumbers(pr.body);
  }
  async status(pr, state, description) {
    this.statuses.push({ number: pr.number, state, description });
  }
  async add(value) {
    this.added.push(value.number);
    return { id: 'item' + value.number, number: value.number, archived: false, values: {} };
  }
  async fields(target, values) {
    Object.assign(target.values, values);
  }
  async labels(value, label, enabled) {
    value.labels = value.labels.filter((v) => v.name !== label);
    if (enabled) value.labels.push({ name: label });
  }
}
test('synchronisation complète : ajout réel prévu, champs, revue et contrôle vert', async () => {
  const api = new FakeGitHub();
  const result = await synchronize(api, config);
  assert.deepEqual(api.added, [1]);
  assert.deepEqual(api.items.get('issue1').values, {
    status: 'review',
    estimate: 2,
    priority: 'p1',
  });
  assert.deepEqual(
    api.statuses.map((s) => s.state),
    ['pending', 'success'],
  );
  assert.equal(result.pullRequests[0].state, 'success');
  await synchronize(api, config);
  assert.deepEqual(api.added, [1]);
});
test('un plan devenu incomplet invalide le contrôle et efface l’ancienne estimation', async () => {
  const value = issue({ body: validBody.replace('\n2\n', '\nTODO\n') });
  const api = new FakeGitHub({ issues: [value], items: new Map([['issue1', item()]]) });
  const result = await synchronize(api, config);
  assert.equal(result.pullRequests[0].state, 'failure');
  assert.equal(api.items.get('issue1').values.estimate, undefined);
  assert.ok(value.labels.some((label) => label.name === LABELS.planning));
});
test('une panne Projects ne peut jamais produire un contrôle vert', async () => {
  const api = new FakeGitHub({ inaccessible: true });
  await assert.rejects(synchronize(api, config), /PROJECTS_TOKEN/);
  assert.deepEqual(
    api.statuses.map((s) => s.state),
    ['pending', 'error'],
  );
});
test('les anciennes issues closes non suivies ne polluent pas le projet; nouvelles closes en Done', async () => {
  const api = new FakeGitHub({
    pulls: [],
    issues: [
      issue({ state: 'closed', created_at: '2020-01-01' }),
      issue({ number: 3, node_id: 'issue3', state: 'closed' }),
    ],
  });
  await synchronize(api, config);
  assert.deepEqual(api.added, [3]);
  assert.deepEqual(api.items.get('issue3').values, { status: 'done' });
});
test('une PR brouillon reste en attente, une tâche bloquée ne passe pas en revue', async () => {
  const draft = new FakeGitHub({ pulls: [pull({ draft: true })] });
  await synchronize(draft, config);
  assert.equal(draft.statuses.at(-1).state, 'pending');
  assert.equal(draft.items.get('issue1').values.status, 'doing');
  const blocked = new FakeGitHub({ issues: [issue({ labels: [{ name: LABELS.blocked }] })] });
  await synchronize(blocked, config);
  assert.equal(blocked.statuses.at(-1).state, 'failure');
  assert.equal(blocked.items.get('issue1').values.status, 'blocked');
});
test('les écritures Projects sont idempotentes et l’effacement est explicite', async () => {
  const api = new GitHub(config, 'repo-token', 'project-token');
  const calls = [];
  api.graphql = async (query, variables) => {
    calls.push({ query, variables });
    return {};
  };
  const target = item();
  await api.fields(target, { status: 'review', estimate: 2 });
  assert.equal(calls.length, 0);
  await api.fields(target, { estimate: 4 });
  assert.equal(calls.length, 1);
  assert.equal(target.values.estimate, 4);
  await api.fields(target, { estimate: undefined });
  assert.equal(calls.length, 2);
  assert.match(calls[1].query, /clearProjectV2ItemFieldValue/);
});

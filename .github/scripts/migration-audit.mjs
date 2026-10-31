import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHub } from './project-workflow.mjs';

const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
const sorted = (values) =>
  [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const fieldId =
  '... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name options{id name}} ... on ProjectV2IterationField{id name}';

export async function destinationAccess(api, token) {
  if (!token)
    throw new Error('PROJECTS_TOKEN_INTEBEC absent; préparer le jeton dédié avant le transfert.');
  const user = await api.request('/user', 'GET', undefined, token);
  if (user.login !== api.config.migration.destinationAccount)
    throw new Error('Le jeton futur appartient à un autre compte.');
  const org = api.config.migration.destinationOwner;
  const membership = await api.request(`/user/memberships/orgs/${org}`, 'GET', undefined, token);
  if (membership.state !== 'active' || membership.role !== 'admin')
    throw new Error('Le compte futur doit être propriétaire actif de l’organisation prévue.');
  const response = await api.request(
    '/graphql',
    'POST',
    {
      query:
        'query($login:String!){organization(login:$login){login projectsV2(first:1){totalCount}}}',
      variables: { login: org },
    },
    token,
  );
  if (response.errors || response.data?.organization?.login?.toLowerCase() !== org.toLowerCase())
    throw new Error('Accès Projects de l’organisation non confirmé avec le jeton futur.');
  return {
    account: user.login,
    organization: org,
    projectsReadable: true,
    limits: 'La capacité réelle à modifier le tableau transféré sera vérifiée après le transfert.',
  };
}

async function optional(read) {
  try {
    return { available: true, value: await read() };
  } catch (error) {
    return { available: false, error: error.message };
  }
}
async function collection(api, path, key) {
  const values = [];
  for (let page = 1; page <= 100; page++) {
    const response = await api.request(`${path}?per_page=100&page=${page}`);
    values.push(...response[key]);
    if (response[key].length < 100) return values;
  }
  throw new Error('Inventaire trop grand; aucune comparaison partielle.');
}
async function projectSnapshot(api) {
  await api.project(); // Validate identity, access and required fields before taking the complete snapshot.
  const query = `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{
    id number url title public closed readme shortDescription
    owner{__typename ... on User{login} ... on Organization{login}}
    fields(first:100){nodes{${fieldId}} pageInfo{hasNextPage}}
    views(first:100){nodes{id name layout filter fields(first:100){nodes{${fieldId}} pageInfo{hasNextPage}}} pageInfo{hasNextPage}}
    workflows(first:100){nodes{id name enabled} pageInfo{hasNextPage}}
    repositories(first:100){nodes{id nameWithOwner} pageInfo{hasNextPage}}
    items(first:100,after:$cursor){nodes{id isArchived content{
      ... on Issue{id number repository{id nameWithOwner}}
      ... on PullRequest{id number repository{id nameWithOwner}}
      ... on DraftIssue{id title body}
    } fieldValues(first:100){nodes{
      ... on ProjectV2ItemFieldNumberValue{number field{${fieldId}}}
      ... on ProjectV2ItemFieldSingleSelectValue{optionId field{${fieldId}}}
      ... on ProjectV2ItemFieldTextValue{text field{${fieldId}}}
      ... on ProjectV2ItemFieldDateValue{date field{${fieldId}}}
      ... on ProjectV2ItemFieldIterationValue{iterationId field{${fieldId}}}
    } pageInfo{hasNextPage}}} pageInfo{hasNextPage endCursor}}
  }}}`;
  let cursor = null,
    metadata;
  const items = [];
  do {
    const p = (await api.graphql(query, { id: api.config.id, cursor })).node;
    if (!p) throw new Error('Projet inaccessible pendant l’inventaire.');
    for (const key of ['fields', 'views', 'workflows', 'repositories'])
      if (p[key].pageInfo.hasNextPage)
        throw new Error(`Inventaire ${key} tronqué; inspection manuelle requise.`);
    for (const view of p.views.nodes)
      if (view.fields.pageInfo.hasNextPage)
        throw new Error('Vue trop grande pour un inventaire complet.');
    for (const item of p.items.nodes) {
      if (item.fieldValues.pageInfo.hasNextPage)
        throw new Error('Carte trop grande pour un inventaire complet.');
      const content = item.content;
      items.push({
        id: item.id,
        archived: item.isArchived,
        content: content?.repository
          ? { id: content.id, number: content.number, repositoryId: content.repository.id }
          : content
            ? { id: content.id, draftHash: hash([content.title, content.body]) }
            : null,
        values: sorted(
          item.fieldValues.nodes
            .filter((v) => v.field)
            .map((v) => ({
              fieldId: v.field.id,
              value: v.optionId ?? v.number ?? v.text ?? v.date ?? v.iterationId,
            })),
        ),
      });
    }
    metadata = {
      id: p.id,
      owner: p.owner.login,
      url: p.url,
      number: p.number,
      title: p.title,
      public: p.public,
      closed: p.closed,
      readmeHash: hash(p.readme),
      descriptionHash: hash(p.shortDescription),
      fields: sorted(p.fields.nodes),
      views: sorted(
        p.views.nodes.map((v) => ({
          id: v.id,
          name: v.name,
          layout: v.layout,
          filter: v.filter,
          fields: v.fields.nodes.map((f) => f.id),
        })),
      ),
      workflows: sorted(p.workflows.nodes),
      repositoryIds: sorted(p.repositories.nodes.map((r) => r.id)),
    };
    cursor = p.items.pageInfo.hasNextPage ? p.items.pageInfo.endCursor : null;
  } while (cursor);
  return { ...metadata, items: sorted(items) };
}

export async function snapshot(api) {
  const repository = await api.initialize();
  const base = `/repos/${api.repository}`;
  const [
    branches,
    tags,
    issues,
    pulls,
    project,
    secrets,
    variables,
    protection,
    actions,
    environments,
    hooks,
    keys,
    releases,
  ] = await Promise.all([
    api.pages('branches'),
    api.pages('tags'),
    api.pages('issues?state=all'),
    api.pages('pulls?state=all'),
    projectSnapshot(api),
    optional(() =>
      collection(api, `${base}/actions/secrets`, 'secrets').then((v) =>
        v.map((s) => s.name).sort(),
      ),
    ),
    optional(() =>
      collection(api, `${base}/actions/variables`, 'variables').then((v) =>
        sorted(v.map((s) => ({ name: s.name, valueHash: hash(s.value) }))),
      ),
    ),
    optional(() =>
      api.request(`${base}/branches/${encodeURIComponent(repository.default_branch)}/protection`),
    ),
    optional(async () => {
      const policy = await api.request(`${base}/actions/permissions`);
      return {
        policy,
        workflowPermissions: await api.request(`${base}/actions/permissions/workflow`),
        allowedActions:
          policy.allowed_actions === 'selected'
            ? await api.request(`${base}/actions/permissions/selected-actions`)
            : null,
      };
    }),
    optional(async () => {
      const environments = await collection(api, `${base}/environments`, 'environments');
      return sorted(
        await Promise.all(
          environments.map(async (e) => {
            const envPath = `${base}/environments/${encodeURIComponent(e.name)}`;
            return {
              name: e.name,
              protection_rules: e.protection_rules,
              deployment_branch_policy: e.deployment_branch_policy,
              secrets: (await collection(api, `${envPath}/secrets`, 'secrets'))
                .map((secret) => secret.name)
                .sort(),
              variables: sorted(
                (await collection(api, `${envPath}/variables`, 'variables')).map((v) => ({
                  name: v.name,
                  valueHash: hash(v.value),
                })),
              ),
            };
          }),
        ),
      );
    }),
    optional(() =>
      api
        .pages('hooks')
        .then((v) =>
          sorted(
            v.map((h) => ({
              id: h.id,
              name: h.name,
              active: h.active,
              events: h.events,
              endpointHash: hash(h.config?.url),
            })),
          ),
        ),
    ),
    optional(() =>
      api
        .pages('keys')
        .then((v) =>
          sorted(v.map((k) => ({ id: k.id, readOnly: k.read_only, keyHash: hash(k.key) }))),
        ),
    ),
    api.pages('releases'),
  ]);
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    repository: {
      id: repository.id,
      nodeId: repository.node_id,
      fullName: repository.full_name,
      private: repository.private,
      defaultBranch: repository.default_branch,
      settings: {
        allow_squash_merge: repository.allow_squash_merge,
        allow_merge_commit: repository.allow_merge_commit,
        allow_rebase_merge: repository.allow_rebase_merge,
        delete_branch_on_merge: repository.delete_branch_on_merge,
      },
    },
    branches: sorted(
      branches.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected })),
    ),
    tags: sorted(tags.map((t) => ({ name: t.name, sha: t.commit.sha }))),
    issues: sorted(
      issues.map((i) => ({
        id: i.node_id,
        number: i.number,
        isPullRequest: !!i.pull_request,
        state: i.state,
        titleHash: hash(i.title),
        bodyHash: hash(i.body),
        comments: i.comments,
        assignees: i.assignees.map((a) => a.login).sort(),
        labels: i.labels.map((l) => l.name).sort(),
        milestone: i.milestone?.number ?? null,
      })),
    ),
    pulls: sorted(
      pulls.map((p) => ({
        id: p.node_id,
        number: p.number,
        state: p.state,
        draft: p.draft,
        head: p.head.sha,
        base: p.base.sha,
        mergedAt: p.merged_at,
      })),
    ),
    releases: sorted(
      releases.map((r) => ({
        id: r.id,
        tag: r.tag_name,
        draft: r.draft,
        prerelease: r.prerelease,
        assets: sorted(
          r.assets.map((a) => ({ id: a.id, name: a.name, size: a.size, digest: a.digest ?? null })),
        ),
      })),
    ),
    project,
    secrets,
    variables,
    protection,
    actions,
    environments,
    hooks,
    keys,
    futureSecretConfigured: secrets.available && secrets.value.includes('PROJECTS_TOKEN_INTEBEC'),
    manualChecks: [
      'Accès des membres/équipes et affectations après transfert',
      'GitHub Apps, webhooks et intégrations externes',
      'Droits des éventuels packages/registries, runners et déploiements externes',
      'Politiques Actions et offre de l’organisation cible',
      'Clones locaux et URLs des documentations historiques',
    ],
  };
}

function stripUrls(value) {
  if (Array.isArray(value)) return value.map(stripUrls);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['url', 'contexts_url'].includes(key))
        .map(([key, v]) => [key, stripUrls(v)]),
    );
  return value;
}
export function compareSnapshots(before, after, destinationOwner = 'Intebec') {
  const errors = [],
    warnings = [];
  if (before.repository.id !== after.repository.id)
    errors.push('Le dépôt a été remplacé au lieu d’être transféré.');
  if (after.repository.fullName.split('/')[0].toLowerCase() !== destinationOwner.toLowerCase())
    errors.push('Le dépôt n’est pas dans l’organisation attendue.');
  if (after.project.owner.toLowerCase() !== destinationOwner.toLowerCase())
    errors.push('Le tableau n’est pas dans l’organisation attendue.');
  for (const key of ['private', 'defaultBranch', 'settings'])
    if (hash(before.repository[key]) !== hash(after.repository[key]))
      errors.push(`Réglage du dépôt modifié : ${key}.`);
  for (const key of ['branches', 'tags', 'issues', 'pulls', 'releases'])
    if (hash(before[key]) !== hash(after[key]))
      errors.push(
        `Écart dans ${key}; inspecter les changements concurrents ou les pertes avant de valider.`,
      );
  for (const key of [
    'id',
    'title',
    'public',
    'closed',
    'fields',
    'views',
    'workflows',
    'repositoryIds',
    'items',
    'readmeHash',
    'descriptionHash',
  ])
    if (hash(before.project[key]) !== hash(after.project[key]))
      errors.push(`Écart dans le tableau : ${key}. Une copie n’équivaut pas à un transfert.`);
  for (const key of [
    'secrets',
    'variables',
    'protection',
    'actions',
    'environments',
    'hooks',
    'keys',
  ]) {
    if (!before[key]?.available || !after[key]?.available)
      warnings.push(`${key}: comparaison non disponible; contrôle manuel requis.`);
    else if (hash(stripUrls(before[key].value)) !== hash(stripUrls(after[key].value)))
      errors.push(`Réglage modifié : ${key}.`);
  }
  return {
    errors,
    warnings,
    manualChecks: after.manualChecks,
    automatedComparisonPassed: errors.length === 0 && warnings.length === 0,
  };
}

async function main() {
  const config = JSON.parse(readFileSync('.github/project.json', 'utf8'));
  const local = process.env.GITHUB_ACTIONS !== 'true';
  const cliToken = local
    ? (process.env.GH_TOKEN ??
      execFileSync('gh', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim())
    : undefined;
  const api = new GitHub(
    config,
    process.env.GITHUB_TOKEN ?? cliToken,
    process.env.PROJECTS_TOKEN ?? cliToken,
    process.env.PROJECTS_TOKEN_INTEBEC,
  );
  const command = process.argv[2];
  if (command === 'destination-access') {
    console.log(
      JSON.stringify(await destinationAccess(api, process.env.PROJECTS_TOKEN_INTEBEC), null, 2),
    );
    return;
  }
  if (!['snapshot', 'verify'].includes(command) || !process.argv[3])
    throw new Error(
      'Usage : snapshot fichier-neuf.json | verify inventaire-avant.json [inventaire-apres-neuf.json] | destination-access',
    );
  const current = await snapshot(api);
  if (command === 'snapshot') {
    writeFileSync(process.argv[3], JSON.stringify(current, null, 2), { flag: 'wx' });
    console.log(
      JSON.stringify(
        {
          file: process.argv[3],
          repository: current.repository.fullName,
          project: current.project.url,
          issuesAndPRs: current.issues.length,
          projectItems: current.project.items.length,
          futureSecretConfigured: current.futureSecretConfigured,
          manualChecks: current.manualChecks,
        },
        null,
        2,
      ),
    );
  } else {
    const before = JSON.parse(readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
    if (process.argv[4])
      writeFileSync(process.argv[4], JSON.stringify(current, null, 2), { flag: 'wx' });
    const report = compareSnapshots(before, current, config.migration.destinationOwner);
    console.log(JSON.stringify(report, null, 2));
    if (!report.automatedComparisonPassed) process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

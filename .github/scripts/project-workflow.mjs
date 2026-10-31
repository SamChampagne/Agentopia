// Standard GitHub v3 — portable across the planned Intebec transfer. No dependencies and no execution of issue/PR content.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryIdentity, selectProjectAccess } from './github-identity.mjs';

export const LABELS = {
  started: 'workflow:started',
  blocked: 'workflow:blocked',
  planning: 'workflow:needs-planning',
};

const clean = (value) => String(value ?? '').replace(/<!--[\s\S]*?-->/g, '');
const normalize = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’]/g, "'")
    .toLowerCase()
    .trim();
export function sections(body) {
  const result = new Map();
  const text = clean(body).replace(/```[^\n]*\n[\s\S]*?```/g, '');
  const headings = [...text.matchAll(/^#{2,3}\s+(.+)\r?$/gm)];
  headings.forEach((heading, index) => {
    const key = normalize(heading[1]);
    if (!result.has(key))
      result.set(
        key,
        text.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim(),
      );
  });
  return result;
}

const substantive = (value, length) =>
  value?.length >= length &&
  !/^(?:[-*]\s*)?(?:TODO|N\/A|_No response_|a completer|a renseigner|a definir|tbd)\b/i.test(
    normalize(value),
  );
export function inspectIssue(issue, maximum = 80) {
  const fields = sections(issue.body);
  const errors = [];
  for (const [name, minimum] of [
    ['description', 30],
    ["hypotheses de l'estimation", 20],
    ['validation prevue', 20],
  ]) {
    if (!substantive(fields.get(name), minimum)) errors.push(`Rubrique requise : ${name}.`);
  }
  const criteria = fields.get("criteres d'acceptation") ?? '';
  if (!/^\s*[-*] \[[ xX]\] .{12,}$/m.test(criteria))
    errors.push("Au moins un critère d'acceptation vérifiable est requis.");
  const rawEstimate = fields.get('estimation (heures)')?.replace(',', '.');
  const estimate = /^\d+(?:\.\d+)?$/.test(rawEstimate ?? '') ? Number(rawEstimate) : NaN;
  if (!Number.isFinite(estimate) || estimate <= 0 || estimate > maximum)
    errors.push(
      `Estimation requise : nombre d'heures > 0 et <= ${maximum}; décomposer les gros lots.`,
    );
  const priority = fields.get('priorite');
  if (!/^P[123]$/.test(priority ?? '')) errors.push('Priorité requise : P1, P2 ou P3.');
  if (
    issue.labels?.some((label) => (label.name ?? label) === 'bug') &&
    !substantive(fields.get('reproduction'), 20)
  )
    errors.push('Un bug doit préciser sa reproduction ou sa preuve datée.');
  return { errors, estimate, priority, fields };
}

export function closingNumbers(body) {
  const text = clean(body)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
  return [
    ...new Set(
      [...text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#([1-9]\d*)\b/gi)].map(
        (match) => Number(match[1]),
      ),
    ),
  ];
}

export function inspectPull(pr) {
  const errors = [];
  const numbers = closingNumbers(pr.body);
  if (!numbers.length)
    errors.push('Lier une vraie issue de ce dépôt avec Closes #N, hors commentaire/exemple.');
  const fields = sections(pr.body);
  for (const name of ['validation', 'limites']) {
    if (!substantive(fields.get(name), 20)) errors.push(`PR : rubrique ${name} concrète requise.`);
  }
  return { errors, numbers };
}

export function desiredStatus(issue, pulls) {
  if (issue.state === 'closed') return 'Done';
  const labels = new Set(issue.labels?.map((label) => label.name ?? label));
  if (labels.has(LABELS.blocked)) return 'Blocked';
  if (pulls.some((pr) => !pr.draft)) return 'In Review';
  if (pulls.length || labels.has(LABELS.started)) return 'In Progress';
  return 'Todo';
}

export function validateTrackedPull(pr, issues, items, config, nativeNumbers) {
  const result = inspectPull(pr);
  const errors = [...result.errors];
  for (const number of result.numbers) {
    const issue = issues.get(number);
    if (!issue || issue.pull_request) {
      errors.push(`#${number} n'est pas une issue de ce dépôt.`);
      continue;
    }
    if (!nativeNumbers.includes(number))
      errors.push(
        `#${number} n'est pas liée nativement par GitHub (base de PR ou référence à corriger).`,
      );
    if (issue.state !== 'open')
      errors.push(`#${number} est fermée; utiliser une issue ouverte pour ce nouveau changement.`);
    const plan = inspectIssue(issue, config.estimateMaxHours);
    errors.push(...plan.errors.map((error) => `#${number} : ${error}`));
    const item = items.get(issue.node_id);
    if (!item || item.archived) {
      errors.push(`#${number} manque dans le projet actif attendu.`);
      continue;
    }
    if (item.values[config.estimateFieldId] !== plan.estimate)
      errors.push(`#${number} : estimation du projet incohérente.`);
    if (item.values[config.priorityFieldId] !== config.priorityOptions[plan.priority])
      errors.push(`#${number} : priorité du projet incohérente.`);
    const status = pr.draft ? 'In Progress' : 'In Review';
    if (item.values[config.statusFieldId] !== config.statusOptions[status])
      errors.push(
        `#${number} : statut attendu ${status} (une tâche bloquée ne peut pas être fusionnée).`,
      );
  }
  return { numbers: result.numbers, errors };
}

export class GitHub {
  constructor(config, repoToken, projectToken, destinationProjectToken) {
    this.config = config;
    this.repoToken = repoToken;
    this.projectToken = projectToken;
    this.projectCandidates = [
      { name: 'PROJECTS_TOKEN_INTEBEC', token: destinationProjectToken },
      { name: 'PROJECTS_TOKEN', token: projectToken },
    ];
    this.repository = `${config.owner}/${config.repository}`;
  }
  async initialize(environment = process.env) {
    if (!Number.isSafeInteger(this.config.repositoryId) || this.config.repositoryId <= 0)
      throw new Error('repositoryId stable requis avant tout accès GitHub.');
    const metadata = await this.request(`/repositories/${this.config.repositoryId}`);
    Object.assign(this.config, repositoryIdentity(this.config, metadata, environment));
    this.repository = `${this.config.owner}/${this.config.repository}`;
    return metadata;
  }
  async resolveProjectAccess() {
    if (this.projectAccessName) return;
    const selected = await selectProjectAccess(
      this.config,
      this.projectCandidates,
      async (token) => {
        const response = await this.request(
          '/graphql',
          'POST',
          {
            query:
              'query($id:ID!){node(id:$id){... on ProjectV2{id number url closed owner{__typename ... on User{login} ... on Organization{login}}}}}',
            variables: { id: this.config.id },
          },
          token,
        );
        if (response.errors) throw new Error('Accès Projects refusé.');
        return response.data?.node;
      },
    );
    this.projectToken = selected.token;
    this.projectAccessName = selected.name;
    Object.assign(this.config, selected.identity);
  }
  async request(path, method = 'GET', body, token = this.repoToken) {
    if (!token) throw new Error('Accès GitHub manquant; impossible de confirmer le suivi.');
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`API GitHub ${method} ${path.split('?')[0]} : HTTP ${response.status}.`);
    return response.status === 204 ? undefined : response.json();
  }
  async graphql(query, variables, projects = true) {
    if (projects && !this.projectToken)
      throw new Error('Secret PROJECTS_TOKEN absent : le contrôle reste en échec.');
    const response = await this.request(
      '/graphql',
      'POST',
      { query, variables },
      projects ? this.projectToken : this.repoToken,
    );
    if (response.errors)
      throw new Error(
        `Requête GraphQL refusée : ${response.errors.map((error) => error.message).join('; ')}`,
      );
    return response.data;
  }
  async pages(path) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await this.request(
        `/repos/${this.repository}/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      all.push(...batch);
      if (batch.length < 100) return all;
    }
    throw new Error('Pagination trop grande; aucune validation partielle acceptée.');
  }
  pulls() {
    return this.pages('pulls?state=open');
  }
  async issues() {
    return (await this.pages('issues?state=all')).filter((issue) => !issue.pull_request);
  }
  issue(number) {
    return this.request(`/repos/${this.repository}/issues/${number}`);
  }
  async nativeLinks(pr) {
    const data = await this.graphql(
      'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}}}}',
      { owner: this.config.owner, repo: this.config.repository, number: pr.number },
      false,
    );
    const refs = data.repository.pullRequest.closingIssuesReferences;
    if (refs.pageInfo.hasNextPage) throw new Error('Trop d’issues liées : découper la PR.');
    return refs.nodes
      .filter((issue) => issue.repository.nameWithOwner === this.repository)
      .map((issue) => issue.number);
  }
  async project() {
    await this.resolveProjectAccess();
    const query =
      'query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{id title closed fields(first:100){nodes{... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name options{id name}}}} items(first:100,after:$cursor){nodes{id isArchived content{... on Issue{id number repository{nameWithOwner}}} fieldValues(first:50){nodes{... on ProjectV2ItemFieldNumberValue{number field{... on ProjectV2Field{id} ... on ProjectV2SingleSelectField{id}}} ... on ProjectV2ItemFieldSingleSelectValue{optionId field{... on ProjectV2Field{id} ... on ProjectV2SingleSelectField{id}}}}}} pageInfo{hasNextPage endCursor}}}}}';
    const items = new Map();
    let cursor = null;
    let project;
    do {
      project = (await this.graphql(query, { id: this.config.id, cursor })).node;
      if (!project || project.closed) throw new Error('Projet absent, fermé ou inaccessible.');
      for (const raw of project.items.nodes) {
        if (raw.content?.repository?.nameWithOwner !== this.repository) continue;
        const values = Object.fromEntries(
          raw.fieldValues.nodes
            .filter((v) => v.field)
            .map((v) => [v.field.id, v.optionId ?? v.number]),
        );
        items.set(raw.content.id, {
          id: raw.id,
          archived: raw.isArchived,
          number: raw.content.number,
          values,
        });
      }
      cursor = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
    } while (cursor);
    const fields = project.fields.nodes;
    const status = fields.find((field) => field.id === this.config.statusFieldId);
    const priority = fields.find((field) => field.id === this.config.priorityFieldId);
    const estimate = fields.find((field) => field.id === this.config.estimateFieldId);
    if (!status || !priority || estimate?.dataType !== 'NUMBER')
      throw new Error('Champs du projet incompatibles avec .github/project.json.');
    for (const [name, id] of Object.entries(this.config.statusOptions))
      if (!status.options.some((o) => o.id === id && o.name === name))
        throw new Error('Options de statut modifiées; actualiser la configuration.');
    for (const [name, id] of Object.entries(this.config.priorityOptions))
      if (!priority.options.some((o) => o.id === id && o.name === name))
        throw new Error('Options de priorité modifiées; actualiser la configuration.');
    return items;
  }
  async add(issue) {
    const data = await this.graphql(
      'mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}',
      { project: this.config.id, content: issue.node_id },
    );
    return {
      id: data.addProjectV2ItemById.item.id,
      archived: false,
      number: issue.number,
      values: {},
    };
  }
  async fields(item, values) {
    const changes = Object.entries(values).filter(([field, value]) => item.values[field] !== value);
    if (!changes.length) return;
    const variables = { project: this.config.id, item: item.id };
    const declarations = ['$project:ID!', '$item:ID!'];
    const operations = [];
    for (const [index, [field, value]] of changes.entries()) {
      declarations.push(`$f${index}:ID!`);
      variables[`f${index}`] = field;
      if (value === undefined) {
        operations.push(
          `m${index}:clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$f${index}}){projectV2Item{id}}`,
        );
      } else {
        declarations.push(`$v${index}:ProjectV2FieldValue!`);
        variables[`v${index}`] =
          typeof value === 'number' ? { number: value } : { singleSelectOptionId: value };
        operations.push(
          `m${index}:updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$f${index},value:$v${index}}){projectV2Item{id}}`,
        );
      }
    }
    await this.graphql(`mutation(${declarations.join(',')}){${operations.join(' ')}}`, variables);
    Object.assign(item.values, values);
  }
  async labels(issue, label, enabled) {
    const present = issue.labels.some((value) => (value.name ?? value) === label);
    if (present === enabled) return;
    const path = `/repos/${this.repository}/issues/${issue.number}/labels`;
    if (enabled) await this.request(path, 'POST', { labels: [label] });
    else await this.request(`${path}/${encodeURIComponent(label)}`, 'DELETE');
    issue.labels = issue.labels.filter((value) => (value.name ?? value) !== label);
    if (enabled) issue.labels.push({ name: label });
  }
  async status(pr, state, description) {
    if (!/^[a-f0-9]{40}$/.test(pr.head.sha)) throw new Error('SHA de PR invalide.');
    await this.request(`/repos/${this.repository}/statuses/${pr.head.sha}`, 'POST', {
      state,
      context: this.config.statusContext,
      description: description.slice(0, 140),
      target_url: process.env.GITHUB_RUN_ID
        ? `https://github.com/${this.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : this.config.url,
    });
  }
}

export async function synchronize(api, config) {
  const pulls = await api.pulls();
  for (const pr of pulls)
    await api.status(pr, 'pending', 'Vérification des issues, estimations et statuts du projet.');
  try {
    const items = await api.project();
    const allIssues = await api.issues();
    const issues = new Map(allIssues.map((issue) => [issue.number, issue]));
    const native = new Map();
    for (const pr of pulls) native.set(pr.number, await api.nativeLinks(pr));
    const planning = [];
    for (const issue of allIssues) {
      let item = items.get(issue.node_id);
      // Historical closed issues are preserved; new closed tasks remain tracked even if events coalesce.
      if (!item && issue.state === 'closed' && issue.created_at < config.adoptedAt) continue;
      if (!item) {
        item = await api.add(issue);
        items.set(issue.node_id, item);
      }
      if (item.archived) continue;
      const linked = pulls.filter((pr) => native.get(pr.number).includes(issue.number));
      const status = desiredStatus(issue, linked);
      if (issue.state === 'closed') {
        await api.fields(item, { [config.statusFieldId]: config.statusOptions.Done });
        continue;
      }
      const plan = inspectIssue(issue, config.estimateMaxHours);
      planning.push({ number: issue.number, errors: plan.errors });
      await api.labels(issue, LABELS.planning, plan.errors.length > 0);
      await api.fields(item, {
        [config.statusFieldId]: config.statusOptions[status],
        [config.estimateFieldId]:
          Number.isFinite(plan.estimate) &&
          plan.estimate > 0 &&
          plan.estimate <= config.estimateMaxHours
            ? plan.estimate
            : undefined,
        [config.priorityFieldId]: config.priorityOptions[plan.priority],
      });
    }
    const results = [];
    for (const pr of pulls) {
      const result = validateTrackedPull(pr, issues, items, config, native.get(pr.number));
      const state = result.errors.length ? 'failure' : pr.draft ? 'pending' : 'success';
      await api.status(
        pr,
        state,
        result.errors[0] ??
          (pr.draft
            ? 'Brouillon suivi; passer la PR en revue pour obtenir le contrôle vert.'
            : 'Issues décrites, estimées, liées au projet et en revue.'),
      );
      results.push({ pullRequest: pr.number, state, ...result });
    }
    return { issues: planning, pullRequests: results };
  } catch (error) {
    for (const pr of pulls)
      await api.status(
        pr,
        'error',
        'Suivi non vérifiable : accès Projects ou configuration indisponible.',
      );
    throw error;
  }
}

async function main() {
  const config = JSON.parse(readFileSync('.github/project.json', 'utf8'));
  const action = process.argv[2] ?? 'sync';
  const local = process.env.GITHUB_ACTIONS !== 'true';
  let cliToken;
  if (local)
    cliToken =
      process.env.GH_TOKEN ??
      execFileSync('gh', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
  const api = new GitHub(
    config,
    process.env.GITHUB_TOKEN ?? cliToken,
    process.env.PROJECTS_TOKEN ?? (local ? cliToken : undefined),
    process.env.PROJECTS_TOKEN_INTEBEC,
  );
  await api.initialize();
  if (['start', 'block', 'create'].includes(action) && !local)
    throw new Error('Cette commande est réservée au poste de développement.');
  if (action === 'create') {
    const file = process.argv[3];
    const title = process.argv[4];
    const bug = process.argv.includes('--bug');
    if (!file || !title) throw new Error('Usage : create fichier.md "Titre de la tâche" [--bug]');
    const body = readFileSync(file, 'utf8');
    const labels = [bug ? 'bug' : 'enhancement'];
    const plan = inspectIssue({ body, labels }, config.estimateMaxHours);
    if (plan.errors.length) throw new Error(plan.errors.join('\n'));
    const issue = await api.request(`/repos/${api.repository}/issues`, 'POST', {
      title,
      body,
      labels,
    });
    console.log(`Issue créée : ${issue.html_url}`);
  } else if (action === 'start' || action === 'block') {
    const number = Number(process.argv[3]);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error('Numéro d’issue positif requis.');
    const issue = await api.issue(number);
    if (issue.pull_request || issue.state !== 'open')
      throw new Error('Une issue ouverte de ce dépôt est requise.');
    const plan = inspectIssue(issue, config.estimateMaxHours);
    if (plan.errors.length) throw new Error(plan.errors.join('\n'));
    const project = await api.project();
    if (project.get(issue.node_id)?.archived)
      throw new Error('Désarchiver la tâche avant de commencer.');
    if (action === 'block') {
      const reason = process.argv.slice(4).join(' ');
      if (reason.length < 20) throw new Error('Décrire le blocage avec au moins 20 caractères.');
      await api.request(`/repos/${api.repository}/issues/${number}`, 'PATCH', {
        body: `${issue.body}\n\n## Blocage — ${new Date().toISOString()}\n\n${reason}\n`,
      });
      await api.labels(issue, LABELS.blocked, true);
    } else {
      await api.labels(issue, LABELS.blocked, false);
      await api.labels(issue, LABELS.started, true);
    }
  } else if (action !== 'sync')
    throw new Error('Commandes disponibles : create, start, block, sync.');
  const result = await synchronize(api, config);
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Suivi projet\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`,
    );
  if (result.pullRequests.some((pr) => pr.errors.length)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

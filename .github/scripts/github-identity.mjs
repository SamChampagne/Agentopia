// Resolve identities, never guess a new owner from a title or a stale URL.
const includesOwner = (owners, login) =>
  typeof login === 'string' && owners.some((owner) => owner.toLowerCase() === login.toLowerCase());

export function repositoryIdentity(config, repository, environment = {}) {
  if (!Number.isSafeInteger(config.repositoryId) || config.repositoryId <= 0)
    throw new Error('repositoryId stable manquant dans .github/project.json.');
  if (repository?.id !== config.repositoryId)
    throw new Error('Identité du dépôt différente; aucune écriture autorisée.');
  const owners = config.migration?.allowedOwners ?? [config.owner];
  if (!includesOwner(owners, repository.owner?.login))
    throw new Error('Propriétaire du dépôt non prévu par la configuration de migration.');
  if (!/^[A-Za-z0-9_.-]+$/.test(repository.name ?? '')) throw new Error('Nom de dépôt invalide.');
  const fullName = `${repository.owner.login}/${repository.name}`;
  if (repository.full_name?.toLowerCase() !== fullName.toLowerCase())
    throw new Error('Nom canonique du dépôt incohérent.');
  if (
    environment.GITHUB_ACTIONS === 'true' &&
    (String(repository.id) !== environment.GITHUB_REPOSITORY_ID ||
      environment.GITHUB_REPOSITORY?.toLowerCase() !== fullName.toLowerCase())
  )
    throw new Error('Le contexte Actions ne correspond pas au dépôt configuré.');
  return {
    owner: repository.owner.login,
    repository: repository.name,
    repositoryUrl: repository.html_url,
    defaultBranch: repository.default_branch,
  };
}

export function projectIdentity(config, project) {
  if (!project || project.id !== config.id || project.closed)
    throw new Error(
      'Tableau attendu absent, fermé ou remplacé; ne pas créer une copie silencieuse.',
    );
  if (!includesOwner(config.migration?.allowedOwners ?? [config.owner], project.owner?.login))
    throw new Error('Propriétaire du tableau non prévu par la configuration de migration.');
  const url = new URL(project.url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    !Number.isSafeInteger(project.number) ||
    project.number <= 0
  )
    throw new Error('Adresse ou numéro de tableau invalide.');
  const expected =
    project.owner.__typename === 'Organization'
      ? `/orgs/${project.owner.login}/projects/${project.number}`
      : `/users/${project.owner.login}/projects/${project.number}`;
  if (url.pathname.toLowerCase() !== expected.toLowerCase())
    throw new Error('Adresse du tableau incohérente avec son propriétaire.');
  return {
    projectOwner: project.owner.login,
    projectOwnerType: project.owner.__typename,
    url: project.url,
    number: project.number,
  };
}

export async function selectProjectAccess(config, candidates, readProject) {
  const failures = [];
  for (const candidate of candidates.filter((entry) => entry.token)) {
    let project;
    try {
      project = await readProject(candidate.token);
    } catch {
      failures.push(`${candidate.name}: accès non confirmé`);
      continue;
    }
    if (!project) {
      failures.push(`${candidate.name}: tableau inaccessible`);
      continue;
    }
    // An accessible wrong identity is a configuration problem, not a reason to try another secret.
    const identity = projectIdentity(config, project);
    if (!project.viewerCanUpdate) {
      failures.push(`${candidate.name}: lecture seule`);
      continue;
    }
    return { ...candidate, identity };
  }
  throw new Error(
    `Accès au tableau impossible. Configurer PROJECTS_TOKEN et/ou PROJECTS_TOKEN_INTEBEC avec les droits du propriétaire réel. ${failures.join('; ')}`,
  );
}

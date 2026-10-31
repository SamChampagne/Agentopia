import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function issueNumbers(body) {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  return [...new Set([...text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#([1-9]\d*)\b/gi)].map(m => Number(m[1])))];
}

export function validateBody(body) {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  if (!issueNumbers(text).length) throw new Error('Lier une issue de ce dépôt avec Closes #N.');
  for (const heading of ['Validation', 'Limites']) {
    const section = text.match(new RegExp(`^## ${heading}\\s*\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1]?.trim();
    if (!section || section.length < 12 || /^(?:[-*]\s*)?(?:TODO|N\/A|à compléter|à renseigner)\b/i.test(section)) {
      throw new Error(`Renseigner ## ${heading} avec les commandes/résultats ou une limite précise.`);
    }
  }
  return issueNumbers(text);
}

export function checkDocs(root = process.cwd()) {
  const files = ['README.md','AGENTS.md','CLAUDE.md','CONTRIBUTING.md','.github/copilot-instructions.md'];
  function walk(dir) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const name = join(dir,entry.name);
      if (entry.isDirectory()) walk(name);
      else if (name.endsWith('.md')) files.push(name);
    }
  }
  walk('docs');
  const failures = [];
  let links = 0;
  for (const file of files) {
    const source = readFileSync(join(root,file),'utf8').replace(/```[\s\S]*?```/g,'');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].replace(/^<|>$/g,'');
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
      const path = decodeURIComponent(target.split(/[?#]/)[0]);
      if (!path) continue;
      links++;
      if (!existsSync(resolve(root,dirname(file),path))) failures.push(`${file}: ${target}`);
    }
  }
  if (failures.length) throw new Error(`Liens locaux absents :\n${failures.join('\n')}`);
  console.log(`${files.length} documents maintenus, ${links} liens locaux vérifiés.`);
}

async function main() {
  if (process.argv[2] !== '--pr') return checkDocs();
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  if (!event.pull_request) throw new Error('Événement pull_request requis.');
  const numbers = validateBody(event.pull_request.body);
  const repository = event.repository.full_name;
  if (!process.env.GITHUB_TOKEN) throw new Error('Jeton GitHub de lecture absent.');
  for (const number of numbers) {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues/${number}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Issue #${number} inaccessible : HTTP ${response.status}.`);
    const issue = await response.json();
    if (issue.pull_request) throw new Error(`#${number} est une PR, pas une issue.`);
  }
  console.log(`PR reliée à ${numbers.map(n => '#'+n).join(', ')}; rubriques Validation et Limites présentes.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueNumbers, validateBody, checkDocs } from './check-development.mjs';

test('le modèle vide et une référence cachée ne satisfont pas le contrat', () => {
  assert.deepEqual(issueNumbers('<!-- Closes #12 -->'), []);
  assert.throws(() => validateBody('<!-- Closes #12 -->\n## Validation\n<!-- commandes -->\n## Limites\n<!-- limites -->'));
  assert.throws(() => validateBody('Closes #12\n## Validation\nTODO\n## Limites\nPas de test produit exécuté.'));
});
test('une vraie preuve et une limite explicite sont acceptées', () => {
  assert.deepEqual(validateBody('Closes #12\nFixes #15\n## Validation\nnode --test : 3 tests réussis.\n## Limites\nAucun test du runtime produit exécuté.'), [12,15]);
});
test('un lien local supprimé est détecté, les URL externes sont hors périmètre', () => {
  const root = mkdtempSync(join(tmpdir(),'development-links-'));
  try {
    mkdirSync(join(root,'docs')); mkdirSync(join(root,'.github'));
    for (const file of ['README.md','AGENTS.md','CLAUDE.md','CONTRIBUTING.md','.github/copilot-instructions.md']) writeFileSync(join(root,file),'# Guide\n');
    writeFileSync(join(root,'README.md'),'[doc](docs/guide.md) [web](https://example.com)\n');
    assert.throws(() => checkDocs(root), /guide.md/);
    writeFileSync(join(root,'docs/guide.md'),'# Guide\n');
    assert.doesNotThrow(() => checkDocs(root));
  } finally { rmSync(root,{recursive:true,force:true}); }
});

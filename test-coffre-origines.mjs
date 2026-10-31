import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoffreSecrets } from './dist/coffreSecrets.js';
import { origineGitLab, appelGitAuthentifie } from './dist/originesGit.js';
import { lireFichierBorne, ecrireFichierAtomique } from './dist/fichiersProteges.js';

function profil(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-coffre-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return path.join(d, 'coffre.json'); }
test('coffre : lecture refusée ne supprime aucun autre compte', t => {
    const f = profil(t), avant = '{"GitHub":"CHIFFRE_A","sftp:demo":"CHIFFRE_B"}'; fs.writeFileSync(f, avant);
    const c = new CoffreSecrets(f, { lire: () => { throw Object.assign(new Error('indisponible'), { code: 'EACCES' }); }, ecrire: () => assert.fail('aucune écriture permise') });
    assert.throws(() => c.modifier(v => { v.claude = 'CHIFFRE_C'; })); assert.equal(fs.readFileSync(f, 'utf8'), avant);
});
test('coffre : JSON corrompu bloque la mutation et restauration conserve l’original', t => {
    const f = profil(t), c = new CoffreSecrets(f); c.modifier(v => { v.GitHub = 'CHIFFRE_A'; }); c.modifier(v => { v.GitLab = 'CHIFFRE_B'; });
    fs.writeFileSync(f, 'CORROMPU'); assert.throws(() => c.modifier(v => { v.claude = 'CHIFFRE_C'; }));
    const copie = c.restaurer(); assert.equal(fs.readFileSync(copie, 'utf8'), 'CORROMPU'); assert.equal(c.lire().GitHub, 'CHIFFRE_A');
});
test('coffre : le premier enregistrement est immédiatement récupérable', t => {
    const f = profil(t), c = new CoffreSecrets(f); c.modifier(v => { v.GitHub = 'CHIFFRE_INITIAL'; }); fs.writeFileSync(f, 'cassé'); c.restaurer(); assert.equal(c.lire().GitHub, 'CHIFFRE_INITIAL');
});
test('coffre : refus de remplacement laisse le coffre valide et sa sauvegarde', t => {
    const f = profil(t); fs.writeFileSync(f, '{"GitHub":"CHIFFRE_A"}');
    const c = new CoffreSecrets(f, { lire: lireFichierBorne, ecrire: (p, b) => { if (p === f) throw new Error('disque indisponible'); ecrireFichierAtomique(p, b); } });
    assert.throws(() => c.modifier(v => { v.GitLab = 'CHIFFRE_B'; })); assert.equal(JSON.parse(fs.readFileSync(f)).GitHub, 'CHIFFRE_A'); assert.equal(JSON.parse(fs.readFileSync(c.sauvegarde)).GitHub, 'CHIFFRE_A');
});
test('coffre : schéma et taille invalides refusés', t => { const f = profil(t), c = new CoffreSecrets(f); for (const text of ['null', '[]', '{"x":42}', '{"__proto__":"x"}']) { fs.writeFileSync(f, text); assert.throws(() => c.lire()); } });
test('coffre : lien dur refusé, fichier lié inchangé', t => {
    const f = profil(t), externe = path.join(path.dirname(f), 'temoin.json'); fs.writeFileSync(externe, '{"GitHub":"CHIFFRE_TEMOIN"}'); fs.linkSync(externe, f);
    const c = new CoffreSecrets(f); assert.throws(() => c.modifier(v => { v.GitLab = 'FAUX'; }), /Lien/); assert.equal(fs.readFileSync(externe, 'utf8'), '{"GitHub":"CHIFFRE_TEMOIN"}');
});
test('GitLab : origine HTTPS stricte et normalisée', () => {
    assert.equal(origineGitLab('https://GitLab.Example:8443/'), 'https://gitlab.example:8443');
    for (const v of ['http://gitlab.com', 'https://u:p@gitlab.com', 'https://gitlab.com/project', 'https://gitlab.com/?x=1']) assert.throws(() => origineGitLab(v));
});
test('Git : une redirection tiers ne reçoit aucun jeton', async () => {
    const appels = []; const resultat = await appelGitAuthentifie('https://gitlab.example/api/v4/user', { 'PRIVATE-TOKEN': 'FAUX_JETON' }, async (url, init) => { appels.push({ url, init }); return new Response(null, { status: 302, headers: { location: 'https://third-party.invalid/collecte' } }); });
    assert.equal(resultat.ok, false); assert.equal(appels.length, 1); assert.equal(appels[0].init.redirect, 'manual');
});
test('Git : redirection même origine acceptée, HTTP jamais appelé', async () => {
    const urls = []; const obtenir = async url => { urls.push(url); return urls.length === 1 ? new Response(null, { status: 307, headers: { location: '/nouveau' } }) : Response.json({ login: 'test' }); };
    assert.equal((await appelGitAuthentifie('https://gitlab.example/ancien', { 'PRIVATE-TOKEN': 'FAUX' }, obtenir)).json.login, 'test');
    assert.equal((await appelGitAuthentifie('http://gitlab.example/', {}, () => assert.fail('HTTP interdit'))).ok, false);
});

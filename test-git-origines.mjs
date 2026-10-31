import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('régression réelle GitLab : remotes tiers sans fuite, ancien compte muet puis association explicite', () => {
    const script = `
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const coffre = { GitLab: 'enc-legacy', 'gitlab:https://approved.example': 'enc-approved' }, captures = [];
let dechiffrements = 0;
const context = vm.createContext({ process: { env: {} }, URL, AbortSignal, Buffer, Response, setTimeout, clearTimeout,
 fetch: async (url, init) => { captures.push({url, headers: init.headers}); return Response.json([]); } });
class Coffre { lire() { return {...coffre}; } modifier(fn) { fn(coffre); } }
const stubs = { fs: {}, path: {}, child_process: {
 spawn: () => { throw Error('Processus interdit'); }, spawnSync: (_p,_a,o) => { dechiffrements++; return {status:0,stdout:o.input === 'enc-approved' ? 'TOKEN_APPROUVE_FACTICE' : 'TOKEN_ANCIEN_FACTICE'}; }
}, './projets.js': {estWorktree:()=>false}, './chemins.js': {surPath:()=>undefined,CHEMINS:{jetons:'/coffre-en-memoire'}}, './coffreSecrets.js': {CoffreSecrets:Coffre},
 './compteGitHub.js': {cleGitHub:async()=>undefined}, './config.js':{chargerConfig:()=>({})}, './authGitReseau.js':{argumentsGitCompte:a=>a} };
const modules = new Map();
async function charger(spec) {
 if (modules.has(spec)) return modules.get(spec);
 let m;
 if (stubs[spec]) { const v=stubs[spec]; m = new vm.SyntheticModule(Object.keys(v),function(){for(const[k,x]of Object.entries(v))this.setExport(k,x);},{context}); }
 else if (['./git.js','./jetons.js','./originesGit.js'].includes(spec)) m = new vm.SourceTextModule(fs.readFileSync('dist/'+spec.slice(2),'utf8'),{context});
 else throw Error('Import interdit : '+spec);
 modules.set(spec,m); await m.link(charger); return m;
}
const git = await charger('./git.js'); await git.evaluate(); const vault=modules.get('./jetons.js').namespace;
assert.equal(vault.jeton('GitLab'),undefined); assert.equal(dechiffrements,0);
const urls=['https://third-party.invalid/gitlab/demo.git','https://gitlab-unknown.invalid/team/demo.git','https://approved.example/team/demo.git','https://gitlab.com/team/demo.git'];
const depots=urls.map(remote=>({...git.namespace.decrireRemote(remote),remote,worktree:false}));
assert.notEqual(depots[0].hebergeur,'GitLab'); assert.notEqual(depots[1].hebergeur,'GitLab');
await git.namespace.ajouterPRs(depots); await git.namespace.depotsDistants(depots);
assert.equal(captures.length,2); assert.ok(captures.every(c=>new URL(c.url).origin==='https://approved.example'&&c.headers['PRIVATE-TOKEN']==='TOKEN_APPROUVE_FACTICE'));
vault.associerAncienGitLab('https://gitlab.com','TOKEN_ANCIEN_FACTICE'); assert.equal(coffre.GitLab,undefined); assert.equal(coffre['gitlab:https://gitlab.com'],'enc-legacy');
assert.equal(vault.jeton('GitLab','https://gitlab.com'),'TOKEN_ANCIEN_FACTICE'); assert.equal(vault.jeton('GitLab','https://other.invalid'),undefined);
console.log('REGRESSION_GITLAB_OK');
`;
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-'], { input: script, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    assert.equal(r.status, 0, r.stderr || r.error?.message); assert.match(r.stdout, /REGRESSION_GITLAB_OK/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chercherMiseAJour } from './dist/versionsDistribution.js';
import { depotPublication } from './outils/depot-publication.mjs';
const release = owner => ({tag_name:'agentopia-2.0.0',assets:['agentopia-release.json','Agentopia-Windows-x64.zip'].map(name=>({name,browser_download_url:`https://github.com/${owner}/Agentopia/releases/download/agentopia-2.0.0/${name}`}))});
const manifest={format:'agentopia-release-v1',id:'2.0.0-transfer',version:'2.0.0',plateforme:'win32-x64',asset:'Agentopia-Windows-x64.zip',sha256:'a'.repeat(64)};
test('mises à jour avant et après transfert via le même ID GitHub',async()=>{
 for(const owner of ['SamChampagne','Intebec']) {
  const urls=[];
  const result=await chercherMiseAJour('1.4.0',async url=>{urls.push(url);return Response.json(url.includes('/releases?')?[release(owner)]:manifest);});
  assert.equal(urls[0],'https://api.github.com/repositories/1436267735/releases?per_page=100');
  assert.ok(result.url.startsWith(`https://github.com/${owner}/Agentopia/`));
 }
});
test('un propriétaire inconnu ou deux assets provenant de propriétaires différents sont refusés',async()=>{
 for(const value of [release('Intrus'),{...release('Intebec'),assets:[release('Intebec').assets[0],release('SamChampagne').assets[1]]}])
  await assert.rejects(chercherMiseAJour('1.4.0',async url=>Response.json(url.includes('/releases?')?[value]:manifest)),/incompatible/);
});
test('les paquets CI utilisent le propriétaire actuel, avec identité et liste autorisée fermées',()=>{
 assert.equal(depotPublication({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1436267735',GITHUB_REPOSITORY:'Intebec/Agentopia'}),'Intebec/Agentopia');
 assert.equal(depotPublication({}),'SamChampagne/Agentopia');
 assert.throws(()=>depotPublication({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'99',GITHUB_REPOSITORY:'Intebec/Agentopia'}),/autre dépôt/);
 assert.throws(()=>depotPublication({GITHUB_REPOSITORY:'Intrus/Agentopia'}),/non autorisé/);
});

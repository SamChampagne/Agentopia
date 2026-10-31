// Test du moteur d'équipe sur un dépôt jetable : plan réel par Claude, refus d'un dossier non accepté,
// suivi des tâches avec des sessions simulées (sans lancer de vrais agents)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { creerEquipe, equipeDe, lancerEquipe, avancerEquipes, avancement, equipes } from './dist/equipe.js';
import { CHEMINS } from './dist/chemins.js';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'equipe-'));
process.env.AGENTOPIA_SANS_MOTEUR = '1';
const git = (cmd) => execSync(`git -c user.name=t -c user.email=t@t ${cmd}`, { cwd: dossier, stdio: 'pipe' });
fs.writeFileSync(path.join(dossier, 'calc.js'), 'export const additionner = (a, b) => a + b;\n');
fs.writeFileSync(path.join(dossier, 'README.md'), '# Calc\n\nPetite bibliothèque de calcul.\n');
git('init -q -b main'); git('add .'); git('commit -qm init');

const t0 = Date.now();
const e = creerEquipe({ chemin: dossier, nom: 'jetable' }, 'Ajouter multiplier et diviser (erreur si division par zéro) à calc.js, avec des tests node:test, et les documenter dans le README');
console.log('équipe', e.id, '· planification…');
while (equipeDe(e.id).etat === 'planification') await new Promise((r) => setTimeout(r, 1000));
const plan = equipeDe(e.id);
console.log(`plan en ${Math.round((Date.now() - t0) / 1000)} s · état ${plan.etat}${plan.message ? ' · ' + plan.message : ''}`);
console.log('résumé :', plan.resume);
for (const t of plan.taches) console.log(` ${t.id} [${t.role}] ${t.titre}${t.dependances.length ? ' ← ' + t.dependances.join(',') : ''}`);

console.log('lancement sur un dossier non accepté :', await lancerEquipe(e.id) ?? 'lancé (inattendu)');

// Suivi simulé : chaque tâche a une session qui travaille, puis qui s'arrête
for (const t of plan.taches) Object.assign(t, { etat: 'en cours', agentId: `faux-${t.id}`, debut: Date.now() });
plan.etat = 'en cours';
const agent = (t, statut) => ({ cle: t.agentId, id: t.agentId, sessionId: t.agentId, arrierePlan: true, cwd: dossier, nom: 'jetable', titre: t.titre, statut, debut: new Date(), fichier: path.join(dossier, 'absent.jsonl') });
await avancerEquipes(plan.taches.map((t) => agent(t, 'travaille')));
console.log('après « travaille » :', JSON.stringify(avancement(plan)), plan.etat);
await avancerEquipes(plan.taches.map((t, i) => agent(t, i === 0 ? 'bloquee' : 'attend')));
console.log('une bloquée, les autres finies :', JSON.stringify(avancement(plan)), plan.etat);
await avancerEquipes(plan.taches.map((t) => agent(t, 'attend')));
console.log('toutes finies :', JSON.stringify(avancement(plan)), plan.etat, '· branche', plan.taches[0].branche);

// Nettoyage : on retire l'équipe de test du fichier
const liste = JSON.parse(fs.readFileSync(CHEMINS.equipes, 'utf-8')).filter((x) => x.id !== e.id);
fs.writeFileSync(CHEMINS.equipes, JSON.stringify(liste, null, 2));
process.exit(0);

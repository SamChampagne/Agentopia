// Test du maître : vraies sessions, vraies réponses, mais AUCUNE commande exécutée
import { demarrerCollecte, lireDonnees } from './dist/ui/donnees.js';
import { prechauffer, demanderAuMaitre, arreterMaitre } from './dist/maitre.js';
import { getProjets } from './dist/commandes.js';
import { capturerConsole } from './dist/ui/journal.js';
capturerConsole();
const ecrire = (t) => process.stderr.write(t + '\n');
demarrerCollecte();
const projets = getProjets().map((p) => p.nom);
let t = Date.now();
await prechauffer(projets);
ecrire(`préchauffage : ${Date.now() - t} ms · ${lireDonnees().agents.length} sessions connues`);
for (const q of ['Quelles sessions travaillent en ce moment ?', 'Ferme toutes les sessions en arrière-plan qui ont fini', 'Lance une session sur SaniPlan pour écrire les tests du module livrables', 'Supprime la session de Bob']) {
    t = Date.now();
    const e = await demanderAuMaitre(q, projets);
    ecrire(`\n» ${q}  (${Date.now() - t} ms)\n  ${e.erreur ?? e.reponse}\n  commandes : ${JSON.stringify(e.commandes ?? [])}`);
}
arreterMaitre();
process.exit(0);

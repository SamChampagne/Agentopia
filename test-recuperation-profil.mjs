import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-profil-test-'));
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'profil'); process.env.AGENTOPIA_SANS_MOTEUR = '1';
process.env.CLAUDETOPIA_SSH_CONFIG = path.join(racine, 'ssh-config'); fs.mkdirSync(process.env.CLAUDETOPIA_DATA_DIR);
after(() => { assert.ok(path.resolve(racine).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(racine, { recursive: true, force: true }); });
const { appliquerTransaction, restaurerTransaction } = await import('./dist/transactionFichiers.js');
const { ecrireFichierAtomique } = await import('./dist/fichiersProteges.js');
const { CHEMINS } = await import('./dist/chemins.js');
const { creerIntegree, changerModeleIntegree } = await import('./dist/sessionsIntegrees.js');
const { lireEtatSession, sauverEtatSession, fichierSession, problemesSessions, restaurerEtatSession } = await import('./dist/stockageSessions.js');
const { chargerConfig, sauverConfig } = await import('./dist/config.js');
const { creerSauvegardeProfil, lireSauvegardeProfil, restaurerSauvegardeProfil, fichiersRestaurationAutorises } = await import('./dist/sauvegardeProfil.js');

test('import transactionnel : deuxième écriture refusée restaure les deux fichiers', () => {
    const a = path.join(racine, 'a'), b = path.join(racine, 'b'), journal = path.join(racine, 'import1.json');
    fs.writeFileSync(a, 'avant-a'); fs.writeFileSync(b, 'avant-b');
    assert.throws(() => appliquerTransaction(journal, [{ fichier: a, contenu: 'apres-a' }, { fichier: b, contenu: 'apres-b' }], (f, c) => { if (f === b) throw new Error('panne'); ecrireFichierAtomique(f, c); }), /annulée/);
    assert.equal(fs.readFileSync(a, 'utf8'), 'avant-a'); assert.equal(fs.readFileSync(b, 'utf8'), 'avant-b');
    assert.equal(JSON.parse(fs.readFileSync(journal)).annulee, true);
});
test('import : journal inachevé conservé, nouveau lancement refusé', () => {
    const f = path.join(racine, 'c'), j = path.join(racine, 'import2.json'); const ancien = JSON.stringify({ format: 'agentopia-transaction-v1', date: 1, terminee: false, entrees: [] });
    fs.writeFileSync(j, ancien); assert.throws(() => appliquerTransaction(j, [{ fichier: f, contenu: 'nouveau' }]), /précédente/);
    assert.equal(fs.readFileSync(j, 'utf8'), ancien); assert.equal(fs.existsSync(f), false);
});
test('import : panne suivie d’un conflit de rollback garde son journal récupérable', () => {
    const a = path.join(racine, 'rollback-a'), b = path.join(racine, 'rollback-b'), j = path.join(racine, 'rollback-panne.json'); fs.writeFileSync(a, 'ancien'); fs.writeFileSync(b, 'ancien-b');
    assert.throws(() => appliquerTransaction(j, [{ fichier: a, contenu: 'nouveau' }, { fichier: b, contenu: 'nouveau-b' }], (f, c) => {
        if (f === b) { fs.writeFileSync(a, 'changement-concurrent'); throw new Error('échec second fichier'); } ecrireFichierAtomique(f, c);
    }), /récupération nécessaire/);
    const avant = fs.readFileSync(j, 'utf8'); assert.equal(JSON.parse(avant).terminee, false);
    assert.throws(() => appliquerTransaction(j, [{ fichier: a, contenu: 'second-import' }]), /précédente/); assert.equal(fs.readFileSync(j, 'utf8'), avant); assert.equal(fs.readFileSync(a, 'utf8'), 'changement-concurrent');
});
test('import : annuler refuse un fichier modifié depuis, puis restaure après retour à l’état importé', () => {
    const f = path.join(racine, 'd'), j = path.join(racine, 'import3.json'); fs.writeFileSync(f, 'avant'); appliquerTransaction(j, [{ fichier: f, contenu: 'apres' }]);
    fs.writeFileSync(f, 'modification-utilisateur'); assert.throws(() => restaurerTransaction(j, [f]), /changé/); assert.equal(fs.readFileSync(f, 'utf8'), 'modification-utilisateur');
    fs.writeFileSync(f, 'apres'); restaurerTransaction(j, [f]); assert.equal(fs.readFileSync(f, 'utf8'), 'avant');
});
test('session : état corrompu visible et récupération sans modifier le transcript', () => {
    const s = creerIntegree('codex', racine, 'Copie test'); fs.writeFileSync(fichierSession(s.id, 'conversation.jsonl'), 'TRANSCRIPT_TEMOIN\n');
    fs.writeFileSync(fichierSession(s.id, 'etat.json'), '{abime'); assert.ok(problemesSessions().some(p => p.id === s.id && p.sauvegarde));
    const copie = restaurerEtatSession(s.id); assert.equal(fs.readFileSync(copie, 'utf8'), '{abime'); assert.equal(lireEtatSession(s.id).etat, 'arretee'); assert.equal(fs.readFileSync(fichierSession(s.id, 'conversation.jsonl'), 'utf8'), 'TRANSCRIPT_TEMOIN\n');
});
test('modèle session : défaut hérité, changements au repos seulement, capacités et format', () => {
    const c = chargerConfig(); c.modelesFournisseurs = { codex: 'gpt-test' }; sauverConfig(c);
    const s = creerIntegree('codex', racine, 'Modele'); assert.equal(s.modele, 'gpt-test'); changerModeleIntegree(s.id, 'gpt-autre'); assert.equal(lireEtatSession(s.id).modele, 'gpt-autre');
    assert.throws(() => changerModeleIntegree(s.id, 'modele;invalide')); s.etat = 'travaille'; sauverEtatSession(s); assert.throws(() => changerModeleIntegree(s.id, 'gpt-test'), /Attends/);
    s.etat = 'attend'; s.terminalExterne = true; sauverEtatSession(s); assert.throws(() => changerModeleIntegree(s.id, 'gpt-test'), /Attends/);
    s.terminalExterne = false; sauverEtatSession(s); changerModeleIntegree(s.id, ''); assert.equal(lireEtatSession(s.id).modele, undefined);
    assert.equal(creerIntegree('codex', racine, 'Sans override', '').modele, undefined);
    assert.throws(() => creerIntegree('perplexity', racine, 'Recherche', { modele: 'sonar' }), /pas disponible/);
});
test('sauvegarde : restauration cohérente sans coffre, plans et commandes automatiques désactivés', () => {
    fs.mkdirSync(CHEMINS.moteur, { recursive: true }); fs.writeFileSync(path.join(CHEMINS.moteur, 'pause.json'), '{}');
    const c = chargerConfig(); c.planifications = [{ id: 'p1', nom: 'test', projet: racine, consigne: 'ne jamais exécuter pendant test', heure: '08:00', jours: [1], actif: true }];
    c.preparationProjets = [{ projet: racine, commande: { programme: 'ne-pas-executer', args: [] } }]; sauverConfig(c);
    fs.writeFileSync(CHEMINS.jetons, '{"GitHub":"CHIFFRE_FAUX_EXCLU"}');
    const f = path.join(racine, 'backup.json'); const resultat = creerSauvegardeProfil(f); assert.ok(resultat.fichiers >= 3);
    assert.equal(JSON.parse(fs.readFileSync(f)).fichiers.some(e => Buffer.from(e.contenu, 'base64').toString('utf8').includes('CHIFFRE_FAUX_EXCLU')), false);
    const avant = fs.readFileSync(CHEMINS.jetons, 'utf8'); c.prenom = 'modifié'; sauverConfig(c);
    restaurerSauvegardeProfil(f); const restauree = chargerConfig(); assert.equal(restauree.planifications[0].actif, false); assert.equal(restauree.preparationProjets, undefined);
    assert.equal(fs.readFileSync(CHEMINS.jetons, 'utf8'), avant); assert.ok(fs.existsSync(path.join(CHEMINS.moteur, 'pause.json')));
    fs.writeFileSync(path.join(CHEMINS.moteur, 'pause.json'), JSON.stringify({ date: Date.now() + 1000 }));
    restaurerTransaction(`${CHEMINS.config}.restauration.json`, fichiersRestaurationAutorises(lireSauvegardeProfil(f)));
    assert.equal(chargerConfig().prenom, 'modifié'); assert.ok(fs.existsSync(path.join(CHEMINS.moteur, 'pause.json')));
});
test('sauvegarde : traversée, identité croisée et contenu altéré refusés avant écriture', () => {
    const original = JSON.parse(fs.readFileSync(path.join(racine, 'backup.json'))), f = path.join(racine, 'attaque.json');
    const a = structuredClone(original); a.fichiers[0].chemin = '../../outside'; fs.writeFileSync(f, JSON.stringify(a)); assert.throws(() => lireSauvegardeProfil(f));
    const vide = structuredClone(original); vide.fichiers[0].zone = 'brouillons'; vide.fichiers[0].chemin = ''; fs.writeFileSync(f, JSON.stringify(vide)); assert.throws(() => lireSauvegardeProfil(f), /fichier enfant/);
    const b = structuredClone(original); b.fichiers[0].contenu = Buffer.from('altéré').toString('base64'); fs.writeFileSync(f, JSON.stringify(b)); assert.throws(() => lireSauvegardeProfil(f), /altérée/);
    const d = structuredClone(original), e = d.fichiers.find(e => e.zone === 'sessions' && e.chemin.endsWith('/etat.json'));
    const s = JSON.parse(Buffer.from(e.contenu, 'base64')); s.id = `ct-${randomUUID()}`; const contenu = Buffer.from(JSON.stringify(s)); e.contenu = contenu.toString('base64'); e.sha256 = createHash('sha256').update(contenu).digest('hex');
    fs.writeFileSync(f, JSON.stringify(d)); assert.throws(() => lireSauvegardeProfil(f), /identité/);
});

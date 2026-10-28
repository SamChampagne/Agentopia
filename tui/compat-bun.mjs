// Notre code actuel (dist/, compilé pour Node) fonctionne-t-il sous Bun ? Lecture seule : rien n'est lancé ni modifié.
const t0 = performance.now();
const ok = (nom, v) => console.log(`✓ ${nom}${v !== undefined ? ' · ' + v : ''}`);
const ko = (nom, e) => console.log(`✗ ${nom} · ${e?.message ?? e}`);
async function essai(nom, f) { try { ok(nom, await f()); } catch (e) { ko(nom, e); } }
const d = '../dist/';
await essai('config', async () => (await import(d + 'config.js')).chargerConfig().racines.length + ' racines');
await essai('projets + git (lireDepot)', async () => {
  const { chargerConfig } = await import(d + 'config.js');
  const { listerProjets } = await import(d + 'projets.js');
  const { lireDepot } = await import(d + 'git.js');
  const p = listerProjets(chargerConfig());
  const deps = (await Promise.all(p.slice(0, 8).map(lireDepot))).filter(Boolean);
  return `${p.length} projets, ${deps.length}/8 dépôts lus, ex. ${deps[0]?.projet.nom} ⎇ ${deps[0]?.branche}`;
});
await essai('coût du jour', async () => (await import(d + 'cout.js')).mettreAJourCout().then((c) => c.total.toFixed(2) + ' $'));
await essai('sessions Claude (listerAgents)', async () => (await (await import(d + 'agents.js')).listerAgents()).length + ' sessions');
await essai('transcript', async () => {
  const { listerAgents, lireTranscript } = await import(d + 'agents.js');
  const a = (await listerAgents())[0];
  return a ? lireTranscript(a.fichier).length + ' messages' : 'aucune session';
});
await essai('serveurs SSH (config)', async () => (await import(d + 'ssh.js')).listerServeurs?.().length ?? 'module chargé');
await essai('ssh2 (chargement + clé)', async () => {
  const { Client, utils } = await import('ssh2');
  const k = utils.generateKeyPairSync('ed25519');
  return typeof Client + ', génération de clé ed25519 ' + (k.private.length > 0 ? 'ok' : 'vide');
});
await essai('pg (chargement)', async () => typeof (await import('pg')).default.Client);
await essai('docker (liste)', async () => { const m = await import(d + 'docker.js'); return Object.keys(m).slice(0, 4).join(', '); });
await essai('collecte complète (8 s)', async () => {
  const { demarrerCollecte, lireDonnees, surMajDonnees } = await import(d + 'ui/donnees.js');
  let maj = 0; surMajDonnees(() => maj++);
  demarrerCollecte();
  await new Promise((r) => setTimeout(r, 8000));
  const x = lireDonnees();
  return `${maj} mises à jour · ${x.agents.length} sessions · ${x.serveurs.length} serveurs · ${x.docker.length} hôtes docker`;
});
console.log(`(${((performance.now() - t0) / 1000).toFixed(1)} s, Bun ${Bun.version})`);
process.exit(0);

// Test bloquant avant la migration : SSH et SFTP fonctionnent-ils pareil sous Bun et sous Node ?
// Mêmes fonctions que l'appli, en lecture seule (ssh … exit, relevé de charge, liste d'un dossier SFTP).
const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`;
const { inventaire, joignable, testerAcces } = await import('../dist/ssh.js');
const { releverMetriques } = await import('../dist/metriques.js');
const { ciblesSftp, Sftp } = await import('../dist/sftp.js');
const NOM = process.argv[2] ?? 'dev';
const t = (p) => { const d = performance.now(); return p.then((v) => [v, Math.round(performance.now() - d)]); };
console.log(`── ${runtime} · serveur ${NOM}`);
const s = (await inventaire()).find((x) => x.nom === NOM);
if (!s) { console.log(`✗ serveur ${NOM} introuvable`); process.exit(1); }
const [rep, d1] = await t(joignable(s));
console.log(`${rep ? '✓' : '✗'} joignable (${d1} ms)`);
const [acces, d2] = await t(testerAcces(s));
console.log(`${acces.ok ? '✓' : '✗'} ssh … exit : ${acces.message} (${d2} ms)`);
const [m, d3] = await t(releverMetriques(s).catch((e) => ({ erreur: e.message })));
console.log(`${m.erreur ? '✗' : '✓'} relevé : ${m.erreur ?? `charge ${m.charge} · RAM ${m.memoire} % · disque ${m.disque} %`} (${d3} ms)`);
const cible = ciblesSftp().find((c) => c.nom === NOM);
if (!cible) console.log('✗ pas de cible SFTP pour ce serveur');
else {
  const sftp = new Sftp(cible);
  try {
    const [, d4] = await t(sftp.connecter());
    const maison = await sftp.reel('.');
    const liste = await sftp.lister(maison);
    console.log(`✓ SFTP (ssh2) : connecté en ${d4} ms · ${maison} contient ${liste.length} entrées`);
  } catch (e) {
    console.log(`✗ SFTP (ssh2) : ${e.message}`);
  } finally {
    sftp.fermer();
  }
}
process.exit(0);

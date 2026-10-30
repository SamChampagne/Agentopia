import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-lanceurs-securite-'));
const bin = path.join(racine, 'bin'), code = path.join(racine, 'VS Code'), codeBin = path.join(code, 'bin');
fs.mkdirSync(bin); fs.mkdirSync(codeBin, { recursive: true });
fs.writeFileSync(path.join(bin, 'pwsh.exe'), 'fixture non exécutable');
fs.writeFileSync(path.join(code, 'Code.exe'), 'fixture non exécutable');
fs.writeFileSync(path.join(codeBin, 'code.cmd'), '@echo fixture');
const ancienPath = process.env.PATH, ancienneSession = process.env.WT_SESSION, ancienSpawn = childProcess.spawn;
process.env.CLAUDETOPIA_DATA_DIR = path.join(racine, 'profil');
process.env.PATH = [bin, codeBin].join(path.delimiter);
process.env.CLAUDETOPIA_TEST_UI = '1'; process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.mkdirSync(process.env.CLAUDETOPIA_DATA_DIR);
fs.writeFileSync(path.join(process.env.CLAUDETOPIA_DATA_DIR, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false }));
const captures = [];
// Aucune fenêtre, aucun programme, navigateur, compte ni installation réels.
childProcess.spawn = (programme, args, options) => {
    const enfant = new EventEmitter();
    enfant.stdout = new PassThrough(); enfant.stderr = new PassThrough(); enfant.stdin = new PassThrough(); enfant.unref = () => enfant;
    captures.push({ programme, args, options, enfant }); return enfant;
};
syncBuiltinESMExports();
const lanceurs = await import('./dist/lanceurs.js');
const { ouvrirTerminal } = await import('./dist/terminaux.js');
const { invocationNative, invocationTerminal, invocationWeb, executableGraphique, scriptInstallationWinget, scriptRaccourciWindows, citerPowerShell } = await import('./dist/lancementsWindows.js');
const { commandesConnexions } = await import('./dist/connexionsCommandes.js');
const { oublierPath } = await import('./dist/chemins.js');
const { bus } = await import('./dist/ui/bus.js');
const derniere = () => captures.at(-1);
const scriptDe = (invocation) => Buffer.from(invocation.args[invocation.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
function analyserScripts(scripts) {
    const donnees = Buffer.from(JSON.stringify(scripts), 'utf8').toString('base64');
    const inspection = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $scripts = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${donnees}')) | ConvertFrom-Json; `
        + `$resultats = @($scripts | ForEach-Object { $jetons = $null; $erreurs = $null; `
        + `$ast = [System.Management.Automation.Language.Parser]::ParseInput($_, [ref]$jetons, [ref]$erreurs); `
        + `$commandes = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() }); `
        + `$litteraux = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) | Where-Object { $_.StringConstantType -eq 'SingleQuoted' } | ForEach-Object { $_.Value }); `
        + `[pscustomobject]@{ erreurs = @($erreurs).Count; commandes = $commandes; litteraux = $litteraux } }); ConvertTo-Json -InputObject $resultats -Depth 5 -Compress`;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const resultat = childProcess.spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(inspection, 'utf16le').toString('base64')],
        { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000 });
    assert.equal(resultat.status, 0, resultat.stderr);
    const analyse = JSON.parse(resultat.stdout);
    assert.ok(analyse.every((a) => a.erreurs === 0));
    return analyse;
}
after(() => {
    childProcess.spawn = ancienSpawn; syncBuiltinESMExports(); process.env.PATH = ancienPath;
    if (ancienneSession === undefined) delete process.env.WT_SESSION; else process.env.WT_SESSION = ancienneSession;
    const relatif = path.relative(os.tmpdir(), racine);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(racine, { recursive: true, force: true });
});

test('VS Code : le fichier reste un argument natif, sans guillemets ajoutés ni shell', () => {
    const fichier = 'C:\\fixture\\espace & echo MARQUEUR ^ %TEMP% \\fichier.ts:7';
    const electron = process.env.ELECTRON_RUN_AS_NODE, dev = process.env.VSCODE_DEV;
    try {
        process.env.ELECTRON_RUN_AS_NODE = '1'; process.env.VSCODE_DEV = '1';
        lanceurs.lancerDetache('code', ['-g', fichier]);
    } finally {
        if (electron === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = electron;
        if (dev === undefined) delete process.env.VSCODE_DEV; else process.env.VSCODE_DEV = dev;
    }
    assert.equal(derniere().programme, path.join(code, 'Code.exe'));
    assert.deepEqual(derniere().args, ['-g', fichier]);
    assert.equal(derniere().options.shell, false); assert.equal(derniere().options.windowsVerbatimArguments, false);
    assert.equal(derniere().options.windowsHide, true);
    assert.equal(derniere().options.env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(derniere().options.env.VSCODE_DEV, undefined);
    const exe = path.join(racine, 'Application avec espaces.exe');
    lanceurs.lancerDetache(exe, ['argument " contenant & et |']);
    assert.equal(derniere().programme, exe); assert.deepEqual(derniere().args, ['argument " contenant & et |']);
});

test('navigateur : HTTP(S) uniquement, URL littérale encodée et anciens appels start sécurisés', () => {
    const adresse = 'https://example.invalid/cherche?q=" & echo MARQUEUR & "&nom=l\'équipe';
    lanceurs.lancerDetache('start', ['', adresse]);
    assert.equal(derniere().programme, path.join(bin, 'pwsh.exe'));
    assert.equal(derniere().options.shell, false); assert.equal(derniere().options.windowsHide, true);
    assert.equal(scriptDe(derniere()), `Start-Process -FilePath ${citerPowerShell(new URL(adresse).href)}`);
    for (const adresse of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'ms-settings:privacy', 'https://example.invalid/\ncommande', 'pas une adresse']) {
        const avant = captures.length; assert.throws(() => lanceurs.ouvrirUrlWeb(adresse)); assert.equal(captures.length, avant);
    }
    assert.throws(() => lanceurs.lancerDetache('start', ['/D', 'C:\\fixture', 'cmd.exe']));
    assert.ok(invocationWeb('http://localhost:3000', 'powershell.exe').args.includes('-EncodedCommand'));
});

test('sans Windows Terminal : dossier avec métacaractères utilisé comme cwd, jamais cmd /c start', () => {
    const dossier = 'C:\\fixture\\Projet & echo MARQUEUR ^ %TEMP%';
    const t = { cle: 'fixture', nom: 'Terminal fixture', exe: 'wsl.exe', args: (d) => ['--cd', d] };
    ouvrirTerminal(t, dossier);
    assert.equal(derniere().programme, 'wsl.exe'); assert.deepEqual(derniere().args, ['--cd', dossier]);
    assert.equal(derniere().options.cwd, dossier); assert.equal(derniere().options.detached, true);
    assert.equal(derniere().options.windowsHide, false); assert.equal(derniere().options.shell, false);
    assert.equal(derniere().options.windowsVerbatimArguments, false);
});

test('Windows Terminal : arguments séparés, points-virgules orientés vers une fenêtre native', () => {
    const dossier = 'C:\\fixture\\projet & équipe', args = ['-NoLogo'];
    const normal = invocationTerminal('powershell.exe', args, dossier, 'Projet fixture', { wt: 'wt.exe', aCote: true });
    assert.equal(normal.programme, 'wt.exe'); assert.equal(normal.aCote, true);
    assert.equal(normal.args[normal.args.indexOf('-d') + 1], dossier); assert.deepEqual(normal.args.slice(-2), ['powershell.exe', '-NoLogo']);
    const special = 'C:\\fixture\\projet; new-tab cmd';
    const replie = invocationTerminal('powershell.exe', args, special, 'Projet fixture', { wt: 'wt.exe', aCote: true });
    assert.equal(replie.programme, 'powershell.exe'); assert.equal(replie.options.cwd, special); assert.equal(replie.aCote, false);
    assert.deepEqual(replie.args, args);
});

test('onglet et panneau : commande volontaire encodée, données de dossier séparées', () => {
    fs.writeFileSync(path.join(bin, 'wt.exe'), 'fixture non exécutable'); oublierPath();
    const commande = "Write-Output 'fixture; & données'", dossier = 'C:\\fixture\\Projet & espaces';
    lanceurs.ouvrirOnglet(dossier, 'Projet fixture', commande);
    assert.equal(derniere().programme, path.join(bin, 'wt.exe')); assert.equal(scriptDe(derniere()), commande);
    assert.equal(derniere().args[derniere().args.indexOf('-d') + 1], dossier); assert.equal(derniere().options.shell, false);
    process.env.WT_SESSION = 'fixture'; assert.equal(lanceurs.ouvrirACote(dossier, 'Titre', commande), true);
    assert.ok(derniere().args.includes('split-pane'));
    assert.equal(lanceurs.ouvrirACote('C:\\fixture; spécial', 'Titre', commande), false);
    assert.equal(derniere().programme, path.join(bin, 'pwsh.exe')); assert.equal(scriptDe(derniere()), commande);
});

test('winget : installation explicitement demandée dans PowerShell natif, sans cmd /c', async () => {
    const installer = commandesConnexions().find((c) => c.nom === 'installer');
    const log = console.log; const messages = [];
    try { console.log = (message) => messages.push(message); await installer.executer({ args: ['git'] }); }
    finally { console.log = log; }
    assert.ok(messages.some((m) => m.includes('Installation de Git')));
    assert.equal(derniere().programme, path.join(bin, 'pwsh.exe')); assert.equal(derniere().options.shell, false);
    assert.equal(derniere().options.windowsHide, false); assert.ok(derniere().args.includes('-NoExit'));
    assert.match(scriptDe(derniere()), /winget install -e --id 'Git\.Git'/);
    assert.ok(scriptInstallationWinget("Outil d'équipe; & fixture", 'Editeur.Outil').includes("Outil d''équipe; & fixture"));
    assert.throws(() => scriptInstallationWinget('Fixture', 'Editeur.Outil; echo MARQUEUR'), /winget invalide/);
});

test('arguments mal formés et batch générique refusés avant lancement', () => {
    const avant = captures.length;
    assert.throws(() => lanceurs.lancerDetache('fixture.cmd', ['fichier']), /batch/);
    assert.throws(() => invocationNative('outil.exe', ['avant\0après']), /interdit/);
    assert.throws(() => invocationNative('outil.exe', [], 'C:\\fixture\ncommande'), /interdit/);
    assert.throws(() => executableGraphique('code', () => path.join(racine, 'autre', 'bin', 'code.cmd'), () => false), /Code.exe/);
    assert.equal(captures.length, avant);
});

test('Windows natif : espaces, guillemets et métacaractères arrivent sans expansion dans un processus témoin', () => {
    const args = ['C:\\fixture\\Projet & équipe', 'avant"après', '%TEMP%', '^ | & ; $(fixture)', 'fin\\', ''];
    const invocation = invocationNative(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args]);
    const resultat = childProcess.spawnSync(invocation.programme, invocation.args, { ...invocation.options,
        detached: false, stdio: 'pipe', windowsHide: true, encoding: 'utf8', timeout: 10_000 });
    assert.equal(resultat.status, 0, resultat.stderr); assert.deepEqual(JSON.parse(resultat.stdout), args);
});

test('parseur PowerShell : les valeurs hostiles restent des littéraux, sans exécuter URL ou winget', () => {
    const adresse = 'https://example.invalid/?q=\'; Write-Output MARQUEUR; #"&suite=x';
    const valeurs = ["'", '\u2018', '\u2019', '\u201a', '\u201b'].map((quote) => `Dossier${quote}; Write-Output MARQUEUR; #`);
    const scripts = [scriptDe(invocationWeb(adresse, 'powershell.exe')), scriptInstallationWinget("Outil'; Write-Output MARQUEUR; #", 'Editeur.Fixture'),
        ...valeurs.map((v) => `Write-Output ${lanceurs.quotePS(v)}`)];
    const analyse = analyserScripts(scripts);
    assert.deepEqual(analyse[0].commandes, ['Start-Process']);
    assert.deepEqual(analyse[1].commandes, ['Write-Host', 'winget', 'Write-Host', 'Write-Host']);
    for (let i = 0; i < valeurs.length; i++) {
        assert.deepEqual(analyse[i + 2].commandes, ['Write-Output']);
        assert.deepEqual(analyse[i + 2].litteraux, [valeurs[i]], 'le helper quotePS historique conserve exactement les cinq variantes d’apostrophe');
    }
});

test('PowerShell : raccourci, notification, presse-papiers et vérification conservent les apostrophes comme données', async () => {
    const valeur = `Données '‘’‚‛; Write-Output MARQUEUR; # & <texte> "`;
    const raccourci = scriptRaccourciWindows(valeur, valeur, valeur, valeur, valeur);
    const { toast } = await import('./dist/notifications.js');
    toast(valeur, valeur, `claudetopia:session/${valeur}`);
    const notification = scriptDe(derniere());
    const { imageDuPressePapiers } = await import('./dist/ui/pressePapiers.js');
    let pressePapiers;
    const image = await imageDuPressePapiers({ dossier: path.join(racine, "Images '‘’‚‛; Write-Output MARQUEUR; #"),
        executer: async (args) => { pressePapiers = scriptDe({ args }); return 'ok'; } });
    const { invocationVerification } = await import('./dist/verificationProjet.js');
    const executable = `C:\\${valeur}\\npm.cmd`, script = `check${valeur}`;
    const verification = scriptDe(invocationVerification({ executable, script }));
    const analyse = analyserScripts([raccourci, notification, pressePapiers, verification]);
    assert.deepEqual(analyse[0].commandes, ['New-Object']);
    assert.equal(analyse[0].litteraux.filter((v) => v === valeur).length, 4);
    assert.ok(analyse[0].litteraux.includes(`${valeur},0`));
    assert.deepEqual(analyse[1].commandes, ['Out-Null', 'Out-Null', 'New-Object']);
    const xml = analyse[1].litteraux.find((v) => v.startsWith('<toast'));
    assert.ok(xml.includes(`Données '‘’‚‛; Write-Output MARQUEUR; # &amp; &lt;texte&gt; &quot;`));
    assert.ok(xml.includes(`launch="claudetopia:session/Données '‘’‚‛; Write-Output MARQUEUR; # &amp; &lt;texte&gt; &quot;"`));
    assert.deepEqual(analyse[2].commandes, ['Add-Type', 'Where-Object', 'Select-Object']);
    assert.ok(analyse[2].litteraux.includes(image));
    assert.deepEqual(analyse[3].commandes, [executable]);
    assert.deepEqual(analyse[3].litteraux, [executable, 'run', script]);
});

test('échec du lancement : avis conservable au lieu d’une erreur enfant non gérée', async () => {
    const avis = []; const recevoir = (texte) => avis.push(texte); bus.on('notice', recevoir);
    try {
        lanceurs.lancerDetache('absent.exe', []); derniere().enfant.emit('error', new Error('ENOENT fixture'));
        assert.match(avis[0], /Ouverture impossible.*ENOENT fixture/);
    } finally { bus.off('notice', recevoir); }
    const lignes = [], execution = lanceurs.executer('Write-Output fixture', racine, (ligne) => lignes.push(ligne));
    assert.equal(derniere().options.windowsHide, true); derniere().enfant.emit('error', new Error('ENOENT PowerShell fixture'));
    assert.equal(await execution, 127); assert.match(lignes[0], /ENOENT PowerShell fixture/);
});

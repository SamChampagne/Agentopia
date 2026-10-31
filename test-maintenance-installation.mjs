import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inventorierInstallation, nettoyerInstallation, preparerDesinstallation, scriptDesinstallation } from './outils/maintenance-windows.mjs';
import { retirerInstallation } from './outils/retrait-windows.mjs';
import { signerSiConfigure, scriptSignature } from './outils/signature-windows.mjs';
function installation(t) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-maintenance-'));
    t.after(() => { assert.ok(path.resolve(d).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(d, { recursive: true, force: true }); });
    fs.mkdirSync(path.join(d, 'paquets')); fs.writeFileSync(path.join(d, 'activation.json'), JSON.stringify({ active: 'v3', precedente: 'v2' }));
    for (const id of ['v1', 'v2', 'v3']) { const dir = path.join(d, 'versions', id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'logiciel.txt'), id); fs.writeFileSync(path.join(dir, 'distribution.json'), JSON.stringify({ format: 'agentopia-windows-v1', id, version: id, fichiers: [{ chemin: 'logiciel.txt', sha256: createHash('sha256').update(id).digest('hex') }] })); fs.writeFileSync(path.join(d, 'paquets', `${id}.zip`), 'ARCHIVE_FAUSSE'); }
    return d;
}
test('maintenance : active/précédente/en cours protégées, nettoyage ciblé des anciens paquets', t => {
    const d = installation(t); let inventaire = inventorierInstallation(d, { processus: [] }); assert.equal(inventaire.versions.find(v => v.id === 'v1').protegee, false);
    inventaire = inventorierInstallation(d, { processus: [{ pid: 123, executable: path.join(d, 'versions', 'v1', 'runtime', 'node.exe') }] }); assert.equal(inventaire.versions.find(v => v.id === 'v1').protegee, true);
    assert.throws(() => nettoyerInstallation(d, { versions: ['v3'], archives: [] }, { processus: [] }), /protégée/);
    fs.writeFileSync(path.join(d, 'versions', 'v1', 'notes-perso.txt'), 'À_CONSERVER');
    nettoyerInstallation(d, { versions: ['v1'], archives: ['v1'] }, { processus: [] });
    assert.equal(fs.existsSync(path.join(d, 'versions', 'v1', 'logiciel.txt')), false); assert.equal(fs.readFileSync(path.join(d, 'versions', 'v1', 'notes-perso.txt'), 'utf8'), 'À_CONSERVER');
    assert.ok(fs.existsSync(path.join(d, 'versions', 'v2', 'logiciel.txt'))); assert.ok(fs.existsSync(path.join(d, 'paquets', 'v3.zip')));
});
test('désinstallation simulée : retire le logiciel, conserve tous les fichiers non possédés', t => {
    const d = installation(t); fs.writeFileSync(path.join(d, 'donnees-perso.json'), 'GARDER'); preparerDesinstallation(d, false);
    let integration = 0; const r = retirerInstallation(d, { listerProcessus: () => [], arreterProcessus: () => assert.fail('aucun processus réel'), retirerIntegration: () => { integration++; } });
    assert.equal(r.donneesConservees, true); assert.equal(integration, 1); assert.equal(fs.readFileSync(path.join(d, 'donnees-perso.json'), 'utf8'), 'GARDER'); assert.equal(fs.existsSync(path.join(d, 'activation.json')), false);
});
test('désinstallation : aucun fichier supprimé si processus encore actif', t => {
    const d = installation(t), p = { ProcessId: 42, ExecutablePath: path.join(d, 'versions', 'v3', 'node.exe') };
    assert.throws(() => retirerInstallation(d, { listerProcessus: () => [p], arreterProcessus: () => {}, retirerIntegration: () => assert.fail('pas de registre') }), /encore ouvert/);
    assert.ok(fs.existsSync(path.join(d, 'versions', 'v3', 'logiciel.txt')));
});
test('maintenance : traversée manifeste refusée sans supprimer le témoin', t => {
    const d = installation(t), cible = path.join(d, 'versions', 'v1', 'distribution.json'); const m = JSON.parse(fs.readFileSync(cible)); m.fichiers[0].chemin = '../../../temoin'; fs.writeFileSync(cible, JSON.stringify(m));
    const inv = inventorierInstallation(d, { processus: [] }); assert.equal(inv.versions.find(v => v.id === 'v1').protegee, true); assert.throws(() => nettoyerInstallation(d, { versions: ['v1'], archives: [] }, { processus: [] }));
});
test('signature : absente explicitement, obligatoire bloque, certificat et timestamp vérifiés', () => {
    assert.deepEqual(signerSiConfigure('Agentopia.exe', {}, () => assert.fail('aucune signature')), { signee: false });
    assert.throws(() => signerSiConfigure('Agentopia.exe', { AGENTOPIA_REQUIRE_SIGNATURE: '1' }), /Certificat absent/);
    assert.throws(() => scriptSignature('x.exe', 'INVALIDE', 'https://timestamp.example'), /Empreinte/);
    const env = { AGENTOPIA_SIGN_CERT_THUMBPRINT: 'a'.repeat(40), AGENTOPIA_SIGN_TIMESTAMP_URL: 'https://timestamp.example' };
    assert.throws(() => signerSiConfigure('x.exe', env, () => ({ status: 0, stdout: '' })), /pas été vérifiée/);
    assert.equal(signerSiConfigure('x.exe', env, () => ({ status: 0, stdout: 'AGENTOPIA_SIGNATURE_VERIFIEE' })).signee, true);
    assert.ok(scriptDesinstallation('C:\\Dossier avec espace').includes('conservés'));
});
test('retrait : script PowerShell valide avec apostrophes, nettoyage confiné au GUID temporaire', { skip: process.platform !== 'win32' }, () => {
    const script = scriptDesinstallation("C:\\Installation O’Neil et l'agent");
    assert.match(script, /GetDirectoryName\(\$finTemp\)/); assert.match(script, /ReparsePoint/); assert.match(script, /agentopia-retrait-\[a-f0-9\]\{32\}/);
    const verifier = "$ErrorActionPreference='Stop'; $s=[Console]::In.ReadToEnd(); $t=$null; $e=$null; $null=[Management.Automation.Language.Parser]::ParseInput($s,[ref]$t,[ref]$e); if ($e.Count) { $e | ConvertTo-Json -Compress; exit 1 }; Write-Output 'AST_OK'";
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', verifier], { input: script, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.equal(r.status, 0, r.stdout || r.stderr); assert.match(r.stdout, /AST_OK/);
});

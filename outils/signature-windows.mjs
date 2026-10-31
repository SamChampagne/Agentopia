import { spawnSync } from 'node:child_process';
const ps = s => `'${s.replace(/['\u2018-\u201b]/g, c => c + c)}'`;
export function scriptSignature(fichier, empreinte, horodatage) {
    if (!/^[a-f0-9]{40}$/i.test(empreinte || '')) throw new Error('Empreinte de certificat de signature invalide');
    const u = new URL(horodatage); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Horodatage HTTPS requis');
    return `$ErrorActionPreference='Stop'; $cert=Get-Item -LiteralPath ${ps(`Cert:\\CurrentUser\\My\\${empreinte}`)}; `
        + `if (!$cert.HasPrivateKey) { throw 'Certificat sans clé de signature' }; `
        + `$null=Set-AuthenticodeSignature -LiteralPath ${ps(fichier)} -Certificate $cert -HashAlgorithm SHA256 -TimestampServer ${ps(u.href)}; `
        + `$s=Get-AuthenticodeSignature -LiteralPath ${ps(fichier)}; `
        + `if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne ${ps(empreinte)} -or !$s.TimeStamperCertificate) { throw 'Signature ou horodatage non vérifié' }; `
        + `Write-Output 'AGENTOPIA_SIGNATURE_VERIFIEE'`;
}
export function signerSiConfigure(fichier, env = process.env, executer = spawnSync) {
    const empreinte = env.AGENTOPIA_SIGN_CERT_THUMBPRINT;
    if (!empreinte) {
        if (env.AGENTOPIA_REQUIRE_SIGNATURE === '1') throw new Error('Cette construction exige une signature d’éditeur. Certificat absent.');
        return { signee: false };
    }
    if (!env.AGENTOPIA_SIGN_TIMESTAMP_URL) throw new Error('AGENTOPIA_SIGN_TIMESTAMP_URL est requis pour signer');
    const script = scriptSignature(fichier, empreinte, env.AGENTOPIA_SIGN_TIMESTAMP_URL);
    const r = executer('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    if (r.error || r.status !== 0 || !r.stdout?.includes('AGENTOPIA_SIGNATURE_VERIFIEE')) throw new Error('La signature d’éditeur n’a pas été vérifiée. Publication refusée.');
    return { signee: true, empreinte: empreinte.toUpperCase() };
}

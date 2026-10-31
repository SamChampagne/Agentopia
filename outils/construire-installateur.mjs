import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sources = path.join(path.dirname(fileURLToPath(import.meta.url)), 'installateur');
// Le bootstrap utilise .NET Framework fourni par Windows, sans Node/Bun installé.
export function construireInstallateur(sortie, configuration) {
    const compilateur = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    if (!fs.existsSync(compilateur)) throw new Error('Compilateur .NET Framework Windows introuvable');
    fs.mkdirSync(sortie, { recursive: true });
    const config = path.join(sortie, 'installateur.json');
    fs.writeFileSync(config, JSON.stringify(configuration));
    const exe = path.join(sortie, 'Agentopia-Setup.exe');
    const args = ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', `/out:${exe}`,
        `/win32manifest:${path.join(sources, 'app.manifest')}`, `/resource:${config},installation.json`,
        ...['System.Windows.Forms', 'System.Drawing', 'System.Net.Http', 'System.Web.Extensions', 'System.IO.Compression', 'System.IO.Compression.FileSystem'].map((n) => `/reference:${n}.dll`),
        ...fs.readdirSync(sources).filter((n) => n.endsWith('.cs')).map((n) => path.join(sources, n))];
    const r = spawnSync(compilateur, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    if (r.error || r.status !== 0) throw new Error(`Construction de l’installateur : ${r.stdout || r.stderr || r.error?.message}`);
    return exe;
}

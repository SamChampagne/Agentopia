// Programmes lancés en fond par Claudetopia pendant 60 s au repos (après le démarrage)
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
import { syncBuiltinESMExports } from 'module';
import cp from 'child_process';
const compte = new Map();
let actif = false;
for (const nom of ['spawn', 'spawnSync', 'execSync', 'exec']) {
    const orig = cp[nom];
    cp[nom] = function (cmd, args, ...r) {
        if (actif) {
            const cle = `${nom} ${String(cmd).split(/[\/]/).pop()} ${Array.isArray(args) ? args.slice(0, 3).join(' ').slice(0, 60) : ''}`;
            compte.set(cle, (compte.get(cle) ?? 0) + 1);
        }
        return orig.call(this, cmd, args, ...r);
    };
}
syncBuiltinESMExports();
process.env.NODE_ENV = 'production';
const { default: React } = await import('react');
const { render } = await import('ink-testing-library');
const { App } = await import('./dist/ui/App.js');
(await import('./dist/ui/journal.js')).capturerConsole();
render(React.createElement(App));
await new Promise((r) => setTimeout(r, 30000));
actif = true;
const u0 = process.cpuUsage();
await new Promise((r) => setTimeout(r, 60000));
const u = process.cpuUsage(u0);
process.stderr.write(`CPU de Claudetopia sur 60 s : ${((u.user + u.system) / 1000).toFixed(0)} ms\n`);
[...compte].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => process.stderr.write(`${String(n).padStart(4)} × ${k}\n`));
process.exit(0);

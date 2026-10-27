// Mémoire de Claudetopia (interface complète) et du maître, après démarrage
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.NODE_ENV ??= 'production';
const { default: React } = await import('react');
const { render } = await import('ink-testing-library');
const { App } = await import('./dist/ui/App.js');
const { capturerConsole } = await import('./dist/ui/journal.js');
const { etatMaitre } = await import('./dist/maitre.js');
const { execSync } = await import('child_process');
capturerConsole();
render(React.createElement(App));
const mo = (o) => `${Math.round(o / 1024 / 1024)} Mo`;
for (const t of [5, 15, 30]) {
    await new Promise((r) => setTimeout(r, t === 5 ? 5000 : t === 15 ? 10000 : 15000));
    global.gc?.();
    const m = process.memoryUsage();
    const pid = etatMaitre().pid;
    let maitre = '—';
    if (pid) try { maitre = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8' }).split('","')[4]?.replace(/"/g, '').trim(); } catch {}
    process.stderr.write(`${t}s : Claudetopia ${mo(m.rss)} (tas JS ${mo(m.heapUsed)}) · maître ${maitre}\n`);
}
process.exit(0);

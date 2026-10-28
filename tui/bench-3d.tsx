// Coût en CPU des animations (globe, logo 3D, veille) rendues seules, comparé à deux références :
// « immobile » (rien ne bouge) et « texte qui change » (une zone de même taille réécrite 14 fois par seconde).
// Lancer : bun tui/bench-3d.tsx
import { useEffect, useState } from 'react';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { Globe } from './globe.tsx';
import { Logo3D } from './logo3d.tsx';
import { Veille } from './veille.tsx';

const serveurs = ['dev', 'prod', 'srv3', 'ppanel1', 'ec2 (us-east-2)', 'gestion', 'ec2 ca-central-1', '10.0.0.5', 'web'].map((nom) => ({ nom, hote: nom, noms: new Set([nom]) }));
const d = { serveurs, joignables: new Map(serveurs.map((s, i) => [s, i % 3 !== 0])), agents: [], activites: new Map() };
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
function TexteQuiChange() {
    const [n, setN] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setN((x) => x + 1), 70);
        return () => clearInterval(t);
    }, []);
    return <box flexDirection="column">{Array.from({ length: 45 }, (_, i) => <text key={i}>{`${n} ${'abcdefghij'.repeat(14)}`.slice(0, 150)}</text>)}</box>;
}
const cas: [string, JSX.Element][] = [
    ['immobile', <text>rien ne bouge</text>],
    ['texte qui change', <TexteQuiChange />],
    ['globe', <Globe d={d} largeur={150} hauteur={45} ouvrir={() => undefined} />],
    ['logo 3D', <Logo3D largeur={64} hauteur={24} />],
    ['veille', <Veille largeur={160} hauteur={50} d={d} reveiller={() => undefined} />],
];
for (const [nom, el] of cas) {
    const { renderer } = await createTestRenderer({ width: 160, height: 50 });
    createRoot(renderer).render(el);
    await w(500);
    const avant = process.cpuUsage();
    const t0 = performance.now();
    await w(3000);
    const u = process.cpuUsage(avant);
    process.stderr.write(`${nom.padEnd(17)} : ${String(Math.round(((u.user + u.system) / 1000 / (performance.now() - t0)) * 100)).padStart(3)} % d'un cœur\n`);
    renderer.destroy();
}
process.exit(0);

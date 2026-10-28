import { useEffect, useRef, useState } from 'react';
import { GRAS, couper } from './style.ts';
import { Toile, RenduToile } from './toile.tsx';
import { theme, fond, melange } from '../dist/theme.js';

// Globe des serveurs : une sphère en braille qui tourne, ton poste et tes serveurs SSH dessus, reliés par des arcs.
// Vert : le serveur répond · rouge : il ne répond pas · gris : pas encore testé. Une impulsion parcourt les arcs vivants.
// Glisser à la souris fait tourner le globe ; clic sur un serveur dans la liste : son détail.
// Position : la région AWS / Azure quand le nom d'hôte la donne ; sinon le serveur est placé près de ton poste (approximatif).

const NOIR = '#0c0c0c';
const RAD = Math.PI / 180;
const POSTE = { lat: 46.8, lon: -71.2 };     // Québec

// Régions infonuagiques reconnues dans le nom d'hôte
const REGIONS: [RegExp, number, number][] = [
    [/us-east-1|eastus\b/, 38.9, -77.4], [/us-east-2|eastus2/, 40.0, -83.0], [/us-west-1/, 37.4, -121.9], [/us-west-2|westus2/, 45.8, -119.7],
    [/ca-central-1|canadacentral/, 45.5, -73.6], [/ca-west-1|canadaeast/, 51.0, -114.1], [/eu-west-1|northeurope/, 53.3, -6.3], [/eu-west-2|uksouth/, 51.5, -0.1],
    [/eu-west-3|francecentral/, 48.9, 2.4], [/eu-central-1|germanywestcentral/, 50.1, 8.7], [/ap-southeast-1|southeastasia/, 1.3, 103.8],
    [/ap-southeast-2|australiaeast/, -33.9, 151.2], [/ap-northeast-1|japaneast/, 35.7, 139.7], [/sa-east-1|brazilsouth/, -23.5, -46.6],
];

function hachage(texte: string): number {
    let h = 2166136261;
    for (const ch of texte) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967295;
}

export function position(s: any): { lat: number; lon: number; exacte: boolean } {
    const nom = `${s.hote ?? ''} ${s.nom ?? ''}`.toLowerCase();
    const r = REGIONS.find(([re]) => re.test(nom));
    if (r) return { lat: r[1], lon: r[2], exacte: true };
    // Inconnu : autour de ton poste, à une place stable
    return { lat: POSTE.lat + (hachage(nom) - 0.5) * 30, lon: POSTE.lon + (hachage(`${nom}·lon`) - 0.5) * 60, exacte: false };
}

// Latitude / longitude → point 3D sur la sphère unité
const versXYZ = (lat: number, lon: number): [number, number, number] =>
    [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];

// Points répartis uniformément sur la sphère (spirale de Fibonacci) : la « surface » du globe
const SURFACE: [number, number, number][] = Array.from({ length: 1400 }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / 1400;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(a) * r, y, Math.sin(a) * r];
});

export function Globe({ d, largeur, hauteur, ouvrir }: { d: any; largeur: number; hauteur: number; ouvrir: (s: any) => void }) {
    const [, setFrame] = useState(0);
    const angle = useRef(POSTE.lon * RAD * -1);
    const glisse = useRef<number>();
    const [survol, setSurvol] = useState<string>();
    useEffect(() => {
        const t = setInterval(() => {
            if (glisse.current === undefined) angle.current += 0.022;
            setFrame((f) => f + 1);
        }, 90);
        return () => clearInterval(t);
    }, []);

    const liste = 30;
    // Taille plafonnée : le coût vient du nombre de cases qui changent à chaque image, pas du calcul (moins d'une ms)
    const l = Math.max(20, Math.min(84, largeur - liste - 2));
    const h = Math.max(8, Math.min(34, hauteur - 2));
    const toile = new Toile(l, h);
    const rayon = Math.min(toile.largeurPx, toile.hauteurPx) * 0.42;
    const cx = toile.largeurPx / 2, cy = toile.hauteurPx / 2;
    const inclinaison = 0.35;
    const [ca, sa, ci, si] = [Math.cos(angle.current), Math.sin(angle.current), Math.cos(inclinaison), Math.sin(inclinaison)];
    // Rotation autour de l'axe vertical, puis inclinaison vers toi
    const tourner = ([x, y, z]: [number, number, number]): [number, number, number] => {
        const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
        return [x1, y * ci - z1 * si, y * si + z1 * ci];
    };
    const projeter = ([x, y]: [number, number, number], r = rayon) => [cx + x * r, cy - y * r];
    const lumiere = [-0.5, 0.5, 0.7];
    const clair = melange(NOIR, theme.primaire, 0.75), sombre = melange(NOIR, theme.primaire, 0.35);

    // La surface : seulement la face visible, plus claire du côté de la lumière
    for (const p of SURFACE) {
        const q = tourner(p);
        if (q[2] < 0) continue;
        const eclairage = Math.max(0, q[0] * lumiere[0] + q[1] * lumiere[1] + q[2] * lumiere[2]);
        // Deux nuances seulement : chaque nuance de plus multiplie les morceaux de texte à redessiner
        const [x, y] = projeter(q);
        toile.point(x, y, eclairage > 0.45 ? clair : sombre, 1);
    }
    // Le contour, et l'équateur en pointillé
    for (let a = 0; a < Math.PI * 2; a += 0.02) toile.point(cx + Math.cos(a) * rayon, cy + Math.sin(a) * rayon, sombre, 0);
    for (let lon = 0; lon < 360; lon += 3) {
        const q = tourner(versXYZ(0, lon));
        if (q[2] > 0) toile.point(...(projeter(q) as [number, number]), clair, 1);
    }

    // Les arcs : du poste vers chaque serveur, ils s'élèvent au-dessus du globe
    const poste = versXYZ(POSTE.lat, POSTE.lon);
    const serveurs = d.serveurs.slice(0, 12);
    const etiquettes: { x: number; y: number; t: string; c: string }[] = [];
    const temps = Date.now() / 1000;
    serveurs.forEach((s: any) => {
        const pos = position(s);
        const cible = versXYZ(pos.lat, pos.lon);
        const ok = d.joignables.get(s);
        const couleur = ok === undefined ? '#94a3b8' : ok ? '#4ade80' : '#f87171';
        const angleArc = Math.acos(Math.min(1, poste[0] * cible[0] + poste[1] * cible[1] + poste[2] * cible[2]));
        const pas = Math.max(12, Math.round(angleArc * 120));
        const impulsion = ((temps * 0.6 + hachage(s.nom)) % 1);
        for (let k = 0; k <= pas; k++) {
            const t = k / pas;
            // Interpolation sur la sphère (slerp), puis élévation au milieu de l'arc
            const sinA = Math.sin(angleArc) || 1;
            const f1 = angleArc ? Math.sin((1 - t) * angleArc) / sinA : 1 - t, f2 = angleArc ? Math.sin(t * angleArc) / sinA : t;
            const p: [number, number, number] = [poste[0] * f1 + cible[0] * f2, poste[1] * f1 + cible[1] * f2, poste[2] * f1 + cible[2] * f2];
            const hauteurArc = 1 + 0.12 * Math.sin(Math.PI * t) * Math.min(1, angleArc * 3 + 0.3);
            const q = tourner(p);
            if (q[2] < -0.15) continue;
            const pres = ok && Math.abs(t - impulsion) < 0.06;
            const [x, y] = projeter(q, rayon * hauteurArc);
            toile.point(x, y, pres ? '#ffffff' : melange(NOIR, couleur, q[2] < 0 ? 0.35 : 0.8), pres ? 4 : 2);
        }
        const q = tourner(cible);
        if (q[2] >= 0) {
            const [x, y] = projeter(q);
            for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) toile.point(x + dx, y + dy, couleur, 3);
            etiquettes.push({ x: Math.round(x / 2) + 2, y: Math.round(y / 4), t: `${s.nom.replace(/ \(.*\)$/, '')}${pos.exacte ? '' : ' ~'}`, c: couleur });
        }
    });
    // Le poste : une étoile qui pulse
    const qp = tourner(poste);
    if (qp[2] >= 0) {
        const [x, y] = projeter(qp);
        const rayonPoste = 1 + Math.round((Math.sin(temps * 4) + 1) * 0.8);
        for (let dx = -rayonPoste; dx <= rayonPoste; dx++) for (let dy = -rayonPoste; dy <= rayonPoste; dy++) {
            if (dx * dx + dy * dy <= rayonPoste * rayonPoste) toile.point(x + dx, y + dy, theme.accent, 5);
        }
        etiquettes.push({ x: Math.round(x / 2) + 2, y: Math.round(y / 4) - 1, t: '✻ ton poste', c: theme.accent });
    }
    // Les étiquettes ne se chevauchent pas : chacune prend la ligne libre la plus proche (le poste d'abord)
    const occupees: [number, number, number][] = [];
    for (const e of etiquettes.reverse()) {
        const texte = couper(e.t, 22);
        const libre = (y: number) => !occupees.some(([oy, debut, fin]) => oy === y && e.x < fin + 1 && e.x + texte.length > debut - 1);
        const y = [0, 1, -1, 2, -2, 3, -3, 4, -4].map((dy) => e.y + dy).find((yy) => yy >= 0 && yy < h && libre(yy));
        if (y === undefined) continue;
        occupees.push([y, e.x, e.x + texte.length]);
        toile.texte(e.x, y, texte, e.c);
    }

    const repond = serveurs.filter((s: any) => d.joignables.get(s)).length;
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <text truncate>
                <span fg={theme.primaire} attributes={GRAS}>◍ GLOBE DES SERVEURS</span>
                <span fg="gray">{`  ${repond}/${serveurs.length} répondent · glisser pour tourner · Échap pour revenir`}</span>
            </text>
            <box flexDirection="row" flexGrow={1}>
                <box flexShrink={0}
                    onMouseDown={(e: any) => (glisse.current = e.x)}
                    onMouseDrag={(e: any) => {
                        if (glisse.current === undefined) return;
                        angle.current += (e.x - glisse.current) * 0.06;
                        glisse.current = e.x;
                    }}
                    onMouseUp={() => (glisse.current = undefined)} onMouseDragEnd={() => (glisse.current = undefined)}>
                    <RenduToile toile={toile} />
                </box>
                <box width={liste} flexShrink={0} flexDirection="column" paddingTop={1}>
                    {serveurs.map((s: any) => {
                        const ok = d.joignables.get(s);
                        const pos = position(s);
                        return (
                            <box key={s.nom} height={1} flexDirection="row" backgroundColor={survol === s.nom ? fond.selection : undefined}
                                onMouseOver={() => setSurvol(s.nom)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => ouvrir(s)}>
                                <text fg={ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171'}>● </text>
                                <text fg={survol === s.nom ? fond.texte : '#cbd5e1'} truncate>{couper(s.nom, liste - 6)}</text>
                                {!pos.exacte && <text fg={fond.discret}> ~</text>}
                            </box>
                        );
                    })}
                    {!serveurs.length && <text fg={fond.eteint}>aucun serveur SSH · /ssh-ajouter</text>}
                    <text> </text>
                    <text fg={fond.discret} wrapMode="word">~ position approximative (près de ton poste) : le nom d'hôte ne dit pas où il est</text>
                </box>
            </box>
        </box>
    );
}

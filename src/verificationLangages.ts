import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { surPath } from './chemins.js';
import type { CommandeVerification } from './verificationProjet.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function lire(f: string): string {
    const stat = fs.lstatSync(f);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Manifeste de vérification invalide ou trop grand (1 Mo maximum).');
    return fs.readFileSync(f, 'utf8');
}
function trouver(programme: string): string | undefined {
    return surPath(programme) || (process.platform === 'win32' ? surPath(`${programme}.exe`) : undefined);
}
export function detecterLangages(dossier: string): { commandes: CommandeVerification[]; explications: string[] } {
    const commandes: CommandeVerification[] = [], explications: string[] = [];
    const ajouter = (gestionnaire: 'python' | 'dotnet' | 'projet', script: string, programme: string, args: string[], manifeste: string, contenu: string) => {
        const executable = trouver(programme);
        if (!executable) { explications.push(`${programme} absent du PATH : ${script} indisponible. Aucun téléchargement automatique.`); return; }
        commandes.push({ gestionnaire, script, contenu, executable, args,
            commande: [programme, ...args].map((s) => /[\s"'`$;]/.test(s) ? JSON.stringify(s) : s).join(' '), manifeste: hash(manifeste) });
    };
    try {
        const noms = fs.readdirSync(dossier);
        const python = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'requirements.txt'].filter((f) => noms.includes(f));
        if (python.length) {
            const manifeste = python.map((f) => `${f}\n${lire(path.join(dossier, f))}`).join('\n');
            const programme = trouver('python') ? 'python' : 'python3';
            if (/pytest/i.test(manifeste) || noms.includes('pytest.ini')) ajouter('python', 'python:pytest', programme, ['-m', 'pytest'], manifeste, 'Tests pytest · utilise uniquement l’environnement Python existant.');
            else if (noms.includes('tests')) ajouter('python', 'python:unittest', programme, ['-m', 'unittest', 'discover', '-s', 'tests'], manifeste, 'Découverte unittest dans tests/. Configure agentopia.json pour une autre commande.');
            else explications.push('Projet Python détecté : déclare une commande dans agentopia.json si aucun test pytest/unittest n’est détecté.');
        }
        const solutions = noms.filter((f) => /\.(sln|slnx)$/i.test(f));
        const dotnet = solutions.length ? solutions : noms.filter((f) => /\.(csproj|fsproj|vbproj)$/i.test(f));
        for (const f of dotnet.slice(0, 30)) ajouter('dotnet', `dotnet:${f}`, 'dotnet', ['test', f, '--no-restore', '--nologo'], lire(path.join(dossier, f)), '.NET test sans restauration implicite : prépare les dépendances séparément.');
        if (noms.includes('agentopia.json')) {
            const texte = lire(path.join(dossier, 'agentopia.json')), p = JSON.parse(texte);
            if (p.verifications !== undefined) {
                if (!Array.isArray(p.verifications) || p.verifications.length > 30) throw new Error('agentopia.json : verifications doit contenir au plus 30 commandes.');
                const vus = new Set<string>();
                for (const c of p.verifications) {
                    if (!c || typeof c.nom !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(c.nom) || vus.has(c.nom)
                        || typeof c.programme !== 'string' || !/^[a-zA-Z0-9_.-]{1,120}$/.test(c.programme)
                        || !Array.isArray(c.args) || c.args.length > 100 || !c.args.every((a: unknown) => typeof a === 'string' && a.length <= 4000 && !/[\x00-\x1f]/.test(a)))
                        throw new Error('agentopia.json : nom unique, programme du PATH et arguments explicites requis.');
                    vus.add(c.nom); ajouter('projet', `projet:${c.nom}`, c.programme, c.args, texte, 'Commande définie par le projet. Relis les arguments avant de confirmer.');
                }
            }
        }
    } catch (err) { return { commandes: [], explications: [(err as Error).message] }; }
    return { commandes, explications };
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

// claude.exe directement si on le trouve (pas de cmd.exe, pas de problème de guillemets)
const EXE = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
export const CLAUDE = fs.existsSync(EXE) ? EXE : 'claude';

export interface OptionsClaude {
    cwd: string;
    modele?: string;                    // 'haiku' pour les petites tâches rapides
    surTexte?: (morceau: string) => void;
}

// claude -p : le prompt passe par stdin, la réponse est renvoyée (et diffusée au fil de l'eau si surTexte)
export function demanderClaude(prompt: string, options: OptionsClaude): Promise<string> {
    return new Promise((ok, ko) => {
        const args = ['-p'];
        if (options.modele) args.push('--model', options.modele);
        const proc = spawn(CLAUDE, args, { cwd: options.cwd, shell: CLAUDE === 'claude' });
        let sortie = '', erreurs = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => {
            sortie += d;
            options.surTexte?.(d);
        });
        proc.stderr.on('data', (d) => (erreurs += d));
        proc.on('error', ko);
        proc.on('close', (code) => (code === 0 ? ok(sortie.trim()) : ko(new Error(erreurs.trim() || `claude a quitté avec le code ${code}`))));
        proc.stdin.end(prompt, 'utf-8');
    });
}

// Découpe un flux de texte en lignes complètes (pour les afficher une à une)
export function parLignes(surLigne: (ligne: string) => void): { pousser: (morceau: string) => void; finir: () => void } {
    let tampon = '';
    return {
        pousser: (morceau) => {
            tampon += morceau;
            const lignes = tampon.split(/\r?\n/);
            tampon = lignes.pop()!;
            lignes.forEach(surLigne);
        },
        finir: () => {
            if (tampon) surLigne(tampon);
            tampon = '';
        },
    };
}

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { CLAUDE } from './claude.js';

// Claude Code est-il installé et connecté ? Vérifié au démarrage, sans bloquer l'interface.
// Sinon l'interface le dit (zone du maître) et propose de l'installer ou de se connecter, sans quitter l'app.

export type EtatClaude = 'verification' | 'absent' | 'deconnecte' | 'pret';

export const etatClaude = new EventEmitter();
let etat: EtatClaude = 'verification';
let compte = '';

export const lireEtatClaude = () => ({ etat, compte });

function sortie(programme: string, args: string[]): Promise<{ code: number | null; texte: string }> {
    return new Promise((ok) => {
        const proc = spawn(programme, args, { shell: programme === 'claude' });
        let texte = '';
        proc.stdout?.on('data', (d) => (texte += d));
        proc.stderr?.on('data', (d) => (texte += d));
        const minuterie = setTimeout(() => proc.kill(), 20_000);
        proc.on('error', () => ok({ code: -1, texte: '' }));
        proc.on('close', (code) => {
            clearTimeout(minuterie);
            ok({ code, texte });
        });
    });
}

export async function verifierClaude(): Promise<EtatClaude> {
    // Pour tester l'interface sans désinstaller Claude : CLAUDETOPIA_SIMULER_CLAUDE=absent | deconnecte
    const simule = process.env.CLAUDETOPIA_SIMULER_CLAUDE as EtatClaude | undefined;
    if (simule) {
        etat = simule;
        etatClaude.emit('maj', etat);
        return etat;
    }
    // Installé : claude.exe trouvé à l'emplacement npm, sinon dans le PATH (installateur natif…)
    const present = CLAUDE !== 'claude' || (await sortie('where', ['claude'])).code === 0;
    if (!present) {
        etat = 'absent';
    } else {
        const r = await sortie(CLAUDE, ['auth', 'status']);
        try {
            const j = JSON.parse(r.texte);
            etat = j.loggedIn ? 'pret' : 'deconnecte';
            compte = j.email ?? j.authMethod ?? '';
        } catch {
            // Version qui ne connaît pas « auth status » : on suppose connecté, les sessions le diront sinon
            etat = r.code === 0 ? 'pret' : 'deconnecte';
        }
    }
    etatClaude.emit('maj', etat);
    return etat;
}

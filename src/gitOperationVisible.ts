import { choisir, bus, type Demande } from './ui/bus.js';
import { dansOperationGit } from './gitExecution.js';

/** L'opération conserve son signal entre deux sous-commandes Git. */
export async function operationGitVisible<T>(titre: string, detail: string, travailler: () => Promise<T>): Promise<T> {
    const controle = new AbortController();
    let dialogue: Extract<Demande, { type: 'choix' }> | undefined, visible = true;
    const observer = (d?: Demande) => { if (d?.type === 'choix' && d.message === titre) dialogue = d; };
    bus.on('demande', observer);
    const fermeture = choisir(titre, [{ label: 'Interrompre l’opération Git', valeur: 'interrompre' }], false,
        `${detail}\n\nÉchap ou Entrée pour interrompre. Les fichiers et commits déjà créés sont conservés.`);
    bus.off('demande', observer);
    const attente = fermeture.then(r => { visible = false; if (r === 'interrompre') controle.abort(); }, () => { visible = false; controle.abort(); });
    try { return await dansOperationGit(controle.signal, travailler); }
    finally { if (visible) dialogue?.resoudre('termine'); await attente; }
}

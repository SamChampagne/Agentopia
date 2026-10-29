// Un vrai processus et le vrai worker, avec un fournisseur simulé sans réseau.
import { travailler } from '../dist/sessionWorker.js';
if (!process.env.CLAUDETOPIA_DATA_DIR?.includes('agentopia-recuperation-')) throw new Error('Données de test requises');
await travailler(process.argv[2], process.argv[3], async (c) => {
    c.thread('thread-avant-crash'); process.send?.({ pret: true });
    return new Promise(() => {});
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Commande } from './commandes.js';
import { choisir, saisir, bus } from './ui/bus.js';
import { rapportDiagnostic } from './diagnostics.js';
import { etatMoteur, moteurEnPause } from './moteurClient.js';

export function commandesDiagnostics(): Commande[] {
    return [{ nom: 'diagnostics', groupe: 'Système', description: 'Rapport technique local après incident, sans conversations ni secrets', executer: async () => {
        const rapport = rapportDiagnostic({ ...etatMoteur(), enPause: moteurEnPause() });
        const texte = JSON.stringify(rapport, null, 2);
        const action = await choisir('Diagnostic technique · aperçu complet', [
            { label: 'Fermer', valeur: 'fermer' }, { label: 'Exporter ce rapport localement', valeur: 'exporter' },
        ], false, `${texte}\n\nAucun envoi automatique. Tu choisis ensuite si tu veux partager ce fichier.`);
        if (action !== 'exporter') return;
        const cible = path.resolve(await saisir('Nouveau fichier de diagnostic', path.join(os.homedir(), `agentopia-diagnostic-${Date.now()}.json`)));
        fs.writeFileSync(cible, texte + '\n', { flag: 'wx', mode: 0o600 });
        bus.emit('notice', `Diagnostic exporté : ${cible}`);
    } }];
}

import { readFileSync } from 'node:fs';

// Source unique pour le moteur, les fournisseurs et le paquet distribué.
export const VERSION_AGENTOPIA: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

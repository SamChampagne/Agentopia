import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-identite-ink-'));
process.env.CLAUDETOPIA_DATA_DIR = tmp;
process.env.CLAUDETOPIA_TEST_UI = '1';
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.writeFileSync(path.join(tmp, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false }));
const { VueSession } = await import('./dist/ui/Zones.js');
const { nomAgentSession, titreConversation } = await import('./dist/ui/identiteSession.js');
try {
    for (const largeur of [60, 80, 130]) {
        for (const [fournisseur, nom] of [['codex', 'Codex'], ['claude', 'Claude'], ['perplexity', 'Perplexity'], [undefined, 'Claude CLI']]) {
            const s = { fournisseur, integree: !!fournisseur, nom: 'Projet très long '.repeat(10), titre: 'Mon analyse', arrierePlan: true, id: 'fixture' };
            const git = { branche: 'feature/une-branche-au-nom-très-long'.repeat(4), modifs: 12, enAvance: 2, enRetard: 0 };
            const ui = render(React.createElement(VueSession, { s, git, largeur, hauteur: 20, messages: [], boutons: [], defilement: 0 }));
            try { assert.ok(ui.lastFrame().split('\n')[0].includes(`Agent : ${nom}`), `${nom} visible dans Ink à ${largeur} colonnes`); }
            finally { ui.unmount(); ui.cleanup(); }
        }
    }
    assert.equal(nomAgentSession({ integree: true, fournisseur: 'inconnu' }), 'Agent inconnu');
    assert.equal(titreConversation({ integree: true, fournisseur: 'codex', nom: 'Pulsar', titre: 'Codex · Pulsar' }), 'Pulsar');
    assert.equal(titreConversation({ integree: true, fournisseur: 'codex', nom: 'Pulsar', titre: 'Analyse' }), 'Pulsar · Analyse');
    process.stdout.write('✓ Identité Ink : trois fournisseurs, Claude CLI, titres et petits écrans\n');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

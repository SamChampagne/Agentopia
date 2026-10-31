import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { render } from 'ink-testing-library';
import { Composeur } from './dist/ui/Composeur.js';
let valeur = '', envoye;
function Fixture() { const [v, changer] = useState(''); valeur = v; return React.createElement(Composeur, { value: v, onChange: changer, onSubmit: (texte) => { envoye = texte; } }); }
const ui = render(React.createElement(Fixture));
const attendre = () => new Promise((r) => setTimeout(r, 70));
try {
    await attendre(); ui.stdin.write('def exemple():\n    return 42\n# fin'); await attendre();
    assert.equal(valeur, 'def exemple():\n    return 42\n# fin'); assert.equal(envoye, undefined);
    ui.stdin.write('\n'); await attendre(); ui.stdin.write('Suite'); await attendre();
    assert.equal(valeur, 'def exemple():\n    return 42\n# fin\nSuite'); assert.equal(envoye, undefined);
    ui.stdin.write('\r'); await attendre(); assert.equal(envoye, valeur);
    process.stdout.write('✓ Composeur Ink : collage multiligne conservé et envoi explicite\n');
} finally { ui.unmount(); ui.cleanup(); }

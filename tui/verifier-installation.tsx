import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { App } from './app.tsx';
const ui = await createTestRenderer({ width: 130, height: 34, autoFocus: false });
const root = createRoot(ui.renderer);
try {
    root.render(<App quitter={() => {}} />);
    await new Promise((r) => setTimeout(r, 200)); await ui.flush(); await ui.renderOnce();
    if (!ui.captureCharFrame().includes('AGENTOPIA')) throw new Error('Bannière Agentopia absente');
    process.stdout.write('Interface Agentopia vérifiée\n');
} finally { root.render(<text>fin</text>); await ui.flush(); await ui.dispose(); }

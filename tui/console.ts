// Windows : la console ne transmet les clics et la molette (séquences VT) que si son entrée est en mode « VT ».
// OpenTUI ne règle pas ce mode lui-même (il compte sur le mode brut du runtime) : on s'en assure ici.
// On retire aussi la « sélection rapide » de la console classique, qui garde les clics pour elle.
// Le mode d'origine est remis en quittant (sinon la fenêtre le garderait après Agentopia).
import { dlopen, FFIType, ptr } from 'bun:ffi';

const VT_ENTREE = 0x0200, SELECTION_RAPIDE = 0x0040, DRAPEAUX_ETENDUS = 0x0080;
let origine: number | undefined;
let k32: any;

function kernel32() {
    k32 ??= dlopen('kernel32.dll', {
        GetStdHandle: { args: [FFIType.i32], returns: FFIType.ptr },
        GetConsoleMode: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        SetConsoleMode: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    }).symbols;
    return k32;
}

// Renvoie ce qui a été fait (pour le journal)
export function activerEntreeVT(): string {
    if (process.platform !== 'win32') return '';
    try {
        const k = kernel32();
        const h = k.GetStdHandle(-10);   // STD_INPUT_HANDLE
        const mode = new Uint32Array(1);
        if (!k.GetConsoleMode(h, ptr(mode))) return 'console : entrée non reconnue (pas une console Windows)';
        origine ??= mode[0];
        const voulu = (mode[0] | VT_ENTREE | DRAPEAUX_ETENDUS) & ~SELECTION_RAPIDE;
        if (voulu === mode[0]) return `console : entrée VT déjà active (mode 0x${mode[0].toString(16)})`;
        const ok = k.SetConsoleMode(h, voulu);
        return ok ? `console : entrée VT activée (mode 0x${mode[0].toString(16)} → 0x${voulu.toString(16)})` : 'console : impossible de changer le mode';
    } catch (e) {
        return `console : ${(e as Error).message}`;
    }
}

export function restaurerConsole(): void {
    if (process.platform !== 'win32' || origine === undefined) return;
    try {
        kernel32().SetConsoleMode(kernel32().GetStdHandle(-10), origine);
    } catch {
        // la fenêtre se ferme peut-être déjà
    }
}

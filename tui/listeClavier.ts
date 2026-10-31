import { useEffect, useRef } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';

export function useSelectionVisible(id: string | undefined) {
    const ref = useRef<ScrollBoxRenderable>(null);
    const { width, height } = useTerminalDimensions();
    useEffect(() => { if (id) ref.current?.scrollChildIntoView(id); }, [id, width, height]);
    return ref;
}
export const indexDeplace = (index: number, pas: number, nombre: number) => Math.max(0, Math.min(nombre - 1, index + pas));

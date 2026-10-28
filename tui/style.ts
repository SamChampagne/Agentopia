import { TextAttributes } from '@opentui/core';

export const GRAS = TextAttributes.BOLD;
export const SOULIGNE = TextAttributes.UNDERLINE;
export const une = (s: string) => s.replace(/\s+/g, ' ').trim();
export const couper = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, Math.max(0, n - 1)).join('') + '…' : s);
export const ANIM = ['✻', '✼', '✽', '✾', '✿', '❀'];

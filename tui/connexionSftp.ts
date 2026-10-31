import { useEffect, useRef, useState } from 'react';
import { creerHookConnexionSftp } from '../dist/ui/connexionSftp.js';

// Utiliser le React du renderer OpenTUI, pas celui de l'interface Ink.
export const useConnexionSftp = creerHookConnexionSftp({ useEffect, useRef, useState });

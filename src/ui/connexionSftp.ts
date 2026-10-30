import { useEffect, useRef, useState } from 'react';
import { Sftp, type ConnexionSftp } from '../sftp.js';
import { EmpreinteSftpInconnue } from '../confianceSftp.js';

const creerSftp = (cible: ConnexionSftp) => new Sftp(cible);
interface HooksConnexion {
    useEffect: (effet: () => void | (() => void), deps: readonly unknown[]) => void;
    useRef: <T>(initial: T) => { current: T };
    useState: <T>(initial: T | (() => T)) => [T, (action: T | ((precedent: T) => T)) => void];
}
/** Même consentement dans les deux interfaces, sans remplacer la vue par un dialogue global. */
export function creerHookConnexionSftp(hooks: HooksConnexion) {
    const { useEffect, useRef, useState } = hooks;
    return function useConnexionSftp(cible: ConnexionSftp, pret: (s: Sftp) => Promise<boolean | void>,
        dire: (texte: string, erreur?: boolean) => void, creer = creerSftp) {
        const sftp = useRef<Sftp | undefined>(undefined);
        const [confiance, setConfiance] = useState<EmpreinteSftpInconnue | undefined>(undefined);
        const callbacks = useRef({ pret, dire }); callbacks.current = { pret, dire };
        const generation = useRef(0), occupe = useRef(false);
        async function connecter(acceptee?: string) {
            if (occupe.current) return;
            occupe.current = true;
            const tentative = ++generation.current;
            setConfiance(undefined); sftp.current?.fermer();
            const s = creer(cible); sftp.current = s;
            callbacks.current.dire(`Connexion à ${cible.utilisateur}@${cible.hote}…`);
            try {
                await s.connecter({ empreinteAcceptee: acceptee });
                if (generation.current !== tentative) return;
                const ouvert = await callbacks.current.pret(s);
                if (ouvert !== false && generation.current === tentative && s.nouvelleEmpreinte)
                    callbacks.current.dire('Connecté · empreinte acceptée et enregistrée.');
            } catch (e) {
                s.fermer();
                if (generation.current !== tentative) return;
                if (e instanceof EmpreinteSftpInconnue) setConfiance(e);
                callbacks.current.dire(`✕ ${(e as Error).message}`, true);
            } finally { if (generation.current === tentative) occupe.current = false; }
        }
        useEffect(() => {
            void connecter();
            return () => { ++generation.current; occupe.current = false; sftp.current?.fermer(); };
        }, []);
        return { sftp, confiance,
            accepter: () => { if (confiance) void connecter(confiance.empreinte); },
            refuser: () => { setConfiance(undefined); sftp.current?.fermer(); callbacks.current.dire('Connexion annulée · aucune nouvelle empreinte enregistrée.', true); },
        };
    };
}
export const useConnexionSftp = creerHookConnexionSftp({ useEffect, useRef, useState });

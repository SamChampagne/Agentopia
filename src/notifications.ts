import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { sessionsActives } from './systeme.js';
import { CHEMINS } from './chemins.js';

// ─── Lien claudetopia: (clic sur une notification) ───────────────────────────
// Enregistré pour ce compte Windows seulement (HKCU, sans droits admin) : il lance outils/protocole.vbs,
// qui écrit la demande dans ~/.claudetopia-ouvrir et met la fenêtre Agentopia au premier plan.

const SCRIPT_LIEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'outils', 'protocole.vbs');
const FICHIER_DEMANDE = path.join(os.homedir(), '.claudetopia-ouvrir');
const CLE = 'HKCU\\Software\\Classes\\claudetopia';

// Activé par l'utilisateur (centre de connexions), jamais en douce : c'est une entrée dans son registre
export function lienEnregistre(): boolean {
    if (process.platform !== 'win32') return false;
    const actuelle = spawnSync('reg', ['query', `${CLE}\\shell\\open\\command`, '/ve'], { encoding: 'utf-8' }).stdout ?? '';
    return actuelle.includes(SCRIPT_LIEN);
}

export function retirerLien(): void {
    spawnSync('reg', ['delete', CLE, '/f']);
}

export function enregistrerLien(): void {
    if (process.platform !== 'win32' || !fs.existsSync(SCRIPT_LIEN) || lienEnregistre()) return;
    const commande = `wscript.exe "${SCRIPT_LIEN}" "%1"`;
    spawnSync('reg', ['add', CLE, '/ve', '/d', 'URL:Agentopia', '/f']);
    spawnSync('reg', ['add', CLE, '/v', 'URL Protocol', '/d', '', '/f']);
    spawnSync('reg', ['add', `${CLE}\\shell\\open\\command`, '/ve', '/d', commande, '/f']);
}

// Les demandes arrivent par un fichier : on le surveille et on émet « demande » (le lien complet)
export const liens = new EventEmitter();
export function surveillerLiens(): void {
    try {
        fs.writeFileSync(FICHIER_DEMANDE, '', 'utf-8');
        fs.watch(FICHIER_DEMANDE, () => {
            let texte = '';
            try {
                texte = fs.readFileSync(FICHIER_DEMANDE, 'utf-8').trim();
            } catch {
                return;
            }
            if (!texte) return;
            fs.writeFileSync(FICHIER_DEMANDE, '', 'utf-8');
            liens.emit('demande', texte);
        }).on('error', () => undefined);
    } catch {
        // pas de liens cliquables : les notifications restent informatives
    }
}

// Toast Windows natif via Windows PowerShell 5.1 (WinRT n'est pas dispo dans pwsh 7).
// On l'envoie au nom de Windows Terminal : l'ID de PowerShell est filtré silencieusement sur ce poste.
// lien : « claudetopia:session/<id> »… un clic sur la notification ouvre ça dans Agentopia (voir enregistrerLien)
// son : « fini » (le son habituel), « alerte » (plus marqué : une session a besoin de toi) ; aucun si /sons est coupé
export type Son = 'fini' | 'alerte';
const SONS_TOAST: Record<Son, string> = { fini: 'ms-winsoundevent:Notification.Default', alerte: 'ms-winsoundevent:Notification.Reminder' };
const sonsActifs = () => {
    try {
        return JSON.parse(fs.readFileSync(CHEMINS.config, 'utf-8')).sons !== false;
    } catch {
        return true;
    }
};

// Le son seul (notifications coupées, ou pour l'essayer) : sons système de Windows
export function jouerSon(son: Son): void {
    if (!sonsActifs()) return;
    const nom = son === 'alerte' ? 'Exclamation' : 'Asterisk';
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `[System.Media.SystemSounds]::${nom}.Play(); Start-Sleep -Milliseconds 1500`], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

export function toast(titre: string, message: string, lien?: string, son: Son = 'fini'): void {
    const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "''");
    const audio = sonsActifs() ? `<audio src="${SONS_TOAST[son]}"/>` : '<audio silent="true"/>';
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast${lien ? ` activationType="protocol" launch="${echapper(lien)}"` : ''}><visual><binding template="ToastGeneric"><text>${echapper(titre)}</text><text>${echapper(message)}</text></binding></visual>${audio}</toast>')
$app = 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { stdio: 'ignore', detached: true }).unref();
}

const DUREE_MIN_MS = 15_000;   // pas de notif pour les réponses de quelques secondes

// Surveille les sessions Claude : quand une passe de "busy" à "idle", elle t'attend → toast
export function demarrerSurveillance(surAttente?: (nom: string) => void, intervalleMs = 4000): () => void {
    const debutTravail = new Map<number, number>();
    const tic = () => {
        for (const s of sessionsActives()) {
            if (s.statut === 'busy') {
                if (!debutTravail.has(s.pid)) debutTravail.set(s.pid, Date.now());
            } else if (debutTravail.has(s.pid)) {
                const duree = Date.now() - debutTravail.get(s.pid)!;
                debutTravail.delete(s.pid);
                if (duree >= DUREE_MIN_MS) {
                    const minutes = Math.round(duree / 60000);
                    toast(`🤖 ${s.nom} t'attend`, `Claude a fini${minutes ? ` (${minutes} min de travail)` : ''}.`);
                    surAttente?.(s.nom);
                }
            }
        }
    };
    const id = setInterval(tic, intervalleMs);
    id.unref();
    return () => clearInterval(id);
}

import { spawn } from 'child_process';
import { sessionsActives } from './systeme.js';

// Toast Windows natif via Windows PowerShell 5.1 (WinRT n'est pas dispo dans pwsh 7).
// On l'envoie au nom de Windows Terminal : l'ID de PowerShell est filtré silencieusement sur ce poste.
export function toast(titre: string, message: string): void {
    const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "''");
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${echapper(titre)}</text><text>${echapper(message)}</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>')
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

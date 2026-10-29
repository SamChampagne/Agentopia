using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Agentopia.Installation {
    internal sealed class Etat {
        public string etape, titre, detail;
        public int? pourcentage;
        public bool annulable;
    }
    internal sealed class Installation {
        private readonly Configuration config;
        private readonly Options options;
        private readonly object verrouJournal = new object();
        public string Version { get { return config.version; } }
        public string Journal { get; private set; }
        public bool OuvrirApres { get { return !options.sansLancer; } }
        public Installation(Configuration config, Options options) {
            this.config = config; this.options = options;
            if (config.taille <= 0 || config.sha256 == null || !System.Text.RegularExpressions.Regex.IsMatch(config.sha256, "^[a-f0-9]{64}$")) throw new Exception("Configuration de l’installateur invalide.");
            Journal = options.journal ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Agentopia", "installation", DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N") + ".log");
            Directory.CreateDirectory(Path.GetDirectoryName(Journal));
        }
        public void Journaliser(string type, string message) {
            lock (verrouJournal) File.AppendAllText(Journal, new JavaScriptSerializer().Serialize(new { type, message }) + Environment.NewLine, Encoding.UTF8);
        }
        private void Signaler(Action<Etat> progression, string etape, string titre, string detail, int? pourcentage, bool annulable) {
            var etat = new Etat { etape = etape, titre = titre, detail = detail, pourcentage = pourcentage, annulable = annulable };
            Journaliser("progression", new JavaScriptSerializer().Serialize(etat)); progression(etat);
        }
        private static int Pourcentage(long lu, long total) { return (int)Math.Min(100, lu * 100 / Math.Max(1, total)); }
        public async Task<string> Executer(Action<Etat> progression, CancellationToken token) {
            string temporaire = Path.Combine(Path.GetTempPath(), "agentopia-setup-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporaire);
            try {
                string archive = Path.Combine(temporaire, "agentopia.zip");
                string titre = options.archive == null ? "Téléchargement d’Agentopia" : "Préparation du paquet local";
                Signaler(progression, "telechargement", titre, "Connexion au téléchargement…", 0, true);
                await Telechargement.Obtenir(config, options.archive, archive, (lu, total) => Signaler(progression, "telechargement", titre,
                    String.Format("{0:0.0} Mo sur {1:0.0} Mo", lu / 1048576.0, total / 1048576.0), Pourcentage(lu, total), true), token);
                Signaler(progression, "verification", "Vérification du téléchargement", "Contrôle de l’intégrité du paquet…", 0, true);
                Telechargement.Verifier(archive, config.sha256, (lu, total) => Signaler(progression, "verification", "Vérification du téléchargement", "Contrôle de l’intégrité du paquet…", Pourcentage(lu, total), true), token);
                token.ThrowIfCancellationRequested();
                Signaler(progression, "installation", "Installation d’Agentopia", "Préparation des composants…", null, false);
                // Extraire uniquement le moteur et les deux modules connus, après contrôle du ZIP.
                using (var zip = ZipFile.OpenRead(archive)) {
                    foreach (string nom in new[] { "runtime/node.exe", "outils/installation-windows.mjs", "outils/installer-worker.mjs" }) {
                        var entrees = zip.Entries.Where(e => e.FullName.Replace('\\', '/') == nom).ToArray();
                        if (entrees.Length != 1) throw new IOException("Composant d’installation manquant ou dupliqué : " + nom);
                        string cible = Path.Combine(temporaire, nom.Replace('/', Path.DirectorySeparatorChar));
                        Directory.CreateDirectory(Path.GetDirectoryName(cible)); entrees[0].ExtractToFile(cible);
                    }
                }
                string parametres = Path.Combine(temporaire, "options.json");
                File.WriteAllText(parametres, new JavaScriptSerializer().Serialize(new { archive, hash = config.sha256, destination = options.destination, raccourci = !options.sansRaccourci, idAttendu = config.id, versionAttendue = config.version }), new UTF8Encoding(false));
                string destination = await Installer(temporaire, parametres, progression);
                Signaler(progression, "termine", "Agentopia est prêt", "Tes réglages et conversations sont conservés.", 100, false);
                return destination;
            } finally {
                // Uniquement le dossier GUID créé par cette tentative, jamais le dossier téléchargé.
                if (Path.GetDirectoryName(temporaire).TrimEnd('\\') == Path.GetTempPath().TrimEnd('\\') && Path.GetFileName(temporaire).StartsWith("agentopia-setup-")) {
                    try { Directory.Delete(temporaire, true); }
                    catch (IOException e) { Journaliser("nettoyage", e.Message); }
                    catch (UnauthorizedAccessException e) { Journaliser("nettoyage", e.Message); }
                }
            }
        }
        private Task<string> Installer(string temporaire, string parametres, Action<Etat> progression) {
            return Task.Run(() => {
                string destination = null, erreur = null;
                var info = new ProcessStartInfo(Path.Combine(temporaire, "runtime", "node.exe"), Citer(Path.Combine(temporaire, "outils", "installer-worker.mjs")) + " " + Citer(parametres)) {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = temporaire
                };
                using (var p = new Process { StartInfo = info }) {
                    p.OutputDataReceived += (s, e) => {
                        if (String.IsNullOrEmpty(e.Data)) return;
                        Journaliser("moteur", e.Data);
                        if (!e.Data.StartsWith("@agentopia ", StringComparison.Ordinal)) return;
                        try {
                            var d = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(e.Data.Substring(11));
                            string type = (string)d["type"];
                            if (type == "resultat") destination = (string)d["destination"];
                            else if (type == "erreur") erreur = (string)d["message"];
                            else if (type == "progression") Signaler(progression, "installation", (string)d["titre"], (string)d["detail"], d["pourcentage"] == null ? (int?)null : Convert.ToInt32(d["pourcentage"]), false);
                        } catch (Exception ex) { erreur = "Réponse d’installation invalide : " + ex.Message; }
                    };
                    p.ErrorDataReceived += (s, e) => { if (!String.IsNullOrEmpty(e.Data)) Journaliser("moteur-erreur", e.Data); };
                    p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine(); p.WaitForExit();
                    if (p.ExitCode != 0 || destination == null) throw new IOException(erreur ?? "L’installation n’a pas pu se terminer. Le journal contient les détails.");
                    return destination;
                }
            });
        }
        private static string Citer(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }
        public void Ouvrir(string destination) {
            string lanceur = Path.Combine(destination, "Agentopia.cmd");
            if (!File.Exists(lanceur)) throw new IOException("Le lanceur installé est introuvable.");
            // UseShellExecute ouvre une vraie console : aucun terminal caché ni flux redirigé.
            Process.Start(new ProcessStartInfo(lanceur) { UseShellExecute = true, WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) });
            Journaliser("ouverture", "Lancement demandé : " + lanceur);
        }
    }
}

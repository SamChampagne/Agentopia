using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Agentopia.Installation {
    internal sealed class Configuration {
        public string version { get; set; }
        public string id { get; set; }
        public string url { get; set; }
        public string sha256 { get; set; }
        public long taille { get; set; }
        public bool testLocal { get; set; }
    }
    internal sealed class Options {
        public string archive, destination, journal;
        public bool silencieux, sansLancer, sansRaccourci, sansEnregistrement;
        public static Options Lire(string[] args) {
            var o = new Options();
            for (int i = 0; i < args.Length; i++) {
                switch (args[i]) {
                    case "--silencieux": o.silencieux = true; break;
                    case "--sans-lancer": o.sansLancer = true; break;
                    case "--sans-raccourci": o.sansRaccourci = true; break;
                    case "--sans-enregistrement": o.sansEnregistrement = true; break;
                    case "--archive": case "--destination": case "--journal":
                        string cle = args[i];
                        if (++i >= args.Length || args[i].StartsWith("--")) throw new Exception("Valeur manquante : " + cle);
                        string chemin = Path.GetFullPath(args[i]);
                        if (cle == "--archive") o.archive = chemin;
                        else if (cle == "--destination") o.destination = chemin;
                        else o.journal = chemin;
                        break;
                    default: throw new Exception("Option inconnue : " + args[i]);
                }
            }
            if (o.silencieux && !o.sansLancer) throw new Exception("Le mode silencieux demande --sans-lancer.");
            return o;
        }
    }
    internal static class Programme {
        [STAThread]
        private static int Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try {
                var options = Options.Lire(args);
                Configuration config;
                using (var r = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("installation.json")))
                    config = new JavaScriptSerializer().Deserialize<Configuration>(r.ReadToEnd());
                var installation = new Installation(config, options);
                if (options.silencieux) {
                    try { installation.Executer(delegate { }, CancellationToken.None).GetAwaiter().GetResult(); return 0; }
                    catch (Exception e) { installation.Journaliser("erreur", e.Message); return 1; }
                }
                using (var fenetre = new FenetreInstallation(installation)) {
                    Application.Run(fenetre);
                    return fenetre.CodeSortie;
                }
            } catch (Exception e) {
                if (Array.IndexOf(args, "--silencieux") < 0) MessageBox.Show(e.Message, "Installation d’Agentopia", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}

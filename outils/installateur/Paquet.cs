using System;
using System.IO;
using System.IO.Compression;
using System.Linq;

namespace Agentopia.Installation {
    // Première extraction, avant que Node puisse appliquer les contrôles du
    // paquet complet. Aucun composant n'est extrait avant validation des trois.
    internal static class Paquet {
        internal const long ArchiveMax = 1024L * 1024 * 1024;
        internal const long RuntimeMax = 512L * 1024 * 1024;
        internal const long ModuleMax = 8L * 1024 * 1024;
        internal const int EntreesMax = 50000;
        internal static void ExtraireComposants(string archive, string destination, long runtimeMax = RuntimeMax, long moduleMax = ModuleMax, int entreesMax = EntreesMax) {
            if (runtimeMax <= 0 || runtimeMax > RuntimeMax || moduleMax <= 0 || moduleMax > ModuleMax || entreesMax <= 0 || entreesMax > EntreesMax)
                throw new IOException("Limite d’extraction invalide.");
            if (new FileInfo(archive).Length > ArchiveMax) throw new IOException("Le paquet dépasse la taille autorisée.");
            using (var zip = ZipFile.OpenRead(archive)) {
                if (zip.Entries.Count > entreesMax) throw new IOException("Le paquet contient trop de fichiers.");
                var noms = new[] { "runtime/node.exe", "outils/installation-windows.mjs", "outils/installer-worker.mjs" };
                var composants = noms.Select(nom => {
                    var entrees = zip.Entries.Where(e => e.FullName.Replace('\\', '/') == nom).ToArray();
                    if (entrees.Length != 1) throw new IOException("Composant d’installation manquant ou dupliqué : " + nom);
                    var entree = entrees[0]; long limite = nom == noms[0] ? runtimeMax : moduleMax;
                    if (entree.Length > limite || (entree.ExternalAttributes & 1024) != 0 || ((entree.ExternalAttributes >> 16) & 61440) == 40960)
                        throw new IOException("Composant trop volumineux ou lien interdit : " + nom);
                    return entree;
                }).ToArray();
                byte[] buffer = new byte[65536];
                for (int i = 0; i < noms.Length; i++) {
                    string cible = Path.Combine(destination, noms[i].Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(cible));
                    using (var source = composants[i].Open())
                    using (var sortie = new FileStream(cible, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                        long total = 0; int n;
                        while ((n = source.Read(buffer, 0, buffer.Length)) != 0) {
                            total += n;
                            if (total > composants[i].Length || total > (i == 0 ? runtimeMax : moduleMax)) throw new IOException("Composant décompressé trop volumineux.");
                            sortie.Write(buffer, 0, n);
                        }
                        if (total != composants[i].Length) throw new IOException("Composant décompressé incomplet.");
                    }
                }
            }
        }
    }
}

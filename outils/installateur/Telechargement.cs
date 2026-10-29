using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace Agentopia.Installation {
    internal static class Telechargement {
        public static async Task Copier(Stream source, string cible, long taille, Action<long, long> progression, CancellationToken token) {
            byte[] buffer = new byte[131072]; long lu = 0; var horloge = Stopwatch.StartNew();
            using (var sortie = new FileStream(cible, FileMode.CreateNew, FileAccess.Write, FileShare.None, buffer.Length, true)) {
                while (true) {
                    int n;
                    using (var attente = CancellationTokenSource.CreateLinkedTokenSource(token)) {
                        attente.CancelAfter(TimeSpan.FromSeconds(45));
                        using (attente.Token.Register(() => source.Dispose())) {
                            try { n = await source.ReadAsync(buffer, 0, buffer.Length, attente.Token); }
                            catch (Exception) {
                                token.ThrowIfCancellationRequested();
                                if (attente.IsCancellationRequested) throw new IOException("Le téléchargement ne répond plus. Vérifie ta connexion puis réessaie.");
                                throw;
                            }
                        }
                    }
                    if (n == 0) break;
                    lu += n;
                    if (lu > taille) throw new IOException("Le téléchargement dépasse la taille attendue.");
                    await sortie.WriteAsync(buffer, 0, n, token);
                    if (horloge.ElapsedMilliseconds >= 150) { progression(lu, taille); horloge.Restart(); }
                }
            }
            if (lu != taille) throw new IOException("Téléchargement incomplet. Vérifie ta connexion puis réessaie.");
            progression(lu, taille);
        }
        public static async Task Obtenir(Configuration config, string archive, string cible, Action<long, long> progression, CancellationToken token) {
            if (archive != null) {
                using (var source = File.OpenRead(archive)) await Copier(source, cible, config.taille, progression, token);
                return;
            }
            var uri = new Uri(config.url);
            bool local = config.testLocal && uri.IsLoopback;
            if (!local && (uri.Scheme != "https" || uri.Host != "github.com" || !uri.AbsolutePath.StartsWith("/SamChampagne/Agentopia/releases/download/", StringComparison.Ordinal)))
                throw new Exception("Adresse de téléchargement invalide.");
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            using (var client = new HttpClient()) {
                client.Timeout = TimeSpan.FromSeconds(45);
                client.DefaultRequestHeaders.UserAgent.ParseAdd("Agentopia-Setup/" + config.version);
                using (var reponse = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token)) {
                    if (!reponse.IsSuccessStatusCode) throw new IOException("Téléchargement indisponible (HTTP " + (int)reponse.StatusCode + "). Réessaie dans quelques instants.");
                    if (!local && reponse.RequestMessage.RequestUri.Scheme != "https") throw new IOException("Connexion de téléchargement non sécurisée.");
                    if (reponse.Content.Headers.ContentLength.HasValue && reponse.Content.Headers.ContentLength.Value != config.taille)
                        throw new IOException("La taille du paquet ne correspond pas à cette version.");
                    using (var source = await reponse.Content.ReadAsStreamAsync()) await Copier(source, cible, config.taille, progression, token);
                }
            }
        }
        public static void Verifier(string archive, string attendu, Action<long, long> progression, CancellationToken token) {
            using (var hash = SHA256.Create()) using (var source = File.OpenRead(archive)) {
                byte[] buffer = new byte[1048576]; int n; long lu = 0; var horloge = Stopwatch.StartNew();
                while ((n = source.Read(buffer, 0, buffer.Length)) != 0) {
                    token.ThrowIfCancellationRequested(); hash.TransformBlock(buffer, 0, n, buffer, 0); lu += n;
                    if (horloge.ElapsedMilliseconds >= 150) { progression(lu, source.Length); horloge.Restart(); }
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                if (!String.Equals(BitConverter.ToString(hash.Hash).Replace("-", ""), attendu, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("Le paquet est incomplet ou modifié. Rien n’a été installé. Réessaie le téléchargement.");
                progression(lu, source.Length);
            }
        }
    }
}

using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Agentopia.Installation {
    internal sealed class FenetreInstallation : Form {
        private readonly Installation installation;
        private readonly Label titre = new Label(), detail = new Label(), etapes = new Label(), mesure = new Label(), conseil = new Label();
        private readonly ProgressBar barre = new ProgressBar();
        private readonly Button action = new Button(), fermer = new Button();
        private readonly LinkLabel journal = new LinkLabel();
        private CancellationTokenSource annulation;
        private bool actif, annulable, pret;
        private string destination;
        public int CodeSortie { get; private set; }
        private static readonly Color Fond = Color.FromArgb(15, 23, 32), Texte = Color.FromArgb(239, 245, 250), Secondaire = Color.FromArgb(174, 191, 207), Accent = Color.FromArgb(65, 219, 201);
        public FenetreInstallation(Installation installation) {
            this.installation = installation;
            Text = "Installation d’Agentopia"; ClientSize = new Size(620, 400); MinimumSize = new Size(636, 439);
            StartPosition = FormStartPosition.CenterScreen; FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
            AutoScaleMode = AutoScaleMode.Dpi; Font = new Font("Segoe UI", 11); BackColor = Fond; ForeColor = Texte;
            var disposition = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(28), ColumnCount = 1, RowCount = 8 };
            foreach (int hauteur in new[] { 48, 36, 48, 44, 22, 36, 56, 48 }) disposition.RowStyles.Add(new RowStyle(SizeType.Absolute, hauteur));
            var marque = new Label { Text = "AGENTOPIA", Font = new Font("Segoe UI", 19, FontStyle.Bold), ForeColor = Accent, Dock = DockStyle.Fill };
            etapes.Text = "1  Télécharger     /     2  Vérifier     /     3  Installer"; etapes.ForeColor = Secondaire;
            titre.Text = "Préparation d’Agentopia"; titre.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            detail.Text = "L’installation va démarrer…"; detail.ForeColor = Secondaire; detail.AutoEllipsis = true;
            barre.Minimum = 0; barre.Maximum = 100; barre.AccessibleName = "Progression de l’étape en cours";
            mesure.Text = "Version " + installation.Version; mesure.TextAlign = ContentAlignment.MiddleRight; mesure.ForeColor = Secondaire;
            conseil.Text = "Agentopia s’ouvrira automatiquement une fois prêt."; conseil.ForeColor = Secondaire;
            var boutons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
            action.Text = "Annuler"; action.Size = new Size(132, 38); action.BackColor = Accent; action.ForeColor = Fond; action.FlatStyle = FlatStyle.Flat;
            fermer.Text = "Fermer"; fermer.Size = new Size(100, 38); fermer.Visible = false;
            journal.Text = "Voir le journal"; journal.AutoSize = true; journal.LinkColor = Secondaire; journal.ActiveLinkColor = Accent; journal.Margin = new Padding(0, 10, 18, 0);
            boutons.Controls.Add(action); boutons.Controls.Add(fermer); boutons.Controls.Add(journal);
            foreach (Control controle in new Control[] { marque, etapes, titre, detail, barre, mesure, conseil, boutons }) { controle.Dock = DockStyle.Fill; disposition.Controls.Add(controle); }
            Controls.Add(disposition); AcceptButton = action;
            journal.LinkClicked += (s, e) => { try { Process.Start(new ProcessStartInfo(installation.Journal) { UseShellExecute = true }); } catch (Exception ex) { detail.Text = ex.Message; } };
            fermer.Click += (s, e) => Close();
            action.Click += async (s, e) => {
                if (actif) { if (annulable) { action.Enabled = false; annulation.Cancel(); } }
                else if (pret) Ouvrir();
                else await Demarrer();
            };
            FormClosing += (s, e) => { if (actif) { e.Cancel = true; if (annulable) annulation.Cancel(); } };
            Shown += async (s, e) => await Demarrer();
        }
        private void Afficher(Etat etat) {
            if (IsDisposed || !actif) return;
            titre.Text = etat.titre; detail.Text = etat.detail; annulable = etat.annulable;
            action.Enabled = annulable; action.Text = annulable ? "Annuler" : "Installation…";
            barre.Style = etat.pourcentage.HasValue ? ProgressBarStyle.Continuous : ProgressBarStyle.Marquee;
            if (etat.pourcentage.HasValue) barre.Value = Math.Max(0, Math.Min(100, etat.pourcentage.Value));
            mesure.Text = etat.pourcentage.HasValue ? etat.pourcentage.Value + " % de cette étape" : "Cette étape peut prendre un moment.";
            etapes.Text = etat.etape == "telechargement" ? "1  Téléchargement en cours" : etat.etape == "verification" ? "1  Téléchargé     /     2  Vérification en cours" : "1  Téléchargé     /     2  Vérifié     /     3  Installation";
        }
        private async Task Demarrer() {
            actif = true; pret = false; annulable = true; CodeSortie = 1; fermer.Visible = false; action.Enabled = true; action.Text = "Annuler";
            annulation = new CancellationTokenSource();
            conseil.Text = installation.OuvrirApres ? "Agentopia s’ouvrira automatiquement une fois prêt." : "L’ouverture automatique est désactivée pour cette installation.";
            try {
                // Le disque, le réseau et le moteur restent hors du thread de l’interface.
                var progression = new Progress<Etat>(Afficher);
                destination = await Task.Run(() => installation.Executer(((IProgress<Etat>)progression).Report, annulation.Token));
                actif = false; pret = true; CodeSortie = 0;
                titre.Text = "Agentopia est prêt"; detail.Text = "Installation terminée. Tes données sont conservées.";
                barre.Style = ProgressBarStyle.Continuous; barre.Value = 100; mesure.Text = "Version " + installation.Version;
                etapes.Text = "Téléchargé     /     Vérifié     /     Installé";
                action.Enabled = true; action.Text = "Ouvrir Agentopia"; fermer.Visible = true;
                if (installation.OuvrirApres) Ouvrir();
            } catch (OperationCanceledException) {
                actif = false; CodeSortie = 2; installation.Journaliser("annule", "Téléchargement annulé par l’utilisateur.");
                Echec("Téléchargement annulé", "Tu peux recommencer quand tu veux.");
            } catch (Exception e) {
                actif = false; CodeSortie = 1; installation.Journaliser("erreur", e.Message);
                Echec("Installation interrompue", e.Message);
            } finally { annulation.Dispose(); }
        }
        private void Echec(string message, string explication) {
            etapes.Text = "Installation en pause";
            titre.Text = message; detail.Text = explication; barre.Style = ProgressBarStyle.Continuous; barre.Value = 0;
            mesure.Text = "Le journal contient les détails."; conseil.Text = "Corrige le problème indiqué, puis réessaie.";
            action.Text = "Réessayer"; action.Enabled = true; fermer.Visible = true;
        }
        private void Ouvrir() {
            try { installation.Ouvrir(destination); Close(); }
            catch (Exception e) {
                installation.Journaliser("ouverture-erreur", e.Message); detail.Text = "Installation réussie, mais l’ouverture a échoué. Utilise le raccourci Agentopia ou réessaie.";
                action.Text = "Ouvrir Agentopia"; action.Enabled = true; fermer.Visible = true;
            }
        }
    }
}

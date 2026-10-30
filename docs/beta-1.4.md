# Agentopia 1.4 — bêta Windows

La bêta **1.4.0-beta.7** stabilise les conversations : un double appui rapide sur Entrée ne déclenche plus deux envois ; parcourir l’historique avec ↑ ↓ conserve le brouillon, même lorsqu’une commande rappelée affiche des suggestions. La recherche utilise ses propres flèches et retrouve le message préparé à sa fermeture. Un historique remplacé ou temporairement inaccessible ne laisse plus une ancienne version figée ou un chat vide à l’écran.

**Pg↑ / Pg↓** parcourent les échanges, **Alt+Début** rejoint leur début et **Alt+Fin** reprend le suivi des derniers messages. Lorsque la lecture est remontée, le lien **Derniers messages** propose le même retour au clic ; l’arrivée de texte ne déplace pas la lecture. Chaque changement de session ouvre sa propre conversation au dernier message. La disposition des écrans est conservée.

La bêta **1.4.0-beta.6** place la saisie de chaque session directement sous ses messages, dans la colonne du chat. Le champ reste visible pendant le défilement et suit la disposition des actions. Les brouillons, la recherche, les suggestions et le verrouillage pendant une reprise dans le terminal Codex sont conservés.

La bêta **1.4.0-beta.5** améliore les conversations : messages et sorties Codex progressifs, détails des outils (Alt+L), commandes lisibles, tableaux adaptés et séparation entre actions et chat. Les mini-graphes turquoise des cartes ont été retirés. **Ouvrir Codex** et **Codex à côté** reprennent la même conversation dans le terminal ; Agentopia garde le brouillon et reste en lecture seule jusqu’à la fermeture de Codex, puis relit l’historique. Le contrôle exclusif empêche deux tours concurrents.

Télécharger **Agentopia-Setup.exe**, puis l’ouvrir. La bêta 1.4.0-beta.4 ajoute une fenêtre de téléchargement (Mo et progression), de vérification et d’installation, puis ouvre Agentopia automatiquement. Annulation pendant le téléchargement, nouvelle tentative après erreur et journal local sont disponibles. Node et Bun sont téléchargés dans le paquet vérifié ; l’assistant guide le choix des projets et la connexion des fournisseurs. L’archive ZIP est disponible pour un lancement portable avec Agentopia.cmd.

- La limite d’un tour compte le travail actif. Une demande de permission ou une question utilisateur suspend le compteur ; Arrêter reste disponible.
- Les permissions expliquent l’action, montrent la commande exacte et proposent les détails techniques. Aucune nouvelle autorisation automatique.
- Dans une équipe, **Relire (b)** ouvre le résultat et les commandes observées, donne accès aux diffs, à l’intégration des branches retenues et au rangement. Une intégration interrompue reprend sa conversation existante.
- Les bilans distinguent temps de travail et attente utilisateur. Les écrans existants sont conservés.
- L’écriture de l’état tolère les refus temporaires de remplacement de fichier sous Windows, avec des tentatives bornées qui préservent le dernier état lisible.
- Les mises à jour suivent le canal installé : une bêta peut recevoir une nouvelle bêta ou une version stable supérieure ; une version stable reste sur les versions stables. Aucun retour automatique à une version plus ancienne.

Cette publication conserve les équipes guidées, les modèles réutilisables, le moteur détaché et la récupération après plantage des versions précédentes. Les conversations et les branches restent dans le profil utilisateur lors d’une mise à jour. `/reparer` et `/retour-version` sont disponibles pour les installations Setup.

La publication automatisée est conditionnée aux tests du moteur et de l’interface ainsi qu’au test du vrai Setup sur un runner GitHub Windows : démarrage sans Node/Bun dans le PATH, mise à jour, réparation, retour arrière et conservation des données. Les fournisseurs sont simulés dans ces tests ; un parcours Codex réel avec revue et reprise d’intégration a aussi été effectué sur la base 1.3.1. Claude et Perplexity nécessitent encore une validation avec leurs comptes réels. Le binaire n’est pas signé : cette validation ne constitue pas une certification SmartScreen/antivirus.

La nouvelle fenêtre ne supprime pas l’avertissement SmartScreen : le Setup est encore non signé. La signature avec une identité d’éditeur reconnue reste à mettre en place. Le nouveau bootstrap .NET remplace l’ancien exécutable Bun lancé depuis Téléchargements ; la recherche des mises à jour utilise maintenant le dépôt renommé `SamChampagne/Agentopia`.

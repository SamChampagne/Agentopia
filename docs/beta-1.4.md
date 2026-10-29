# Agentopia 1.4 — bêta Windows

Télécharger **Agentopia-Setup.exe**, puis l’ouvrir. Node et Bun sont inclus ; l’assistant guide le choix des projets et la connexion des fournisseurs. L’archive ZIP est disponible pour un lancement portable avec Agentopia.cmd.

- La limite d’un tour compte le travail actif. Une demande de permission ou une question utilisateur suspend le compteur ; Arrêter reste disponible.
- Les permissions expliquent l’action, montrent la commande exacte et proposent les détails techniques. Aucune nouvelle autorisation automatique.
- Dans une équipe, **Relire (b)** ouvre le résultat et les commandes observées, donne accès aux diffs, à l’intégration des branches retenues et au rangement. Une intégration interrompue reprend sa conversation existante.
- Les bilans distinguent temps de travail et attente utilisateur. Les écrans existants sont conservés.
- L’écriture de l’état tolère les refus temporaires de remplacement de fichier sous Windows, avec des tentatives bornées qui préservent le dernier état lisible.
- Les mises à jour suivent le canal installé : une bêta peut recevoir une nouvelle bêta ou une version stable supérieure ; une version stable reste sur les versions stables. Aucun retour automatique à une version plus ancienne.

Cette publication conserve les équipes guidées, les modèles réutilisables, le moteur détaché et la récupération après plantage des versions précédentes. Les conversations et les branches restent dans le profil utilisateur lors d’une mise à jour. `/reparer` et `/retour-version` sont disponibles pour les installations Setup.

La publication automatisée est conditionnée aux tests du moteur et de l’interface ainsi qu’au test du vrai Setup sur un runner GitHub Windows : démarrage sans Node/Bun dans le PATH, mise à jour, réparation, retour arrière et conservation des données. Les fournisseurs sont simulés dans ces tests ; un parcours Codex réel avec revue et reprise d’intégration a aussi été effectué sur la base 1.3.1. Claude et Perplexity nécessitent encore une validation avec leurs comptes réels. Le binaire n’est pas signé : cette validation ne constitue pas une certification SmartScreen/antivirus.

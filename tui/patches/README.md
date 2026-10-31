# Compatibilité React en production

`@opentui/react@0.7.0` contient des appels à `jsxDEV` dans ses composants compilés,
y compris son écran d'erreur. React n'exporte pas cette fonction en production.
Le démarrage réel impose ce mode : le défaut donnait un écran noir, puis une
console de débogage vide parce que les erreurs étaient capturées dans le journal.

Le patch conserve le runtime de développement et adapte ses appels vers
`jsx` / `jsxs` en production. Il est enregistré avec `bun patch`, verrouillé dans
`bun.lock` et réappliqué lors de l'installation propre du paquet Windows.
Il ne modifie ni React ni ses instances utilisées par le moteur de rendu.

Avant de retirer le patch ou de changer OpenTUI, exécuter `node test-demarrage.mjs`
depuis la racine après compilation. Le contrôle couvre les deux modes, le rendu
de l'accueil et du cockpit, la saisie et l'écran d'erreur de la bibliothèque.
`--verifier-installation` impose aussi le mode production au contrôle du paquet.

Référence : [patchs persistants Bun](https://bun.sh/docs/pm/cli/patch).

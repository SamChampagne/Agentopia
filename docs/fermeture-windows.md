# Fermeture Windows — bêta 20

## Défaut reproduit

La bêta 19 pouvait fonctionner normalement puis écrire `Internal error: directory mismatch` pour `tui/tsconfig.json` à la fermeture, avec un code de sortie 0. Le 2 novembre 2026, une commande minimale Bun 1.3.14, sans interface ni profil Agentopia, reproduit le diagnostic :

```powershell
bun --tsconfig-override .\tui\tsconfig.json -e "console.log('sonde')"
```

Les chemins absolus, relatifs et écrits avec des slashs donnent le même résultat. Retirer cette option supprime le diagnostic dans ces essais. Le problème est également signalé dans le [suivi amont Bun](https://github.com/oven-sh/bun/issues/25730).

## Changement

Le lanceur et le contrôle d’installation utilisent une seule fonction de préparation du processus. Bun démarre dans le dossier `tui/` d’Agentopia pour charger sa configuration JSX. Un court fichier d’amorçage restaure ensuite le dossier du projet avant d’importer les modules de l’application. L’option qui déclenche le défaut n’est plus utilisée. Les options de lancement sont décrites dans la [documentation du runtime Bun](https://bun.com/docs/runtime).

Le dossier du projet appelant et ses arguments restent transmis sans modification. Le réglage temporaire du dossier est retiré de l’environnement avant les imports applicatifs. Le runtime demeure Bun 1.3.14 ; il ne s’agit pas d’une mise à niveau de dépendance ni d’un filtrage des erreurs. Les sorties du lancement normal restent visibles. Le contrôle d’installation refuse maintenant le diagnostic interne même lorsque le processus termine avec le code 0.

## Vérifications

`test-demarrage.mjs` vérifie le rendu, les erreurs contrôlées et la reprise dans les modes production et développement, depuis des dossiers contenant trois configurations TypeScript différentes : source JSX externe, JSX classique, et alias externes. Deux passages supplémentaires couvrent le cache de transpilation local au test, à froid puis réutilisé. Une sonde vérifie le dossier courant et les arguments contenant espaces, accents et caractères spéciaux.

Les contrôles vérifient explicitement l’absence du diagnostic à la fermeture. Le précontrôle est aussi testé avec deux faux lancements retournant 0 : diagnostic interne présent, puis rendu jamais validé. Les deux doivent être refusés. Ces essais sont inclus dans `npm run test:ci`. Le paquet Windows passe ensuite les essais d’installation, de réparation, de retour arrière et de téléchargement. Les preuves de publication et du lancement installé sont conservées sur [l’issue #19](https://github.com/SamChampagne/Agentopia/issues/19) et sa PR.

La signature d’éditeur Windows reste une tâche distincte, suivie dans [#5](https://github.com/SamChampagne/Agentopia/issues/5).

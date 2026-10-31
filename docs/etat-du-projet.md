# État d'Agentopia

Version **1.4.0-beta.18**, 31 octobre 2026 : [#12 — comptes GitHub locaux](https://github.com/SamChampagne/Agentopia/issues/12), sur la base main `325f45c` qui inclut le choix d’agent de la bêta 17 et le suivi GitHub v2. Le choix GitHub est propre à Agentopia ; voir [le périmètre et les limites](comptes-github.md). Validation locale : `test:ci` complet réussi (265 tests Node, démarrage, 2 parcours Ink et 14 parcours OpenTUI), 17 contrôles du standard/suivi et vérification en lecture seule des deux comptes locaux, sans changement du compte global. Les contrôles distants et la distribution sont suivis sur l’issue et sa PR.

Historique du ménage du 31 octobre 2026 : la [PR #2](https://github.com/SamChampagne/Agentopia/pull/2) a intégré la bêta 16 (`e9f856d`) dans main `7dc0c74655be`. Ses contrôles Windows ont réussi.

## Structure

- `src/` : cœur TypeScript, sessions, fournisseurs et moteur d'équipes.
- `tui/` : interface OpenTUI/Bun; `outils/` : préparation et distribution.
- `docs/` : guides et rapports datés; les scripts de tests existants restent à la racine.

## Validation

La CI produit existante `.github/workflows/validation.yml` utilise Node 24.22.1 et Bun 1.3.14. Depuis un clone isolé : `npm ci --no-audit --no-fund`, `bun install --frozen-lockfile` dans `tui/`, puis `npm run test:ci` à la racine. Les tags de bêta ajoutent construction, installation, mise à jour, réparation et retour de version.

Le ménage documentaire n'exécute pas une session modèle réelle, SSH/SFTP ou un installateur sur le profil personnel. Le contrôle du standard ne remplace pas cette CI Windows.

## Suivi

- [#4 — démarrage Windows et intégration de la PR #2](https://github.com/SamChampagne/Agentopia/issues/4), P1.
- [#5 — signature et distribution Windows](https://github.com/SamChampagne/Agentopia/issues/5), P2.
- [#3 — documentation et standard](https://github.com/SamChampagne/Agentopia/issues/3).

Les branches `opentui` et `codex/sessions-multi-agents` sont intégrées à la base observée. La branche de la PR #2, encore active localement lors du relevé initial, est conservée. Le manifeste de nettoyage garde la base observée avant cette fusion.

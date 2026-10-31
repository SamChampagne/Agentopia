# État d'Agentopia

Relevé actualisé le 31 octobre 2026 : la [PR #2](https://github.com/SamChampagne/Agentopia/pull/2) a été fusionnée pendant le ménage. Main `7dc0c74655be` intègre désormais la bêta 16 (`e9f856d`), également publiée. Ses contrôles Windows ont réussi. La branche documentaire a été synchronisée avec ce nouveau main.

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

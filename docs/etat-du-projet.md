# État d'Agentopia

Relevé du 31 octobre 2026, avant l'intégration du standard : main `63b08986fc04`, bêta 13. La bêta 16 (`e9f856d`) est publiée séparément et la [PR #2](https://github.com/SamChampagne/Agentopia/pull/2) reste ouverte à cette date. Ses contrôles Windows ont réussi. Une publication de tag ne signifie pas que main a intégré la correction.

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

Les branches `opentui` et `codex/sessions-multi-agents` sont intégrées à la base observée. La branche de la PR #2 est conservée.

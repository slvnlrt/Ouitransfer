# Rapport d'Audit #6 : Qualite de Code & Dette Technique

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Scope** : TypeScript, linting, tests, patterns, complexite, duplication, documentation

---

## Resume Executif

**Score global : 4.5/10.** Le projet presente un paradoxe : `strict: true` est active dans tous les tsconfig, mais `@typescript-eslint/no-explicit-any` est desactive, resultant en **470+ occurrences de `any`**. L'absence totale de tests (0 fichier sur 508 sources) est le deficit le plus critique. Le code est neanmoins consistant dans son nommage, bien documente par JSDoc (204 blocs), et le pre-push hook assure un minimum de qualite.

---

## 1. Configuration TypeScript

| Setting | web | server | docs |
|---------|-----|--------|------|
| `strict` | true | true | true |
| `skipLibCheck` | true | true | true |
| `target` | ES2017 | ES2022 | ESNext |
| `moduleResolution` | bundler | node16 | bundler |
| `forceConsistentCasingInFileNames` | absent | absent | true |

**Paradoxe** : `strict: true` est correctement active partout, mais les configs ESLint **desactivent** `@typescript-eslint/no-explicit-any` dans TOUTES les apps, annulant une grande partie du benefice du mode strict.

---

## 2. Linting & Formatting

### ESLint

Flat config (`.mjs`) dans les 3 apps. Regles critiques desactivees :

| Regle | Statut | Impact |
|-------|--------|--------|
| `@typescript-eslint/no-explicit-any` | **off** | Permet `any` partout |
| `@typescript-eslint/explicit-function-return-type` | **off** | Pas de types retour explicites |
| `@typescript-eslint/explicit-module-boundary-types` | **off** | Pas de types aux frontieres de modules |
| `@typescript-eslint/no-var-requires` | **off** | Autorise `require()` |
| `camelcase` | **off** | Pas d'enforcement nommage |

### Prettier

Configuration consistante (printWidth: 120, double quotes, 2-space tabs, es5 trailing commas). Tri des imports via `@ianvs/prettier-plugin-sort-imports`.

### Suppressions dans le code

- 8 `eslint-disable-next-line` -- tous `react-hooks/exhaustive-deps` (tableaux de dependances incorrects)
- 1 `@ts-expect-error` (`apps/web/src/app/api/(proxy)/files/upload/route.ts:45`)

---

## 3. Tests

| Metrique | Valeur |
|----------|--------|
| Fichiers de test | **0** |
| Config test runner | **Aucune** |
| Dependances de test | **Aucune** |
| Fichiers source | 508 |
| **Ratio test/source** | **0:508 (0%)** |

**[CRITIQUE] ZERO tests dans l'ensemble du codebase.** Pas de tests unitaires, pas de tests d'integration, pas de tests E2E. Aucun framework de test configure. Aucune librairie de test installee. C'est le deficit de qualite le plus critique.

---

## 4. Utilisation de `any`

### Ampleur : 470+ occurrences

| Fichier | Count | Notes |
|---------|-------|-------|
| `shares-table.tsx` | 17+ | Toutes les props typees `any` |
| `useUppyUpload.ts` | 15+ | Callbacks Uppy tous `any` |
| `share-actions-modals.tsx` | 12+ | Etat et callbacks tous `any` |
| `use-enhanced-file-manager.ts` | 8+ | Pattern `"__DELETE__" as any` |
| `two-factor/controller.ts` | 14+ | `(request as any).user` repete |
| `storage.config.ts` | 3 | `(global as any)` |

### Patterns recurrents

- **`(request as any).user?.userId`** : utilise 15+ fois dans les controllers serveur. Le typage de la decoration Fastify request n'est pas utilise.
- **Props interfaces en `any` wall** : `shares: any[]`, `onDelete: (share: any) => void`
- **`"__DELETE__" as any`** : valeur sentinelle fragile pour les suppressions optimistes

---

## 5. Statements Console

**334 occurrences** `console.*` dans le codebase.

- `apps/server/src/scripts/reset-password.ts` : ~50 (acceptable, outil CLI)
- `apps/web/src/hooks/` : 30+ `console.error`
- `apps/server/src/server.ts` : logs de demarrage

La plupart sont des `console.error` pour la gestion d'erreurs. Le serveur utilise `console.log` au lieu du logger integre de Fastify (configure a `warn` mais bypasse).

---

## 6. Gestion d'Erreurs

- **394 blocs `try`** identifies
- Pattern general : `catch (error: any)` avec `console.error` et retour d'erreur generique
- **2 catch vides** (erreurs d'auth silencieuses) : `file/controller.ts:253` et `:359`
- Erreurs typees `any` partout au lieu de `unknown`
- Pas de middleware centralise de gestion d'erreurs cote Fastify
- Frontend : toasts mais pas assez de contexte loggue

---

## 7. Duplication de Code

| Pattern | Impact | Localisation |
|---------|--------|-------------|
| `(request as any).user?.userId` | 15+ emplacements | Tous les controllers serveur |
| Routes proxy boilerplate | 100+ fichiers | `apps/web/src/app/api/(proxy)/` |
| Logic selection fichier/dossier recursive | 2 implementations | `share-item-modal.tsx`, `share-multiple-items-modal.tsx` |
| `eslint-disable react-hooks/exhaustive-deps` | 8 fichiers | Hooks divers |
| Pattern d'acces storage (branching internal/external) | Multiple fichiers | Serveur |

---

## 8. Hotspots de Complexite

**Top 10 fichiers les plus longs** :

| Lignes | Fichier | Probleme |
|--------|---------|----------|
| 972 | `components/tables/files-table.tsx` | Composant table monolithique |
| 919 | `modules/reverse-share/service.ts` | Service geant |
| 918 | `reverse-shares/components/received-files-modal.tsx` | Modal massive |
| 917 | `components/tables/files-grid.tsx` | Vue monolithique |
| 771 | `modules/reverse-share/routes.ts` | Definitions de routes |
| 770 | `modules/file/controller.ts` | God controller |
| 746 | `modules/auth-providers/service.ts` | Complexite OIDC |
| 724 | `reverse-shares/components/edit-reverse-share-modal.tsx` | Modal |
| 682 | `components/modals/share-details-modal.tsx` | Modal |
| 654 | `modules/reverse-share/controller.ts` | Controller |

**15 fichiers depassent 500 lignes.** Le domaine reverse-share est la zone la plus complexe du codebase.

---

## 9. Documentation

**204 commentaires JSDoc (`/**`)** identifies.

| Zone | Couverture |
|------|-----------|
| Server services | Bonne (two-factor, storage, directories, config) |
| Server DTOs | Bonne |
| Web `http/endpoints/` | Excellente (layer client API) |
| Web utilitaires | Bonne (mime-types, download-url-cache, proxy-utils) |
| Commentaires inline | Qualite elevee, expliquent le "pourquoi" |
| README src/ | Absent dans web et server |

Commentaires en francais occasionnellement (`// TODO: remplacer par des screenshots`).

---

## 10. Conventions de Nommage

| Convention | Respect |
|-----------|---------|
| Fichiers React : kebab-case.tsx | Consistant |
| Hooks : use-kebab-case.ts | Consistant (sauf `useUppyUpload.ts` en camelCase) |
| Modules serveur : kebab-case/ | Consistant |
| Composants React : PascalCase | Consistant |
| Fonctions : camelCase | Consistant |

**Typo** : `unahthenticated-only-paths.ts` -- devrait etre `unauthenticated-only-paths.ts`.

---

## 11. Code Mort & Exports Inutilises

- `apps/web/src/types/layout.ts` -- fichier de 4 lignes avec une interface `Config`, utilite incertaine
- `apps/web/src/lib/i18n-mock.ts` -- fichier "mock" sans infrastructure de test
- `apps/web/src/components/ui/` -- ignore par ESLint (auto-genere shadcn/ui)
- `apps/docs/src/components/magicui/` -- ignore par ESLint, 6 composants d'animation (possiblement copy-paste externe)

---

## 12. Tableau de Scoring

| Domaine | Score | Commentaire |
|---------|-------|-------------|
| Strictness TypeScript | 3/10 | strict=true mais no-explicit-any=off l'annule |
| Tests | 0/10 | Zero tests |
| Linting/Formatting | 7/10 | Bon outillage, regles trop permissives |
| Documentation | 6/10 | JSDoc present aux endroits cles |
| Architecture | 6/10 | Modules propres, mais couche proxy bloated |
| Error handling | 4/10 | try/catch partout mais avec `any`, 2 catch muets |
| Type safety | 3/10 | 470+ `any`, pas de types partages |
| Securite du code | 3/10 | Body limit 1PB, proto pollution desactivee |
| Duplication | 4/10 | Patterns repetes non abstraits |
| Consistance nommage | 8/10 | Tres consistant sauf 1 typo, 1 hook camelCase |
| **GLOBAL** | **4.5/10** | |

---

## 13. Recommandations Prioritaires

1. **Installer un framework de test** (Vitest) et commencer par les services/controllers critiques du serveur.
2. **Activer `no-explicit-any`** progressivement -- creer des interfaces propres pour Share, File, Folder partages entre frontend et backend.
3. **Typer la request Fastify** -- eliminer `(request as any).user` en decorant proprement l'interface Fastify request (le fichier `types/fastify.d.ts` existe mais n'est pas utilise partout).
4. **Consolider la couche proxy** -- 100+ routes boilerplate devraient etre un seul middleware avec mapping de routes.
5. **Remplacer `console.*`** par le logger Fastify cote serveur et un logger structure cote client.
6. **Decomposer les fichiers >500 lignes** -- commencer par `files-table.tsx` (972L) et `reverse-share/service.ts` (919L).
7. **Corriger le typo** `unahthenticated-only-paths.ts`.

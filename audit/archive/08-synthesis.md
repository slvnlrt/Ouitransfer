# Rapport d'Audit #8 : Synthese Executive & Roadmap de Reprise

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Auditeur** : Audit automatise multi-agents (7 dimensions)

---

## 1. Vue d'Ensemble

Ouitransfer est une solution self-hosted de transfert de fichiers (alternative WeTransfer). Le projet est **fonctionnellement avance** (uploads chunked, 22 langues, theming custom, OIDC multi-provider, reverse shares) mais presente des **deficits critiques en securite, qualite et infrastructure** qui le rendent non-deployable en production dans son etat actuel.

### Metriques Cles

| Metrique | Valeur |
|----------|--------|
| Lignes de code | ~55 000 |
| Fichiers TS/TSX | 508 |
| Tests | **0** |
| Endpoints API | 70+ |
| Langues i18n | 22 |
| Vulnerabilites critiques | **5 securite + 3 deps** |
| Score qualite | **4.5/10** |

---

## 2. Scores par Dimension

| Dimension | Score | Verdict |
|-----------|-------|---------|
| Architecture | 5/10 | Faux monorepo, pas de packages partages, proxy bloated |
| Backend | 4/10 | API riche mais critiques securite majeures, zero tests |
| Frontend | 5/10 | UX riche, mais zero error boundaries, zero tests, zero server-state |
| Infrastructure | 4/10 | Docker correct, mais zero CI/CD, scripts fragiles |
| Securite | **2/10** | 5 critiques exploitables, 6 hautes, application non deployable |
| Qualite code | 4.5/10 | 470+ `any`, zero tests, bon nommage/JSDoc |
| Dependances | 6/10 | Stack principal a jour, 3 packages abandonnes critiques |
| **GLOBAL** | **4.3/10** | |

---

## 3. Constats Critiques Consolides

### Securite (blocants pour le deploiement)

| # | Constat | Impact | Effort |
|---|---------|--------|--------|
| S1 | CORS ouvert a toute origine + credentials | Toute action utilisateur executable depuis un site tiers | 1h |
| S2 | Protection prototype pollution desactivee | RCE potentiel via payloads JSON craftes | 15min |
| S3 | Routes `/s3/*` sans authentification | Upload/download/suppression arbitraire de tout fichier | 2h |
| S4 | Endpoint `/embed/:id` sans auth | Telechargement de tout fichier media avec l'ID | 2h |
| S5 | Body limit 1 PB | DoS trivial | 15min |
| S6 | `exec()` shell dans StorageService | Injection commande potentielle | 1h |
| S7 | Contournement 2FA (userId client-side) | Skip etape password, brute-force TOTP | 4h |
| S8 | Zero rate limiting | Brute-force, email bombing, resource exhaustion | 4h |

### Qualite (blocants pour la maintenabilite)

| # | Constat | Impact | Effort |
|---|---------|--------|--------|
| Q1 | Zero tests (0/508 fichiers) | Tout refactoring est risque, regression invisible | Eleve (ongoing) |
| Q2 | 470+ types `any` | Type safety annulee, refactoring dangereux | Eleve (ongoing) |
| Q3 | Zero error boundaries frontend | Crash ecran blanc sur erreur | 4h |
| Q4 | Zero loading states frontend | Pages vides pendant navigation | 4h |

### Infrastructure (blocants pour les operations)

| # | Constat | Impact | Effort |
|---|---------|--------|--------|
| I1 | Zero CI/CD | Pas de tests, builds, deploiement automatises | 8h |
| I2 | Faux monorepo (pas de workspace) | Deps dupliquees, drift versions, pas d'orchestration | 4h |

### Dependances (blocants securite)

| # | Constat | Impact | Effort |
|---|---------|--------|--------|
| D1 | `crypto-js` CVE-2023-46233 | Crypto faible | 4h |
| D2 | `speakeasy` abandonne 2017 | TOTP sans patches securite depuis 9 ans | 8h |
| D3 | `react-qr-reader` beta archivee | Acces camera, code non maintenu | 4h |

---

## 4. Points Forts

L'audit n'est pas que negatif. Le projet possede des bases solides :

| Aspect | Evaluation |
|--------|-----------|
| **Fonctionnalites** | Riche -- uploads chunked (Uppy), 22 langues, theming custom, OIDC (9 providers), reverse shares |
| **Architecture modulaire serveur** | 15 feature modules coherents avec pattern MVC |
| **i18n** | Implementation exemplaire -- ICU plurals, RTL (partiel), scripts de gestion |
| **Password handling** | Solide -- bcrypt, lockout, tokens 128 bytes |
| **Prisma/SQLite** | Zero risque SQL injection, schema bien structure (17 modeles) |
| **Docker multi-stage** | Bien concu -- Alpine, non-root, smart chown caching |
| **Stack technique** | Frameworks principaux a jour (Next.js 15, React 19, Fastify 5, Tailwind 4) |
| **Nommage** | Tres consistant (kebab-case fichiers, PascalCase composants) |
| **JSDoc** | 204 blocs, bonne couverture aux points cles |

---

## 5. Roadmap de Reprise

### Phase 0 : Urgences securite (Semaine 1)

**Objectif** : Rendre l'application securisable. Aucun deploiement avant completion.

| Action | Fichier | Effort | Priorite |
|--------|---------|--------|----------|
| Reactiver protection prototype pollution | `app.ts:36-37` | 15min | P0 |
| Body limit raisonnable (50MB) | `app.ts:30`, `server.ts:58` | 15min | P0 |
| Authentifier routes `/s3/*` | `modules/s3-storage/routes.ts` | 2h | P0 |
| Authentifier `/embed/:id` | `modules/file/routes.ts:134-155` | 2h | P0 |
| Restreindre CORS aux origines connues | `app.ts:71-74` | 1h | P0 |
| Remplacer `exec()` par `execFile()` ou `fs.statfs` | `modules/storage/service.ts` | 1h | P0 |
| Installer `@fastify/rate-limit` | Global | 4h | P0 |
| Corriger flux 2FA (token challenge server-side) | `modules/auth/` | 4h | P0 |

**Total Phase 0** : ~15h

---

### Phase 1 : Fondations techniques (Semaines 2-3)

**Objectif** : Poser les bases pour un developpement sain.

| Action | Effort | Priorite |
|--------|--------|----------|
| Creer `pnpm-workspace.yaml`, unifier lockfiles | 4h | P1 |
| Installer Vitest, ecrire les premiers tests (auth, file, share services) | 16h | P1 |
| Ajouter error boundaries (`error.tsx`) sur chaque segment de route | 4h | P1 |
| Ajouter `loading.tsx` sur les segments principaux | 4h | P1 |
| Mettre en place GitHub Actions (lint + typecheck + test sur PRs) | 8h | P1 |
| Remplacer `speakeasy` par `otpauth` | 8h | P1 |
| Remplacer `crypto-js` par `crypto` natif | 4h | P1 |
| Remplacer `react-qr-reader` | 4h | P1 |
| Deplacer passwords partage des query params vers body | 3h | P1 |
| Defaulter `SECURE_SITE` a `true` | 1h | P1 |

**Total Phase 1** : ~56h

---

### Phase 2 : Amelioration qualite (Semaines 4-6)

**Objectif** : Reduire la dette technique et ameliorer la DX.

| Action | Effort | Priorite |
|--------|--------|----------|
| Integrer TanStack Query pour le server-state frontend | 16h | P2 |
| Activer `no-explicit-any` progressivement (commencer par server) | 16h | P2 |
| Creer package partage `packages/shared` (mime-types, types communs) | 8h | P2 |
| Consolider configs (tsconfig.base, ESLint partage, Prettier partage) | 4h | P2 |
| Centraliser error handling serveur (`app.setErrorHandler()`) | 4h | P2 |
| Unifier PrismaClient (singleton partout) | 2h | P2 |
| Ajouter validation contenu fichier (magic bytes) | 8h | P2 |
| Consolider librairies d'icones sur lucide-react | 8h | P2 |
| Charger Google Fonts a la demande | 4h | P2 |
| Ajouter Axios response interceptor pour 401 | 2h | P2 |

**Total Phase 2** : ~72h

---

### Phase 3 : Industrialisation (Semaines 7-10)

**Objectif** : Preparer pour un deploiement production robuste.

| Action | Effort | Priorite |
|--------|--------|----------|
| Evaluer remplacement couche proxy par reverse proxy (nginx/caddy) | 16h | P3 |
| Ajouter Turborepo pour orchestration builds | 8h | P3 |
| CI/CD complet (build Docker auto sur tags, deploiement staging) | 16h | P3 |
| Creer service account MinIO dedie | 4h | P3 |
| Fixer permissions credentials MinIO (600) | 1h | P3 |
| Ajouter checksums SHA256 sur binaires telecharges | 2h | P3 |
| Tests E2E (Playwright) sur les flux critiques | 24h | P3 |
| Implementer CSRF | 4h | P3 |
| Implementer reprise d'upload | 16h | P3 |
| Completer support RTL (fa-IR, he-IL) | 4h | P3 |

**Total Phase 3** : ~95h

---

## 6. Estimation Globale

| Phase | Duree estimee | Effort | Bloquant si absent |
|-------|--------------|--------|-------------------|
| Phase 0 : Urgences securite | 1 semaine | ~15h | **Oui** -- deploiement impossible |
| Phase 1 : Fondations | 2 semaines | ~56h | **Oui** -- developpement risque |
| Phase 2 : Qualite | 3 semaines | ~72h | Non -- mais dette croissante |
| Phase 3 : Industrialisation | 4 semaines | ~95h | Non -- mais scaling limite |
| **Total** | **~10 semaines** | **~238h** | |

---

## 7. Arbre de Decision

```
Le projet est-il deployable ?
|
+-- NON. 5 vulnerabilites critiques exploitables.
    |
    +-- Phase 0 est-elle completee ?
        |
        +-- NON --> Faire Phase 0 (1 semaine)
        |
        +-- OUI --> Deploiement possible en staging
            |
            +-- Phase 1 est-elle completee ?
                |
                +-- NON --> Faire Phase 1 (2 semaines)
                |           Deploiement staging pour tests
                |
                +-- OUI --> Deploiement beta possible
                    |
                    +-- Phases 2-3 en continu
                        pour production-ready
```

---

## 8. Risques de la Reprise

| Risque | Probabilite | Impact | Mitigation |
|--------|------------|--------|-----------|
| Regression lors des corrections securite (zero tests) | Elevee | Eleve | Phase 1 : tests en priorite apres securite |
| Casser l'i18n lors des refactorings | Moyenne | Moyen | Garder les scripts de validation traductions |
| Migration speakeasy -> otpauth casse 2FA existants | Elevee | Eleve | Migration script pour convertir les secrets existants |
| Unification lockfiles cause des breaking changes | Moyenne | Moyen | Tester en staging avant merge |
| Temps sous-estime pour la couverture de tests | Elevee | Moyen | Prioriser les chemins critiques (auth, upload, share) |

---

## 9. Index des Rapports

| # | Rapport | Fichier |
|---|---------|---------|
| 1 | Architecture & Structure | `audit/01-architecture.md` |
| 2 | Backend (apps/server) | `audit/02-backend.md` |
| 3 | Frontend (apps/web) | `audit/03-frontend.md` |
| 4 | Infrastructure & DevOps | `audit/04-infrastructure.md` |
| 5 | Securite | `audit/05-security.md` |
| 6 | Qualite & Dette Technique | `audit/06-quality.md` |
| 7 | Dependances & Supply Chain | `audit/07-dependencies.md` |
| 8 | Synthese Executive & Roadmap | `audit/08-synthesis.md` (ce fichier) |

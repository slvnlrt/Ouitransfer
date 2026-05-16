# Rapport d'Audit #3 : Frontend (apps/web)

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Stack** : Next.js 15.3.6, React 19.1, Tailwind CSS 4.1, shadcn/ui, Uppy
**Scope** : Composants, UX, patterns, performance, accessibilite, i18n

---

## Resume Executif

Le frontend est **fonctionnellement riche** (22 langues, theming custom, upload drag&drop/paste/chunked) mais presente des **lacunes structurelles critiques** : zero tests, zero error boundaries, zero loading states, pas de couche de cache serveur (React Query/SWR). Les 216 types `any` avec la regle ESLint desactivee compromettent la surete du refactoring. La couche de 101 routes proxy est un fardeau de maintenance majeur.

---

## 1. Configuration Next.js

| Propriete | Valeur |
|-----------|--------|
| Next.js | **15.3.6** (derniere stable) |
| React | 19.1.0 |
| Router | **App Router** (`src/app/`) |
| Output | `standalone` (optimise Docker) |
| Package Manager | pnpm 10.6.0 |

### Structure des Routes (17 pages, 16 layouts)

| Route | Fonction |
|-------|----------|
| `(home)/` | Page d'accueil |
| `login/` | Connexion |
| `forgot-password/`, `reset-password/` | Recuperation mot de passe |
| `register-with-invite/[token]/` | Inscription par invitation |
| `auth/callback/`, `auth/oidc/callback/` | Callbacks SSO |
| `dashboard/` | Tableau de bord |
| `files/` | Gestionnaire de fichiers |
| `(shares)/shares/`, `(shares)/reverse-shares/` | Gestion des partages |
| `(shares)/s/[alias]/`, `(shares)/r/[alias]/` | Vues publiques partage/upload |
| `profile/` | Profil utilisateur |
| `customization/` | Personnalisation theme |
| `settings/` | Parametres admin |
| `users-management/` | Gestion utilisateurs admin |
| `api/(proxy)/**` | **101 routes proxy** |

### Constats Configuration

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **WARN** | `bodySizeLimit: "1pb"` dans les server actions | `next.config.ts:21` |
| **WARN** | Wildcard image remote patterns (`hostname: "**"`) -- permet toute image distante, elimine la protection SSRF de Next.js | `next.config.ts:7-16` |
| **INFO** | Pas de `middleware.ts` -- protection des routes purement cote client via `ProtectedRoute` | |

---

## 2. Architecture Composants

**Organisation hybride** : composants par type au niveau partage, par feature au niveau page.

| Categorie | Nombre | Exemples |
|-----------|--------|----------|
| shadcn/ui | 33 | button, dialog, dropdown, table, form... |
| Modals partages | 17 | share-details, upload-file, confirm-delete... |
| Tables | 4 | files-table, files-grid, shares-table |
| Layout | 4 | Navbar, loading screen, file manager layout |
| General | 5 | Composants reutilisables |
| Co-localises par page | ~96 | Composants specifiques aux features |
| **Total** | **~169** | |

**Points forts** : composants de page co-localises sous `app/**/components/` plutot que dumpes dans un dossier global.

---

## 3. Gestion d'Etat

| Pattern | Localisation | Usage |
|---------|-------------|-------|
| React Context | `contexts/auth-context.tsx` | Etat auth (user, isAuthenticated, isAdmin) |
| React Context | `contexts/share-context.tsx` | Flag SMTP |
| Zustand | `contexts/app-info-context.tsx` | Info app (nom, logo, firstAccess) |
| useState | Partout | Etat UI local |

| Severite | Constat |
|----------|---------|
| **CRITIQUE** | **Pas de librairie de server-state** (ni React Query, ni SWR, ni TanStack Query). Chaque composant qui a besoin de donnees appelle axios directement. Pas de cache, pas de deduplication de requetes, pas de stale-while-revalidate. La navigation entre pages declenche des appels API redondants. |
| **WARN** | Paradigmes mixtes : Zustand pour `useAppInfo` mais Context pour auth. Le store Zustand est paradoxalement dans le dossier `contexts/`. |
| **INFO** | Le context auth n'a pas de mecanisme de refresh token. Le check auth tourne une seule fois au mount. |

---

## 4. Communication API

### Pattern BFF Proxy (101 routes)

```
Browser --> Next.js API Routes (/api/(proxy)/**) --> Backend (API_BASE_URL)
```

| Couche | Details |
|--------|---------|
| Client HTTP | Axios, `withCredentials: true`, timeout 2min |
| API Layer | `src/http/endpoints/` -- fonctions typees par domaine |
| Proxy Layer | `src/app/api/(proxy)/` -- **101 route handlers** |

| Severite | Constat |
|----------|---------|
| **WARN** | Les 101 routes proxy sont du boilerplate repetitif. Chaque route suit le meme pattern : extraire cookies, forwarder au backend, retourner la reponse. Pas de middleware partage. |
| **WARN** | Pas d'intercepteur d'erreur centralise. L'instance axios n'a pas de response interceptor pour les 401/403. L'expiration auth est uniquement detectee au check initial. |

---

## 5. Upload de Fichiers

**Moteur** : Uppy (`@uppy/core` v4.5.2 + `@uppy/aws-s3` v4.3.2)

| Feature | Statut |
|---------|--------|
| Drag & Drop | Oui -- modal + zone globale |
| Paste clipboard | Oui -- images collables partout |
| Multi-fichier | Oui -- illimite |
| Suivi progression | Oui -- pourcentage par fichier + barre |
| Upload simple | Fichiers < 50MB -> URL PUT presignee |
| Multipart/Chunked | Fichiers >= 50MB -> S3 multipart (chunks 5MB, 3 concurrents) |
| **Reprise** | **Non** -- `listParts` retourne `[]` avec un TODO |
| Retry | Oui -- par fichier |
| Annulation | Oui -- par fichier |
| Validation pre-upload | Oui -- check via endpoint `checkFile` |

| Severite | Constat |
|----------|---------|
| **WARN** | Reprise d'upload non implementee. Commentaire en portugais : "Para simplificar, nao vamos implementar resumo de upload por enquanto." Les uploads de gros fichiers qui echouent doivent reprendre de zero. |

---

## 6. Internationalisation

**Librairie** : `next-intl` v4.3.1

**22 langues supportees** : en-US, pt-BR, fr-FR, es-ES, de-DE, it-IT, nl-NL, pl-PL, tr-TR, ru-RU, hi-IN, ar-SA, zh-CN, ja-JP, ko-KR, th-TH, vi-VN, uk-UA, fa-IR, sv-SE, id-ID, el-GR, he-IL

| Feature | Statut |
|---------|--------|
| Detection locale par cookie | Oui (`NEXT_LOCALE`) |
| Support RTL | Partiel (arabe seulement) |
| Langue par defaut configurable | Oui (`NEXT_PUBLIC_DEFAULT_LANGUAGE`) |
| Pluriels ICU MessageFormat | Oui |
| Scripts de gestion traductions | 5 scripts Python |

| Severite | Constat |
|----------|---------|
| **WARN** | RTL incomplet : seul `ar-SA` declenche le RTL (`layout.tsx:104`), mais `fa-IR` (persan) et `he-IL` (hebreu) sont aussi RTL et sont dans la liste supportee. |

---

## 7. Styling & Theming

| Propriete | Valeur |
|-----------|--------|
| Framework | Tailwind CSS **v4.1.11** |
| Systeme couleurs | OKLCH via CSS custom properties |
| Dark mode | Strategie `class` via `next-themes` |
| Animations | `tw-animate-css` + `framer-motion` |
| Theming | Couleur primaire, font, border-radius, background personnalisables par l'utilisateur |

**11 Google Fonts preloades** : Outfit (defaut), Inter, Roboto, Open Sans, Poppins, Nunito, Lato, Montserrat, Source Sans 3, Raleway, Work Sans.

| Severite | Constat |
|----------|---------|
| **WARN** | Les 11 Google Fonts sont chargees dans le root layout quelle que soit la selection utilisateur. Chaque declaration force une requete reseau. Impact significatif sur LCP et poids total de page. |

---

## 8. Accessibilite

| Pattern | Nombre | Exemples |
|---------|--------|----------|
| `aria-label` | ~15 | Select all, select file, breadcrumb |
| `aria-invalid` | ~12 | Inputs de formulaire |
| `aria-errormessage` | 4 | Champs profil |
| `role` | ~8 | status, link, separator, menuitem |
| `onKeyDown` | ~20 | Enter-to-submit, navigation clavier |

| Severite | Constat |
|----------|---------|
| **WARN** | Pas de lien skip-to-content. |
| **WARN** | Pas de gestion du focus sur changement de route. |
| **WARN** | Le drag & drop n'a pas d'alternative clavier. Le systeme custom de DnD est souris-only. |
| **INFO** | L'accessibilite des formulaires est raisonnable grace a Radix UI primitives. Pas de tests a11y formels. |

---

## 9. Performance

| Pattern | Statut |
|---------|--------|
| Code Splitting | Automatique via App Router (page-level) |
| Lazy Loading | **Aucun** -- pas de `React.lazy`, `dynamic()`, `Suspense` |
| Optimisation images | `next/image` disponible mais `@next/next/no-img-element` **desactive** dans ESLint |
| SSR/SSG | **Toutes les pages sont client-rendered** (use client ou hooks client-only) |
| `loading.tsx` | **Aucun** -- zero streaming/suspense boundaries |
| `error.tsx` | **Aucun** -- zero error boundaries |
| Dynamic imports | 1 seule instance : `zip-download.ts` |
| Font display | `swap` sur toutes les fonts (bien) |

| Severite | Constat |
|----------|---------|
| **CRITIQUE** | **Zero error boundaries.** Aucun `error.tsx` dans toute l'app. Toute erreur non geree crash l'app entiere sans UI de recuperation. |
| **CRITIQUE** | **Zero `loading.tsx`.** Pas de streaming/suspense boundaries. Les pages n'affichent rien pendant la navigation jusqu'a ce que le data fetching client soit termine. |
| **WARN** | ESLint desactive `@next/next/no-img-element` : les tags `<img>` sont utilises au lieu de `next/image`, bypassant l'optimisation automatique. |

---

## 10. TypeScript

| Propriete | Valeur |
|-----------|--------|
| Version | 5.8.3 |
| `strict` mode | **true** |
| `any` occurrences | **216** |
| `no-explicit-any` | **off** (`eslint.config.mjs:63`) |

### Hotspots `any`

| Fichier/Zone | Count | Severite |
|-------------|-------|----------|
| `shares-table.tsx` props | ~16 | Eleve -- la plupart des props sont `any` |
| `useUppyUpload.ts` | ~20 | Moyen -- types Uppy complexes |
| `share-actions-modals.tsx` | ~12 | Eleve -- toutes les props share sont `any` |
| `use-enhanced-file-manager.ts` | ~8 | Moyen -- hack `"__DELETE__" as any` |
| `error: any` catch blocks | ~10+ | Faible -- pattern courant |

---

## 11. Tests

| Categorie | Statut |
|-----------|--------|
| Tests unitaires | **Aucun** |
| Tests composants | **Aucun** |
| Tests integration | **Aucun** |
| Tests E2E | **Aucun** |
| Framework de test | **Pas installe** |

**[CRITIQUE] Zero couverture de tests.** Aucun test d'aucun type. Pas de framework de test installe.

---

## 12. Tableau Recapitulatif

| # | Severite | Constat |
|---|----------|---------|
| 1 | **CRITIQUE** | Zero tests, zero framework de test |
| 2 | **CRITIQUE** | Zero error boundaries (`error.tsx`) |
| 3 | **CRITIQUE** | Zero `loading.tsx` -- pas de streaming/suspense |
| 4 | **CRITIQUE** | Pas de librairie server-state (React Query/SWR) |
| 5 | **WARN** | 216 types `any` avec regle ESLint desactivee |
| 6 | **WARN** | RTL incomplet (fa-IR, he-IL manquants) |
| 7 | **WARN** | 11 Google Fonts chargees sur chaque page |
| 8 | **WARN** | Pas d'intercepteur Axios pour 401 |
| 9 | **WARN** | Reprise d'upload non implementee |
| 10 | **WARN** | ESLint permet `<img>` au lieu de `next/image` |
| 11 | **WARN** | 101 routes proxy boilerplate |
| 12 | **WARN** | Deux librairies d'icones (lucide + tabler) |

---

## 13. Recommandations Prioritaires

1. **Ajouter des error boundaries** (`error.tsx`) sur chaque segment de route.
2. **Ajouter des `loading.tsx`** pour les segments principaux (dashboard, files, shares).
3. **Integrer TanStack Query** pour le server-state : caching, deduplication, revalidation.
4. **Installer Vitest + React Testing Library** -- commencer par les hooks critiques et les formulaires.
5. **Activer `no-explicit-any`** progressivement -- commencer par les fichiers les plus critiques.
6. **Charger les fonts a la demande** -- uniquement la font selectionnee.
7. **Standardiser sur une seule librairie d'icones** (lucide-react).
8. **Ajouter un Axios response interceptor** pour gerer les 401 globalement.

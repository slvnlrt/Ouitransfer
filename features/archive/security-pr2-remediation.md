# Security Remediation — PR #2 (Aikido Autofix) + Dep Bumps

> **✅ DONE — 2026-05-31 (session 19)**
> Plan exécuté intégralement. PR #2 fermée. S-5 + S-6 fixés. 4 commits sur `main`.

> Plan de remédiation pour les CVEs identifiées par Aikido Security (PR #2) et les mises à jour de sécurité associées.
> **Ne PAS merger la PR #2 telle quelle** — elle est stale (2 semaines de retard) et ne gère pas le breaking change `@fastify/cors` 11.

---

## Contexte

**PR #2** (`app/aikido-autofix` → `main`) : générée automatiquement par Aikido.dev.
Couvre 6 CVEs sur 5 packages. Analyse d'impact complète réalisée le 31 mai 2026.

**État de la branche `main`** au moment de l'analyse :
- `@fastify/cors`: `^10.0.2` → résolu `10.1.0`
- `next-intl`: `^4.3.1` → résolu `4.9.1`
- `zod`: catalog `^3.25.67` → résolu `3.25.76` (v3). `zod@4.3.6` transitif (fumadocs-mdx)
- `fast-xml-parser`: `5.5.8` (transitif AWS SDK)
- `@aws-sdk/xml-builder`: `3.972.18` (transitif)
- `axios`: `1.16.0` (déjà tracké dans SECURITY.md S-5)

---

## Tâches

### T-1 — `@fastify/cors` 10 → 11 (CRITIQUE)

**CVE :** AIKIDO-2026-XXXX (cors default methods restriction)
**Impact :** v11 change les méthodes par défaut de `*` → `GET, HEAD, POST` seulement.
**Routes affectées :** 41 routes (11 PUT, 13 PATCH, 17 DELETE) dans 14 modules.

**Action :**
1. Bumper `@fastify/cors` de `^10.0.2` à `^11.0.0` dans `apps/server/package.json`
2. Ajouter `methods` explicitement dans `apps/server/src/app.ts:95-104` :

```typescript
app.register(fastifyCors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"), false);
    }
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
```

3. Vérifier les éventuels autres breaking changes du changelog v11
4. Lancer les tests serveur : `pnpm --filter @ouitransfer/server test`
5. Vérifier le build : `pnpm --filter @ouitransfer/server run type-check`

**Risque :** Faible si `methods` est spécifié (comportement identique à v10).

---

### T-2 — `next-intl` 4.9.1 → 4.9.2 (FAIBLE)

**CVE :** GHSA-4c35-wcg5-mm9h (Prototype Pollution via `experimental.messages` + `precompile: true`)
**Impact :** Aucun — notre config n'utilise ni `experimental.messages` ni `precompile`.
**Transitif :** bumpe aussi `icu-minify` de 4.9.1 → 4.12.0.

**Action :**
1. Specifier `^4.3.1` couvre déjà 4.9.2 — lockfile update uniquement
2. `pnpm update next-intl` dans `apps/web/`
3. Vérifier le build : `pnpm --filter @ouitransfer/web run type-check`

**Risque :** Nul (patch semver dans la range existante).

---

### T-3 — `fast-xml-parser` 5.5.8 → 5.7.2 (FAIBLE)

**CVE :** AIKIDO-2026-10621 (XML Parser Resource Exhaustion DoS)
**Impact :** Aucun — transitif AWS SDK, ne traite que les réponses S3, jamais d'input utilisateur.
**Aussi :** `@aws-sdk/xml-builder` 3.972.18 → 3.972.20 (même fix).

**Action (choisir une) :**
- **Option A (préférée)** : Bumper l'AWS SDK
  ```bash
  pnpm update @aws-sdk/client-s3 @aws-sdk/s3-request-presigner --filter @ouitransfer/server
  ```
  Vérifier que `fast-xml-parser` ≥ 5.7.2 dans le lockfile après update.

- **Option B (fallback)** : Ajouter un pnpm override dans `package.json` racine :
  ```json
  "pnpm": {
    "overrides": {
      "fast-uri": ">=3.1.2",
      "fast-xml-builder": ">=1.1.7",
      "fast-xml-parser": ">=5.7.2"
    }
  }
  ```

**Risque :** Nul (transitif, pas d'API directe).

---

### T-4 — `zod` v4.3.6 → v4.4.0 override (OPTIONNEL)

**CVEs :** AIKIDO-2026-10707, AIKIDO-2026-10706 (Prototype Pollution + Missing validation, zod v4)
**Impact :** Aucun — zod v4 est uniquement transitif via fumadocs-mdx. Notre code utilise zod v3.
**Déjà tracké :** SECURITY.md S-6.

**Action :**
- Ajouter un pnpm override (safe mais optionnel) :
  ```json
  "pnpm": {
    "overrides": {
      "zod@>=4.0.0 <4.4.0": "4.4.0"
    }
  }
  ```
- OU attendre le prochain bump de fumadocs qui embarquera la version corrigée.

**Recommandation :** Faire l'override pour fermer le rapport Aikido, mais ce n'est pas urgent.

---

### T-5 — `axios` 1.16.0 → 1.16.1 (HAUTE)

**CVEs :** AIKIDO-2026-10823 (Proxy Cleartext Leak, High), AIKIDO-2026-10822 (Prototype Pollution, Low)
**Déjà tracké :** SECURITY.md S-5.
**Non inclus dans la PR #2** — à faire séparément.

**Action :**
1. Bumper dans `apps/web/package.json` : `"axios": "^1.16.1"`
2. `pnpm install`
3. Vérifier : `pnpm --filter @ouitransfer/web run type-check`

**Risque :** Nul (1.16.1 reverte le support `URL` objects dans `config.url` — nous n'utilisons que des strings).

---

### T-6 — Actions GitHub : pinning par hash (BASSE)

**Déjà tracké :** SECURITY.md S-4.
**Non inclus dans ce plan** — à faire quand Dependabot/Renovate sera configuré.

---

## Ordre d'exécution recommandé

| # | Tâche | Priorité | Effort | Commit séparé |
|---|-------|----------|--------|---------------|
| 1 | T-1 `@fastify/cors` 11 | Critique | ~15 min | Oui |
| 2 | T-5 `axios` 1.16.1 | Haute | ~5 min | Oui |
| 3 | T-2 `next-intl` lockfile | Faible | ~5 min | Grouper avec T-3 |
| 4 | T-3 `fast-xml-parser` via AWS SDK | Faible | ~5 min | Grouper avec T-2 |
| 5 | T-4 `zod` v4 override | Optionnel | ~5 min | Grouper avec T-2/T-3 |

**Total estimé :** ~35 min de travail, 2-3 commits.

## Vérification finale

Après toutes les tâches :
1. `pnpm install` — vérifier pas de conflits
2. `pnpm --filter @ouitransfer/server test` — tests serveur
3. `pnpm --filter @ouitransfer/web test` — tests web
4. `pnpm --filter @ouitransfer/server run type-check` — types serveur
5. `pnpm --filter @ouitransfer/web run type-check` — types web
6. `pnpm build` — build complet
7. Mettre à jour `features/SECURITY.md` — marquer S-5 et S-6 comme fixés
8. Fermer la PR #2 avec un commentaire expliquant qu'on a fait les bumps nous-mêmes

## Disposition de la PR #2

**Ne PAS merger.** Raisons :
- Stale (2 semaines de retard, lockfile incompatible avec main)
- Ne gère pas le breaking change `@fastify/cors` 11 (méthodes par défaut)
- L'override `zod` cible toutes les versions ≤4.4.0 sans distinction v3/v4
- Pas de tests, pas de vérification d'impact

**Action :** Fermer la PR avec commentaire. Faire les bumps sur `main` directement via ce plan.

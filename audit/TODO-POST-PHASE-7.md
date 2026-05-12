# Phase 7 — Post-Review Follow-ups

**Source:** `audit/REVIEW-PHASE-7.md`
**Date:** 2026-05-12

## Important

- [x] **I-1**: Date-format behavior change (locale-aware vs hardcoded US format) — this is an intentional improvement matching existing `formatDateTime` call sites. No e2e/screenshot tests reference the old format. No action needed.
- [x] **I-2**: `motion` v12 transitively pulls `framer-motion` — by design, not a regression. Will resolve when motion v13+ drops the alias. No action needed.

## Minor

- [x] **M-3**: Wrap `fullLocale` in `encodeURIComponent()` in `language-switcher.tsx`. **Fixed inline** — commit pending.
- [x] **M-5**: Add unit tests for `formatDateTime()` with non-default locales. **Fixed inline** — 13 tests added covering en-US, fr-FR, pt-BR, ar-SA, ja-JP, locale differentiation, and compact vs table format.
- [x] **M-6**: Cookie domain scoping — no action required, matches prior behavior.
- [x] **M-7**: Pre-existing animation prop spread pattern — no action required.

## Forwarded to Phase 8

- [ ] **M-1**: Replace hardcoded `label: "Move"` in `files-table-folder-row.tsx:89` with `t("filesTable.actions.move")` and add the translation key to all 23 locale files. *Pre-existing tech debt, not introduced by Phase 7.* → Phase 8 (translations/i18n cleanup)
- [ ] **M-2**: Optionally re-evaluate `Webhook` icon for `graphql`/`proto`/`protobuf` file types — consider `Network` or `Code` for better semantic match. *Cosmetic, low priority.* → Phase 8 (polish)
- [ ] **M-4**: Run knip cleanup pass for pre-existing unused deps (`@fastify/static`, `@radix-ui/react-collapsible`, `qrcode` in web, `tw-animate-css`, `class-variance-authority` in docs, `@types/qrcode`/`tailwindcss` in web devDeps). Verify each before removal — knip false positives are common. *Not introduced by Phase 7.* → Phase 8 (dependency hygiene)

# Knip Audit — Dedicated Session

Full knip run (post-Phase 9) reveals significant dead code/deps never addressed:

- **22 unused files** (e.g., `sheet.tsx`, `file-selector.tsx`, `collapsible.tsx`, `password-input.tsx`, `files-view.tsx`, `reset-password.ts`, etc.)
- **2 unused dependencies** (`@radix-ui/react-collapsible`, `tw-animate-css` in web)
- **3 unused devDependencies** (`@axe-core/playwright`, `tailwindcss` in web, `tw-animate-css` in docs)
- **4 unlisted dependencies** (`@vitest/coverage-v8` x2, `postcss`, `@commitlint/types`)
- **128 unused exports** (functions, constants, components across server + web + docs)
- **52 unused exported types** (interfaces, type aliases)
- **2 duplicate exports** (`useFileBrowser|useFiles`, `getMimeType|getContentType`)
- **20 configuration hints** (knip.json needs refinement)

## Actions

- [ ] Triage all findings: true positives vs false positives (barrel exports, shadcn/ui components kept for future use, etc.)
- [ ] Delete genuinely dead files
- [ ] Remove unused dependencies
- [ ] Add unlisted dependencies
- [ ] Clean up unused exports (remove or mark as intentionally kept)
- [ ] Refine `knip.json` config to reduce false positives
- [ ] Consider adding knip to CI (`ci.yml`) as a non-blocking check
- [ ] Consider adding knip to pre-commit hook (lefthook)

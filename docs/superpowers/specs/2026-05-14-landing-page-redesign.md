# Landing Page Redesign

## Context

The current landing page (`apps/web/src/app/(home)/`) is an open-source promo page with a palm tree icon, "File sharing made simple and free" tagline, "Documentation" and "Star on GitHub" buttons. This is wrong for the app's actual identity: a corporate internal file transfer tool (self-hosted WeTransfer alternative). The page needs to communicate to two audiences: employees (who create shares) and external partners/clients (who receive share links).

## Design

### Layout

Split two-column layout, single viewport height (no scroll), no footer.

- **Left column (employees)**: Hero section with animated Send icon, app name, tagline, and primary CTA "Se connecter" pointing to `/login`
- **Right column (partners/clients)**: Informational card explaining they should use the link they received, with guidance if they're lost (contact their interlocutor)

On mobile (<768px), columns stack vertically: employees section on top, partners section below.

### Navbar

Simplified sticky glassmorphism header:
- Logo + app name (from `useAppInfo()`, links to `/`)
- LanguageSwitcher + ModeToggle
- **Removed**: Docs link, Sponsor link, GitHub link, mobile hamburger menu (not needed with only 2 controls)

### Icon

Replace `Palmtree` with `Send` from lucide-react. The icon gets an animated treatment:
- Continuous subtle floating animation (translateY oscillation)
- Scale-in on page load
- Slight rotation (-45deg to give a "launching" feel)
- Primary color glow/shadow effect

### Visual Effects

One notch above the login page. Keep the existing design language:
- `BackgroundLights` animated gradient orbs (already in the app)
- Glassmorphism cards (`bg-background/60 backdrop-blur-md`)
- `motion` fade-in-up for page entry (0.5s staggered)

Add:
- Animated Send icon (continuous float + glow)
- More elaborate stagger reveals (left column then right column)
- Subtle hover micro-interactions on the CTA button (scale + shadow lift)

### Copy

**Employees section (left):**
- App name (dynamic from `useAppInfo()`)
- Tagline: "Transfert de fichiers securise" (i18n key)
- Subtitle: "Envoyez et partagez vos fichiers en toute securite" (i18n key)
- CTA button: "Se connecter" (i18n key, links to `/login`)

**Partners section (right):**
- Title: "Vous avez recu un lien ?" (i18n key)
- Body: "Utilisez le lien qui vous a ete communique pour acceder a vos fichiers. Si vous ne retrouvez pas ce lien, contactez la personne qui vous l'a envoye." (i18n key)
- No CTA button on this side (the link IS their entry point)

### i18n

New translation keys under the `home` namespace, replacing all current keys:

```json
{
  "home": {
    "pageTitle": "Accueil",
    "tagline": "Transfert de fichiers securise",
    "subtitle": "Envoyez et partagez vos fichiers en toute securite.",
    "login": "Se connecter",
    "partners": {
      "title": "Vous avez recu un lien ?",
      "description": "Utilisez le lien qui vous a ete communique pour acceder a vos fichiers. Si vous ne retrouvez pas ce lien, contactez la personne qui vous l'a envoye."
    }
  }
}
```

Old keys to remove: `home.description`, `home.documentation`, `home.starOnGithub`, `home.privacyMessage`, `home.header.fileSharing`, `home.header.tagline`.

All 23 locale files must be updated. For common languages (en-US, de-DE, es-ES, pt-BR, it-IT, nl-NL, ja-JP, zh-CN, zh-TW, ko-KR, ru-RU, ar-SA), provide proper translations. For less common locales, use English as a reasonable fallback (same approach as the rest of the app).

### Behavior

- `useHome()` hook stays as-is (same redirect logic: authenticated -> dashboard, showHomePage disabled -> /login)
- `showHomePage` config toggle preserved
- No footer (page fits one viewport)

## Files

### Modified

| File | Change |
|------|--------|
| `apps/web/src/app/(home)/page.tsx` | Remove `<DefaultFooter />`, keep `<Navbar />` + `<HomeContent />` |
| `apps/web/src/app/(home)/components/home-content.tsx` | Complete rewrite: two-column layout, new copy, animated Send icon |
| `apps/web/src/app/(home)/components/navbar.tsx` | Strip to: logo + app name + LanguageSwitcher + ModeToggle |
| `apps/web/messages/*.json` (23 files) | Replace `home.*` keys with new structure |

### Deleted

| File | Reason |
|------|--------|
| `apps/web/src/app/(home)/components/home-header.tsx` | Content merged into `home-content.tsx` |
| `apps/web/src/config/site.ts` | Only consumers were navbar.tsx and home-content.tsx, both rewritten |
| `apps/web/src/app/(home)/types/index.ts` | No typed props needed in new design |

### Not Modified

| File | Reason |
|------|--------|
| `apps/web/src/app/(home)/hooks/use-home.ts` | Redirect logic unchanged |
| `apps/web/src/app/(home)/layout.tsx` | Metadata generation unchanged (still uses `home.pageTitle`) |
| `apps/web/src/components/ui/background-lights.tsx` | Shared component, used as-is |
| `apps/web/src/components/ui/default-footer.tsx` | Shared component, just no longer imported by home page |

## Constraints

- The `DefaultFooter` component is used by other pages -- don't delete it, just stop importing it in the home page.
- The `siteConfig` object in `config/site.ts` may be imported elsewhere -- check all consumers before simplifying. If nothing else imports it, it can be reduced to minimal or deleted entirely.
- The `BackgroundLights` component is shared -- don't modify it.
- The `useAppInfo()` hook provides `appName` and `appLogo` dynamically -- use these instead of hardcoding.
- All animations must use `motion/react` (the existing motion library), not CSS animations.

## Testing

- Verify TypeScript compiles: `pnpm --filter=ouitransfer-web run type-check`
- Run existing web tests: `pnpm --filter=ouitransfer-web test`
- Visual verification: `pnpm --filter=ouitransfer-web dev` and check `/` while logged out
- Check mobile responsiveness (stack columns on small screens)
- Check RTL layout (ar-SA, fa-IR, he-IL) -- columns should mirror
- Check dark mode

## Out of Scope

- No new tests required (this is a visual/presentational change with no new logic)
- No server changes
- No middleware changes
- No new dependencies

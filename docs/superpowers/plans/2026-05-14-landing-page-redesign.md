# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the open-source promo landing page with a corporate-identity split-column page targeting employees (login CTA) and partners (link guidance).

**Architecture:** Rewrite 3 components (page, content, navbar), delete 3 files (header, types, site config), update 23 locale files. No new dependencies. All animations use `motion/react`.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS 4, motion/react, lucide-react, next-intl

---

### Task 1: Delete dead files and clean up site config

This task removes files that will no longer exist after the redesign. Doing deletions first prevents import errors during the rewrite.

**Files:**
- Delete: `apps/web/src/app/(home)/components/home-header.tsx`
- Delete: `apps/web/src/app/(home)/types/index.ts`
- Delete: `apps/web/src/config/site.ts`

- [ ] **Step 1: Delete the three files**

```bash
rm apps/web/src/app/(home)/components/home-header.tsx
rm apps/web/src/app/(home)/types/index.ts
rm apps/web/src/config/site.ts
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(home)/components/home-header.tsx apps/web/src/app/(home)/types/index.ts apps/web/src/config/site.ts
git commit -m "refactor(web): delete home-header, types, and site config (landing page redesign prep)"
```

Note: The project will NOT type-check at this point because `home-content.tsx`, `navbar.tsx`, and `page.tsx` still import these files. This is expected -- Tasks 2 and 3 will fix them.

---

### Task 2: Rewrite navbar

Strip the navbar down to: logo + app name + LanguageSwitcher + ModeToggle. Remove all nav links, Sponsor button, Docs link, and mobile hamburger menu.

**Files:**
- Modify: `apps/web/src/app/(home)/components/navbar.tsx`

- [ ] **Step 1: Rewrite navbar.tsx**

Replace the entire content of `apps/web/src/app/(home)/components/navbar.tsx` with:

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/general/language-switcher";
import { ModeToggle } from "@/components/general/mode-toggle";
import { useAppInfo } from "@/contexts/app-info-context";

export function Navbar() {
  const { appName, appLogo } = useAppInfo();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/70 backdrop-blur-sm px-6">
      <div className="container flex h-16 max-w-screen-xl items-center mx-auto">
        <div className="flex flex-1 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            {appLogo && (
              <Image
                alt="App Logo"
                className="object-contain rounded"
                src={appLogo}
                width={32}
                height={32}
                unoptimized
              />
            )}
            <p className="font-bold text-2xl">{appName}</p>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ModeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(home)/components/navbar.tsx
git commit -m "refactor(web): simplify home navbar to logo + lang + theme"
```

---

### Task 3: Rewrite home content with two-column layout and animated Send icon

This is the main visual rewrite. Creates the split two-column layout with the animated Send icon, employee CTA, and partner information card.

**Files:**
- Modify: `apps/web/src/app/(home)/components/home-content.tsx`
- Modify: `apps/web/src/app/(home)/page.tsx`

- [ ] **Step 1: Rewrite home-content.tsx**

Replace the entire content of `apps/web/src/app/(home)/components/home-content.tsx` with:

```tsx
"use client";

import { Send } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAppInfo } from "@/contexts/app-info-context";
import { BackgroundLights } from "../../../components/ui/background-lights";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

function AnimatedSendIcon() {
  return (
    <motion.div
      initial={{ scale: 0, rotate: 0 }}
      animate={{ scale: 1, rotate: -45 }}
      transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
      className="relative mb-6"
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      >
        <div className="relative">
          <Send className="size-16 md:size-20 text-primary" strokeWidth={1.5} />
          <motion.div
            className="absolute inset-0 rounded-full bg-primary/20 blur-xl -z-10"
            animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

function EmployeeSection() {
  const t = useTranslations("home");
  const { appName } = useAppInfo();

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="flex flex-col items-center md:items-start text-center md:text-start"
    >
      <AnimatedSendIcon />

      <motion.h1
        variants={fadeInUp}
        transition={{ duration: 0.5 }}
        className="text-4xl lg:text-5xl font-extrabold tracking-tight"
      >
        {appName}
      </motion.h1>

      <motion.p
        variants={fadeInUp}
        transition={{ duration: 0.5 }}
        className="text-xl lg:text-2xl font-semibold text-primary mt-3"
      >
        {t("tagline")}
      </motion.p>

      <motion.p
        variants={fadeInUp}
        transition={{ duration: 0.5 }}
        className="text-lg text-muted-foreground mt-4 max-w-md"
      >
        {t("subtitle")}
      </motion.p>

      <motion.div variants={fadeInUp} transition={{ duration: 0.5 }} className="mt-8">
        <Button asChild size="lg" className="text-base font-semibold px-8 transition-all hover:scale-105 hover:shadow-lg hover:shadow-primary/25">
          <Link href="/login">{t("login")}</Link>
        </Button>
      </motion.div>
    </motion.div>
  );
}

function PartnerSection() {
  const t = useTranslations("home.partners");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className="flex items-center justify-center"
    >
      <div className="rounded-xl border border-border/50 bg-background/60 backdrop-blur-md p-8 max-w-md w-full">
        <h2 className="text-xl font-semibold mb-4">{t("title")}</h2>
        <p className="text-muted-foreground leading-relaxed">{t("description")}</p>
      </div>
    </motion.div>
  );
}

export function HomeContent() {
  return (
    <div className="container mx-auto max-w-7xl px-6 flex-grow flex items-center">
      <BackgroundLights />
      <section className="relative grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-16 w-full py-12">
        <EmployeeSection />
        <PartnerSection />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Update page.tsx**

Replace the entire content of `apps/web/src/app/(home)/page.tsx` with:

```tsx
"use client";

import { LoadingScreen } from "@/components/layout/loading-screen";
import { HomeContent } from "./components/home-content";
import { Navbar } from "./components/navbar";
import { useHome } from "./hooks/use-home";

export default function HomePage() {
  const { isLoading, shouldShowHomePage } = useHome();

  if (isLoading || !shouldShowHomePage) {
    return <LoadingScreen />;
  }

  return (
    <div className="relative flex flex-col h-screen">
      <Navbar />
      <HomeContent />
    </div>
  );
}
```

Changes from current: removed `DefaultFooter` import/usage, removed `isLoading` prop from `HomeContent`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm --filter=ouitransfer-web run type-check`
Expected: Exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(home)/components/home-content.tsx apps/web/src/app/(home)/page.tsx
git commit -m "feat(web): redesign landing page with two-column layout and animated Send icon"
```

---

### Task 4: Update i18n translations (all 23 locales)

Replace the `home` namespace in all 23 locale files with new keys matching the redesigned page.

**Files:**
- Modify: `apps/web/messages/*.json` (23 files)

**Current keys to replace** (same structure in all 23 files):
```json
"home": {
  "description": "...",
  "documentation": "...",
  "starOnGithub": "...",
  "privacyMessage": "...",
  "header": {
    "fileSharing": "...",
    "tagline": "..."
  },
  "pageTitle": "..."
}
```

**New structure:**
```json
"home": {
  "pageTitle": "...",
  "tagline": "...",
  "subtitle": "...",
  "login": "...",
  "partners": {
    "title": "...",
    "description": "..."
  }
}
```

- [ ] **Step 1: Update fr-FR.json**

Replace the `"home"` block (around line 503) with:
```json
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
```

- [ ] **Step 2: Update en-US.json**

```json
"home": {
  "pageTitle": "Home",
  "tagline": "Secure file transfer",
  "subtitle": "Send and share your files securely.",
  "login": "Sign in",
  "partners": {
    "title": "Received a link?",
    "description": "Use the link you were given to access your files. If you can't find it, contact the person who sent it to you."
  }
}
```

- [ ] **Step 3: Update de-DE.json**

```json
"home": {
  "pageTitle": "Startseite",
  "tagline": "Sicherer Dateitransfer",
  "subtitle": "Senden und teilen Sie Ihre Dateien sicher.",
  "login": "Anmelden",
  "partners": {
    "title": "Einen Link erhalten?",
    "description": "Verwenden Sie den Link, den Sie erhalten haben, um auf Ihre Dateien zuzugreifen. Wenn Sie ihn nicht finden, wenden Sie sich an die Person, die ihn Ihnen geschickt hat."
  }
}
```

- [ ] **Step 4: Update es-ES.json**

```json
"home": {
  "pageTitle": "Inicio",
  "tagline": "Transferencia segura de archivos",
  "subtitle": "Envie y comparta sus archivos de forma segura.",
  "login": "Iniciar sesion",
  "partners": {
    "title": "Has recibido un enlace?",
    "description": "Utiliza el enlace que te han proporcionado para acceder a tus archivos. Si no lo encuentras, contacta con la persona que te lo envio."
  }
}
```

- [ ] **Step 5: Update pt-BR.json**

```json
"home": {
  "pageTitle": "Inicio",
  "tagline": "Transferencia segura de arquivos",
  "subtitle": "Envie e compartilhe seus arquivos com seguranca.",
  "login": "Entrar",
  "partners": {
    "title": "Recebeu um link?",
    "description": "Use o link que voce recebeu para acessar seus arquivos. Se nao conseguir encontra-lo, entre em contato com a pessoa que o enviou."
  }
}
```

- [ ] **Step 6: Update it-IT.json**

```json
"home": {
  "pageTitle": "Home",
  "tagline": "Trasferimento file sicuro",
  "subtitle": "Invia e condividi i tuoi file in sicurezza.",
  "login": "Accedi",
  "partners": {
    "title": "Hai ricevuto un link?",
    "description": "Utilizza il link che ti e stato inviato per accedere ai tuoi file. Se non riesci a trovarlo, contatta la persona che te lo ha inviato."
  }
}
```

- [ ] **Step 7: Update nl-NL.json**

```json
"home": {
  "pageTitle": "Home",
  "tagline": "Veilige bestandsoverdracht",
  "subtitle": "Verzend en deel uw bestanden veilig.",
  "login": "Inloggen",
  "partners": {
    "title": "Een link ontvangen?",
    "description": "Gebruik de link die u hebt ontvangen om toegang te krijgen tot uw bestanden. Als u deze niet kunt vinden, neem dan contact op met de persoon die hem heeft verzonden."
  }
}
```

- [ ] **Step 8: Update ja-JP.json**

```json
"home": {
  "pageTitle": "ホーム",
  "tagline": "安全なファイル転送",
  "subtitle": "ファイルを安全に送信・共有できます。",
  "login": "ログイン",
  "partners": {
    "title": "リンクを受け取りましたか？",
    "description": "受け取ったリンクを使用してファイルにアクセスしてください。リンクが見つからない場合は、送信者にお問い合わせください。"
  }
}
```

- [ ] **Step 9: Update zh-CN.json**

```json
"home": {
  "pageTitle": "首页",
  "tagline": "安全文件传输",
  "subtitle": "安全地发送和共享您的文件。",
  "login": "登录",
  "partners": {
    "title": "收到了链接？",
    "description": "请使用您收到的链接来访问文件。如果找不到链接，请联系发送链接的人。"
  }
}
```

- [ ] **Step 10: Update remaining 14 locale files**

For the following locales, use English translations as fallback (same approach used elsewhere in the app): `ar-SA`, `el-GR`, `fa-IR`, `he-IL`, `hi-IN`, `id-ID`, `ko-KR`, `pl-PL`, `ru-RU`, `sv-SE`, `th-TH`, `tr-TR`, `uk-UA`, `vi-VN`, `zh-TW`.

For each, replace the `"home"` block with:
```json
"home": {
  "pageTitle": "<translated page title>",
  "tagline": "Secure file transfer",
  "subtitle": "Send and share your files securely.",
  "login": "Sign in",
  "partners": {
    "title": "Received a link?",
    "description": "Use the link you were given to access your files. If you can't find it, contact the person who sent it to you."
  }
}
```

For `ko-KR`, `ru-RU`, `ar-SA`, `zh-TW` provide proper native translations. For the rest, English is acceptable.

- [ ] **Step 11: Verify TypeScript compiles**

Run: `pnpm --filter=ouitransfer-web run type-check`
Expected: Exit 0, no errors.

- [ ] **Step 12: Run full web test suite**

Run: `pnpm --filter=ouitransfer-web test`
Expected: All tests pass. The locale-keys parity test (`locale-keys.test.ts`) will verify all 23 locale files have the same key structure.

- [ ] **Step 13: Commit**

```bash
git add apps/web/messages/
git commit -m "feat(web): update i18n translations for landing page redesign (23 locales)"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full type-check**

Run: `pnpm --filter=ouitransfer-web run type-check`
Expected: Exit 0.

- [ ] **Step 2: Run full test suite**

Run: `pnpm --filter=ouitransfer-web test`
Expected: All tests pass.

- [ ] **Step 3: Check for unused imports or dead references**

Run: `pnpm run knip` (from root)
Expected: No new issues related to home page files.

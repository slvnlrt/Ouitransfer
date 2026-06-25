import { defineI18n } from "fumadocs-core/i18n";
import { uiTranslations } from "fumadocs-ui/i18n";

/**
 * i18n configuration for the documentation site.
 *
 * - `en` is the default language and keeps clean URLs (`/docs/...`).
 * - `fr` is served under a locale prefix (`/fr/docs/...`).
 *
 * `hideLocale: "default-locale"` removes the prefix for the default language
 * only, so existing English URLs stay unchanged while French pages live under
 * `/fr`. Pages without a translation fall back to the default language.
 */
export const i18n = defineI18n({
  defaultLanguage: "en",
  languages: ["en", "fr"],
  hideLocale: "default-locale",
});

/**
 * Translations for the Fumadocs UI chrome (search box, theme switch, table of
 * contents, language selector, …). English values come from the library
 * defaults via `uiTranslations()`; French values are provided below.
 */
export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add("ui", {
    fr: {
      displayName: "Français",
      search: "Rechercher",
      searchNoResult: "Aucun résultat",
      searchOpen: "Ouvrir la recherche",
      searchClose: "Fermer la recherche",
      toc: "Sur cette page",
      tocNoHeadings: "Aucun titre",
      tocInline: "Table des matières",
      lastUpdate: "Dernière mise à jour le",
      chooseLanguage: "Choisir une langue",
      nextPage: "Page suivante",
      previousPage: "Page précédente",
      chooseTheme: "Thème",
      editOnGithub: "Modifier sur GitHub",
      themeToggle: "Changer de thème",
      themeLight: "Clair",
      themeDark: "Sombre",
      themeSystem: "Système",
      codeBlockCopy: "Copier",
      codeBlockCopied: "Copié",
      accordionCopyAnchor: "Copier le lien",
      headingCopyAnchor: "Copier le lien d'ancrage",
      bannerClose: "Fermer la bannière",
      menuToggle: "Basculer le menu",
      pageActionsCopyMarkdown: "Copier le Markdown",
      pageActionsOpen: "Ouvrir",
      pageActionsOpenGitHub: "Ouvrir dans GitHub",
      pageActionsViewMarkdown: "Voir en Markdown",
      pageActionsOpenScira: "Ouvrir dans Scira AI",
      pageActionsOpenChatGPT: "Ouvrir dans ChatGPT",
      pageActionsOpenClaude: "Ouvrir dans Claude",
      pageActionsOpenCursor: "Ouvrir dans Cursor",
      pageActionsOpenInLLMPrompt: "Lis {url}, je veux poser des questions à ce sujet.",
      sidebarOpen: "Ouvrir la barre latérale",
      sidebarCollapse: "Réduire la barre latérale",
      typeTableProp: "Propriété",
      typeTableType: "Type",
      typeTableDefault: "Défaut",
      typeTableParameters: "Paramètres",
      typeTableReturns: "Retourne",
      notFoundTitle: "Page introuvable",
      notFoundDescription:
        "La page que vous recherchez a peut-être été supprimée, renommée ou est temporairement indisponible.",
      notFoundLink: "Retour à l'accueil",
    },
  });

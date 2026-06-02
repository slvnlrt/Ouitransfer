import { i18n } from "@/lib/i18n";

/**
 * Translations for hand-authored marketing pages and custom components
 * (home page, beta modal, banner). MDX documentation pages are translated
 * via locale-suffixed content files and are not part of this dictionary.
 */
export interface SiteContent {
  metadata: {
    title: string;
    description: string;
  };
  banner: {
    text: string;
  };
  home: {
    hero: {
      badge: string;
      title: string;
      titleAccent: string;
      description: string;
      primaryCta: string;
      secondaryCta: string;
      note: string;
    };
    demo: {
      label: string;
      encrypted: string;
      file: string;
      size: string;
      uploading: string;
      ready: string;
      link: string;
      copy: string;
      copied: string;
      expires: string;
    };
    highlights: string[];
    features: {
      eyebrow: string;
      heading: string;
      subtitle: string;
      secure: { title: string; description: string };
      fast: { title: string; description: string };
      storage: { title: string; description: string };
      api: { title: string; description: string };
      search: { title: string; description: string };
      selfHosted: { title: string; description: string };
    };
    stack: {
      heading: string;
    };
    cta: {
      title: string;
      description: string;
      primaryCta: string;
      secondaryCta: string;
    };
    footer: {
      poweredBy: string;
    };
  };
  modal: {
    title: string;
    note: string;
    intro: string;
    feedback: string;
    gotIt: string;
    getStarted: string;
  };
}

const en: SiteContent = {
  metadata: {
    title: "OUITRANSFER | Official Website",
    description: "OUITRANSFER is a fast, simple and powerful document sharing platform.",
  },
  banner: {
    text: "is coming !",
  },
  home: {
    hero: {
      badge: "Open source · Self-hosted",
      title: "Send files,",
      titleAccent: "keep control.",
      description:
        "OUITRANSFER is a fast, self-hosted file transfer platform. Drop a file, share a secure link — on your own server, with zero tracking and no third parties.",
      primaryCta: "Read the docs",
      secondaryCta: "Star on GitHub",
      note: "No account required · No tracking · Your server, your rules",
    },
    demo: {
      label: "New transfer",
      encrypted: "Encrypted",
      file: "design-handoff.zip",
      size: "248 MB",
      uploading: "Uploading…",
      ready: "Ready to share",
      link: "oui.tr/a7Kf2x",
      copy: "Copy link",
      copied: "Copied!",
      expires: "Link expires in 7 days",
    },
    highlights: ["100% open source", "Self-hosted", "S3-compatible", "Zero tracking", "REST API"],
    features: {
      eyebrow: "Why OUITRANSFER",
      heading: "Everything you need to share files — and nothing you don't.",
      subtitle:
        "A focused, production-ready transfer platform. Secure by default, fully yours, and ready to deploy in minutes.",
      secure: {
        title: "Secure & private by design",
        description:
          "Password-protected links, expiring downloads and per-share access control. Your data stays encrypted and entirely under your roof — no third party ever sees it.",
      },
      fast: {
        title: "Built for speed",
        description: "Streaming uploads and downloads on a modern Fastify core.",
      },
      storage: {
        title: "Flexible storage",
        description: "Bundled storage or any S3-compatible backend, internal or external.",
      },
      api: {
        title: "Developer-first API",
        description: "A full REST API with webhooks to automate every transfer.",
      },
      search: {
        title: "Manage with ease",
        description: "A clean dashboard to track, search and revoke shares in a click.",
      },
      selfHosted: {
        title: "Self-hosted in minutes",
        description:
          "One Docker Compose command brings up storage, API and web. Own your infrastructure, your data and every byte that flows through it.",
      },
    },
    stack: {
      heading: "Built on a modern, battle-tested stack",
    },
    cta: {
      title: "Deploy your own transfer platform today.",
      description:
        "Free, open source and self-hosted. Be up and running in under five minutes — no account, no limits, no strings attached.",
      primaryCta: "Get started",
      secondaryCta: "View on GitHub",
    },
    footer: {
      poweredBy: "Powered by",
    },
  },
  modal: {
    title: "Welcome to v1-beta",
    note: "OUITRANSFER is currently in beta. Features may evolve and some rough edges may remain. Your feedback helps us improve.",
    intro:
      "This is the first public release of OUITRANSFER — a self-hosted, open-source file transfer platform built for speed, privacy, and simplicity.",
    feedback: "Found a bug or have a suggestion? Open an issue on",
    gotIt: "Got it",
    getStarted: "Get Started",
  },
};

const fr: SiteContent = {
  metadata: {
    title: "OUITRANSFER | Site officiel",
    description:
      "OUITRANSFER est une plateforme de partage de documents rapide, simple et puissante.",
  },
  banner: {
    text: "arrive bientôt !",
  },
  home: {
    hero: {
      badge: "Open source · Auto-hébergé",
      title: "Partagez vos fichiers,",
      titleAccent: "gardez le contrôle.",
      description:
        "OUITRANSFER est une plateforme de transfert de fichiers rapide et auto-hébergée. Déposez un fichier, partagez un lien sécurisé — sur votre propre serveur, sans tracking ni tiers.",
      primaryCta: "Lire la documentation",
      secondaryCta: "Star sur GitHub",
      note: "Aucun compte requis · Aucun tracking · Votre serveur, vos règles",
    },
    demo: {
      label: "Nouveau transfert",
      encrypted: "Chiffré",
      file: "remise-design.zip",
      size: "248 Mo",
      uploading: "Envoi en cours…",
      ready: "Prêt à partager",
      link: "oui.tr/a7Kf2x",
      copy: "Copier le lien",
      copied: "Copié !",
      expires: "Le lien expire dans 7 jours",
    },
    highlights: ["100% open source", "Auto-hébergé", "Compatible S3", "Zéro tracking", "API REST"],
    features: {
      eyebrow: "Pourquoi OUITRANSFER",
      heading: "Tout ce qu'il faut pour partager des fichiers — et rien de superflu.",
      subtitle:
        "Une plateforme de transfert ciblée et prête pour la production. Sécurisée par défaut, entièrement à vous, déployable en quelques minutes.",
      secure: {
        title: "Sécurisé et privé par conception",
        description:
          "Liens protégés par mot de passe, téléchargements expirants et contrôle d'accès par partage. Vos données restent chiffrées et entièrement chez vous — aucun tiers n'y accède.",
      },
      fast: {
        title: "Conçu pour la vitesse",
        description: "Envois et téléchargements en streaming sur un cœur Fastify moderne.",
      },
      storage: {
        title: "Stockage flexible",
        description: "Stockage intégré ou tout backend compatible S3, interne ou externe.",
      },
      api: {
        title: "API pensée pour les devs",
        description: "Une API REST complète avec webhooks pour automatiser chaque transfert.",
      },
      search: {
        title: "Gestion sans effort",
        description: "Un tableau de bord clair pour suivre, rechercher et révoquer vos partages.",
      },
      selfHosted: {
        title: "Auto-hébergé en quelques minutes",
        description:
          "Une seule commande Docker Compose lance le stockage, l'API et le web. Maîtrisez votre infrastructure, vos données et chaque octet qui y transite.",
      },
    },
    stack: {
      heading: "Bâti sur une stack moderne et éprouvée",
    },
    cta: {
      title: "Déployez votre plateforme de transfert dès aujourd'hui.",
      description:
        "Gratuit, open source et auto-hébergé. Opérationnel en moins de cinq minutes — sans compte, sans limites, sans contrepartie.",
      primaryCta: "Commencer",
      secondaryCta: "Voir sur GitHub",
    },
    footer: {
      poweredBy: "Propulsé par",
    },
  },
  modal: {
    title: "Bienvenue dans la v1-beta",
    note: "OUITRANSFER est actuellement en bêta. Les fonctionnalités peuvent évoluer et quelques imperfections peuvent subsister. Vos retours nous aident à nous améliorer.",
    intro:
      "Il s'agit de la première version publique d'OUITRANSFER — une plateforme de transfert de fichiers auto-hébergée et open source, conçue pour la rapidité, la confidentialité et la simplicité.",
    feedback: "Vous avez trouvé un bug ou une suggestion ? Ouvrez une issue sur",
    gotIt: "Compris",
    getStarted: "Commencer",
  },
};

const content: Record<string, SiteContent> = { en, fr };

/** Returns the site content for a locale, falling back to the default language. */
export function getSiteContent(lang: string): SiteContent {
  return content[lang] ?? content[i18n.defaultLanguage];
}

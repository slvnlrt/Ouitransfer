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
      tagline: string;
      description: string;
      documentation: string;
      github: string;
    };
    feedback: {
      title: string;
      words: string[];
    };
    coreFeatures: {
      uploadTitle: string;
      uploadDescription: string;
      secureTitle: string;
      secureDescription: string;
    };
    callout: {
      badge: string;
      title: string;
      subtitle: string;
    };
    keyFeatures: {
      heading: string;
      fastTitle: string;
      fastDescription: string;
      storageTitle: string;
      storageDescription: string;
      apiTitle: string;
      apiDescription: string;
      searchTitle: string;
      searchDescription: string;
      uiTitle: string;
      uiDescription: string;
      databaseTitle: string;
      databaseDescription: string;
    };
    getStarted: {
      title: string;
      description: string;
      quickSetupTitle: string;
      quickSetupDescription: string;
      fullControlTitle: string;
      fullControlDescription: string;
      productionTitle: string;
      productionDescription: string;
      readDocs: string;
      viewGithub: string;
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
      tagline: "Modern & efficient file sharing",
      description:
        "OUITRANSFER is a fast and secure platform for sharing files, built with performance and privacy in mind.",
      documentation: "Documentation",
      github: "GitHub",
    },
    feedback: {
      title: "A modern way to share files",
      words: ["efficiently", "securely", "privately", "reliably", "seamlessly"],
    },
    coreFeatures: {
      uploadTitle: "Upload & Share",
      uploadDescription:
        "Send your files quickly and safely. Share easily with anyone through secure links.",
      secureTitle: "Secure & Private",
      secureDescription: "Files are encrypted and protected. You control your data completely.",
    },
    callout: {
      badge: "Open Source & Self-Hosted",
      title: "Complete File Sharing Solution",
      subtitle: "Built with Next.js, Fastify, and SQLite",
    },
    keyFeatures: {
      heading: "Key Features",
      fastTitle: "Lightning Fast",
      fastDescription: "Optimized upload/download speeds with modern architecture",
      storageTitle: "Flexible Storage",
      storageDescription: "S3-compatible storage options (internal or external)",
      apiTitle: "Developer API",
      apiDescription: "Full REST API with webhooks for seamless integration",
      searchTitle: "Smart Search",
      searchDescription: "Find and manage your shared files effortlessly",
      uiTitle: "Modern UI",
      uiDescription: "Clean, intuitive interface built with best practices",
      databaseTitle: "SQLite Powered",
      databaseDescription: "Lightweight, reliable database for efficient data handling",
    },
    getStarted: {
      title: "Get Started Today",
      description:
        "Deploy your own secure file sharing platform in minutes. Take control of your data with our self-hosted solution.",
      quickSetupTitle: "Quick Setup",
      quickSetupDescription:
        "Docker deployment or direct installation - get running in under 5 minutes",
      fullControlTitle: "Full Control",
      fullControlDescription:
        "Self-hosted means you own your data and control every aspect of the platform",
      productionTitle: "Production Ready",
      productionDescription: "Latest technologies optimized for performance and security",
      readDocs: "Read documentation",
      viewGithub: "View on GitHub",
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
      tagline: "Partage de fichiers moderne et efficace",
      description:
        "OUITRANSFER est une plateforme rapide et sécurisée pour partager vos fichiers, conçue pour la performance et le respect de la vie privée.",
      documentation: "Documentation",
      github: "GitHub",
    },
    feedback: {
      title: "Une manière moderne de partager des fichiers",
      words: ["efficacement", "en toute sécurité", "en privé", "de façon fiable", "sans effort"],
    },
    coreFeatures: {
      uploadTitle: "Envoyer & Partager",
      uploadDescription:
        "Envoyez vos fichiers rapidement et en toute sécurité. Partagez-les facilement avec n'importe qui grâce à des liens sécurisés.",
      secureTitle: "Sécurisé & Privé",
      secureDescription:
        "Les fichiers sont chiffrés et protégés. Vous gardez le contrôle total de vos données.",
    },
    callout: {
      badge: "Open Source & Auto-hébergé",
      title: "Une solution complète de partage de fichiers",
      subtitle: "Construit avec Next.js, Fastify et SQLite",
    },
    keyFeatures: {
      heading: "Fonctionnalités clés",
      fastTitle: "Ultra rapide",
      fastDescription:
        "Vitesses d'envoi et de téléchargement optimisées grâce à une architecture moderne",
      storageTitle: "Stockage flexible",
      storageDescription: "Options de stockage compatibles S3 (interne ou externe)",
      apiTitle: "API développeur",
      apiDescription: "API REST complète avec webhooks pour une intégration transparente",
      searchTitle: "Recherche intelligente",
      searchDescription: "Retrouvez et gérez vos fichiers partagés sans effort",
      uiTitle: "Interface moderne",
      uiDescription: "Interface claire et intuitive, conçue selon les meilleures pratiques",
      databaseTitle: "Propulsé par SQLite",
      databaseDescription: "Base de données légère et fiable pour une gestion efficace des données",
    },
    getStarted: {
      title: "Commencez dès aujourd'hui",
      description:
        "Déployez votre propre plateforme de partage de fichiers sécurisée en quelques minutes. Gardez le contrôle de vos données avec notre solution auto-hébergée.",
      quickSetupTitle: "Installation rapide",
      quickSetupDescription:
        "Déploiement Docker ou installation directe — opérationnel en moins de 5 minutes",
      fullControlTitle: "Contrôle total",
      fullControlDescription:
        "L'auto-hébergement signifie que vous possédez vos données et maîtrisez chaque aspect de la plateforme",
      productionTitle: "Prêt pour la production",
      productionDescription:
        "Les dernières technologies optimisées pour la performance et la sécurité",
      readDocs: "Lire la documentation",
      viewGithub: "Voir sur GitHub",
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

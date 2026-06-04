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
    stats: {
      languages: string;
      providers: string;
      maxSize: string;
      openSource: string;
    };
    features: {
      eyebrow: string;
      heading: string;
      subtitle: string;
      shares: { title: string; description: string; tags: string[] };
      identity: { title: string; description: string };
      directory: { title: string; description: string };
      teams: { title: string; description: string };
      audit: { title: string; description: string };
      reverseShare: { title: string; description: string };
      notifications: { title: string; description: string };
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
    footer: Record<string, never>;
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
    stats: {
      languages: "Languages",
      providers: "Identity providers",
      maxSize: "Max file size",
      openSource: "Open source",
    },
    features: {
      eyebrow: "Why OUITRANSFER",
      heading: "Everything teams need to share files — under your control.",
      subtitle:
        "Single sign-on, directory sync, quotas and audit trails: the controls organizations need, in a platform you fully own and self-host.",
      shares: {
        title: "Shares you fully control",
        description:
          "Protect every link with a password, an expiry date or a view limit. Add recipients with personalized tracking links, require visitor identification, and hand out a clean URL with a QR code.",
        tags: ["Password", "Expiry date", "View limit", "QR code", "Tracking links"],
      },
      identity: {
        title: "SSO & two-factor",
        description:
          "OpenID Connect single sign-on with 7+ providers, plus built-in TOTP two-factor and brute-force lockout.",
      },
      directory: {
        title: "Active Directory sync",
        description:
          "Provision users automatically from LDAP / AD, with group mapping and scheduled synchronization.",
      },
      teams: {
        title: "Groups & quotas",
        description:
          "Organize users into groups and set per-user storage quotas that cascade from group to global.",
      },
      audit: {
        title: "Compliance-ready audit trail",
        description:
          "Every access, download and admin action is logged with visitor IP — filterable, exportable, with retention policies.",
      },
      reverseShare: {
        title: "Request files from anyone",
        description:
          "Publish a reverse-share upload form to collect files from external people — no account required on their side.",
      },
      notifications: {
        title: "Email notifications",
        description:
          "Share access, downloads, quota warnings and expiry alerts over SMTP, with per-user and per-share preferences.",
      },
      selfHosted: {
        title: "Self-hosted, with no limits",
        description:
          "One Docker Compose command brings up storage, API and web. Bundled storage or any S3-compatible backend, and no artificial file-size caps — the only limit is your own disk.",
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
    footer: {},
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
    stats: {
      languages: "Langues",
      providers: "Fournisseurs d'identité",
      maxSize: "Taille de fichier max",
      openSource: "Open source",
    },
    features: {
      eyebrow: "Pourquoi OUITRANSFER",
      heading: "Tout ce qu'il faut aux équipes pour partager — sous votre contrôle.",
      subtitle:
        "Authentification unique, synchro d'annuaire, quotas et journal d'audit : les contrôles dont les organisations ont besoin, dans une plateforme que vous possédez et hébergez.",
      shares: {
        title: "Des partages maîtrisés de bout en bout",
        description:
          "Protégez chaque lien par mot de passe, date d'expiration ou limite de vues. Ajoutez des destinataires avec liens de suivi personnalisés, exigez l'identification des visiteurs, et obtenez une URL propre avec QR code.",
        tags: ["Mot de passe", "Expiration", "Limite de vues", "QR code", "Liens de suivi"],
      },
      identity: {
        title: "SSO & double authentification",
        description:
          "Authentification unique OpenID Connect avec 7+ fournisseurs, plus 2FA TOTP intégrée et verrouillage anti-force brute.",
      },
      directory: {
        title: "Synchro Active Directory",
        description:
          "Provisionnez automatiquement les utilisateurs depuis LDAP / AD, avec mappage de groupes et synchronisation planifiée.",
      },
      teams: {
        title: "Groupes & quotas",
        description:
          "Organisez les utilisateurs en groupes et fixez des quotas de stockage par utilisateur, hérités du groupe puis du global.",
      },
      audit: {
        title: "Journal d'audit pour la conformité",
        description:
          "Chaque accès, téléchargement et action admin est journalisé avec l'IP du visiteur — filtrable, exportable, avec rétention configurable.",
      },
      reverseShare: {
        title: "Recevez des fichiers de n'importe qui",
        description:
          "Publiez un formulaire de reverse-share pour collecter des fichiers auprès de personnes externes — sans compte de leur côté.",
      },
      notifications: {
        title: "Notifications email",
        description:
          "Accès, téléchargements, alertes de quota et d'expiration par SMTP, avec préférences par utilisateur et par partage.",
      },
      selfHosted: {
        title: "Auto-hébergé, sans limites",
        description:
          "Une seule commande Docker Compose lance le stockage, l'API et le web. Stockage intégré ou tout backend compatible S3, et aucune limite artificielle de taille — la seule limite, c'est votre disque.",
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
    footer: {},
  },
  modal: {
    title: "Bienvenue sur la v1-beta",
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

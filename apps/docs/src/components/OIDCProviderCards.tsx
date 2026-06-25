"use client";

import {
  Chrome,
  Egg,
  Github,
  Key,
  Lock,
  MessageSquare,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Card, CardGrid } from "@/components/ui/card";

interface Provider {
  name: string;
  /** Localized one-line description keyed by language. */
  description: Record<string, string>;
  /** Path slug under the OIDC authentication section. */
  slug: string;
  icon: ReactNode;
}

const providers: Provider[] = [
  {
    name: "Google",
    description: {
      en: "Configure authentication using Google OAuth2 services",
      fr: "Configurez l'authentification via les services OAuth2 de Google",
    },
    slug: "google",
    icon: <Chrome className="w-4 h-4" />,
  },
  {
    name: "Discord",
    description: {
      en: "Set up Discord OAuth2 for community-based authentication",
      fr: "Mettez en place Discord OAuth2 pour une authentification communautaire",
    },
    slug: "discord",
    icon: <MessageSquare className="w-4 h-4" />,
  },
  {
    name: "GitHub",
    description: {
      en: "Enable GitHub OAuth for developer-friendly sign-in",
      fr: "Activez GitHub OAuth pour une connexion adaptée aux développeurs",
    },
    slug: "github",
    icon: <Github className="w-4 h-4" />,
  },
  {
    name: "Zitadel",
    description: {
      en: "Enterprise-grade identity and access management",
      fr: "Gestion des identités et des accès de niveau entreprise",
    },
    slug: "zitadel",
    icon: <Shield className="w-4 h-4" />,
  },
  {
    name: "Auth0",
    description: {
      en: "Flexible identity platform with extensive customization",
      fr: "Plateforme d'identité flexible avec une personnalisation poussée",
    },
    slug: "auth0",
    icon: <Lock className="w-4 h-4" />,
  },
  {
    name: "Authentik",
    description: {
      en: "Open-source identity provider with modern features",
      fr: "Fournisseur d'identité open source aux fonctionnalités modernes",
    },
    slug: "authentik",
    icon: <Key className="w-4 h-4" />,
  },
  {
    name: "Frontegg",
    description: {
      en: "User management platform for B2B applications",
      fr: "Plateforme de gestion des utilisateurs pour les applications B2B",
    },
    slug: "frontegg",
    icon: <Egg className="w-4 h-4" />,
  },
  {
    name: "Kinde Auth",
    description: {
      en: "Developer-first authentication and user management",
      fr: "Authentification et gestion des utilisateurs pensées pour les développeurs",
    },
    slug: "kinde-auth",
    icon: <Users className="w-4 h-4" />,
  },
  {
    name: "Pocket ID",
    description: {
      en: "Open-source identity provider with OIDC support",
      fr: "Fournisseur d'identité open source avec prise en charge d'OIDC",
    },
    slug: "pocket-id",
    icon: <Key className="w-4 h-4" />,
  },
  {
    name: "Other",
    description: {
      en: "Configure any other OIDC-compliant identity provider",
      fr: "Configurez tout autre fournisseur d'identité compatible OIDC",
    },
    slug: "other",
    icon: <Settings className="w-4 h-4" />,
  },
];

/** Derive the locale prefix (e.g. "/fr") from the current pathname. */
function useLocalePrefix(): string {
  const pathname = usePathname();
  const match = pathname?.match(/^\/([a-z]{2})(?:\/|$)/);
  // Only treat known non-default locales as a prefix; "docs" is not a locale.
  if (match && match[1] !== "docs") return `/${match[1]}`;
  return "";
}

export const OIDCProviderCards = () => {
  const prefix = useLocalePrefix();
  const lang = prefix.replace("/", "") || "en";

  return (
    <CardGrid>
      {providers.map((provider) => (
        <Card
          key={provider.name}
          title={provider.name}
          description={provider.description[lang] ?? provider.description.en}
          href={`${prefix}/docs/v1-beta/oidc-authentication/${provider.slug}`}
          icon={provider.icon}
        />
      ))}
    </CardGrid>
  );
};

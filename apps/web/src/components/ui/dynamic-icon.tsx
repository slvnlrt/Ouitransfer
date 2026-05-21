"use client";

import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { IconType } from "react-icons";

/**
 * react-icons packs re-export every icon as a named export plus a `default`
 * namespace object. Using `Record<string, IconType>` breaks because `default`
 * isn't an IconType. We type the raw module as `Record<string, unknown>` and
 * narrow at the lookup site.
 */
type IconPackModule = Record<string, unknown>;

// Cache loaded icons across all DynamicIcon instances to avoid re-importing
const iconCache = new Map<string, IconType | null>();

// Cache pending imports to avoid duplicate fetches for the same pack
const pendingImports = new Map<string, Promise<IconPackModule>>();

/**
 * Prefix → react-icons pack slug mapping.
 * Order matters: longer/more-specific prefixes must come before shorter ones
 * to avoid "Fa6Brand" matching "Fa" instead of "Fa6".
 */
const PREFIX_TO_PACK: [string, string][] = [
  // 3-char prefixes that shadow shorter ones
  ["Fa6", "fa6"],
  ["Hi2", "hi2"],
  ["Io5", "io5"],
  ["Lia", "lia"],
  ["Tfi", "tfi"],
  ["Vsc", "vsc"],
  // 2-char prefixes (alphabetical)
  ["Ai", "ai"],
  ["Bi", "bi"],
  ["Bs", "bs"],
  ["Cg", "cg"],
  ["Ci", "ci"],
  ["Di", "di"],
  ["Fa", "fa"],
  ["Fc", "fc"],
  ["Fi", "fi"],
  ["Gi", "gi"],
  ["Go", "go"],
  ["Gr", "gr"],
  ["Hi", "hi"],
  ["Im", "im"],
  ["Io", "io"],
  ["Lu", "lu"],
  ["Md", "md"],
  ["Pi", "pi"],
  ["Ri", "ri"],
  ["Rx", "rx"],
  ["Si", "si"],
  ["Sl", "sl"],
  ["Tb", "tb"],
  ["Ti", "ti"],
  ["Wi", "wi"],
];

function getPackSlug(iconName: string): string | null {
  for (const [prefix, slug] of PREFIX_TO_PACK) {
    if (iconName.startsWith(prefix)) {
      return slug;
    }
  }
  return null;
}

/**
 * Dynamic import for a react-icons pack. Uses an explicit switch statement
 * so bundlers (including Turbopack) can statically analyze the imports and
 * create proper chunks — template literal `import(\`react-icons/${slug}\`)`
 * is not reliably supported.
 */
function importPack(slug: string): Promise<IconPackModule> {
  // Deduplicate concurrent imports for the same pack
  const pending = pendingImports.get(slug);
  if (pending) return pending;

  let promise: Promise<IconPackModule>;

  switch (slug) {
    case "ai":
      promise = import("react-icons/ai") as Promise<IconPackModule>;
      break;
    case "bi":
      promise = import("react-icons/bi") as Promise<IconPackModule>;
      break;
    case "bs":
      promise = import("react-icons/bs") as Promise<IconPackModule>;
      break;
    case "cg":
      promise = import("react-icons/cg") as Promise<IconPackModule>;
      break;
    case "ci":
      promise = import("react-icons/ci") as Promise<IconPackModule>;
      break;
    case "di":
      promise = import("react-icons/di") as Promise<IconPackModule>;
      break;
    case "fa":
      promise = import("react-icons/fa") as Promise<IconPackModule>;
      break;
    case "fa6":
      promise = import("react-icons/fa6") as Promise<IconPackModule>;
      break;
    case "fc":
      promise = import("react-icons/fc") as Promise<IconPackModule>;
      break;
    case "fi":
      promise = import("react-icons/fi") as Promise<IconPackModule>;
      break;
    case "gi":
      promise = import("react-icons/gi") as Promise<IconPackModule>;
      break;
    case "go":
      promise = import("react-icons/go") as Promise<IconPackModule>;
      break;
    case "gr":
      promise = import("react-icons/gr") as Promise<IconPackModule>;
      break;
    case "hi":
      promise = import("react-icons/hi") as Promise<IconPackModule>;
      break;
    case "hi2":
      promise = import("react-icons/hi2") as Promise<IconPackModule>;
      break;
    case "im":
      promise = import("react-icons/im") as Promise<IconPackModule>;
      break;
    case "io":
      promise = import("react-icons/io") as Promise<IconPackModule>;
      break;
    case "io5":
      promise = import("react-icons/io5") as Promise<IconPackModule>;
      break;
    case "lia":
      promise = import("react-icons/lia") as Promise<IconPackModule>;
      break;
    case "lu":
      promise = import("react-icons/lu") as Promise<IconPackModule>;
      break;
    case "md":
      promise = import("react-icons/md") as Promise<IconPackModule>;
      break;
    case "pi":
      promise = import("react-icons/pi") as Promise<IconPackModule>;
      break;
    case "ri":
      promise = import("react-icons/ri") as Promise<IconPackModule>;
      break;
    case "rx":
      promise = import("react-icons/rx") as Promise<IconPackModule>;
      break;
    case "si":
      promise = import("react-icons/si") as Promise<IconPackModule>;
      break;
    case "sl":
      promise = import("react-icons/sl") as Promise<IconPackModule>;
      break;
    case "tb":
      promise = import("react-icons/tb") as Promise<IconPackModule>;
      break;
    case "tfi":
      promise = import("react-icons/tfi") as Promise<IconPackModule>;
      break;
    case "ti":
      promise = import("react-icons/ti") as Promise<IconPackModule>;
      break;
    case "vsc":
      promise = import("react-icons/vsc") as Promise<IconPackModule>;
      break;
    case "wi":
      promise = import("react-icons/wi") as Promise<IconPackModule>;
      break;
    default:
      promise = Promise.reject(new Error(`Unknown react-icons pack: ${slug}`));
  }

  pendingImports.set(slug, promise);
  // Clean up pending entry once resolved (success or failure)
  promise.finally(() => pendingImports.delete(slug));

  return promise;
}

interface DynamicIconProps {
  /** react-icons icon name, e.g. "FaGoogle", "SiGithub" */
  name: string;
  className?: string;
}

/**
 * Renders a single react-icons icon by name, lazily loading only the
 * required pack. Caches loaded icons so subsequent renders are instant.
 *
 * Shows an empty placeholder while loading; falls back to a lucide-react
 * Settings (gear) icon if the icon is not found.
 */
export function DynamicIcon({ name, className }: DynamicIconProps) {
  const [Icon, setIcon] = useState<IconType | null | undefined>(() => {
    // Synchronous cache hit — no loading flash
    if (iconCache.has(name)) return iconCache.get(name);
    return undefined; // undefined = not yet loaded
  });

  useEffect(() => {
    // Already resolved from cache
    if (iconCache.has(name)) {
      // Wrap in () => to prevent React from calling functions as state updaters
      setIcon(() => iconCache.get(name));
      return;
    }

    let cancelled = false;

    const slug = getPackSlug(name);
    if (!slug) {
      iconCache.set(name, null);
      if (!cancelled) setIcon(() => null);
      return;
    }

    importPack(slug)
      .then((mod) => {
        const candidate = mod[name];
        const icon: IconType | null =
          typeof candidate === "function" ? (candidate as IconType) : null;
        iconCache.set(name, icon);
        if (!cancelled) setIcon(() => icon);
      })
      .catch(() => {
        iconCache.set(name, null);
        if (!cancelled) setIcon(() => null);
      });

    return () => {
      cancelled = true;
    };
  }, [name]);

  // Still loading
  if (Icon === undefined) {
    return <span className={className} />;
  }

  // Not found — fallback gear icon
  if (Icon === null) {
    return <Settings className={className} />;
  }

  return <Icon className={className} />;
}

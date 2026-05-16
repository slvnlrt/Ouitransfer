/**
 * Shared icon loading utilities for the icon picker.
 * Reuses the same import pattern as dynamic-icon.tsx but exposes
 * a promise-based API for batch loading in the virtualized grid.
 */
import type { IconType } from "react-icons";

type IconPackModule = Record<string, unknown>;

// Shared cache across all icon-picker cells.
// Key format: "${slug}:${iconName}" — prevents collisions across packs that share icon names.
const iconCache = new Map<string, IconType | null>();
const pendingImports = new Map<string, Promise<IconPackModule>>();

/**
 * Dynamic import for a react-icons pack. Uses an explicit switch statement
 * so bundlers can statically analyze the imports and create proper chunks.
 */
function importPack(slug: string): Promise<IconPackModule> {
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
  promise.finally(() => pendingImports.delete(slug));

  return promise;
}

/**
 * Load a single icon by name and pack slug.
 * Returns the IconType component or null if not found.
 * Results are cached for subsequent calls.
 */
export async function loadIcon(slug: string, iconName: string): Promise<IconType | null> {
  const cacheKey = `${slug}:${iconName}`;

  // Cache hit
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey) ?? null;
  }

  try {
    const mod = await importPack(slug);
    const candidate = mod[iconName];
    const icon: IconType | null = typeof candidate === "function" ? (candidate as IconType) : null;
    iconCache.set(cacheKey, icon);
    return icon;
  } catch {
    iconCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Check if an icon is already in the cache.
 */
export function getCachedIcon(slug: string, iconName: string): IconType | null | undefined {
  const cacheKey = `${slug}:${iconName}`;
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey);
  }
  return undefined; // undefined = not loaded yet
}

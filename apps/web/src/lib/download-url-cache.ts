import { getDownloadUrl } from "@/http/endpoints";
import { downloadReverseShareFile } from "@/http/endpoints/reverse-shares";

interface CacheEntry {
  url: string;
  expires: number;
  createdAt: number;
}

class DownloadUrlCache {
  private cache = new Map<string, CacheEntry>();
  private lastEvictionAt = 0;

  // Presigned URLs expire in 3600s (1h)
  // We cache for 3300s (55min) with a 5min safety margin
  private readonly CACHE_DURATION = 3300 * 1000; // 55min in ms
  private readonly SAFETY_BUFFER = 60 * 1000; // 1min buffer before using cached URL
  private readonly EVICTION_INTERVAL = 60 * 1000; // Run eviction at most once per 60s

  /**
   * Generates unique cache key considering objectName and optional share password
   */
  private getCacheKey(
    objectName: string,
    options?: { headers?: { "x-share-password"?: string } },
    shareId?: string,
    intent: "preview" | "download" = "download",
  ): string {
    const password = options?.headers?.["x-share-password"] || "";
    // `intent` always carries a value (default "download"), so a preview and a download of the same
    // file never share a cache entry — a real download after a preview still hits the server and is
    // recorded as a download (B-34 / C-1 guard). The presigned URL is identical; only the server-side
    // tracking side-effect differs, which is exactly why we must not reuse one for the other.
    const parts = [objectName, password, shareId, intent].filter(Boolean);
    return parts.join("|");
  }

  /**
   * Checks if cache entry is still valid
   */
  private isValidCacheEntry(entry: CacheEntry): boolean {
    const now = Date.now();
    const timeUntilExpiration = entry.expires - now;
    return timeUntilExpiration > this.SAFETY_BUFFER;
  }

  /**
   * Removes expired entries from cache
   */
  private evictExpiredEntries(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires <= now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Runs eviction if at least EVICTION_INTERVAL has elapsed since the last run.
   */
  private maybeEvict(): void {
    const now = Date.now();
    if (now - this.lastEvictionAt >= this.EVICTION_INTERVAL) {
      this.evictExpiredEntries();
      this.lastEvictionAt = now;
    }
  }

  /**
   * Gets download URL with intelligent caching
   */
  async getCachedDownloadUrl(
    objectName: string,
    options?: { headers?: { "x-share-password"?: string } },
    shareId?: string,
    intent: "preview" | "download" = "download",
  ): Promise<string> {
    const cacheKey = this.getCacheKey(objectName, options, shareId, intent);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && this.isValidCacheEntry(cached)) {
      return cached.url;
    }

    // Extract password from x-share-password header and pass it as body param
    const password = options?.headers?.["x-share-password"];
    const response = await getDownloadUrl(objectName, password, intent);
    const url = response.data.url;
    const entry: CacheEntry = {
      url,
      expires: now + this.CACHE_DURATION,
      createdAt: now,
    };

    this.cache.set(cacheKey, entry);
    this.maybeEvict();

    return url;
  }

  /**
   * Gets download URL for reverse share with caching
   */
  async getCachedReverseShareDownloadUrl(fileId: string): Promise<string> {
    const cacheKey = `reverse:${fileId}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && this.isValidCacheEntry(cached)) {
      return cached.url;
    }

    const response = await downloadReverseShareFile(fileId);
    const url = response.data.url;
    const entry: CacheEntry = {
      url,
      expires: now + this.CACHE_DURATION,
      createdAt: now,
    };

    this.cache.set(cacheKey, entry);
    this.maybeEvict();

    return url;
  }
}

// Singleton instance
const downloadUrlCache = new DownloadUrlCache();

// Export main methods
export const getCachedDownloadUrl = downloadUrlCache.getCachedDownloadUrl.bind(downloadUrlCache);
export const getCachedReverseShareDownloadUrl =
  downloadUrlCache.getCachedReverseShareDownloadUrl.bind(downloadUrlCache);

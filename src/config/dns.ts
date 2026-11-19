import dns from "node:dns";
import { Resolver } from "node:dns/promises";

// Prioritize IPv4 over IPv6 to avoid WSL/Linux glibc dual-stack lookup timeouts
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Ignored on older Node runtimes
}

interface CacheEntry {
  ip: string;
  expiresAt: number;
}

const dnsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const fallbackResolver = new Resolver();
try {
  fallbackResolver.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch {
  // Fall back to default system servers if custom servers fail
}

const originalLookup = dns.lookup.bind(dns);

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[] | null,
  family?: number,
) => void;

function resilientLookup(
  hostname: string,
  optionsOrCallback: dns.LookupOptions | LookupCallback,
  maybeCallback?: LookupCallback,
): void {
  const options = typeof optionsOrCallback === "object" ? optionsOrCallback : {};
  const callback = (typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback)!;

  // 1. Check in-memory DNS cache
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() < cached.expiresAt) {
    if (options.all) {
      callback(null, [{ address: cached.ip, family: 4 }]);
    } else {
      callback(null, cached.ip, 4);
    }
    return;
  }

  // 2. Perform system lookup
  originalLookup(hostname, options, async (err, address, family) => {
    if (!err && address) {
      const ip = Array.isArray(address) ? address[0]?.address : address;
      if (ip && typeof ip === "string") {
        dnsCache.set(hostname, { ip, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      callback(null, address, family);
      return;
    }

    // 3. Resilient fallback on DNS failure (e.g. EAI_AGAIN in WSL)
    try {
      const ips = await fallbackResolver.resolve4(hostname);
      if (ips && ips.length > 0) {
        const ip = ips[0];
        dnsCache.set(hostname, { ip, expiresAt: Date.now() + CACHE_TTL_MS });
        if (options.all) {
          callback(null, [{ address: ip, family: 4 }]);
        } else {
          callback(null, ip, 4);
        }
        return;
      }
    } catch {
      // Fallback also failed, proceed with original error
    }

    callback(err, address, family);
  });
}

// Install resilient lookup globally
dns.lookup = resilientLookup as typeof dns.lookup;

/**
 * Pre-warms the DNS cache for a given connection URL's hostname.
 */
export async function prewarmDns(connectionUrl?: string): Promise<void> {
  if (!connectionUrl) return;
  try {
    const parsed = new URL(connectionUrl);
    const hostname = parsed.hostname;
    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      const ips = await fallbackResolver.resolve4(hostname).catch(() => []);
      if (ips && ips.length > 0) {
        dnsCache.set(hostname, { ip: ips[0], expiresAt: Date.now() + CACHE_TTL_MS });
      }
    }
  } catch {
    // Ignore invalid URL parsing
  }
}

/**
 * Outbound HTTP for tools, with SSRF protection: bots may read the public web,
 * never our internal network, cloud metadata endpoints or localhost.
 *
 * A URL someone else chose (a page a bot reads, an MCP server, a custom AI endpoint, the OAuth
 * endpoints such a server names) goes through publicFetch: only public http(s) addresses, checked
 * again at every redirect and when connecting, so a name that resolves to a public address when
 * it's checked and to a private one a moment later (DNS rebinding) gets nowhere.
 */
import dns from "node:dns";
import net from "node:net";
import { Agent } from "undici";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

/** IPv4 addresses that aren't the public internet (the special-purpose ranges of RFC 6890 and after). */
function privateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, where cloud metadata lives
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // protocol assignments, documentation
    (a === 192 && b === 88 && c === 99) || // the old 6to4 relay
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/** The 16 bytes of an IPv6 address that net.isIPv6 accepted (a dotted IPv4 tail included). */
function v6Bytes(ip: string): number[] {
  let s = ip.toLowerCase().split("%")[0];
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const [, a, b, c, d] = tail.map(Number);
    s = `${s.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const left = head ? head.split(":") : [];
  const right = rest === undefined ? [] : rest ? rest.split(":") : [];
  const groups = rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

/**
 * IPv6 addresses that aren't the public internet, including the ones that carry an IPv4 address
 * inside them (IPv4-mapped "::ffff:169.254.169.254", which URLs write as "::ffff:a9fe:a9fe", NAT64
 * and 6to4): those are judged by the IPv4 address they carry.
 */
function privateV6(ip: string): boolean {
  const b = v6Bytes(ip);
  if (b.length !== 16 || b.some((x) => !Number.isInteger(x))) return true;
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4At = (i: number) => b.slice(i, i + 4).join(".");
  if (zero(0, 15) && b[15] <= 1) return true; // :: and ::1
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return privateV4(v4At(12)); // IPv4-mapped
  if (zero(0, 12)) return privateV4(v4At(12)); // IPv4-compatible (deprecated)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return zero(4, 12) ? privateV4(v4At(12)) : true; // NAT64; its local-use /48
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(v4At(2)); // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // Teredo, which hides an IPv4 address
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  if (b[0] === 0x01 && zero(1, 8)) return true; // discard-only
  if ((b[0] & 0xfe) === 0xfc) return true; // unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) >= 0x80) return true; // link-local and the old site-local
  return b[0] === 0xff; // multicast
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip);
  if (net.isIPv6(ip)) return privateV6(ip);
  return true;
}

/**
 * The network an address is on, for limits per network: an IPv4 address itself; an IPv6 address's
 * /64, which one home or phone gets whole (so it can't dodge a limit by changing its last bits).
 */
export function networkOf(ip: string | null | undefined): string | null {
  const bare = ip?.trim();
  if (!bare) return null;
  if (net.isIPv4(bare)) return bare;
  if (!net.isIPv6(bare)) return null;
  const b = v6Bytes(bare);
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return b.slice(12).join(".");
  return `${[0, 2, 4, 6].map((i) => ((b[i] << 8) | b[i + 1]).toString(16)).join(":")}::/64`;
}

export class UnsafeUrlError extends Error {}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http(s) links can be opened.");
  if (url.username || url.password) throw new UnsafeUrlError("Links with embedded credentials aren't allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localhost")) {
    throw new UnsafeUrlError("That address is private.");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("That address is private.");
    return url;
  }
  try {
    const records = await dns.promises.lookup(host, { all: true });
    if (records.some((r) => isPrivateIp(r.address))) throw new UnsafeUrlError("That address is private.");
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    // DNS failure: let fetch fail naturally.
  }
  return url;
}

/**
 * Name lookups for publicFetch's connections: a name that resolves to any private address is
 * refused right where the connection is made, whatever it resolved to when the URL was checked.
 */
function publicLookup(hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: "EPRIVATE" }), []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

let publicAgent: Agent | null = null;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type PublicFetchInit = RequestInit & { timeoutMs?: number; maxRedirects?: number };

/**
 * Fetch a URL someone else chose. Redirects are followed here, up to `maxRedirects`, each one
 * checked like the first; credentials don't follow a redirect to another site. Throws
 * UnsafeUrlError for a private address. Times out like fetchWithTimeout (until the headers).
 */
export async function publicFetch(raw: string, init: PublicFetchInit = {}): Promise<Response> {
  const { timeoutMs = 15000, maxRedirects = 5, signal, redirect: _redirect, ...rest } = init;
  publicAgent ??= new Agent({ connect: { lookup: publicLookup } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    let url = await assertPublicUrl(raw);
    let method = (rest.method ?? "GET").toUpperCase();
    let body = rest.body;
    const headers = new Headers(rest.headers);
    for (let hop = 0; ; hop++) {
      // Node's fetch takes undici's dispatcher (not in the DOM's RequestInit).
      const res = await fetch(url, { ...rest, method, body, headers, redirect: "manual", signal: controller.signal, dispatcher: publicAgent } as RequestInit);
      const location = REDIRECTS.has(res.status) ? res.headers.get("location") : null;
      if (!location) return res;
      await res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new UnsafeUrlError("That address redirects too many times.");
      const next = await assertPublicUrl(new URL(location, url).toString());
      // As browsers do: a 303, or a 301/302 after a POST, carries on as a GET without the body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
      }
      if (next.origin !== url.origin) for (const h of ["authorization", "cookie", "proxy-authorization"]) headers.delete(h);
      url = next;
    }
  } catch (err) {
    // A connection refused for a private address reads like any other private address.
    if ((err as { cause?: { code?: string } })?.cause?.code === "EPRIVATE") throw new UnsafeUrlError("That address is private.");
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchWithTimeout(input: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15000, signal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export const USER_AGENT = "Build-a-bot/0.1 (+https://build-a-bot.site; an AI assistant acting for its owner)";

/** Very small HTML → text for reading pages when no extractor is configured. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return { title: decodeEntities(title), text };
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

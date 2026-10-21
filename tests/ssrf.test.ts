/**
 * Addresses someone else chose (a page a bot reads, an MCP server, a custom AI endpoint, the OAuth
 * endpoints such a server names) never reach our own network: not in any spelling of a private
 * address, not through a redirect, and not through a name that resolves somewhere else by the time
 * we connect (DNS rebinding).
 */
import http from "node:http";
import dns from "node:dns";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicUrl, isPrivateIp, networkOf, publicFetch, UnsafeUrlError } from "@/lib/tools/net";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Names resolve to a public address when the URL is checked (dns.promises.lookup). */
function publicDns() {
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.215.14", family: 4 }] as never);
}

describe("which addresses are private", () => {
  it("knows every IPv4 range that isn't the public internet", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.215.14", "172.32.0.1", "100.128.0.1"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("sees the IPv4 address inside an IPv6 one, however it's written", () => {
    const privateV6 = [
      "::1",
      "::",
      "::ffff:169.254.169.254",
      "::ffff:a9fe:a9fe", // how a URL writes ::ffff:169.254.169.254
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::7f00:1", // IPv4-compatible
      "64:ff9b::a9fe:a9fe", // NAT64
      "64:ff9b:1::1", // local-use NAT64
      "2002:a9fe:a9fe::1", // 6to4
      "2001:0:4136:e378::1", // Teredo
      "2001:db8::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
    ];
    for (const ip of privateV6) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("refuses private URLs in every spelling a URL allows", async () => {
    publicDns();
    for (const url of [
      "http://[::ffff:169.254.169.254]/latest/meta-data",
      "http://[::ffff:127.0.0.1]:9001/",
      "http://[64:ff9b::169.254.169.254]/",
      "http://[2002:a9fe:a9fe::]/",
      "http://2130706433/", // 127.0.0.1 as one number
      "http://0x7f.1/",
      "http://0177.0.0.1/",
      "http://0.0.0.0/",
      "http://foo.localhost/",
      "http://metadata.google.internal/",
    ]) {
      await expect(assertPublicUrl(url), url).rejects.toThrow(UnsafeUrlError);
    }
    await expect(assertPublicUrl("https://example.com/a")).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("http://[2606:4700:4700::1111]/")).resolves.toBeInstanceOf(URL);
  });
});

describe("a network, for limits per network", () => {
  it("is an IPv4 address itself, or an IPv6 address's /64", () => {
    expect(networkOf("203.0.113.9")).toBe("203.0.113.9");
    expect(networkOf("2001:db8:aaaa:bbbb:1:2:3:4")).toBe("2001:db8:aaaa:bbbb::/64");
    expect(networkOf("2001:db8:aaaa:bbbb::99")).toBe("2001:db8:aaaa:bbbb::/64");
    expect(networkOf("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(networkOf("not an address")).toBeNull();
    expect(networkOf(null)).toBeNull();
  });
});

type Seen = { url: string; method: string; headers: Headers; body: unknown; dispatcher: unknown };

/** A fake network: each answer in turn, recording what was asked. */
function fakeNet(answers: Response[]): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit & { dispatcher?: unknown }) => {
      seen.push({ url: String(input), method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body, dispatcher: init.dispatcher });
      const next = answers.shift();
      if (!next) throw new Error(`unexpected request to ${input}`);
      return next;
    }),
  );
  return seen;
}

const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } });

describe("publicFetch", () => {
  it("checks every redirect: a public page can't send us to the metadata service", async () => {
    publicDns();
    const seen = fakeNet([redirect(302, "http://169.254.169.254/latest/meta-data/iam")]);
    await expect(publicFetch("https://example.com/innocent")).rejects.toThrow(UnsafeUrlError);
    expect(seen).toHaveLength(1);
    // Redirects are followed here, never by fetch, and connections go through the guarded dispatcher.
    expect(seen[0].dispatcher).toBeTruthy();
  });

  it("follows public redirects the way browsers do, without taking credentials to another site", async () => {
    publicDns();
    const seen = fakeNet([redirect(307, "https://other.example/next"), redirect(303, "/done"), new Response("ok")]);
    const res = await publicFetch("https://example.com/start", { method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: "{}" });
    expect(await res.text()).toBe("ok");
    expect(seen.map((s) => [s.method, s.url])).toEqual([
      ["POST", "https://example.com/start"],
      ["POST", "https://other.example/next"], // a 307 keeps the method and body
      ["GET", "https://other.example/done"], // a 303 carries on as a GET
    ]);
    expect(seen[0].headers.get("authorization")).toBe("Bearer secret");
    expect(seen[1].headers.get("authorization")).toBeNull();
    expect(seen[1].body).toBe("{}");
    expect(seen[2].body).toBeUndefined();
  });

  it("gives up after too many redirects, or at the first one when none are allowed", async () => {
    publicDns();
    fakeNet(Array.from({ length: 7 }, (_, i) => redirect(302, `https://example.com/${i}`)));
    await expect(publicFetch("https://example.com/loop")).rejects.toThrow(/redirects too many times/);
    fakeNet([redirect(302, "https://example.com/elsewhere")]);
    await expect(publicFetch("https://example.com/api", { maxRedirects: 0 })).rejects.toThrow(/redirects too many times/);
  });

  it("refuses a name that resolves to a private address by the time it connects (DNS rebinding)", async () => {
    // The page really is on this machine; the name pointed somewhere public when it was checked.
    const server = http.createServer((_req, res) => res.end("internal secrets")).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const { port } = server.address() as AddressInfo;
      publicDns();
      const real = dns.lookup;
      vi.spyOn(dns, "lookup").mockImplementation(((host: string, opts: unknown, cb: (...args: unknown[]) => void) => {
        if (host === "rebind.example") return cb(null, [{ address: "127.0.0.1", family: 4 }]);
        return (real as (...args: unknown[]) => void)(host, opts, cb);
      }) as never);
      await expect(publicFetch(`http://rebind.example:${port}/`)).rejects.toThrow(UnsafeUrlError);
    } finally {
      server.close();
    }
  });
});

describe("where publicFetch is used", () => {
  it("an MCP server at a private address can't be reached, in any spelling", async () => {
    const { listTools } = await import("@/lib/connectors/mcp/client");
    await expect(listTools({ url: "https://[::ffff:a9fe:a9fe]/mcp" } as never)).rejects.toThrow(/That address is private/);
  });

  it("an MCP server that redirects to our network is refused", async () => {
    publicDns();
    fakeNet([redirect(307, "http://10.0.0.5/mcp")]);
    const { listTools } = await import("@/lib/connectors/mcp/client");
    await expect(listTools({ url: "https://mcp.example.com/mcp" } as never)).rejects.toThrow(/That address is private/);
  });

  it("a custom AI endpoint isn't redirected anywhere, and its key check refuses private addresses", async () => {
    publicDns();
    const { validateApiKey } = await import("@/lib/agent/brain");
    expect(await validateApiKey("custom", "sk-test", "http://[::ffff:7f00:1]:8080/v1")).toEqual({ ok: false, message: "That address is private." });
    fakeNet([redirect(302, "https://elsewhere.example/v1/models")]);
    expect(await validateApiKey("custom", "sk-test", "https://llm.example.com/v1")).toEqual({ ok: false, message: "Couldn't reach the provider to check the key." });
  });
});

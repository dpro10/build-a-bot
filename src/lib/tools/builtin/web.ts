import { z } from "zod";
import { config } from "@/lib/env";
import { truncate } from "@/lib/utils";
import { defineTool, type ToolOutput, type ToolSource } from "../types";
import { assertPublicUrl, fetchWithTimeout, htmlToText, UnsafeUrlError, USER_AGENT } from "../net";

type TavilyResult = { title: string; url: string; content: string; published_date?: string };

async function tavilySearch(query: string, opts: { topic?: "general" | "news"; maxResults?: number; signal?: AbortSignal }) {
  const res = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.tavily.apiKey}` },
    body: JSON.stringify({
      query,
      topic: opts.topic ?? "general",
      search_depth: "basic",
      max_results: opts.maxResults ?? 5,
      include_answer: true,
    }),
    signal: opts.signal,
    timeoutMs: 20000,
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return (await res.json()) as { answer?: string; results: TavilyResult[] };
}

function demoResults(query: string, news = false): { answer: string; results: TavilyResult[] } {
  const q = query.trim();
  return {
    answer: `Demo mode: live search isn't connected yet, so these are placeholder results for "${q}". Add a TAVILY_API_KEY to search the real web.`,
    results: [
      {
        title: `${q} — overview`,
        url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}`,
        content: `A general overview of ${q}. (Demo result.)`,
      },
      {
        title: news ? `Latest on ${q}` : `${q}: what to know`,
        url: `https://news.google.com/search?q=${encodeURIComponent(q)}`,
        content: `Recent coverage and key points about ${q}. (Demo result.)`,
        published_date: new Date().toISOString().slice(0, 10),
      },
    ],
  };
}

function formatResults(answer: string | undefined, results: TavilyResult[]): ToolOutput {
  const sources: ToolSource[] = results.map((r) => ({ title: r.title, url: r.url }));
  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.title}${r.published_date ? ` (${r.published_date})` : ""}\n${r.url}\n${truncate(r.content ?? "", 600)}`,
  );
  return {
    ok: true,
    content: `${answer ? `Summary: ${answer}\n\n` : ""}${lines.join("\n\n")}\n\nCite sources as [n] with links when you use them.`,
    summary: `${results.length} result${results.length === 1 ? "" : "s"}`,
    sources,
  };
}

export const webSearch = defineTool({
  name: "web_search",
  title: "Search the web",
  description:
    "Search the live web for current information (news, prices, opening hours, facts that change). Returns a short summary and sources with links.",
  input: z.object({
    query: z.string().min(2).max(300).describe("What to search for, phrased like a search query"),
    max_results: z.number().int().min(1).max(8).optional().describe("How many results (default 5)"),
  }),
  connectorId: "web_search",
  capabilityId: "search",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `Search: “${a.query}”`,
  async run(args, ctx) {
    if (!config.tavily.apiKey) {
      if (!ctx.demo) return { ok: false, error: "Web search is coming soon. Answer from what you already know, and say you couldn't search the web." };
      const d = demoResults(args.query);
      return formatResults(d.answer, d.results);
    }
    const data = await tavilySearch(args.query, { maxResults: args.max_results, signal: ctx.signal });
    return formatResults(data.answer, data.results ?? []);
  },
});

export const newsHeadlines = defineTool({
  name: "news_headlines",
  title: "Check the news",
  description: "Find today's news headlines about a topic, with links.",
  input: z.object({ topic: z.string().min(2).max(200).describe("Topic, person, company or place") }),
  connectorId: "news",
  capabilityId: "headlines",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `News: “${a.topic}”`,
  async run(args, ctx) {
    if (!config.tavily.apiKey) {
      if (!ctx.demo) return { ok: false, error: "News is coming soon. Answer from what you already know, and say you couldn't check the news." };
      const d = demoResults(args.topic, true);
      return formatResults(d.answer, d.results);
    }
    const data = await tavilySearch(args.topic, { topic: "news", maxResults: 6, signal: ctx.signal });
    return formatResults(data.answer, data.results ?? []);
  },
});

export const readWebpage = defineTool({
  name: "read_webpage",
  title: "Read a web page",
  description: "Open a public web page and read its main text. Use for links the owner shares or sources from search.",
  input: z.object({ url: z.string().url().describe("Full http(s) URL") }),
  connectorId: "web_reader",
  capabilityId: "read_page",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `Read ${a.url}`,
  async run(args, ctx) {
    let url: URL;
    try {
      url = await assertPublicUrl(args.url);
    } catch (err) {
      return { ok: false, error: err instanceof UnsafeUrlError ? err.message : "Invalid URL" };
    }
    if (config.tavily.apiKey) {
      const res = await fetchWithTimeout("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.tavily.apiKey}` },
        body: JSON.stringify({ urls: [url.toString()] }),
        signal: ctx.signal,
        timeoutMs: 25000,
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: { url: string; raw_content?: string }[] };
        const page = data.results?.[0];
        if (page?.raw_content) {
          return {
            ok: true,
            content: `Page: ${url}\n\n${truncate(page.raw_content, 12000)}`,
            summary: "Read the page",
            sources: [{ title: url.hostname, url: url.toString() }],
          };
        }
      }
    }
    try {
      const res = await fetchWithTimeout(url.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
        redirect: "follow",
        signal: ctx.signal,
        timeoutMs: 15000,
      });
      if (!res.ok) return { ok: false, error: `The page answered ${res.status}.` };
      const type = res.headers.get("content-type") ?? "";
      const body = (await res.text()).slice(0, 2_000_000);
      const { title, text } = type.includes("html") ? htmlToText(body) : { title: url.hostname, text: body };
      return {
        ok: true,
        content: `Page: ${title || url.hostname} (${url})\n\n${truncate(text, 12000)}`,
        summary: "Read the page",
        sources: [{ title: title || url.hostname, url: url.toString() }],
      };
    } catch {
      if (ctx.demo) {
        return {
          ok: true,
          content: `Demo mode: couldn't reach ${url.hostname} from this server, so here's a placeholder. In production the bot reads the page's text here.`,
          summary: "Placeholder (demo)",
          sources: [{ title: url.hostname, url: url.toString() }],
        };
      }
      return { ok: false, error: "Couldn't open that page." };
    }
  },
});

export const wikipediaLookup = defineTool({
  name: "wikipedia_lookup",
  title: "Look it up on Wikipedia",
  description: "Get a short encyclopedia summary of a topic, person, place or concept.",
  input: z.object({ topic: z.string().min(1).max(200) }),
  connectorId: "wikipedia",
  capabilityId: "lookup",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `Wikipedia: “${a.topic}”`,
  async run(args, ctx) {
    try {
      const search = await fetchWithTimeout(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(args.topic)}`,
        { headers: { "user-agent": USER_AGENT }, signal: ctx.signal, timeoutMs: 10000 },
      );
      const sdata = (await search.json()) as { query?: { search?: { title: string }[] } };
      const title = sdata.query?.search?.[0]?.title;
      if (!title) return { ok: true, content: `No Wikipedia article found for “${args.topic}”.`, summary: "No article" };
      const page = await fetchWithTimeout(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        { headers: { "user-agent": USER_AGENT }, signal: ctx.signal, timeoutMs: 10000 },
      );
      const p = (await page.json()) as { title: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
      const url = p.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
      return { ok: true, content: `${p.title}\n${p.extract ?? ""}\n${url}`, summary: p.title, sources: [{ title: p.title, url }] };
    } catch {
      if (!ctx.demo) return { ok: false, error: "Wikipedia didn't answer." };
      return {
        ok: true,
        content: `Demo mode: Wikipedia isn't reachable from this server. In production this returns the article summary for “${args.topic}”.`,
        summary: "Placeholder (demo)",
      };
    }
  },
});

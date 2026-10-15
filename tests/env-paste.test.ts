/**
 * Keys pasted into the hosting settings as a whole .env line ("NAME=value", sometimes quoted)
 * still work: Composio's dashboard copies its key that way, and the key was rejected live.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

async function freshConfig(env: Record<string, string>) {
  Object.assign(process.env, env);
  vi.resetModules();
  return (await import("@/lib/env")).config;
}

describe("reading keys from the environment", () => {
  it("keeps just the value when the whole line was pasted", async () => {
    const config = await freshConfig({ COMPOSIO_API_KEY: "COMPOSIO_API_KEY=ak_test_123", TELEGRAM_MANAGER_BOT_TOKEN: ' TELEGRAM_MANAGER_BOT_TOKEN="123456:abc" ' });
    expect(config.composio.apiKey).toBe("ak_test_123");
    expect(config.telegram.managerToken).toBe("123456:abc");
  });

  it("drops quotes around a value and leaves ordinary values alone", async () => {
    const config = await freshConfig({ COMPOSIO_API_KEY: "'ak_quoted'", DISCORD_PUBLIC_KEY: "abc=def", EMAIL_FROM: "Build-a-bot <hello@build-a-bot.site>" });
    expect(config.composio.apiKey).toBe("ak_quoted");
    expect(config.discord.publicKey).toBe("abc=def");
    expect(config.email.from).toBe("Build-a-bot <hello@build-a-bot.site>");
  });

  it("an empty or blank value is unset", async () => {
    const config = await freshConfig({ COMPOSIO_API_KEY: "  ", TRANSCRIBE_API_KEY: "TRANSCRIBE_API_KEY=" });
    expect(config.composio.apiKey).toBeUndefined();
    expect(config.transcribe.apiKey).toBeUndefined();
  });
});

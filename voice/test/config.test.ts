import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, parseMaxCalls } from "../src/config.ts";

/** loadConfig with these settings (and the three it needs), the environment put back after. */
function configWith(settings: Record<string, string | undefined>) {
  const keys = ["APP_URL", "VOICE_SERVER_SECRET", "TOKEN_FACTORY_API_KEY", ...Object.keys(settings)];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { APP_URL: "https://build-a-bot.site", VOICE_SERVER_SECRET: "s".repeat(40), TOKEN_FACTORY_API_KEY: "k" });
  for (const [k, v] of Object.entries(settings)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return loadConfig();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("MAX_CALLS is a whole number of 1 or more; a bad one is 1, never no limit", () => {
  assert.equal(parseMaxCalls("1"), 1);
  assert.equal(parseMaxCalls(" 3 "), 3);
  for (const bad of ["0", "-1", "abc", "Infinity", "1.5", "1e3", "NaN", "", "99999999999999999999"]) assert.equal(parseMaxCalls(bad), null, bad);

  assert.equal(configWith({ MAX_CALLS: undefined }).maxCalls, 1);
  assert.deepEqual(configWith({ MAX_CALLS: undefined }).warnings, []);
  assert.equal(configWith({ MAX_CALLS: "2" }).maxCalls, 2);
  for (const bad of ["abc", "0", "Infinity"]) {
    const config = configWith({ MAX_CALLS: bad });
    assert.equal(config.maxCalls, 1, bad);
    assert.match(config.warnings.join(" "), /MAX_CALLS/);
  }
});

test("the documented settings reach the server: the talker's model and Magpie's guidance", () => {
  assert.equal(configWith({ TALKER_MODEL: "nvidia/Some-Other-Model" }).talker.model, "nvidia/Some-Other-Model");
  assert.equal(configWith({ TALKER_MODEL: undefined }).talker.model, "nvidia/Nemotron-3_5-Lightning");
  const args = (cfg: string | undefined) => {
    const speech = configWith({ TTS_CFG: cfg, SPEECH_URL: undefined, NEMO_VOICE_ARGS: undefined }).speech;
    return speech.kind === "sidecar" ? speech.args : [];
  };
  assert.ok(args("0").includes("--no-cfg"));
  assert.ok(!args(undefined).includes("--no-cfg"));
  // The talker runs without reasoning: it would slow every answer.
  assert.deepEqual(configWith({ TALKER_EXTRA_BODY: undefined }).talker.extraBody, { reasoning_effort: "none" });
});

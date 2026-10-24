import { describe, expect, it } from "vitest";
import { evaluate, containsSecret, type ActionContext } from "./engine";

const base: ActionContext = {
  trust: "trusted",
  paused: false,
  effect: "write",
  risk: "low",
  tainted: false,
  actionsToday: 0,
};

const owner = { address: "me@example.com", kind: "email", isOwner: true, isKnownContact: true };
const friend = { address: "friend@example.com", kind: "email", isOwner: false, isKnownContact: true };
const stranger = { address: "attacker@evil.test", kind: "email", isOwner: false, isKnownContact: false };

describe("policy engine", () => {
  it("STOP beats everything, even reads", () => {
    expect(evaluate({ ...base, paused: true, effect: "read" }).verdict).toBe("deny");
    expect(evaluate({ ...base, paused: true, trust: "full" }).reasons).toContain("paused");
  });

  it("allows reads at every level", () => {
    for (const trust of ["look", "ask", "trusted", "full"] as const) {
      expect(evaluate({ ...base, trust, effect: "read" }).verdict).toBe("allow");
    }
  });

  it("owner rules can turn reads off or into asks", () => {
    expect(evaluate({ ...base, effect: "read", ownerRule: "deny" }).verdict).toBe("deny");
    expect(evaluate({ ...base, effect: "read", ownerRule: "ask" }).verdict).toBe("ask");
  });

  it("look only denies every non-read", () => {
    for (const effect of ["write", "send", "delete", "spend", "admin"] as const) {
      const d = evaluate({ ...base, trust: "look", effect });
      expect(d.verdict).toBe("deny");
      expect(d.reasons).toContain("look_only");
    }
  });

  it("ask-me-first asks before any write or send", () => {
    expect(evaluate({ ...base, trust: "ask", effect: "write" }).verdict).toBe("ask");
    expect(evaluate({ ...base, trust: "ask", effect: "send", recipients: [owner] }).verdict).toBe("ask");
    expect(evaluate({ ...base, trust: "ask", effect: "delete" }).verdict).toBe("ask");
  });

  it("trusted helper does low-risk writes alone but asks for high risk, deletes and new people", () => {
    expect(evaluate({ ...base, trust: "trusted", effect: "write", risk: "medium" }).verdict).toBe("allow");
    expect(evaluate({ ...base, trust: "trusted", effect: "write", risk: "high" }).verdict).toBe("ask");
    expect(evaluate({ ...base, trust: "trusted", effect: "delete" }).verdict).toBe("ask");
    expect(evaluate({ ...base, trust: "trusted", effect: "send", risk: "medium", recipients: [friend] }).verdict).toBe(
      "allow",
    );
    const d = evaluate({ ...base, trust: "trusted", effect: "send", risk: "medium", recipients: [stranger] });
    expect(d.verdict).toBe("ask");
    expect(d.reasons).toContain("new_recipient");
  });

  it("full faith acts alone, including new recipients when the run is clean", () => {
    expect(evaluate({ ...base, trust: "full", effect: "delete", risk: "high" }).verdict).toBe("allow");
    expect(evaluate({ ...base, trust: "full", effect: "send", risk: "high", recipients: [stranger] }).verdict).toBe(
      "allow",
    );
  });

  it("prompt-injection guard: a tainted run can't send to someone new, even under full faith", () => {
    const d = evaluate({ ...base, trust: "full", effect: "send", risk: "high", tainted: true, recipients: [stranger] });
    expect(d.verdict).toBe("ask");
    expect(d.reasons).toContain("tainted_send_new_recipient");
    // ...but replying to a known contact or the owner is fine.
    expect(
      evaluate({ ...base, trust: "full", effect: "send", tainted: true, recipients: [friend, owner] }).verdict,
    ).toBe("allow");
  });

  it("an owner allow rule never relaxes the injection guard", () => {
    const d = evaluate({
      ...base,
      trust: "trusted",
      effect: "send",
      tainted: true,
      ownerRule: "allow",
      recipients: [stranger],
    });
    expect(d.verdict).toBe("ask");
    expect(d.reasons).toEqual(["tainted_send_new_recipient"]);
  });

  it("an owner allow rule can relax ask-me-first for one app", () => {
    expect(evaluate({ ...base, trust: "ask", effect: "write", ownerRule: "allow" }).verdict).toBe("allow");
  });

  it("always-ask actions (e.g. sending a web form) wait for the owner at every trust level", () => {
    for (const trust of ["ask", "trusted", "full"] as const) {
      const d = evaluate({ ...base, trust, effect: "send", risk: "high", alwaysAsk: true, recipients: [friend] });
      expect(d.verdict).toBe("ask");
      expect(d.reasons).toContain("always_ask");
    }
    // Full faith, a clean run, a known recipient and an owner "allow" rule: still asks.
    expect(
      evaluate({ ...base, trust: "full", effect: "send", risk: "high", alwaysAsk: true, ownerRule: "allow", recipients: [friend] }),
    ).toMatchObject({ verdict: "ask", reasons: ["always_ask"] });
    // The same call without the flag runs on its own.
    expect(evaluate({ ...base, trust: "full", effect: "send", risk: "high", recipients: [friend] }).verdict).toBe("allow");
    // Reads that set it ask too.
    expect(evaluate({ ...base, trust: "full", effect: "read", alwaysAsk: true })).toMatchObject({ verdict: "ask", reasons: ["always_ask"] });
  });

  it("always-ask never loosens anything: STOP, an owner's off switch, Look only and the secret rule still win", () => {
    expect(evaluate({ ...base, trust: "full", effect: "send", alwaysAsk: true, paused: true }).verdict).toBe("deny");
    expect(evaluate({ ...base, trust: "full", effect: "send", alwaysAsk: true, ownerRule: "deny" }).verdict).toBe("deny");
    expect(evaluate({ ...base, trust: "look", effect: "send", alwaysAsk: true }).verdict).toBe("deny");
    const leaked = `card on file, key ${["sk", "live", "x".repeat(30)].join("_")}`;
    const d = evaluate({ ...base, trust: "full", effect: "send", alwaysAsk: true, recipients: [stranger], outboundText: leaked });
    expect(d.verdict).toBe("deny");
    expect(d.reasons).toEqual(expect.arrayContaining(["always_ask", "secret_in_payload"]));
  });

  it("money is off without a cap and the cap is never exceeded", () => {
    expect(evaluate({ ...base, trust: "full", effect: "spend", amountUsd: 5 }).reasons).toContain("money_off");
    expect(
      evaluate({ ...base, trust: "full", effect: "spend", amountUsd: 30, spendCapUsd: 50, spentThisMonthUsd: 25 })
        .verdict,
    ).toBe("deny");
    expect(
      evaluate({ ...base, trust: "full", effect: "spend", amountUsd: 10, spendCapUsd: 50, spentThisMonthUsd: 25 })
        .verdict,
    ).toBe("allow");
    expect(
      evaluate({ ...base, trust: "trusted", effect: "spend", amountUsd: 10, spendCapUsd: 50, spentThisMonthUsd: 0 })
        .verdict,
    ).toBe("ask");
    // An app that doesn't say what it costs: the owner decides, even on Full faith.
    expect(evaluate({ ...base, trust: "full", effect: "spend", spendCapUsd: 50 }).verdict).toBe("ask");
    expect(evaluate({ ...base, trust: "full", effect: "spend", spendCapUsd: 50, ownerRule: "allow" }).verdict).toBe("ask");
  });

  it("secrets never leave", () => {
    const leaked = `here you go: ${["sk", "ant", "api03", "x".repeat(40)].join("-")}`;
    expect(
      evaluate({ ...base, trust: "full", effect: "send", recipients: [friend], outboundText: leaked }).verdict,
    ).toBe("deny");
    expect(
      evaluate({ ...base, trust: "full", effect: "send", recipients: [owner], outboundText: leaked }).verdict,
    ).toBe("ask");
  });

  it("bulk deletes and daily caps ask, even under full faith", () => {
    expect(evaluate({ ...base, trust: "full", effect: "delete", itemCount: 50 }).reasons).toContain("bulk_delete");
    expect(
      evaluate({ ...base, trust: "full", effect: "write", actionsToday: 100, dailyActionCap: 100 }).reasons,
    ).toContain("daily_action_cap");
  });

  it("sensitive apps need a tap for changes, even under full faith", () => {
    expect(evaluate({ ...base, trust: "full", effect: "write", sensitive: true }).verdict).toBe("ask");
    expect(evaluate({ ...base, trust: "full", effect: "read", sensitive: true }).verdict).toBe("allow");
  });

  it("an owner allow rule never auto-allows changes in sensitive apps", () => {
    const d = evaluate({ ...base, trust: "trusted", effect: "write", sensitive: true, ownerRule: "allow" });
    expect(d.verdict).toBe("ask");
    expect(d.reasons).toContain("sensitive_app");
    expect(evaluate({ ...base, trust: "full", effect: "write", sensitive: true, ownerRule: "allow" }).verdict).toBe("ask");
    // Reading them is still fine.
    expect(evaluate({ ...base, trust: "full", effect: "read", sensitive: true, ownerRule: "allow" }).verdict).toBe("allow");
  });

  it("quiet hours hold messages to other people", () => {
    expect(
      evaluate({ ...base, trust: "full", effect: "send", recipients: [friend], inQuietHours: true }).reasons,
    ).toContain("quiet_hours");
    expect(
      evaluate({ ...base, trust: "full", effect: "send", recipients: [owner], inQuietHours: true }).verdict,
    ).toBe("allow");
  });

  it("detects common secret formats", () => {
    expect(containsSecret("ghp_" + "a".repeat(36))).toBe(true);
    expect(containsSecret(`AKIA${"ABCDEFGHIJKLMNOP"}`)).toBe(true);
    expect(containsSecret("just a normal sentence about sk ateboarding")).toBe(false);
  });
});

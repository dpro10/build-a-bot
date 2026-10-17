/**
 * The phone box shows +1 in front, so people type just their 10-digit number; whatever they type
 * or paste is tidied to "(512) 555-0123", and the server reads it as +15125550123.
 */
import { describe, expect, it } from "vitest";
import { tidyUsPhone } from "@/components/ui/input";
import { isUsOrCanadaPhone, normalizePhone } from "@/lib/utils";

describe("the +1 phone box", () => {
  it("tidies a number as it's typed", () => {
    expect(["5", "512", "5125", "512555", "5125550", "5125550123"].map(tidyUsPhone)).toEqual(["5", "512", "(512) 5", "(512) 555", "(512) 555-0", "(512) 555-0123"]);
  });

  it("drops a 1 or +1 typed or pasted in front, since the box already shows +1", () => {
    for (const typed of ["+1 512 555 0123", "1 (512) 555-0123", "15125550123", "+1-512-555-0123"]) expect(tidyUsPhone(typed)).toBe("(512) 555-0123");
    expect(tidyUsPhone("1")).toBe("");
  });

  it("keeps at most 10 digits", () => {
    expect(tidyUsPhone("512555012399")).toBe("(512) 555-0123");
  });

  it("what it shows is what the server reads", () => {
    const shown = tidyUsPhone("+1 (512) 555-0123");
    expect(normalizePhone(shown)).toBe("+15125550123");
    expect(isUsOrCanadaPhone(normalizePhone(shown)!)).toBe(true);
  });
});

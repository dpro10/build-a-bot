/**
 * The phone box shows +1 in front, so people type just their 10-digit number; whatever they type
 * or paste is tidied to "(512) 905-9674", and the server reads it as +15129059674.
 */
import { describe, expect, it } from "vitest";
import { tidyUsPhone } from "@/components/ui/input";
import { isUsOrCanadaPhone, normalizePhone } from "@/lib/utils";

describe("the +1 phone box", () => {
  it("tidies a number as it's typed", () => {
    expect(["5", "512", "5129", "512905", "5129059", "5129059674"].map(tidyUsPhone)).toEqual(["5", "512", "(512) 9", "(512) 905", "(512) 905-9", "(512) 905-9674"]);
  });

  it("drops a 1 or +1 typed or pasted in front, since the box already shows +1", () => {
    for (const typed of ["+1 512 905 9674", "1 (512) 905-9674", "15129059674", "+1-512-905-9674"]) expect(tidyUsPhone(typed)).toBe("(512) 905-9674");
    expect(tidyUsPhone("1")).toBe("");
  });

  it("keeps at most 10 digits", () => {
    expect(tidyUsPhone("512905967499")).toBe("(512) 905-9674");
  });

  it("what it shows is what the server reads", () => {
    const shown = tidyUsPhone("+1 (512) 905-9674");
    expect(normalizePhone(shown)).toBe("+15129059674");
    expect(isUsOrCanadaPhone(normalizePhone(shown)!)).toBe(true);
  });
});

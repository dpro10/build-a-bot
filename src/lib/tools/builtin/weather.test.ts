import { afterEach, describe, expect, it, vi } from "vitest";
import { getWeather } from "./weather";
import type { ToolContext } from "../types";

const ctx = { demo: false, now: new Date("2026-10-23T12:00:00Z") } as unknown as ToolContext;

/** Open-Meteo, answering with these places and a two-day forecast; `asked` gets each URL. */
function stubOpenMeteo(places: object[], asked: string[]) {
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    if (url.includes("geocoding")) return Response.json({ results: places });
    return Response.json({
      current: { temperature_2m: 20, apparent_temperature: 19, weather_code: 0, wind_speed_10m: 5 },
      daily: { time: ["2026-10-24", "2026-10-25"], weather_code: [0, 3], temperature_2m_max: [22, 18], temperature_2m_min: [10, 9], precipitation_probability_max: [0, 40] },
    });
  });
}

const PARIS = [
  { name: "Paris", latitude: 48.85, longitude: 2.35, country: "France", country_code: "FR", admin1: "Île-de-France" },
  { name: "Paris", latitude: 33.66, longitude: -95.55, country: "United States", country_code: "US", admin1: "Texas" },
];

afterEach(() => vi.unstubAllGlobals());

describe("the weather tool", () => {
  it("finds the place the words after the comma name, in the units people use there, with weekdays", async () => {
    const asked: string[] = [];
    stubOpenMeteo(PARIS, asked);
    const out = await getWeather.run({ location: "Paris, TX" }, ctx);
    expect(out.ok && out.content).toMatch(/^Weather for Paris, Texas, United States/);
    expect(asked[1]).toContain("latitude=33.66");
    expect(asked[1]).toContain("temperature_unit=fahrenheit");
    // 2026-10-24 is a Saturday.
    expect(out.ok && out.content).toContain("Sat, Oct 24: clear sky");
  });

  it("Celsius outside the US unless asked", async () => {
    const asked: string[] = [];
    stubOpenMeteo(PARIS, asked);
    await getWeather.run({ location: "Paris" }, ctx);
    expect(asked[1]).toContain("latitude=48.85");
    expect(asked[1]).toContain("temperature_unit=celsius");
    await getWeather.run({ location: "Paris", unit: "fahrenheit" }, ctx);
    expect(asked[3]).toContain("temperature_unit=fahrenheit");
  });
});

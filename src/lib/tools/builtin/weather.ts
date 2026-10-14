import { z } from "zod";
import { defineTool } from "../types";
import { fetchWithTimeout, USER_AGENT } from "../net";

const CODES: Record<number, string> = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorms", 96: "thunderstorms with hail", 99: "severe thunderstorms with hail",
};

function demoForecast(location: string, days: number, unit: "fahrenheit" | "celsius") {
  // Deterministic, plausible numbers so demos and tests are stable.
  const seed = [...location.toLowerCase()].reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = unit === "fahrenheit" ? 58 + (seed % 25) : 14 + (seed % 14);
  const sky = ["clear sky", "partly cloudy", "light rain", "mostly clear", "overcast"];
  const lines = Array.from({ length: days }, (_, i) => {
    const hi = base + ((seed + i * 7) % 8);
    const lo = hi - 9 - (i % 3);
    return `Day ${i + 1}: ${sky[(seed + i) % sky.length]}, high ${hi}°, low ${lo}°, ${(seed * (i + 3)) % 60}% chance of rain`;
  });
  return `Weather for ${location} (demo data — live forecasts come from Open-Meteo in production):\nNow: ${base}° and ${sky[seed % sky.length]}\n${lines.join("\n")}`;
}

export const getWeather = defineTool({
  name: "get_weather",
  title: "Check the weather",
  description: "Current conditions and a short daily forecast for a city or place.",
  input: z.object({
    location: z.string().min(2).max(120).describe("City or place, e.g. 'Austin, TX' or 'Paris'"),
    days: z.number().int().min(1).max(7).optional().describe("Forecast days (default 3)"),
    unit: z.enum(["fahrenheit", "celsius"]).optional().describe("Default fahrenheit for US places, else celsius"),
  }),
  connectorId: "weather",
  capabilityId: "forecast",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: (a) => `Weather in ${a.location}`,
  async run(args, ctx) {
    const days = args.days ?? 3;
    const unit = args.unit ?? "fahrenheit";
    try {
      const geo = await fetchWithTimeout(
        `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(args.location.split(",")[0])}`,
        { headers: { "user-agent": USER_AGENT }, signal: ctx.signal, timeoutMs: 8000 },
      );
      const g = (await geo.json()) as { results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[] };
      const place = g.results?.[0];
      if (!place) return { ok: true, content: `I couldn't find a place called “${args.location}”.`, summary: "Place not found" };
      const fc = await fetchWithTimeout(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${days}&temperature_unit=${unit}&wind_speed_unit=${unit === "fahrenheit" ? "mph" : "kmh"}`,
        { headers: { "user-agent": USER_AGENT }, signal: ctx.signal, timeoutMs: 8000 },
      );
      const f = (await fc.json()) as {
        current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
        daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
      };
      const name = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
      const u = unit === "fahrenheit" ? "°F" : "°C";
      const now = f.current
        ? `Now: ${Math.round(f.current.temperature_2m)}${u} (feels ${Math.round(f.current.apparent_temperature)}${u}), ${CODES[f.current.weather_code] ?? "—"}, wind ${Math.round(f.current.wind_speed_10m)} ${unit === "fahrenheit" ? "mph" : "km/h"}`
        : "";
      const daily = (f.daily?.time ?? []).map(
        (d, i) =>
          `${d}: ${CODES[f.daily!.weather_code[i]] ?? "—"}, high ${Math.round(f.daily!.temperature_2m_max[i])}${u}, low ${Math.round(f.daily!.temperature_2m_min[i])}${u}, ${f.daily!.precipitation_probability_max[i] ?? 0}% rain`,
      );
      return { ok: true, content: `Weather for ${name}\n${now}\n${daily.join("\n")}`, summary: name };
    } catch {
      if (!ctx.demo) return { ok: false, error: "The weather service didn't answer." };
      return { ok: true, content: demoForecast(args.location, days, unit), summary: `${args.location} (demo)` };
    }
  },
});

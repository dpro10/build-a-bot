/**
 * The five original Build-a-bot characters. Visuals live in src/components/avatar;
 * this file holds what every part of the app needs to know about them: names,
 * colorways, and the default personality each one brings to its bot's system prompt.
 *
 * Rules (docs/DECISIONS.md): original characters only, no bears or plush/toy
 * imagery, nothing aimed at kids (the product is 18+).
 */

export const AVATAR_IDS = ["blip", "nimbus", "sprout", "ember", "otto"] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export const COLORWAY_IDS = ["ocean", "sky", "grape", "rose", "coral", "sunny", "mint", "midnight"] as const;
export type ColorwayId = (typeof COLORWAY_IDS)[number];

export type AvatarMood = "idle" | "happy" | "thinking" | "working" | "sleeping" | "alert";

export type Colorway = {
  id: ColorwayId;
  name: string;
  /** Body gradient, light → dark. */
  light: string;
  base: string;
  deep: string;
  /** Contrasting accent (antenna bulbs, leaves, sparks, suckers...). */
  accent: string;
  /** Soft tint for backgrounds/chips behind the avatar. */
  tint: string;
};

export const COLORWAYS: Record<ColorwayId, Colorway> = {
  ocean: { id: "ocean", name: "Ocean", light: "#7CC4FF", base: "#3B82F6", deep: "#1D4ED8", accent: "#FFD25A", tint: "#E6F1FF" },
  sky: { id: "sky", name: "Sky", light: "#C7D7FF", base: "#8EA8FF", deep: "#5B74E8", accent: "#FFB4C8", tint: "#EEF2FF" },
  grape: { id: "grape", name: "Grape", light: "#B7A6FF", base: "#7C5CFF", deep: "#5136D9", accent: "#7CF5D3", tint: "#F1EDFF" },
  rose: { id: "rose", name: "Rose", light: "#FFB3CF", base: "#F2679B", deep: "#C93D73", accent: "#FFE08A", tint: "#FFEEF4" },
  coral: { id: "coral", name: "Coral", light: "#FFB199", base: "#FF6F59", deep: "#E0442F", accent: "#5BD1FF", tint: "#FFF0EB" },
  sunny: { id: "sunny", name: "Sunny", light: "#FFE58A", base: "#FFC23D", deep: "#E89A00", accent: "#7C5CFF", tint: "#FFF7DD" },
  mint: { id: "mint", name: "Mint", light: "#9BF0CD", base: "#2FCB94", deep: "#169C6E", accent: "#FF8FAB", tint: "#E7FBF2" },
  midnight: { id: "midnight", name: "Midnight", light: "#5D6488", base: "#363C5E", deep: "#1F233D", accent: "#7CF5D3", tint: "#ECEDF4" },
};

export type AvatarDef = {
  id: AvatarId;
  /** Character name, shown as "Blip the robot". The owner gives their bot its own name. */
  character: string;
  species: string;
  tagline: string;
  /** Three words for the picker card. */
  traits: [string, string, string];
  defaultColor: ColorwayId;
  /** Name ideas for the "Surprise me" button. Never includes the brand. */
  nameIdeas: string[];
  personality: {
    tone: string;
    /** Injected into the system prompt. Second person, short, concrete. */
    prompt: string;
    greetingStyle: string;
  };
  goodAt: string[];
};

export const AVATARS: Record<AvatarId, AvatarDef> = {
  blip: {
    id: "blip",
    character: "Blip",
    species: "robot",
    tagline: "Quick, precise, a little nerdy.",
    traits: ["Precise", "Speedy", "Techy"],
    defaultColor: "ocean",
    nameIdeas: ["Blip", "Pixel", "Volt", "Byte", "Rivet", "Nova", "Dot", "Chip", "Echo", "Ziggy"],
    personality: {
      tone: "crisp and nerdy",
      prompt:
        "You are crisp, precise and quietly funny in a nerdy way. You love a good checklist. Lead with the answer, then the detail. Use short sentences. When something is technical, you explain it plainly without talking down.",
      greetingStyle: "upbeat and efficient, with one light nerdy joke at most",
    },
    goodAt: ["code & GitHub", "tech chores", "fast answers"],
  },
  nimbus: {
    id: "nimbus",
    character: "Nimbus",
    species: "cloud",
    tagline: "Calm, organized, unflappable.",
    traits: ["Calm", "Organized", "Gentle"],
    defaultColor: "sky",
    nameIdeas: ["Nimbus", "Misty", "Cirrus", "Haze", "Skye", "Willow", "Puff", "Luna", "Drift", "Breeze"],
    personality: {
      tone: "calm and reassuring",
      prompt:
        "You are calm, organized and reassuring. You turn chaos into a short plan. You never sound rushed. You gently point out what matters most today and keep things tidy: clear lists, clear next steps.",
      greetingStyle: "soft and welcoming, like a deep breath",
    },
    goodAt: ["inbox zero", "calendar & planning", "staying on top of things"],
  },
  sprout: {
    id: "sprout",
    character: "Sprout",
    species: "seedling",
    tagline: "Kind, steady, cheers you on.",
    traits: ["Kind", "Steady", "Encouraging"],
    defaultColor: "mint",
    nameIdeas: ["Sprout", "Fern", "Basil", "Clover", "Juniper", "Sage", "Olive", "Moss", "Ivy", "Pip"],
    personality: {
      tone: "warm and encouraging",
      prompt:
        "You are warm, patient and encouraging. You celebrate small wins and help people build good habits one step at a time. You are honest, never preachy, and you keep reminders friendly.",
      greetingStyle: "warm and encouraging, with genuine curiosity about the person",
    },
    goodAt: ["habits & reminders", "school & studying", "wellbeing check-ins"],
  },
  ember: {
    id: "ember",
    character: "Ember",
    species: "spark",
    tagline: "Bold, fast, gets it done.",
    traits: ["Bold", "Decisive", "Energetic"],
    defaultColor: "coral",
    nameIdeas: ["Ember", "Blaze", "Flint", "Sparky", "Ash", "Rio", "Jet", "Scout", "Dash", "Kit"],
    personality: {
      tone: "energetic and decisive",
      prompt:
        "You are energetic, decisive and action-first. You cut to what needs doing, propose a plan, and push things over the finish line. Keep it punchy. Offer one clear recommendation instead of a menu when you can.",
      greetingStyle: "punchy and energetic, ready to get going",
    },
    goodAt: ["errands", "getting things done", "deals & logistics"],
  },
  otto: {
    id: "otto",
    character: "Otto",
    species: "octopus",
    tagline: "Curious, witty, juggles everything.",
    traits: ["Curious", "Witty", "Multitasker"],
    defaultColor: "grape",
    nameIdeas: ["Otto", "Inkwell", "Squish", "Coral", "Marlo", "Tako", "Indy", "Ollie", "Wren", "Kai"],
    personality: {
      tone: "curious and witty",
      prompt:
        "You are curious, witty and a natural researcher who juggles many things at once. You dig for the real answer, cite where things came from, and connect dots across apps. A dash of playful humor is welcome; never at the person's expense.",
      greetingStyle: "curious and playful, with a light octopus pun at most",
    },
    goodAt: ["research", "juggling many apps", "finding the real answer"],
  },
};

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && (AVATAR_IDS as readonly string[]).includes(value);
}

export function isColorwayId(value: unknown): value is ColorwayId {
  return typeof value === "string" && (COLORWAY_IDS as readonly string[]).includes(value);
}

import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import "@/components/avatar/avatar.css";
import { Toaster } from "@/components/ui/toaster";
import { appUrl } from "@/lib/env";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: "Build-a-bot — your own AI agent, in about a minute",
    template: "%s · Build-a-bot",
  },
  description:
    "Pick a face, name it, choose its brain — bring your Claude or ChatGPT, or use open models for free — connect your apps, and talk to it anywhere: calls, texts, email, Telegram, Discord, Slack.",
  applicationName: "Build-a-bot",
  openGraph: {
    title: "Build-a-bot — your own AI agent, in about a minute",
    description: "Pick a face. Name it. Give it a brain and your apps. Talk to it anywhere. Rules enforced in code.",
    type: "website",
    siteName: "Build-a-bot",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c12" },
  ],
};

// Set the theme before first paint (no flash): saved choice, else the system's.
const themeScript = `(function(){try{var t=localStorage.getItem('bab-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}

import { headers } from "next/headers";
import Link from "next/link";
import { Check, Download, Keyboard, Laptop, Monitor, NotebookPen, RefreshCw, ShieldCheck } from "lucide-react";
import { Container } from "@/components/marketing/ui";
import { Button } from "@/components/ui/button";
import { PLATFORMS, desktopReleases, formatSize, isPhoneUserAgent, latestDownload, platformFromUserAgent, type DesktopPlatform } from "@/lib/desktop/releases";
import { pageMetadata } from "@/lib/site";
import { audioStaysOnComputer } from "@/lib/transcribe";

export const metadata = pageMetadata({
  title: "Download",
  description: "Build-a-bot for Mac and Windows: your bot takes notes in your calls and types what you say in any app, heard on your computer by NVIDIA Parakeet. It installs in one go and keeps itself up to date.",
  path: "/download",
});

const ICON: Record<DesktopPlatform, React.ReactNode> = { mac: <Laptop />, windows: <Monitor /> };

const OPEN_IT: Record<DesktopPlatform, string> = {
  mac: "Open the download and double-click Build-a-bot. It moves itself into Applications and opens.",
  windows: "Open the download. It installs in a few seconds, with no questions and no admin password, and opens.",
};

export default async function DownloadPage() {
  const releases = await desktopReleases();
  const ua = (await headers()).get("user-agent");
  const here = platformFromUserAgent(ua);
  const phone = isPhoneUserAgent(ua);
  const builds = { mac: latestDownload(releases, "mac"), windows: latestDownload(releases, "windows") };
  // The visitor's own computer first; on a phone or anything else, both side by side.
  const order: DesktopPlatform[] = here === "windows" ? ["windows", "mac"] : ["mac", "windows"];
  const primary = here && builds[here] ? here : null;
  const any = Boolean(builds.mac || builds.windows);
  const audioStays = audioStaysOnComputer();

  return (
    <section className="relative overflow-hidden">
      <div className="aurora" aria-hidden="true" />
      <Container className="relative pt-16 pb-20 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance sm:text-6xl">
            Build-a-bot for <span className="mk-gradient-text">your computer</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
            Your bot takes notes in your calls and types what you say, in any app. NVIDIA Parakeet hears it right on your computer
            {audioStays ? ", so your audio never leaves it." : "."}
          </p>
        </div>

        {any ? (
          <div className={primary ? "mx-auto mt-10 max-w-xl" : "mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2"}>
            {(primary ? [primary] : order).map((p) => (
              <PlatformCard key={p} platform={p} build={builds[p]} big={Boolean(primary)} />
            ))}
            {primary ? <OtherPlatform platform={order.find((p) => p !== primary)!} build={builds[order.find((p) => p !== primary)!]} /> : null}
            {phone ? (
              <p className="text-center text-sm text-muted-foreground sm:col-span-2">It installs on a Mac or a Windows PC: open build-a-bot.site/download there.</p>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-xl rounded-3xl border border-border bg-card p-6 text-center shadow-soft">
            <p className="font-semibold">Signed downloads for Mac and Windows are coming soon.</p>
            <p className="mt-1.5 text-sm text-muted-foreground">Meeting notes and voice typing come with them. Everything else works on the web today.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/build">Build your bot</Link>
            </Button>
          </div>
        )}

        {any ? (
          <ol className="mx-auto mt-14 grid max-w-4xl gap-4 sm:grid-cols-3">
            <Step n={1} title="Open it">
              {primary ? OPEN_IT[primary] : `${OPEN_IT.mac} On Windows: ${OPEN_IT.windows.charAt(0).toLowerCase()}${OPEN_IT.windows.slice(1)}`}
            </Step>
            <Step n={2} title="Pair it with your bot">
              It asks for a code. Get one in the Build-a-bot web app, on the <strong className="font-semibold text-foreground">Desktop app</strong> page.
            </Step>
            <Step n={3} title="Talk, or let it take notes">
              NVIDIA Parakeet downloads once (about 0.7 GB). Then hold the shortcut and talk in any app, and your bot asks before it takes notes in a call.
            </Step>
          </ol>
        ) : null}

        <ul className="mx-auto mt-12 grid max-w-4xl gap-x-8 gap-y-4 text-sm text-muted-foreground sm:grid-cols-2">
          <Point icon={<NotebookPen />}>Notes from Zoom, Google Meet, Teams and more. It asks first, and you can always see it&apos;s listening.</Point>
          <Point icon={<Keyboard />}>Voice typing in any app: hold the shortcut, talk, let go. Your words appear where your cursor is.</Point>
          <Point icon={<ShieldCheck />}>
            Signed by its developer, and heard on your computer{audioStays ? ": only the words reach Build-a-bot, never the audio." : " by NVIDIA Parakeet."}
          </Point>
          <Point icon={<RefreshCw />}>It keeps itself up to date, and never restarts in the middle of a call.</Point>
        </ul>
      </Container>
    </section>
  );
}

function PlatformCard({ platform, build, big }: { platform: DesktopPlatform; build: ReturnType<typeof latestDownload>; big: boolean }) {
  const info = PLATFORMS[platform];
  return (
    <div className="flex flex-col items-center rounded-3xl border border-border bg-card p-6 text-center shadow-soft">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-6" aria-hidden>
        {ICON[platform]}
      </span>
      {build ? (
        <>
          <Button asChild size={big ? "xl" : "lg"} className="mt-4">
            <a href={`/download/${platform}`}>
              <Download /> Download for {info.label}
            </a>
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">
            Version {build.version}
            {build.asset.size ? ` · ${formatSize(build.asset.size)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{info.needs}</p>
        </>
      ) : (
        <>
          <p className="mt-4 font-semibold">{info.label}: coming soon</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{info.needs}</p>
        </>
      )}
    </div>
  );
}

function OtherPlatform({ platform, build }: { platform: DesktopPlatform; build: ReturnType<typeof latestDownload> }) {
  const info = PLATFORMS[platform];
  return (
    <p className="mt-4 text-center text-sm text-muted-foreground">
      {build ? (
        <>
          On {info.label === "Mac" ? "a Mac" : "Windows"}?{" "}
          <a className="font-semibold text-primary underline-offset-4 hover:underline" href={`/download/${platform}`}>
            Download for {info.label}
          </a>{" "}
          ({info.needs}).
        </>
      ) : (
        <>The {info.label} app is coming soon.</>
      )}
    </p>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-3xl border border-border bg-card/70 p-5">
      <div className="flex items-center gap-2 font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary" aria-hidden>
          {n}
        </span>
        {title}
      </div>
      <p className="mt-2 text-sm text-pretty text-muted-foreground">{children}</p>
    </li>
  );
}

function Point({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 text-primary [&_svg]:size-[18px]" aria-hidden>
        {icon ?? <Check />}
      </span>
      <span className="text-pretty">{children}</span>
    </li>
  );
}

"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { Bell, CreditCard, Laptop, Menu, Plus, Settings, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export type ShellBot = { id: string; name: string; avatar: AvatarId; color: ColorwayId; status: string; pending: number; subtitle: string };

export function AppShell({
  bots,
  pendingTotal,
  planName,
  demo,
  anonymous,
  children,
}: {
  bots: ShellBot[];
  pendingTotal: number;
  planName: string;
  demo: boolean;
  anonymous: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const menuButton = React.useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  React.useEffect(() => setOpen(false), [pathname]);
  // The drawer is for phones: close it if the window grows into the desktop layout.
  React.useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  const nav = (
    <SidebarContent bots={bots} pendingTotal={pendingTotal} planName={planName} pathname={pathname} anonymous={anonymous} />
  );

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="sticky top-0 hidden h-dvh w-[280px] shrink-0 flex-col border-r border-border bg-background-2/60 lg:flex">{nav}</aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/85 px-3 backdrop-blur-xl lg:hidden">
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Open menu"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/app" className="flex items-center">
          <Logo className="text-lg" />
        </Link>
        <Link href="/app/approvals" className="relative inline-flex size-10 items-center justify-center rounded-full hover:bg-muted" aria-label="Approvals">
          <Bell className="size-5" />
          {pendingTotal > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">{pendingTotal}</span>
          ) : null}
        </Link>
      </div>
      {/* Phone menu: a drawer that traps focus, closes on Escape and gives focus back to the menu button. */}
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] lg:hidden" />
          <D.Content
            aria-describedby={undefined}
            onCloseAutoFocus={(e) => {
              // Back to the menu button (it isn't a Radix trigger), unless a link moved focus on purpose.
              if (menuButton.current && document.activeElement === document.body) {
                e.preventDefault();
                menuButton.current.focus();
              }
            }}
            className="fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-[320px] animate-[fade-up_0.2s_ease-out] flex-col bg-background shadow-lift outline-none lg:hidden"
          >
            <D.Title className="sr-only">Menu</D.Title>
            <D.Close className="absolute top-3 right-3 rounded-full p-2 hover:bg-muted" aria-label="Close menu">
              <X className="size-5" />
            </D.Close>
            {nav}
          </D.Content>
        </D.Portal>
      </D.Root>

      {/* One screen tall: pages scroll inside, so the chat composer stays put on phones too. */}
      <main className="flex h-dvh min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        {demo ? (
          <div className="shrink-0 border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
            Demo mode: integrations without keys are simulated — nothing real is sent or charged.
          </div>
        ) : null}
        <div id="app-scroll" className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

function SidebarContent({
  bots,
  pendingTotal,
  planName,
  pathname,
  anonymous,
}: {
  bots: ShellBot[];
  pendingTotal: number;
  planName: string;
  pathname: string;
  anonymous: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/app" aria-label="Your bots">
          <Logo className="text-lg" />
        </Link>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3">
        <div className="px-2 pt-2 pb-2 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">Your bots</div>
        <nav className="flex flex-col gap-1">
          {bots.map((b) => {
            const active = pathname.startsWith(`/app/bots/${b.id}`);
            return (
              <Link
                key={b.id}
                href={`/app/bots/${b.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl px-2 py-2 transition",
                  active ? "bg-card shadow-soft ring-1 ring-border" : "hover:bg-muted/70",
                )}
              >
                <span className="relative">
                  <Avatar avatar={b.avatar} color={b.color} size={40} mood={b.status === "paused" ? "sleeping" : b.pending ? "alert" : "idle"} animated={active} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{b.name}</span>
                    {b.status === "paused" ? <span className="text-[11px] font-semibold text-muted-foreground">Paused</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{b.subtitle}</span>
                </span>
                {b.pending ? <Badge tone="danger">{b.pending}</Badge> : null}
              </Link>
            );
          })}
          <Link
            href="/build"
            className="mt-1 flex items-center gap-3 rounded-2xl border border-dashed border-border px-3 py-3 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Plus className="size-4" />
            </span>
            New bot
          </Link>
        </nav>
      </div>
      <div className="border-t border-border p-3">
        {anonymous ? (
          <Link href="/login?next=/app" className="mb-2 block rounded-2xl bg-primary-soft px-3 py-2.5 text-sm font-semibold text-primary">
            Save your account →<span className="block text-xs font-normal">Add your email so you never lose your bots.</span>
          </Link>
        ) : null}
        <NavItem href="/app/approvals" icon={<Bell className="size-[18px]" />} label="Approvals" active={pathname === "/app/approvals"} badge={pendingTotal} />
        <NavItem href="/app/bridge" icon={<Laptop className="size-[18px]" />} label="Bridge (your computer)" active={pathname === "/app/bridge"} />
        <NavItem href="/app/billing" icon={<CreditCard className="size-[18px]" />} label="Plan & usage" active={pathname === "/app/billing"} trailing={<Badge tone="primary">{planName}</Badge>} />
        <div className="mt-1 flex items-center justify-between">
          <NavItem href="/app/account" icon={<Settings className="size-[18px]" />} label="Account" active={pathname === "/app/account"} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function NavItem({ href, icon, label, active, badge, trailing }: { href: string; icon: React.ReactNode; label: string; active?: boolean; badge?: number; trailing?: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex flex-1 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition", active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge ? <Badge tone="danger">{badge}</Badge> : null}
      {trailing}
    </Link>
  );
}

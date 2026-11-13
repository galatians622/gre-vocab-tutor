import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BarChart3, BookOpen, GitBranch, Home, LogOut, Mic, Settings, Sparkle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/study", label: "Study", icon: Sparkle },
  { to: "/voice", label: "Voice Tutor", icon: Mic },
  { to: "/library", label: "Word Library", icon: BookOpen },
  { to: "/roots", label: "Root Explorer", icon: GitBranch },
  { to: "/progress", label: "Progress", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const MOBILE = [NAV[0], NAV[1], NAV[2], NAV[3], NAV[4]] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const immersive = pathname.startsWith("/voice");

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (immersive) return <>{children}</>;

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar px-4 py-6 lg:flex">
        <Link to="/dashboard" className="px-2">
          <Logo />
        </Link>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent",
                  to === "/voice" && !active && "text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <button onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-sidebar-accent">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/dashboard">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <Link to="/progress" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Progress">
            <BarChart3 className="h-5 w-5" />
          </Link>
          <Link to="/settings" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Settings">
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <main className="pb-28 lg:pb-12 lg:pl-64">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 lg:px-10 lg:pt-10">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-md items-end justify-between">
          {MOBILE.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            if (to === "/voice") {
              return (
                <Link key={to} to={to} className="-mt-6 flex flex-col items-center gap-1" aria-label="Voice Tutor">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-lift)]">
                    <Mic className="h-6 w-6" />
                  </span>
                  <span className="text-[11px] font-semibold text-primary">Voice</span>
                </Link>
              );
            }
            return (
              <Link
                key={to}
                to={to}
                className={cn("flex w-16 flex-col items-center gap-1 py-1.5 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
              >
                <Icon className="h-5 w-5" />
                {to === "/library" ? "Words" : to === "/roots" ? "Roots" : label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-3xl leading-tight sm:text-4xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

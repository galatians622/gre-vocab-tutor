import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Flame, GraduationCap, Mic, Sparkle, Target, Zap } from "lucide-react";
import { dashboardQuery, pct } from "@/lib/queries";
import { PageHeader } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — LexiMind GRE" },
      { name: "description", content: "Your reviews due, mastery and daily GRE vocabulary goal." },
      { property: "og:title", content: "Dashboard — LexiMind GRE" },
      { property: "og:description", content: "Your reviews due, mastery and daily GRE vocabulary goal." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
  component: Dashboard,
});

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="surface p-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 font-display text-3xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Dashboard() {
  const { data: d } = useSuspenseQuery(dashboardQuery);
  const name = d.prefs?.display_name;
  const goalPct = Math.min(100, Math.round((d.learnedToday / Math.max(1, d.dailyGoal)) * 100));
  const maxUpcoming = Math.max(1, ...d.upcoming.map((u) => u.count));

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} title={name ? `Good to see you, ${name}.` : "Your study desk"} />

      {!d.prefs?.onboarded && (
        <Link to="/onboarding" className="surface flex items-center justify-between gap-4 border-accent bg-accent-soft p-5">
          <div className="flex items-center gap-4">
            <GraduationCap className="h-8 w-8 shrink-0 text-accent-foreground" />
            <div>
              <div className="font-display text-xl">Take the 3-minute diagnostic</div>
              <div className="text-sm text-muted-foreground">Set your test date and daily goal, and we'll tailor your plan.</div>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </Link>
      )}

      {/* Voice tutor — the headline feature */}
      <Link
        to="/voice"
        className="ink-glow group relative block overflow-hidden rounded-[1.75rem] bg-ink p-6 text-ink-foreground shadow-[var(--shadow-lift)] sm:p-8"
      >
        <div className="flex items-center gap-5">
          <span className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full bg-primary">
            <span className="absolute inset-0 rounded-full bg-primary animate-ripple" />
            <Mic className="relative h-7 w-7" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">Hands-free</div>
            <div className="font-display text-2xl sm:text-3xl">Start Voice Study</div>
            <div className="mt-0.5 text-sm text-ink-muted">
              Talk through {d.needsReview > 0 ? `${d.needsReview} due words` : "new words and roots"} while you walk, cook or commute.
            </div>
          </div>
          <ArrowRight className="ml-auto hidden h-6 w-6 transition-transform group-hover:translate-x-1 sm:block" />
        </div>
      </Link>

      <div className="grid gap-3 sm:grid-cols-3">
        <Button asChild variant="outline" size="xl" className="h-auto justify-start bg-card py-4">
          <Link to="/study" search={{ focus: "quick", minutes: 10 }}>
            <Zap className="text-primary" />
            <span className="text-left">
              <span className="block font-semibold">Quick Review</span>
              <span className="block text-xs font-normal text-muted-foreground">{d.needsReview} due now</span>
            </span>
          </Link>
        </Button>
        <Button asChild variant="outline" size="xl" className="h-auto justify-start bg-card py-4">
          <Link to="/study" search={{ focus: "teach", minutes: 15 }}>
            <Sparkle className="text-primary" />
            <span className="text-left">
              <span className="block font-semibold">Teach Me Something New</span>
              <span className="block text-xs font-normal text-muted-foreground">Guided lesson</span>
            </span>
          </Link>
        </Button>
        <Button asChild variant="outline" size="xl" className="h-auto justify-start bg-card py-4">
          <Link to="/study" search={{ focus: "challenge", minutes: 10 }}>
            <Flame className="text-primary" />
            <span className="text-left">
              <span className="block font-semibold">Challenge Me</span>
              <span className="block text-xs font-normal text-muted-foreground">Harder formats</span>
            </span>
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="surface p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <Target className="h-4 w-4 text-primary" /> Today's new words
            </div>
            <span className="text-sm text-muted-foreground">
              {d.learnedToday} / {d.dailyGoal}
            </span>
          </div>
          <Progress value={goalPct} className="mt-3 h-2.5" />
          <p className="mt-3 text-sm text-muted-foreground">
            {d.needsReview >= d.dailyGoal * 2
              ? "Reviews are piling up, so new words are slowed until you catch up."
              : "New words are paced so reviews never pile up."}
          </p>
          {d.daysToTest != null && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm">
              <CalendarClock className="h-4 w-4 text-primary" />
              {d.daysToTest > 0 ? `${d.daysToTest} days until your GRE` : "Test day has passed — update it in Settings"}
            </div>
          )}
        </div>
        <div className="surface p-5">
          <div className="font-semibold">Upcoming reviews</div>
          <div className="mt-4 flex h-28 items-end gap-2">
            {d.upcoming.map((u, i) => (
              <div key={u.day} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="text-[11px] text-muted-foreground">{u.count || ""}</div>
                <div className="w-full rounded-md bg-primary/80" style={{ height: `${Math.max(4, (u.count / maxUpcoming) * 80)}px` }} />
                <div className="text-[11px] text-muted-foreground">
                  {i === 0 ? "Today" : new Date(u.day + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Words introduced" value={d.introduced} sub={`of ${d.totalWords} in the library`} />
        <Stat label="Mastered" value={d.mastered} sub="Recalled across days & formats" />
        <Stat label="Need review" value={d.needsReview} sub="Due now" />
        <Stat label="Roots mastered" value={d.rootsMastered} sub={`${d.rootsStarted} started of ${d.totalRoots}`} />
        <Stat label="Recall accuracy" value={pct(d.recallAccuracy)} sub={`${d.recallCount} typed definitions, 30 days`} />
        <Stat label="Review accuracy" value={pct(d.reviewAccuracy)} sub={`${d.reviewCount} answers, 30 days`} />
        <Stat label="Estimated retention" value={pct(d.retention)} sub="Scheduler's estimate for words you've recalled" />
        <Stat label="Study time" value={`${d.minutesToday}m`} sub={`${d.minutesWeek}m in the last 7 days`} />
      </div>
    </div>
  );
}

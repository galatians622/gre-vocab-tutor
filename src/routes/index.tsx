import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BrainCircuit, GitBranch, Mic, Repeat } from "lucide-react";
import heroImg from "@/assets/hero-desk.jpg";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/app/logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LexiMind GRE — The vocabulary tutor that remembers everything you study" },
      {
        name: "description",
        content: "Adaptive GRE vocabulary: precise definitions, Greek and Latin roots, spaced repetition and a hands-free voice tutor.",
      },
      { property: "og:title", content: "LexiMind GRE — Adaptive GRE vocabulary tutor" },
      { property: "og:description", content: "Precise definitions, real etymology, spaced repetition and a voice tutor you can study with hands-free." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  { icon: BrainCircuit, title: "Recall, not recognition", body: "You type or say definitions in your own words. Picking from four options never counts as mastery." },
  { icon: GitBranch, title: "Roots, honestly", body: "Real Greek and Latin etymology, clearly separated from memory tricks — and drilled across whole word families." },
  { icon: Repeat, title: "Spaced repetition", body: "An FSRS scheduler brings each word back right before you'd forget it, and pulls weak words forward." },
  { icon: Mic, title: "A tutor you can talk to", body: "Start a voice session and study while you walk or cook — it asks, listens, corrects and remembers." },
];

function Landing() {
  return (
    <div className="paper-grain min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Button asChild variant="ghost">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
        <div className="animate-rise">
          <div className="eyebrow mb-4">Adaptive GRE vocabulary</div>
          <h1 className="text-[2.6rem] leading-[1.05] sm:text-6xl">
            Know the word.
            <br />
            <span className="italic text-primary">Know where it came from.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            LexiMind teaches GRE words through their roots, tests you without showing the answer, and schedules every review
            around what you actually remember.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="xl">
              <Link to="/auth">
                Start learning <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="xl" variant="hero">
              <Link to="/voice">
                <Mic /> Try the voice tutor
              </Link>
            </Button>
          </div>
        </div>
        <div className="relative">
          <img
            src={heroImg}
            alt="An open dictionary with handwritten etymology notes on a writing desk"
            width={1280}
            height={960}
            className="aspect-[4/3] w-full rounded-[2rem] object-cover shadow-[var(--shadow-lift)]"
          />
          <div className="surface absolute -bottom-6 left-4 right-4 p-4 sm:left-auto sm:right-[-1rem] sm:w-72">
            <div className="font-display text-2xl">
              bene<span className="text-muted-foreground">·</span>vol<span className="text-muted-foreground">·</span>ent
            </div>
            <div className="mt-1 text-sm text-muted-foreground">well + wish + being → wishing others well</div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 pt-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="surface p-5">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-lg">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/app-shell";
import { useLiveVoice, type LiveEvent } from "@/hooks/use-live-voice";
import { supabase } from "@/integrations/supabase/client";
import { VERDICT_LABEL, VERDICT_STYLE } from "@/components/study/word-reveal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/voice")({
  head: () => ({
    meta: [
      { title: "Voice Tutor — LexiMind GRE" },
      { name: "description", content: "Practice GRE words out loud with a tutor that grades and saves your answers." },
      { property: "og:title", content: "Voice Tutor — LexiMind GRE" },
      { property: "og:description", content: "Practice GRE words out loud with a tutor that grades and saves your answers." },
    ],
  }),
  component: Page,
});

type Line = { role: "you" | "tutor"; text: string };
type Saved = { word: string; verdict: string; feedback: string };

function Page() {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [thinking, setThinking] = useState(false);
  const lastRole = useRef<Line["role"] | null>(null);

  const onEvent = useCallback(
    (e: LiveEvent) => {
      if (e.type === "session.input_transcript.delta" || e.type === "session.output_transcript.delta") {
        const role: Line["role"] = e.type === "session.input_transcript.delta" ? "you" : "tutor";
        const delta = typeof e["delta"] === "string" ? (e["delta"] as string) : "";
        if (!delta) return;
        setLines((prev) => {
          if (lastRole.current === role && prev.length) {
            const copy = prev.slice();
            copy[copy.length - 1] = { role, text: copy[copy.length - 1]!.text + delta };
            return copy;
          }
          lastRole.current = role;
          return [...prev, { role, text: delta }];
        });
        if (role === "tutor") setThinking(false);
      } else if (e.type === "app.delegation.pending") {
        setThinking(true);
      } else if (e.type === "app.voice.saved") {
        const s = e["saved"] as Saved;
        setSaved((prev) => [s, ...prev]);
        void qc.invalidateQueries();
      }
    },
    [qc],
  );

  const getToken = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null, []);
  const call = useLiveVoice({ onEvent, getToken });
  const active = call.status === "connecting" || call.status === "connected";

  const begin = () => {
    setLines([]);
    setSaved([]);
    lastRole.current = null;
    call.start();
  };

  return (
    <div>
      <PageHeader eyebrow="Practice out loud" title="Voice Tutor" />
      <div className="surface space-y-4 p-6">
        <p className="text-sm text-muted-foreground">
          Lexi picks your practice words, asks you to define each one, then asks how its root, prefix and suffix build the meaning.
          Every answer is graded and saved to your progress.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!active ? (
            <Button onClick={begin}>
              <Mic className="mr-2 h-4 w-4" /> Start talking
            </Button>
          ) : (
            <>
              <Button variant="destructive" onClick={call.stop}>
                <PhoneOff className="mr-2 h-4 w-4" /> End session
              </Button>
              <Button variant="outline" onClick={() => call.setMuted(!call.muted)} disabled={call.status !== "connected"}>
                {call.muted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                {call.muted ? "Unmute" : "Mute"}
              </Button>
            </>
          )}
          {call.playbackBlocked && (
            <Button variant="outline" onClick={call.resumePlayback}>
              <Play className="mr-2 h-4 w-4" /> Play audio
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            {call.status === "connecting" ? "Connecting…" : call.status === "connected" ? (thinking ? "Lexi is checking…" : "Listening") : call.status === "stopping" ? "Ending…" : ""}
          </span>
        </div>
        {call.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{call.error}</p>}
        <audio ref={call.audioRef} controls className="w-full" />
      </div>

      {saved.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="eyebrow">Saved this session</div>
          {saved.map((s, i) => (
            <div key={i} className={cn("rounded-lg border-l-4 p-3 text-sm", VERDICT_STYLE[s.verdict])}>
              <span className="font-display text-base">{s.word}</span> · {VERDICT_LABEL[s.verdict] ?? s.verdict}
              <p className="text-muted-foreground">{s.feedback}</p>
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <div className="surface mt-4 space-y-3 p-4">
          {lines.map((l, i) => (
            <p key={i} className={cn("text-sm", l.role === "you" ? "text-foreground" : "text-muted-foreground")}>
              <span className="font-semibold">{l.role === "you" ? "You" : "Lexi"}:</span> {l.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress as ProgressBar } from "@/components/ui/progress";
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
type Progress = { set_number: number; mastered: number; set_size: number; word: string | null; mode: "teach" | "review" };

function Page() {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [thinking, setThinking] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastRole = useRef<Line["role"] | null>(null);
  const answerCount = useRef(0);

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
      } else if (e.type === "app.connected") {
        window.__lovableEvents?.track?.("project.voice_session_started", {});
      } else if (e.type === "app.closed") {
        window.__lovableEvents?.track?.("project.voice_session_completed", {
          answers_count: answerCount.current,
          finalized: e.finalized === true,
        });
      } else if (e.type === "app.delegation.pending") {
        setThinking(true);
      } else if (e.type === "app.voice.progress") {
        setProgress(e["progress"] as Progress);
      } else if (e.type === "app.voice.save_failed") {
        setNotice(`Your answer for "${String(e["word"])}" couldn't be saved. Keep going; it will come up again.`);
      } else if (e.type === "app.voice.saved") {
        setNotice(null);
        const s = e["saved"] as Saved;
        setSaved((prev) => [s, ...prev]);
        answerCount.current += 1;
        window.__lovableEvents?.track?.("project.voice_answer_graded", { verdict: String(s.verdict) });
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
    setProgress(null);
    setNotice(null);
    lastRole.current = null;
    answerCount.current = 0;
    call.start();
  };

  return (
    <div>
      <PageHeader eyebrow="Practice out loud" title="Voice Tutor" />
      <div className="surface space-y-4 p-6">
        <p className="text-sm text-muted-foreground">
          Just talk. Lexi leads the session through sets of 10 words: she asks what each word means, gives hints from its roots when
          you need them, walks you through the definition and has you use it in a sentence, then moves straight on. A word is mastered
          once you define it correctly, with no hints, three times in a row. A new set starts once every word is mastered, and your
          progress is saved as you go, so you can pick up where you left off.
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
            {call.status === "connecting" ? "Connecting…" : call.status === "connected" ? (thinking ? "Lexi is getting the next word…" : "Listening") : call.status === "stopping" ? "Ending…" : ""}
          </span>
        </div>
        {progress && (
          <div className="space-y-2 rounded-lg bg-secondary p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <span className="font-semibold">Set {progress.set_number}</span> · {progress.mastered} of {progress.set_size} mastered
              </span>
              {progress.word && (
                <span className="text-muted-foreground">
                  {progress.mode === "teach" ? "Learning" : "Reviewing"}: <span className="font-display text-base text-foreground">{progress.word}</span>
                </span>
              )}
            </div>
            <ProgressBar value={progress.set_size ? (progress.mastered / progress.set_size) * 100 : 0} />
          </div>
        )}
        {notice && <p className="rounded-lg bg-accent-soft p-3 text-sm">{notice}</p>}
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

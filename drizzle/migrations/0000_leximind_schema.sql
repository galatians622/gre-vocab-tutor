-- ===== Content: roots, words, morphemes (public read-only reference data) =====
CREATE TABLE public.roots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  form text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('root','prefix','suffix')),
  meaning text NOT NULL,
  origin text NOT NULL,
  source_word text,
  pronunciation text,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.roots TO anon, authenticated;
GRANT ALL ON public.roots TO service_role;
ALTER TABLE public.roots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Roots are readable by everyone" ON public.roots FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  word text NOT NULL,
  pronunciation text NOT NULL,
  part_of_speech text NOT NULL,
  definition text NOT NULL,
  secondary_meanings text[] NOT NULL DEFAULT '{}',
  plain_english text NOT NULL,
  examples text[] NOT NULL DEFAULT '{}',
  synonyms text[] NOT NULL DEFAULT '{}',
  antonyms text[] NOT NULL DEFAULT '{}',
  difficulty smallint NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  gre_frequency smallint NOT NULL DEFAULT 2 CHECK (gre_frequency BETWEEN 1 AND 3),
  etymology text,
  etymology_status text NOT NULL DEFAULT 'none' CHECK (etymology_status IN ('established','uncertain','none')),
  memory_aid text,
  confused_with text[] NOT NULL DEFAULT '{}',
  confused_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.words TO anon, authenticated;
GRANT ALL ON public.words TO service_role;
ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Words are readable by everyone" ON public.words FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.word_morphemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id uuid NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES public.roots(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  surface text NOT NULL,
  contribution text NOT NULL,
  UNIQUE (word_id, root_id, position)
);
CREATE INDEX word_morphemes_root_idx ON public.word_morphemes(root_id);
GRANT SELECT ON public.word_morphemes TO anon, authenticated;
GRANT ALL ON public.word_morphemes TO service_role;
ALTER TABLE public.word_morphemes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Morphemes are readable by everyone" ON public.word_morphemes FOR SELECT TO anon, authenticated USING (true);

-- ===== Private learner data =====
CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY,
  display_name text,
  test_date date,
  daily_new_words smallint NOT NULL DEFAULT 10,
  daily_minutes smallint NOT NULL DEFAULT 20,
  target_level text NOT NULL DEFAULT 'strong',
  onboarded boolean NOT NULL DEFAULT false,
  diagnostic jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT ALL ON public.user_preferences TO service_role;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own preferences select" ON public.user_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own preferences insert" ON public.user_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own preferences update" ON public.user_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own preferences delete" ON public.user_preferences FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mode text NOT NULL,              -- 'focused' | 'voice' | 'diagnostic'
  focus text,                      -- e.g. 'mixed', 'new', 'weak', 'roots'
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  items_reviewed integer NOT NULL DEFAULT 0,
  items_correct integer NOT NULL DEFAULT 0,
  summary text
);
CREATE INDEX study_sessions_user_idx ON public.study_sessions(user_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_sessions TO authenticated;
GRANT ALL ON public.study_sessions TO service_role;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own sessions select" ON public.study_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own sessions insert" ON public.study_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own sessions update" ON public.study_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own sessions delete" ON public.study_sessions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- One FSRS card per (learner, item, skill). Skills track mastery separately.
CREATE TABLE public.review_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('word','root')),
  item_id uuid NOT NULL,
  skill text NOT NULL CHECK (skill IN ('recognition','recall','precision','context','root_recognition','root_meaning','inference')),
  -- FSRS card fields
  due timestamptz NOT NULL DEFAULT now(),
  stability double precision NOT NULL DEFAULT 0,
  difficulty double precision NOT NULL DEFAULT 0,
  elapsed_days double precision NOT NULL DEFAULT 0,
  scheduled_days double precision NOT NULL DEFAULT 0,
  learning_steps integer NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  state smallint NOT NULL DEFAULT 0,
  last_review timestamptz,
  -- learning analytics
  exposures integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  incorrect_count integer NOT NULL DEFAULT 0,
  hinted_count integer NOT NULL DEFAULT 0,
  independent_correct integer NOT NULL DEFAULT 0,
  correct_days text[] NOT NULL DEFAULT '{}',
  avg_latency_ms integer,
  last_confidence smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_type, item_id, skill)
);
CREATE INDEX review_states_due_idx ON public.review_states(user_id, due);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_states TO authenticated;
GRANT ALL ON public.review_states TO service_role;
ALTER TABLE public.review_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own states select" ON public.review_states FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own states insert" ON public.review_states FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own states update" ON public.review_states FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own states delete" ON public.review_states FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid REFERENCES public.study_sessions(id) ON DELETE SET NULL,
  item_type text NOT NULL CHECK (item_type IN ('word','root')),
  item_id uuid NOT NULL,
  skill text NOT NULL,
  activity text NOT NULL,          -- 'learn','definition_recall','reverse_recall','context','deconstruct','root','diagnostic','voice'
  source text NOT NULL DEFAULT 'focused',
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  correct boolean NOT NULL,
  hints_used smallint NOT NULL DEFAULT 0,
  latency_ms integer,
  confidence smallint,
  response text,
  verdict text,                    -- 'correct','partial','incorrect','skipped','exposure'
  feedback text,
  misconception text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_events_user_idx ON public.review_events(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_events TO authenticated;
GRANT ALL ON public.review_events TO service_role;
ALTER TABLE public.review_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own events select" ON public.review_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own events insert" ON public.review_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own events delete" ON public.review_events FOR DELETE TO authenticated USING (auth.uid() = user_id);

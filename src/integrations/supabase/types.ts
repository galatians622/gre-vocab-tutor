export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      review_events: {
        Row: {
          activity: string
          confidence: number | null
          correct: boolean
          created_at: string
          feedback: string | null
          hints_used: number
          id: string
          item_id: string
          item_type: string
          latency_ms: number | null
          misconception: string | null
          rating: number
          response: string | null
          session_id: string | null
          skill: string
          source: string
          user_id: string
          verdict: string | null
        }
        Insert: {
          activity: string
          confidence?: number | null
          correct: boolean
          created_at?: string
          feedback?: string | null
          hints_used?: number
          id?: string
          item_id: string
          item_type: string
          latency_ms?: number | null
          misconception?: string | null
          rating: number
          response?: string | null
          session_id?: string | null
          skill: string
          source?: string
          user_id: string
          verdict?: string | null
        }
        Update: {
          activity?: string
          confidence?: number | null
          correct?: boolean
          created_at?: string
          feedback?: string | null
          hints_used?: number
          id?: string
          item_id?: string
          item_type?: string
          latency_ms?: number | null
          misconception?: string | null
          rating?: number
          response?: string | null
          session_id?: string | null
          skill?: string
          source?: string
          user_id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      review_states: {
        Row: {
          avg_latency_ms: number | null
          correct_count: number
          correct_days: string[]
          created_at: string
          difficulty: number
          due: string
          elapsed_days: number
          exposures: number
          hinted_count: number
          id: string
          incorrect_count: number
          independent_correct: number
          item_id: string
          item_type: string
          lapses: number
          last_confidence: number | null
          last_review: string | null
          learning_steps: number
          reps: number
          scheduled_days: number
          skill: string
          stability: number
          state: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_latency_ms?: number | null
          correct_count?: number
          correct_days?: string[]
          created_at?: string
          difficulty?: number
          due?: string
          elapsed_days?: number
          exposures?: number
          hinted_count?: number
          id?: string
          incorrect_count?: number
          independent_correct?: number
          item_id: string
          item_type: string
          lapses?: number
          last_confidence?: number | null
          last_review?: string | null
          learning_steps?: number
          reps?: number
          scheduled_days?: number
          skill: string
          stability?: number
          state?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_latency_ms?: number | null
          correct_count?: number
          correct_days?: string[]
          created_at?: string
          difficulty?: number
          due?: string
          elapsed_days?: number
          exposures?: number
          hinted_count?: number
          id?: string
          incorrect_count?: number
          independent_correct?: number
          item_id?: string
          item_type?: string
          lapses?: number
          last_confidence?: number | null
          last_review?: string | null
          learning_steps?: number
          reps?: number
          scheduled_days?: number
          skill?: string
          stability?: number
          state?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      roots: {
        Row: {
          created_at: string
          explanation: string
          form: string
          id: string
          kind: string
          meaning: string
          origin: string
          pronunciation: string | null
          slug: string
          source_word: string | null
        }
        Insert: {
          created_at?: string
          explanation: string
          form: string
          id?: string
          kind: string
          meaning: string
          origin: string
          pronunciation?: string | null
          slug: string
          source_word?: string | null
        }
        Update: {
          created_at?: string
          explanation?: string
          form?: string
          id?: string
          kind?: string
          meaning?: string
          origin?: string
          pronunciation?: string | null
          slug?: string
          source_word?: string | null
        }
        Relationships: []
      }
      study_sessions: {
        Row: {
          ended_at: string | null
          focus: string | null
          id: string
          items_correct: number
          items_reviewed: number
          mode: string
          started_at: string
          summary: string | null
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          focus?: string | null
          id?: string
          items_correct?: number
          items_reviewed?: number
          mode: string
          started_at?: string
          summary?: string | null
          user_id: string
        }
        Update: {
          ended_at?: string | null
          focus?: string | null
          id?: string
          items_correct?: number
          items_reviewed?: number
          mode?: string
          started_at?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          daily_minutes: number
          daily_new_words: number
          diagnostic: Json | null
          display_name: string | null
          onboarded: boolean
          target_level: string
          test_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_minutes?: number
          daily_new_words?: number
          diagnostic?: Json | null
          display_name?: string | null
          onboarded?: boolean
          target_level?: string
          test_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_minutes?: number
          daily_new_words?: number
          diagnostic?: Json | null
          display_name?: string | null
          onboarded?: boolean
          target_level?: string
          test_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      word_morphemes: {
        Row: {
          contribution: string
          id: string
          position: number
          root_id: string
          surface: string
          word_id: string
        }
        Insert: {
          contribution: string
          id?: string
          position: number
          root_id: string
          surface: string
          word_id: string
        }
        Update: {
          contribution?: string
          id?: string
          position?: number
          root_id?: string
          surface?: string
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "word_morphemes_root_id_fkey"
            columns: ["root_id"]
            isOneToOne: false
            referencedRelation: "roots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "word_morphemes_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "words"
            referencedColumns: ["id"]
          },
        ]
      }
      words: {
        Row: {
          antonyms: string[]
          confused_note: string | null
          confused_with: string[]
          created_at: string
          definition: string
          difficulty: number
          etymology: string | null
          etymology_status: string
          examples: string[]
          gre_frequency: number
          id: string
          memory_aid: string | null
          part_of_speech: string
          plain_english: string
          pronunciation: string
          secondary_meanings: string[]
          slug: string
          synonyms: string[]
          word: string
        }
        Insert: {
          antonyms?: string[]
          confused_note?: string | null
          confused_with?: string[]
          created_at?: string
          definition: string
          difficulty?: number
          etymology?: string | null
          etymology_status?: string
          examples?: string[]
          gre_frequency?: number
          id?: string
          memory_aid?: string | null
          part_of_speech: string
          plain_english: string
          pronunciation: string
          secondary_meanings?: string[]
          slug: string
          synonyms?: string[]
          word: string
        }
        Update: {
          antonyms?: string[]
          confused_note?: string | null
          confused_with?: string[]
          created_at?: string
          definition?: string
          difficulty?: number
          etymology?: string | null
          etymology_status?: string
          examples?: string[]
          gre_frequency?: number
          id?: string
          memory_aid?: string | null
          part_of_speech?: string
          plain_english?: string
          pronunciation?: string
          secondary_meanings?: string[]
          slug?: string
          synonyms?: string[]
          word?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

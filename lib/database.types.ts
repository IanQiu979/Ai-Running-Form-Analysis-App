// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source: the live Supabase project's `public`/`graphql_public` schemas (project ref
// vputdomdlknvthnzritt), introspected via `supabase gen types typescript --project-id
// vputdomdlknvthnzritt` (issue #32). Regenerate the same way — or `--linked` once this checkout
// is `supabase link`-ed — after every migration lands in `supabase/migrations/`, then commit
// this file; there is no build-time codegen step (unlike
// `supabase/functions/_shared/knowledge.generated.ts`), so a stale copy here is silent until a
// column actually renames.
//
// Committed on purpose: CI has no database credentials, so it cannot regenerate this file
// itself — the generic on `createClient<Database>` in `lib/supabase.ts` would silently fall
// back to untyped if this were gitignored.
//
// Regenerated 2026-09-21 against the live project after that day's deploy (docs/status.md Known
// Issue #52): includes `profiles.age_band`, `guardian_consent`, and `pace_record_age_band` for
// real (the 2026-09-20 hand-patch is gone — the diff against it was empty for those entries),
// plus the 2026-09-19 migrations (`analysis_request_aliases`, `canonical_analysis_claims`, the
// zero-pillar cooldown RPCs) that a prior docs-only deploy PR (#234) never regenerated this file
// for. `pace_quota_status` and `pace_purchase_tier` are both present — the 2026-07-13 KNOWN DRIFT
// note about them being unpushed is stale and removed.
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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_call_log: {
        Row: {
          actual_usd: number | null
          analysis_id: string | null
          cache_creation_input_tokens: number | null
          cache_read_input_tokens: number | null
          created_at: string
          estimated_input_tokens: number
          estimated_output_tokens: number
          estimated_usd: number
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          settled_at: string | null
          status: Database["public"]["Enums"]["ai_call_status"]
          user_id: string | null
        }
        Insert: {
          actual_usd?: number | null
          analysis_id?: string | null
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          estimated_input_tokens: number
          estimated_output_tokens: number
          estimated_usd: number
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["ai_call_status"]
          user_id?: string | null
        }
        Update: {
          actual_usd?: number | null
          analysis_id?: string | null
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          estimated_input_tokens?: number
          estimated_output_tokens?: number
          estimated_usd?: number
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["ai_call_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_log_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_log_model_fkey"
            columns: ["model"]
            isOneToOne: false
            referencedRelation: "ai_model_pricing"
            referencedColumns: ["model"]
          },
          {
            foreignKeyName: "ai_call_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_pricing: {
        Row: {
          cache_read_multiplier: number
          cache_write_multiplier: number
          input_usd_per_mtok: number
          model: string
          output_usd_per_mtok: number
          updated_at: string
        }
        Insert: {
          cache_read_multiplier?: number
          cache_write_multiplier?: number
          input_usd_per_mtok: number
          model: string
          output_usd_per_mtok: number
          updated_at?: string
        }
        Update: {
          cache_read_multiplier?: number
          cache_write_multiplier?: number
          input_usd_per_mtok?: number
          model?: string
          output_usd_per_mtok?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_ops_config: {
        Row: {
          analyze_enabled: boolean
          breaker_cooldown_seconds: number
          breaker_failure_threshold: number
          daily_usd_cap: number
          disabled_reason: string | null
          id: boolean
          pending_timeout_seconds: number
          updated_at: string
          user_daily_usd_cap_elite: number
          user_daily_usd_cap_free: number
          user_daily_usd_cap_pro: number
        }
        Insert: {
          analyze_enabled?: boolean
          breaker_cooldown_seconds?: number
          breaker_failure_threshold?: number
          daily_usd_cap?: number
          disabled_reason?: string | null
          id?: boolean
          pending_timeout_seconds?: number
          updated_at?: string
          user_daily_usd_cap_elite?: number
          user_daily_usd_cap_free?: number
          user_daily_usd_cap_pro?: number
        }
        Update: {
          analyze_enabled?: boolean
          breaker_cooldown_seconds?: number
          breaker_failure_threshold?: number
          daily_usd_cap?: number
          disabled_reason?: string | null
          id?: boolean
          pending_timeout_seconds?: number
          updated_at?: string
          user_daily_usd_cap_elite?: number
          user_daily_usd_cap_free?: number
          user_daily_usd_cap_pro?: number
        }
        Relationships: []
      }
      analyses: {
        Row: {
          created_at: string
          deleted_at: string | null
          delivered_at: string | null
          frame_count: number
          id: string
          idempotency_key: string
          is_fallback: boolean
          media_paths: string[]
          media_type: Database["public"]["Enums"]["media_type"]
          release_reason: string | null
          released_at: string | null
          result: Json | null
          status: Database["public"]["Enums"]["analysis_status"]
          tier_at_run: Database["public"]["Enums"]["analysis_tier"]
          updated_at: string
          user_id: string
          zero_pillar_at: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          delivered_at?: string | null
          frame_count: number
          id?: string
          idempotency_key: string
          is_fallback?: boolean
          media_paths?: string[]
          media_type: Database["public"]["Enums"]["media_type"]
          release_reason?: string | null
          released_at?: string | null
          result?: Json | null
          status?: Database["public"]["Enums"]["analysis_status"]
          tier_at_run: Database["public"]["Enums"]["analysis_tier"]
          updated_at?: string
          user_id: string
          zero_pillar_at?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          delivered_at?: string | null
          frame_count?: number
          id?: string
          idempotency_key?: string
          is_fallback?: boolean
          media_paths?: string[]
          media_type?: Database["public"]["Enums"]["media_type"]
          release_reason?: string | null
          released_at?: string | null
          result?: Json | null
          status?: Database["public"]["Enums"]["analysis_status"]
          tier_at_run?: Database["public"]["Enums"]["analysis_tier"]
          updated_at?: string
          user_id?: string
          zero_pillar_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analyses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_request_aliases: {
        Row: {
          analysis_id: string
          analyzer_revision: string
          created_at: string
          idempotency_key: string
          input_fingerprint: string
          tier_at_run: Database["public"]["Enums"]["analysis_tier"]
          user_id: string
        }
        Insert: {
          analysis_id: string
          analyzer_revision: string
          created_at?: string
          idempotency_key: string
          input_fingerprint: string
          tier_at_run: Database["public"]["Enums"]["analysis_tier"]
          user_id: string
        }
        Update: {
          analysis_id?: string
          analyzer_revision?: string
          created_at?: string
          idempotency_key?: string
          input_fingerprint?: string
          tier_at_run?: Database["public"]["Enums"]["analysis_tier"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_request_aliases_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_request_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_analysis_claims: {
        Row: {
          analysis_id: string
          analyzer_revision: string
          created_at: string
          input_fingerprint: string
          tier_at_run: Database["public"]["Enums"]["analysis_tier"]
          user_id: string
        }
        Insert: {
          analysis_id: string
          analyzer_revision: string
          created_at?: string
          input_fingerprint: string
          tier_at_run: Database["public"]["Enums"]["analysis_tier"]
          user_id: string
        }
        Update: {
          analysis_id?: string
          analyzer_revision?: string
          created_at?: string
          input_fingerprint?: string
          tier_at_run?: Database["public"]["Enums"]["analysis_tier"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canonical_analysis_claims_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: true
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_analysis_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          consent_key: string
          created_at: string
          granted: boolean
          id: string
          user_id: string
        }
        Insert: {
          consent_key: string
          created_at?: string
          granted: boolean
          id?: string
          user_id?: string
        }
        Update: {
          consent_key?: string
          created_at?: string
          granted?: boolean
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_consent: {
        Row: {
          granted_at: string
          policy_version: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          policy_version: string
          user_id: string
        }
        Update: {
          granted_at?: string
          policy_version?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age_band: string | null
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          age_band?: string | null
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          age_band?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          purchased_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          purchased_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          purchased_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_breaker_state: { Args: never; Returns: Json }
      ai_spend_today: { Args: never; Returns: Json }
      ai_user_daily_cap_usd: {
        Args: { p_tier: Database["public"]["Enums"]["analysis_tier"] }
        Returns: number
      }
      attach_media_paths: {
        Args: {
          p_analysis_id: string
          p_media_paths: string[]
          p_user_id: string
        }
        Returns: Json
      }
      gate_ai_call: {
        Args: {
          p_analysis_id?: string
          p_estimated_input_tokens: number
          p_estimated_output_tokens: number
          p_model?: string
          p_user_id: string
        }
        Returns: Json
      }
      gate_ai_call_for_tier: {
        Args: {
          p_analysis_id?: string
          p_estimated_input_tokens: number
          p_estimated_output_tokens: number
          p_model?: string
          p_tier: Database["public"]["Enums"]["analysis_tier"]
          p_user_id: string
        }
        Returns: Json
      }
      gate_ai_call_unlimited: {
        Args: {
          p_analysis_id?: string
          p_estimated_input_tokens: number
          p_estimated_output_tokens: number
          p_model?: string
          p_user_id: string
        }
        Returns: Json
      }
      list_orphaned_media_prefixes: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: {
          analysis_id: string
          object_count: number
          oldest_object_at: string
          prefix: string
          user_id: string
        }[]
      }
      pace_add_months_clamped: {
        Args: { base: string; n: number }
        Returns: string
      }
      pace_before_user_created: { Args: { event: Json }; Returns: Json }
      pace_current_period: {
        Args: { anchor: string; as_of: string }
        Returns: unknown
      }
      pace_current_tier: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["analysis_tier"]
      }
      pace_is_farming_signal: {
        Args: { p_release_reason: string }
        Returns: boolean
      }
      pace_media_paths_within_namespace: {
        Args: {
          p_analysis_id: string
          p_media_paths: string[]
          p_user_id: string
        }
        Returns: boolean
      }
      pace_purchase_tier: {
        Args: {
          p_tier: Database["public"]["Enums"]["subscription_tier"]
          p_user_id: string
        }
        Returns: Json
      }
      pace_quota_status: {
        Args: { p_as_of?: string; p_user_id: string }
        Returns: Json
      }
      pace_quota_status_unlimited: {
        Args: { p_as_of?: string; p_user_id: string }
        Returns: Json
      }
      pace_record_age_band: {
        Args: {
          p_age_band: string
          p_guardian_consent: boolean
          p_policy_version: string
          p_user_id: string
        }
        Returns: undefined
      }
      pace_zero_pillar_cooldown_remaining: {
        Args: { p_user_id: string }
        Returns: number
      }
      pace_zero_pillar_cooldown_seconds: { Args: never; Returns: number }
      record_ai_call: {
        Args: {
          p_analysis_id?: string
          p_cache_creation_input_tokens?: number
          p_cache_read_input_tokens?: number
          p_call_id: string
          p_input_tokens?: number
          p_output_tokens?: number
          p_status: Database["public"]["Enums"]["ai_call_status"]
        }
        Returns: Json
      }
      release_analysis: {
        Args: { p_analysis_id: string; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      reserve_analysis:
        | {
            Args: {
              p_frame_count: number
              p_idempotency_key: string
              p_media_type: Database["public"]["Enums"]["media_type"]
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_analysis_identity: Json
              p_frame_count: number
              p_idempotency_key: string
              p_media_type: Database["public"]["Enums"]["media_type"]
              p_user_id: string
            }
            Returns: Json
          }
      reserve_analysis_unlimited: {
        Args: {
          p_analysis_identity: Json
          p_frame_count: number
          p_idempotency_key: string
          p_media_type: Database["public"]["Enums"]["media_type"]
          p_user_id: string
        }
        Returns: Json
      }
      resolve_analysis_request: {
        Args: { p_idempotency_key: string }
        Returns: Json
      }
      settle_analysis:
        | {
            Args: {
              p_analysis_id: string
              p_is_fallback?: boolean
              p_media_paths?: string[]
              p_result: Json
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_analysis_id: string
              p_is_fallback: boolean
              p_media_paths: string[]
              p_result: Json
              p_user_id: string
              p_zero_pillar: boolean
            }
            Returns: Json
          }
      sweep_stale_reservations: {
        Args: { p_batch_limit?: number; p_stale_after?: string }
        Returns: number
      }
    }
    Enums: {
      ai_call_status:
        | "pending"
        | "success"
        | "model_error"
        | "validation_failed"
        | "fallback"
        | "cancelled"
      analysis_status: "reserved" | "delivered" | "released"
      analysis_tier: "free" | "pro" | "elite"
      media_type: "photo" | "video"
      subscription_status: "active" | "canceled"
      subscription_tier: "pro" | "elite"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_call_status: [
        "pending",
        "success",
        "model_error",
        "validation_failed",
        "fallback",
        "cancelled",
      ],
      analysis_status: ["reserved", "delivered", "released"],
      analysis_tier: ["free", "pro", "elite"],
      media_type: ["photo", "video"],
      subscription_status: ["active", "canceled"],
      subscription_tier: ["pro", "elite"],
    },
  },
} as const

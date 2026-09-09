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
// KNOWN DRIFT (2026-07-13): two functions defined in this repo's migrations —
// `pace_quota_status` (`20260712233000_quota_status_function.sql`) and `pace_purchase_tier`
// (`20260713120000_purchase_tier_function.sql`) — are NOT present below because they have not
// been pushed to the linked project yet (confirmed via the Supabase MCP's `list_migrations`,
// which stops at `20260712230000`). This is expected and already documented at the two call
// sites that depend on them (`supabase/functions/_shared/quota-status.ts`,
// `supabase/functions/_shared/purchase-tier.ts` — both deploy-gated, per their own headers).
// Once those migrations are pushed, regenerate this file and the two `.rpc(...)` calls in that
// pair of edge functions will start being checked against real return types instead of
// whatever shape their hand-written parsers assume.
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
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
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
      pace_add_months_clamped: {
        Args: { base: string; n: number }
        Returns: string
      }
      pace_current_period: {
        Args: { anchor: string; as_of: string }
        Returns: unknown
      }
      pace_is_farming_signal: {
        Args: { p_release_reason: string }
        Returns: boolean
      }
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
      resolve_analysis_request: {
        Args: { p_idempotency_key: string }
        Returns: Json
      }
      reserve_analysis: {
        Args:
          | {
              p_frame_count: number
              p_idempotency_key: string
              p_media_type: Database["public"]["Enums"]["media_type"]
              p_user_id: string
            }
          | {
              p_analysis_identity: Json
              p_frame_count: number
              p_idempotency_key: string
              p_media_type: Database["public"]["Enums"]["media_type"]
              p_user_id: string
            }
        Returns: Json
      }
      reserve_analysis_unlimited: {
        Args:
          | {
              p_frame_count: number
              p_idempotency_key: string
              p_media_type: Database["public"]["Enums"]["media_type"]
              p_user_id: string
            }
          | {
              p_analysis_identity: Json
              p_frame_count: number
              p_idempotency_key: string
              p_media_type: Database["public"]["Enums"]["media_type"]
              p_user_id: string
            }
        Returns: Json
      }
      settle_analysis: {
        Args: {
          p_analysis_id: string
          p_is_fallback?: boolean
          p_media_paths?: string[]
          p_result: Json
          p_user_id: string
        }
        Returns: Json
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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

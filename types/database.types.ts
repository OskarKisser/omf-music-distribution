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
    PostgrestVersion: "14.4"
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
      ai_moderation_logs: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          flagged_reasons: Json | null
          id: string
          model: string | null
          release_id: string | null
          status: string | null
          user_id: number | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          flagged_reasons?: Json | null
          id?: string
          model?: string | null
          release_id?: string | null
          status?: string | null
          user_id?: number | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          flagged_reasons?: Json | null
          id?: string
          model?: string | null
          release_id?: string | null
          status?: string | null
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_moderation_logs_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          created_at: string
          error_message: string
          id: string
          screen_name: string | null
          stack_trace: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          id?: string
          screen_name?: string | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          id?: string
          screen_name?: string | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      release_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          release_id: string | null
          stage: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          release_id?: string | null
          stage?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          release_id?: string | null
          stage?: string | null
          status?: string | null
        }
        Relationships: []
      }
      releases: {
        Row: {
          admin_notes: string | null
          artist_links: Json | null
          artist_name: string | null
          artwork_url: string | null
          audio_url: string | null
          author_full_name: string | null
          c_line: string | null
          client_request_id: string | null
          collaborators: Json | null
          created_at: string
          draft_upload_started: boolean | null
          error_message: string | null
          explicit: boolean | null
          genre: string | null
          id: string
          is_explicit: boolean | null
          isrc: string | null
          language: string | null
          license_type: string | null
          lyrics: string | null
          moderator_notes: string | null
          mood: string | null
          music_author: string | null
          p_line: string | null
          payment_status: string | null
          payment_updated_at: string | null
          payment_updated_by: string | null
          performance_language: string | null
          planned_release_date: string | null
          release_date: string | null
          release_type: string | null
          status: Database["public"]["Enums"]["release_status"] | null
          sub_genre: string | null
          smart_link: string | null
          telegram_id: string | null
          telegram_pending_ack_sent_at: string | null
          takedown_requested_at: string | null
          takedown_reason: string | null
          draft_reminded_at: string | null
          release_day_notified_at: string | null
          colleagues_sent_at: string | null
          telegram_username: string | null
          terms_accepted_at: string | null
          title: string | null
          track_name: string | null
          upc: string | null
          user_id: string | null
          user_uuid: string | null
        }
        Insert: {
          admin_notes?: string | null
          artist_links?: Json | null
          artist_name?: string | null
          artwork_url?: string | null
          audio_url?: string | null
          author_full_name?: string | null
          c_line?: string | null
          client_request_id?: string | null
          collaborators?: Json | null
          created_at?: string
          draft_upload_started?: boolean | null
          error_message?: string | null
          explicit?: boolean | null
          genre?: string | null
          id?: string
          is_explicit?: boolean | null
          isrc?: string | null
          language?: string | null
          license_type?: string | null
          lyrics?: string | null
          moderator_notes?: string | null
          mood?: string | null
          music_author?: string | null
          p_line?: string | null
          payment_status?: string | null
          payment_updated_at?: string | null
          payment_updated_by?: string | null
          performance_language?: string | null
          planned_release_date?: string | null
          release_date?: string | null
          release_type?: string | null
          status?: Database["public"]["Enums"]["release_status"] | null
          sub_genre?: string | null
          smart_link?: string | null
          telegram_id?: string | null
          telegram_pending_ack_sent_at?: string | null
          takedown_requested_at?: string | null
          takedown_reason?: string | null
          draft_reminded_at?: string | null
          release_day_notified_at?: string | null
          colleagues_sent_at?: string | null
          telegram_username?: string | null
          terms_accepted_at?: string | null
          title?: string | null
          track_name?: string | null
          upc?: string | null
          user_id?: string | null
          user_uuid?: string | null
        }
        Update: {
          admin_notes?: string | null
          artist_links?: Json | null
          artist_name?: string | null
          artwork_url?: string | null
          audio_url?: string | null
          author_full_name?: string | null
          c_line?: string | null
          client_request_id?: string | null
          collaborators?: Json | null
          created_at?: string
          draft_upload_started?: boolean | null
          error_message?: string | null
          explicit?: boolean | null
          genre?: string | null
          id?: string
          is_explicit?: boolean | null
          isrc?: string | null
          language?: string | null
          license_type?: string | null
          lyrics?: string | null
          moderator_notes?: string | null
          mood?: string | null
          music_author?: string | null
          p_line?: string | null
          payment_status?: string | null
          payment_updated_at?: string | null
          payment_updated_by?: string | null
          performance_language?: string | null
          planned_release_date?: string | null
          release_date?: string | null
          release_type?: string | null
          status?: Database["public"]["Enums"]["release_status"] | null
          sub_genre?: string | null
          smart_link?: string | null
          telegram_id?: string | null
          telegram_pending_ack_sent_at?: string | null
          takedown_requested_at?: string | null
          takedown_reason?: string | null
          draft_reminded_at?: string | null
          release_day_notified_at?: string | null
          colleagues_sent_at?: string | null
          telegram_username?: string | null
          terms_accepted_at?: string | null
          title?: string | null
          track_name?: string | null
          upc?: string | null
          user_id?: string | null
          user_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "releases_user_uuid_fkey"
            columns: ["user_uuid"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          created_at: string | null
          duration: number | null
          explicit: boolean | null
          file_path: string | null
          id: string
          index: number | null
          lyrics: string | null
          position: number | null
          release_id: string | null
          telegram_id: string | null
          title: string | null
          user_id: number | null
          user_uuid: string | null
        }
        Insert: {
          created_at?: string | null
          duration?: number | null
          explicit?: boolean | null
          file_path?: string | null
          id?: string
          index?: number | null
          lyrics?: string | null
          position?: number | null
          release_id?: string | null
          telegram_id?: string | null
          title?: string | null
          user_id?: number | null
          user_uuid?: string | null
        }
        Update: {
          created_at?: string | null
          duration?: number | null
          explicit?: boolean | null
          file_path?: string | null
          id?: string
          index?: number | null
          lyrics?: string | null
          position?: number | null
          release_id?: string | null
          telegram_id?: string | null
          title?: string | null
          user_id?: number | null
          user_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracks_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_user_uuid_fkey"
            columns: ["user_uuid"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string | null
          payout_details: Json | null
          payout_method: string | null
          push_notifications: boolean | null
          updated_at: string | null
          user_id: number
          user_uuid: string | null
        }
        Insert: {
          created_at?: string | null
          payout_details?: Json | null
          payout_method?: string | null
          push_notifications?: boolean | null
          updated_at?: string | null
          user_id: number
          user_uuid?: string | null
        }
        Update: {
          created_at?: string | null
          payout_details?: Json | null
          payout_method?: string | null
          push_notifications?: boolean | null
          updated_at?: string | null
          user_id?: number
          user_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_uuid_fkey"
            columns: ["user_uuid"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          account_linked_at: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          telegram_first_name: string | null
          telegram_id: number | null
          telegram_is_premium: boolean | null
          telegram_language_code: string | null
          telegram_last_name: string | null
          telegram_photo_url: string | null
          telegram_username: string | null
          updated_at: string
        }
        Insert: {
          account_linked_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          telegram_first_name?: string | null
          telegram_id?: number | null
          telegram_is_premium?: boolean | null
          telegram_language_code?: string | null
          telegram_last_name?: string | null
          telegram_photo_url?: string | null
          telegram_username?: string | null
          updated_at?: string
        }
        Update: {
          account_linked_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          telegram_first_name?: string | null
          telegram_id?: number | null
          telegram_is_premium?: boolean | null
          telegram_language_code?: string | null
          telegram_last_name?: string | null
          telegram_photo_url?: string | null
          telegram_username?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_release_safe: {
        Args: {
          p_client_request_id: string
          p_title: string
          p_user_id: string
        }
        Returns: string
      }
      current_user_uuid: { Args: never; Returns: string }
      finalize_release: {
        Args: { p_client_request_id: string; p_release_id: string }
        Returns: Database["public"]["Tables"]["releases"]["Row"][]
      }
      get_current_user_id: { Args: never; Returns: string }
      get_user_id_by_telegram: {
        Args: { p_telegram_id: number }
        Returns: string
      }
      is_admin_request: { Args: never; Returns: boolean }
      log_release_event: {
        Args: {
          p_error?: string
          p_release_id: string
          p_stage: string
          p_status: string
        }
        Returns: undefined
      }
      migrate_table_user_ids_to_uuid: {
        Args: {
          p_new_column_name?: string
          p_old_column_name?: string
          p_table_name: string
        }
        Returns: number
      }
    }
    Enums: {
      release_status:
        | "draft"
        | "processing"
        | "ready"
        | "failed"
        | "review"
        | "pending"
        | "removed"
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
      release_status: [
        "draft",
        "processing",
        "ready",
        "failed",
        "review",
        "pending",
        "removed",
      ],
    },
  },
} as const

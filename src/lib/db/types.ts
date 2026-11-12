export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      account_metrics: {
        Row: {
          account_id: string;
          created_at: string;
          day: string;
          followers: number;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          created_at?: string;
          day: string;
          followers: number;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          day?: string;
          followers?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_metrics_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "account_metrics_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      api_keys: {
        Row: {
          created_at: string;
          id: string;
          key_hash: string;
          last_used_at: string | null;
          name: string;
          revoked_at: string | null;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          key_hash: string;
          last_used_at?: string | null;
          name: string;
          revoked_at?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          key_hash?: string;
          last_used_at?: string | null;
          name?: string;
          revoked_at?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "api_keys_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          allowed_email: string | null;
          id: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          allowed_email?: string | null;
          id?: boolean;
          updated_at?: string;
        };
        Update: {
          allowed_email?: string | null;
          id?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      avatar_versions: {
        Row: {
          avatar_id: string;
          created_at: string;
          note: string;
          profile: NonNullable<Json>;
          version: number;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_id: string;
          created_at?: string;
          note?: string;
          profile: NonNullable<Json>;
          version: number;
          workspace_id: string;
        };
        Update: {
          avatar_id?: string;
          created_at?: string;
          note?: string;
          profile?: NonNullable<Json>;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "avatar_versions_avatar_id_workspace_id_fkey";
            columns: ["avatar_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "avatars";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "avatar_versions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      avatars: {
        Row: {
          account_id: string | null;
          created_at: string;
          current_version: number;
          id: string;
          name: string;
          profile: NonNullable<Json>;
          studio: NonNullable<Json>;
          studio_step: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          created_at?: string;
          current_version?: number;
          id?: string;
          name: string;
          profile?: NonNullable<Json>;
          studio?: NonNullable<Json>;
          studio_step?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string | null;
          created_at?: string;
          current_version?: number;
          id?: string;
          name?: string;
          profile?: NonNullable<Json>;
          studio?: NonNullable<Json>;
          studio_step?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "avatars_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "avatars_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      brands: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brands_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      content_uploads: {
        Row: {
          api_key_id: string;
          content_type: string;
          created_at: string;
          expires_at: string;
          file_name: string;
          id: string;
          storage_path: string;
          used_at: string | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          api_key_id: string;
          content_type: string;
          created_at?: string;
          expires_at: string;
          file_name: string;
          id: string;
          storage_path: string;
          used_at?: string | null;
          workspace_id: string;
        };
        Update: {
          api_key_id?: string;
          content_type?: string;
          created_at?: string;
          expires_at?: string;
          file_name?: string;
          id?: string;
          storage_path?: string;
          used_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_uploads_api_key_id_workspace_id_fkey";
            columns: ["api_key_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "api_keys";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "content_uploads_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      factory_music: {
        Row: {
          artist: string;
          bpm: number | null;
          credit: string;
          key: string;
          licence: string;
          mood: string;
          sample_url: string;
          sort: number;
          source_url: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          artist: string;
          bpm?: number | null;
          credit: string;
          key: string;
          licence: string;
          mood?: string;
          sample_url: string;
          sort?: number;
          source_url: string;
          title: string;
        };
        Update: {
          artist?: string;
          bpm?: number | null;
          credit?: string;
          key?: string;
          licence?: string;
          mood?: string;
          sample_url?: string;
          sort?: number;
          source_url?: string;
          title?: string;
        };
        Relationships: [];
      };
      factory_settings: {
        Row: {
          cap_monthly_usd: number;
          cap_per_video_usd: number;
          created_at: string;
          default_face_model: string;
          enabled_models: string[];
          fallback_face_model: string | null;
          step_modes: NonNullable<Json>;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          cap_monthly_usd?: number;
          cap_per_video_usd?: number;
          created_at?: string;
          default_face_model?: string;
          enabled_models?: string[];
          fallback_face_model?: string | null;
          step_modes?: NonNullable<Json>;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          cap_monthly_usd?: number;
          cap_per_video_usd?: number;
          created_at?: string;
          default_face_model?: string;
          enabled_models?: string[];
          fallback_face_model?: string | null;
          step_modes?: NonNullable<Json>;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "factory_settings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      factory_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          last_used_at: string | null;
          production_id: string;
          revoked_at: string | null;
          token_hash: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          last_used_at?: string | null;
          production_id: string;
          revoked_at?: string | null;
          token_hash: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_used_at?: string | null;
          production_id?: string;
          revoked_at?: string | null;
          token_hash?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "factory_tokens_production_id_workspace_id_fkey";
            columns: ["production_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "productions";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "factory_tokens_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      factory_voices: {
        Row: {
          credit: string;
          description: string;
          key: string;
          kind: string;
          label: string;
          licence: string;
          model: string | null;
          paid: boolean;
          provider: string;
          sample_text: string | null;
          sample_url: string | null;
          sort: number;
        };
        ComputedFields: never;
        Insert: {
          credit: string;
          description?: string;
          key: string;
          kind: string;
          label: string;
          licence: string;
          model?: string | null;
          paid?: boolean;
          provider?: string;
          sample_text?: string | null;
          sample_url?: string | null;
          sort?: number;
        };
        Update: {
          credit?: string;
          description?: string;
          key?: string;
          kind?: string;
          label?: string;
          licence?: string;
          model?: string | null;
          paid?: boolean;
          provider?: string;
          sample_text?: string | null;
          sample_url?: string | null;
          sort?: number;
        };
        Relationships: [];
      };
      fake_accounts: {
        Row: {
          account_id: string;
          created_at: string;
          failure_mode: string | null;
          failures_left: number | null;
          quota_limit: number;
          ready_after_checks: number;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          created_at?: string;
          failure_mode?: string | null;
          failures_left?: number | null;
          quota_limit?: number;
          ready_after_checks?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          failure_mode?: string | null;
          failures_left?: number | null;
          quota_limit?: number;
          ready_after_checks?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fake_accounts_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "fake_accounts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      fake_containers: {
        Row: {
          account_id: string;
          caption: string;
          created_at: string;
          id: string;
          media_id: string | null;
          permalink: string | null;
          published_at: string | null;
          status_checks: number;
          updated_at: string;
          video_url: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          caption?: string;
          created_at?: string;
          id: string;
          media_id?: string | null;
          permalink?: string | null;
          published_at?: string | null;
          status_checks?: number;
          updated_at?: string;
          video_url: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          caption?: string;
          created_at?: string;
          id?: string;
          media_id?: string | null;
          permalink?: string | null;
          published_at?: string | null;
          status_checks?: number;
          updated_at?: string;
          video_url?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fake_containers_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "fake_containers_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      gen_jobs: {
        Row: {
          avatar_id: string | null;
          completed_at: string | null;
          cost_usd: number | null;
          created_at: string;
          error: string | null;
          id: string;
          idempotency_key: string;
          input: NonNullable<Json>;
          kind: string;
          model: string;
          output_url: string | null;
          production_id: string | null;
          provider: string;
          provider_request_id: string | null;
          quote_usd: number;
          response_url: string | null;
          seconds: number;
          slot: string;
          status: Database["public"]["Enums"]["gen_job_status"];
          status_url: string | null;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_id?: string | null;
          completed_at?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          idempotency_key: string;
          input?: NonNullable<Json>;
          kind?: string;
          model: string;
          output_url?: string | null;
          production_id?: string | null;
          provider: string;
          provider_request_id?: string | null;
          quote_usd: number;
          response_url?: string | null;
          seconds: number;
          slot: string;
          status?: Database["public"]["Enums"]["gen_job_status"];
          status_url?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          avatar_id?: string | null;
          completed_at?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          idempotency_key?: string;
          input?: NonNullable<Json>;
          kind?: string;
          model?: string;
          output_url?: string | null;
          production_id?: string | null;
          provider?: string;
          provider_request_id?: string | null;
          quote_usd?: number;
          response_url?: string | null;
          seconds?: number;
          slot?: string;
          status?: Database["public"]["Enums"]["gen_job_status"];
          status_url?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gen_jobs_avatar_id_workspace_id_fkey";
            columns: ["avatar_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "avatars";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "gen_jobs_production_id_workspace_id_fkey";
            columns: ["production_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "productions";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "gen_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      gen_keys: {
        Row: {
          created_at: string;
          key_enc: string;
          last4: string;
          provider: string;
          test_message: string | null;
          test_ok: boolean | null;
          tested_at: string | null;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          key_enc: string;
          last4: string;
          provider: string;
          test_message?: string | null;
          test_ok?: boolean | null;
          tested_at?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          key_enc?: string;
          last4?: string;
          provider?: string;
          test_message?: string | null;
          test_ok?: boolean | null;
          tested_at?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gen_keys_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      job_log: {
        Row: {
          account_id: string | null;
          at: string;
          id: number;
          kind: string;
          message: string | null;
          ok: boolean;
          post_id: string | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          at?: string;
          id?: never;
          kind: string;
          message?: string | null;
          ok: boolean;
          post_id?: string | null;
          workspace_id: string;
        };
        Update: {
          account_id?: string | null;
          at?: string;
          id?: never;
          kind?: string;
          message?: string | null;
          ok?: boolean;
          post_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_log_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "job_log_post_id_workspace_id_fkey";
            columns: ["post_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "job_log_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      media_assets: {
        Row: {
          bytes: number | null;
          created_at: string;
          deleted_at: string | null;
          duration_s: number | null;
          height: number | null;
          id: string;
          recipe: Json | null;
          storage_path: string;
          thumbnail_path: string | null;
          updated_at: string;
          width: number | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          bytes?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          duration_s?: number | null;
          height?: number | null;
          id?: string;
          recipe?: Json | null;
          storage_path: string;
          thumbnail_path?: string | null;
          updated_at?: string;
          width?: number | null;
          workspace_id: string;
        };
        Update: {
          bytes?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          duration_s?: number | null;
          height?: number | null;
          id?: string;
          recipe?: Json | null;
          storage_path?: string;
          thumbnail_path?: string | null;
          updated_at?: string;
          width?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "media_assets_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      oauth_credentials: {
        Row: {
          access_token_enc: string;
          account_id: string;
          checked_at: string | null;
          created_at: string;
          expires_at: string | null;
          last_refreshed_at: string | null;
          refresh_claim_token: string | null;
          refresh_claimed_until: string | null;
          refresh_retry_at: string | null;
          refresh_token_enc: string | null;
          scopes: string[];
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          access_token_enc: string;
          account_id: string;
          checked_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          last_refreshed_at?: string | null;
          refresh_claim_token?: string | null;
          refresh_claimed_until?: string | null;
          refresh_retry_at?: string | null;
          refresh_token_enc?: string | null;
          scopes?: string[];
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          access_token_enc?: string;
          account_id?: string;
          checked_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          last_refreshed_at?: string | null;
          refresh_claim_token?: string | null;
          refresh_claimed_until?: string | null;
          refresh_retry_at?: string | null;
          refresh_token_enc?: string | null;
          scopes?: string[];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "oauth_credentials_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "oauth_credentials_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      oauth_states: {
        Row: {
          account_id: string | null;
          brand_id: string;
          created_at: string;
          expires_at: string;
          platform: Database["public"]["Enums"]["platform"];
          state: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          brand_id: string;
          created_at?: string;
          expires_at?: string;
          platform: Database["public"]["Enums"]["platform"];
          state: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string | null;
          brand_id?: string;
          created_at?: string;
          expires_at?: string;
          platform?: Database["public"]["Enums"]["platform"];
          state?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "oauth_states_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "oauth_states_brand_id_workspace_id_fkey";
            columns: ["brand_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "oauth_states_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      post_metrics: {
        Row: {
          comments: number | null;
          created_at: string;
          due_at: string;
          id: string;
          likes: number | null;
          missed: boolean;
          post_id: string;
          reach: number | null;
          saves: number | null;
          shares: number | null;
          stat_offset: Database["public"]["Enums"]["stat_offset"];
          taken_at: string | null;
          views: number | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          comments?: number | null;
          created_at?: string;
          due_at: string;
          id?: string;
          likes?: number | null;
          missed?: boolean;
          post_id: string;
          reach?: number | null;
          saves?: number | null;
          shares?: number | null;
          stat_offset: Database["public"]["Enums"]["stat_offset"];
          taken_at?: string | null;
          views?: number | null;
          workspace_id: string;
        };
        Update: {
          comments?: number | null;
          created_at?: string;
          due_at?: string;
          id?: string;
          likes?: number | null;
          missed?: boolean;
          post_id?: string;
          reach?: number | null;
          saves?: number | null;
          shares?: number | null;
          stat_offset?: Database["public"]["Enums"]["stat_offset"];
          taken_at?: string | null;
          views?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_metrics_post_id_workspace_id_fkey";
            columns: ["post_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "post_metrics_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          account_id: string;
          attempts: number;
          caption: string;
          claim_token: string | null;
          claimed_until: string | null;
          container_created_at: string | null;
          container_id: string | null;
          created_at: string;
          id: string;
          is_ai_generated: boolean;
          last_error: string | null;
          media_id: string;
          media_ig_id: string | null;
          next_attempt_at: string | null;
          permalink: string | null;
          published_at: string | null;
          queue_position: number | null;
          scheduled_at: string | null;
          status: Database["public"]["Enums"]["post_status"];
          timing: Database["public"]["Enums"]["post_timing"];
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          attempts?: number;
          caption?: string;
          claim_token?: string | null;
          claimed_until?: string | null;
          container_created_at?: string | null;
          container_id?: string | null;
          created_at?: string;
          id?: string;
          is_ai_generated?: boolean;
          last_error?: string | null;
          media_id: string;
          media_ig_id?: string | null;
          next_attempt_at?: string | null;
          permalink?: string | null;
          published_at?: string | null;
          queue_position?: number | null;
          scheduled_at?: string | null;
          status?: Database["public"]["Enums"]["post_status"];
          timing?: Database["public"]["Enums"]["post_timing"];
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          attempts?: number;
          caption?: string;
          claim_token?: string | null;
          claimed_until?: string | null;
          container_created_at?: string | null;
          container_id?: string | null;
          created_at?: string;
          id?: string;
          is_ai_generated?: boolean;
          last_error?: string | null;
          media_id?: string;
          media_ig_id?: string | null;
          next_attempt_at?: string | null;
          permalink?: string | null;
          published_at?: string | null;
          queue_position?: number | null;
          scheduled_at?: string | null;
          status?: Database["public"]["Enums"]["post_status"];
          timing?: Database["public"]["Enums"]["post_timing"];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posts_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "posts_media_id_workspace_id_fkey";
            columns: ["media_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "posts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      production_reworks: {
        Row: {
          created_at: string;
          id: string;
          note: string;
          production_id: string;
          quote_usd: number;
          ref: string | null;
          status: string;
          target: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          note?: string;
          production_id: string;
          quote_usd?: number;
          ref?: string | null;
          status?: string;
          target: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string;
          production_id?: string;
          quote_usd?: number;
          ref?: string | null;
          status?: string;
          target?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_reworks_production_id_workspace_id_fkey";
            columns: ["production_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "productions";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "production_reworks_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      production_steps: {
        Row: {
          attempt: number;
          created_at: string;
          finished_at: string | null;
          message: string | null;
          output: NonNullable<Json>;
          production_id: string;
          progress: number;
          session_id: string | null;
          session_url: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["factory_step_status"];
          step: Database["public"]["Enums"]["factory_step"];
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          attempt?: number;
          created_at?: string;
          finished_at?: string | null;
          message?: string | null;
          output?: NonNullable<Json>;
          production_id: string;
          progress?: number;
          session_id?: string | null;
          session_url?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["factory_step_status"];
          step: Database["public"]["Enums"]["factory_step"];
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          attempt?: number;
          created_at?: string;
          finished_at?: string | null;
          message?: string | null;
          output?: NonNullable<Json>;
          production_id?: string;
          progress?: number;
          session_id?: string | null;
          session_url?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["factory_step_status"];
          step?: Database["public"]["Enums"]["factory_step"];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_steps_production_id_workspace_id_fkey";
            columns: ["production_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "productions";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "production_steps_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      productions: {
        Row: {
          account_id: string | null;
          avatar_id: string | null;
          avatar_version: number | null;
          caption: string | null;
          caption_options: NonNullable<Json>;
          created_at: string;
          face_model: string | null;
          id: string;
          idea: string;
          media_id: string | null;
          music_key: string | null;
          post_id: string | null;
          project_slug: string | null;
          remake_of: string | null;
          script: Json | null;
          session_id: string | null;
          session_url: string | null;
          status: Database["public"]["Enums"]["production_status"];
          step_modes: NonNullable<Json>;
          style: string | null;
          title: string;
          updated_at: string;
          use_avatar: boolean;
          voice_key: string | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          avatar_id?: string | null;
          avatar_version?: number | null;
          caption?: string | null;
          caption_options?: NonNullable<Json>;
          created_at?: string;
          face_model?: string | null;
          id?: string;
          idea?: string;
          media_id?: string | null;
          music_key?: string | null;
          post_id?: string | null;
          project_slug?: string | null;
          remake_of?: string | null;
          script?: Json | null;
          session_id?: string | null;
          session_url?: string | null;
          status?: Database["public"]["Enums"]["production_status"];
          step_modes?: NonNullable<Json>;
          style?: string | null;
          title?: string;
          updated_at?: string;
          use_avatar?: boolean;
          voice_key?: string | null;
          workspace_id: string;
        };
        Update: {
          account_id?: string | null;
          avatar_id?: string | null;
          avatar_version?: number | null;
          caption?: string | null;
          caption_options?: NonNullable<Json>;
          created_at?: string;
          face_model?: string | null;
          id?: string;
          idea?: string;
          media_id?: string | null;
          music_key?: string | null;
          post_id?: string | null;
          project_slug?: string | null;
          remake_of?: string | null;
          script?: Json | null;
          session_id?: string | null;
          session_url?: string | null;
          status?: Database["public"]["Enums"]["production_status"];
          step_modes?: NonNullable<Json>;
          style?: string | null;
          title?: string;
          updated_at?: string;
          use_avatar?: boolean;
          voice_key?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "productions_account_id_workspace_id_fkey";
            columns: ["account_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "productions_avatar_id_workspace_id_fkey";
            columns: ["avatar_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "avatars";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "productions_media_id_workspace_id_fkey";
            columns: ["media_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "productions_music_key_fkey";
            columns: ["music_key"];
            isOneToOne: false;
            referencedRelation: "factory_music";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "productions_post_id_workspace_id_fkey";
            columns: ["post_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "productions_remake_of_workspace_id_fkey";
            columns: ["remake_of", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "productions";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "productions_voice_key_fkey";
            columns: ["voice_key"];
            isOneToOne: false;
            referencedRelation: "factory_voices";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "productions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduler_status: {
        Row: {
          id: boolean;
          last_summary: Json | null;
          last_tick_at: string | null;
          last_tick_ms: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          id?: boolean;
          last_summary?: Json | null;
          last_tick_at?: string | null;
          last_tick_ms?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          last_summary?: Json | null;
          last_tick_at?: string | null;
          last_tick_ms?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          clock_override: string | null;
          created_at: string;
          timezone: string | null;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          clock_override?: string | null;
          created_at?: string;
          timezone?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          clock_override?: string | null;
          created_at?: string;
          timezone?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      social_accounts: {
        Row: {
          ai_bio_done: boolean;
          ai_label_done: boolean;
          brand_id: string;
          created_at: string;
          description: string;
          face_model: string | null;
          followers: number | null;
          handle: string;
          id: string;
          platform: Database["public"]["Enums"]["platform"];
          platform_user_id: string | null;
          profile_url: string | null;
          slots: string[];
          status: Database["public"]["Enums"]["account_status"];
          status_reason: string | null;
          tags: string[];
          updated_at: string;
          vault_url: string | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          ai_bio_done?: boolean;
          ai_label_done?: boolean;
          brand_id: string;
          created_at?: string;
          description?: string;
          face_model?: string | null;
          followers?: number | null;
          handle: string;
          id?: string;
          platform: Database["public"]["Enums"]["platform"];
          platform_user_id?: string | null;
          profile_url?: string | null;
          slots?: string[];
          status?: Database["public"]["Enums"]["account_status"];
          status_reason?: string | null;
          tags?: string[];
          updated_at?: string;
          vault_url?: string | null;
          workspace_id: string;
        };
        Update: {
          ai_bio_done?: boolean;
          ai_label_done?: boolean;
          brand_id?: string;
          created_at?: string;
          description?: string;
          face_model?: string | null;
          followers?: number | null;
          handle?: string;
          id?: string;
          platform?: Database["public"]["Enums"]["platform"];
          platform_user_id?: string | null;
          profile_url?: string | null;
          slots?: string[];
          status?: Database["public"]["Enums"]["account_status"];
          status_reason?: string | null;
          tags?: string[];
          updated_at?: string;
          vault_url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_accounts_brand_id_workspace_id_fkey";
            columns: ["brand_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "social_accounts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["workspace_kind"];
          name: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["workspace_kind"];
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["workspace_kind"];
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_refresh: {
        Args: {
          p_lease_seconds?: number;
          p_limit: number;
          p_min_age_seconds: number;
          p_platforms: Database["public"]["Enums"]["platform"][];
          p_window_seconds: number;
          p_workspace_ids?: string[];
        };
        Returns: {
          account_id: string;
          claim_token: string;
          workspace_id: string;
        }[];
      };
      claim_work: {
        Args: {
          p_kind: string;
          p_lease_seconds?: number;
          p_limit: number;
          p_platforms: Database["public"]["Enums"]["platform"][];
          p_workspace_ids?: string[];
        };
        Returns: {
          claim_token: string;
          post_id: string;
          workspace_id: string;
        }[];
      };
      is_allowed_user: { Args: Record<PropertyKey, never>; Returns: boolean };
      move_post: {
        Args: {
          p_account_id: string;
          p_post_id: string;
          p_queue_position?: number;
          p_renumber?: Json;
          p_scheduled_at?: string;
          p_status: Database["public"]["Enums"]["post_status"];
          p_timing: Database["public"]["Enums"]["post_timing"];
          p_workspace_id: string;
        };
        Returns: string;
      };
      reset_sandbox: { Args: Record<PropertyKey, never>; Returns: undefined };
      schedule_tick: { Args: Record<PropertyKey, never>; Returns: string };
      unschedule_tick: { Args: Record<PropertyKey, never>; Returns: string };
      valid_slots: { Args: { slots: string[] }; Returns: boolean };
    };
    Enums: {
      account_status: "ready" | "needs_attention" | "not_connected";
      factory_step: "idea" | "script" | "style" | "visuals" | "face_quote" | "render";
      factory_step_status: "pending" | "running" | "waiting" | "approved" | "failed" | "skipped";
      gen_job_status: "queued" | "running" | "completed" | "failed";
      platform: "instagram" | "fake";
      post_status: "queued" | "publishing" | "published" | "failed" | "paused" | "removed";
      post_timing: "queue" | "pinned";
      production_status: "draft" | "running" | "waiting" | "ready" | "scheduled" | "failed";
      stat_offset: "1h" | "6h" | "24h" | "48h" | "7d";
      workspace_kind: "live" | "sandbox";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_status: ["ready", "needs_attention", "not_connected"],
      factory_step: ["idea", "script", "style", "visuals", "face_quote", "render"],
      factory_step_status: ["pending", "running", "waiting", "approved", "failed", "skipped"],
      gen_job_status: ["queued", "running", "completed", "failed"],
      platform: ["instagram", "fake"],
      post_status: ["queued", "publishing", "published", "failed", "paused", "removed"],
      post_timing: ["queue", "pinned"],
      production_status: ["draft", "running", "waiting", "ready", "scheduled", "failed"],
      stat_offset: ["1h", "6h", "24h", "48h", "7d"],
      workspace_kind: ["live", "sandbox"],
    },
  },
} as const;

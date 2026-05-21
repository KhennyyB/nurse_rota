export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_name: string | null;
          actor_role: string | null;
          created_at: string;
          id: string;
          target: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_name?: string | null;
          actor_role?: string | null;
          created_at?: string;
          id?: string;
          target?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          actor_role?: string | null;
          created_at?: string;
          id?: string;
          target?: string | null;
        };
        Relationships: [];
      };
      leave_requests: {
        Row: {
          created_at: string;
          from_date: string;
          id: string;
          nurse_id: string | null;
          nurse_name: string;
          reason: string | null;
          requested_by: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["leave_status"];
          to_date: string;
          type: Database["public"]["Enums"]["leave_type"];
        };
        Insert: {
          created_at?: string;
          from_date: string;
          id?: string;
          nurse_id?: string | null;
          nurse_name: string;
          reason?: string | null;
          requested_by?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["leave_status"];
          to_date: string;
          type: Database["public"]["Enums"]["leave_type"];
        };
        Update: {
          created_at?: string;
          from_date?: string;
          id?: string;
          nurse_id?: string | null;
          nurse_name?: string;
          reason?: string | null;
          requested_by?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["leave_status"];
          to_date?: string;
          type?: Database["public"]["Enums"]["leave_type"];
        };
        Relationships: [
          {
            foreignKeyName: "leave_requests_nurse_id_fkey";
            columns: ["nurse_id"];
            isOneToOne: false;
            referencedRelation: "nurses";
            referencedColumns: ["id"];
          },
        ];
      };
      nurses: {
        Row: {
          certifications: string[];
          created_at: string;
          facility: string | null;
          hours_this_month: number;
          id: string;
          name: string;
          role: string;
          target_hours: number;
          updated_at: string;
          ward: string | null;
        };
        Insert: {
          certifications?: string[];
          created_at?: string;
          facility?: string | null;
          hours_this_month?: number;
          id?: string;
          name: string;
          role?: string;
          target_hours?: number;
          updated_at?: string;
          ward?: string | null;
        };
        Update: {
          certifications?: string[];
          created_at?: string;
          facility?: string | null;
          hours_this_month?: number;
          id?: string;
          name?: string;
          role?: string;
          target_hours?: number;
          updated_at?: string;
          ward?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shift_assignments: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          nurse_id: string;
          shift: Database["public"]["Enums"]["shift_code"];
          shift_date: string;
          status: Database["public"]["Enums"]["assignment_status"];
          updated_at: string;
          ward: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          nurse_id: string;
          shift: Database["public"]["Enums"]["shift_code"];
          shift_date: string;
          status?: Database["public"]["Enums"]["assignment_status"];
          updated_at?: string;
          ward?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          nurse_id?: string;
          shift?: Database["public"]["Enums"]["shift_code"];
          shift_date?: string;
          status?: Database["public"]["Enums"]["assignment_status"];
          updated_at?: string;
          ward?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shift_assignments_nurse_id_fkey";
            columns: ["nurse_id"];
            isOneToOne: false;
            referencedRelation: "nurses";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      wards: {
        Row: {
          created_at: string;
          id: string;
          min_morning_na: number;
          min_morning_nurses: number;
          min_morning_supervisor: number;
          min_night_na: number;
          min_night_nurses: number;
          min_night_supervisor: number;
          name: string;
          patients: number;
          ratio: string | null;
          staffed: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          min_morning_na?: number;
          min_morning_nurses?: number;
          min_morning_supervisor?: number;
          min_night_na?: number;
          min_night_nurses?: number;
          min_night_supervisor?: number;
          name: string;
          patients?: number;
          ratio?: string | null;
          staffed?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          min_morning_na?: number;
          min_morning_nurses?: number;
          min_morning_supervisor?: number;
          min_night_na?: number;
          min_night_nurses?: number;
          min_night_supervisor?: number;
          name?: string;
          patients?: number;
          ratio?: string | null;
          staffed?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role:
        | "cno"
        | "chief_matron"
        | "head_nurse"
        | "ward_manager"
        | "hr_admin"
        | "nurse"
        | "admin";
      assignment_status: "draft" | "submitted" | "approved_chief" | "approved_cno" | "published";
      leave_status: "Pending" | "Approved" | "Rejected";
      leave_type: "Sick" | "Annual" | "Emergency" | "Public Holiday" | "Swap";
      shift_code: "M" | "N" | "OFF" | "LEAVE";
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["cno", "chief_matron", "head_nurse", "ward_manager", "hr_admin", "nurse", "admin"],
      assignment_status: ["draft", "submitted", "approved_chief", "approved_cno", "published"],
      leave_status: ["Pending", "Approved", "Rejected"],
      leave_type: ["Sick", "Annual", "Emergency", "Public Holiday", "Swap"],
      shift_code: ["M", "N", "OFF", "LEAVE"],
    },
  },
} as const;

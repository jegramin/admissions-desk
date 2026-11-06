
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "applicant_private": {
                  Row: {
                    "applicant_id": string,"date_of_birth": string,"learning_support_notes": string | null,"medical_notes": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "applicant_id": string,"date_of_birth": string,"learning_support_notes"?: string | null,"medical_notes"?: string | null
                  }
                  Update: {
                    "applicant_id"?: string,"date_of_birth"?: string,"learning_support_notes"?: string | null,"medical_notes"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "applicant_private_applicant_id_fkey"
      columns: ["applicant_id"]
isOneToOne: true
      referencedRelation: "applicants"
      referencedColumns: ["id"]
    }
                  ]
                },"applicants": {
                  Row: {
                    "current_school": string | null,"entry_grade": string,"entry_year": number,"first_name": string,"guardian_id": string,"id": string,"last_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "current_school"?: string | null,"entry_grade": string,"entry_year": number,"first_name": string,"guardian_id": string,"id"?: string,"last_name": string
                  }
                  Update: {
                    "current_school"?: string | null,"entry_grade"?: string,"entry_year"?: number,"first_name"?: string,"guardian_id"?: string,"id"?: string,"last_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "applicants_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "guardians"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "allowed": boolean,"arguments": NonNullable<Json>,"created_at": string,"id": string,"result_count": number | null,"staff_id": string,"tool_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed": boolean,"arguments"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"result_count"?: number | null,"staff_id": string,"tool_name": string
                  }
                  Update: {
                    "allowed"?: boolean,"arguments"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"result_count"?: number | null,"staff_id"?: string,"tool_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"campuses": {
                  Row: {
                    "city": string,"country": string,"id": string,"name": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "city": string,"country": string,"id": string,"name": string,"timezone": string
                  }
                  Update: {
                    "city"?: string,"country"?: string,"id"?: string,"name"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"followups": {
                  Row: {
                    "channel": Database["public"]['Enums']["followup_channel"],"created_at": string,"id": string,"inquiry_id": string,"note": string,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": Database["public"]['Enums']["followup_channel"],"created_at"?: string,"id"?: string,"inquiry_id": string,"note": string,"staff_id": string
                  }
                  Update: {
                    "channel"?: Database["public"]['Enums']["followup_channel"],"created_at"?: string,"id"?: string,"inquiry_id"?: string,"note"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "followups_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "inquiries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "followups_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "inquiry_activity"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "followups_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"guardians": {
                  Row: {
                    "email": string,"full_name": string,"id": string,"phone": string,"preferred_language": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email": string,"full_name": string,"id"?: string,"phone": string,"preferred_language": string
                  }
                  Update: {
                    "email"?: string,"full_name"?: string,"id"?: string,"phone"?: string,"preferred_language"?: string
                  }
                  Relationships: [
                    
                  ]
                },"inquiries": {
                  Row: {
                    "applicant_id": string,"assigned_staff_id": string | null,"campus_id": string,"created_at": string,"guardian_id": string,"id": string,"source": Database["public"]['Enums']["inquiry_source"],"stage": Database["public"]['Enums']["inquiry_stage"]
                  }
                  ComputedFields: never
                  Insert: {
                    "applicant_id": string,"assigned_staff_id"?: string | null,"campus_id": string,"created_at"?: string,"guardian_id": string,"id"?: string,"source": Database["public"]['Enums']["inquiry_source"],"stage"?: Database["public"]['Enums']["inquiry_stage"]
                  }
                  Update: {
                    "applicant_id"?: string,"assigned_staff_id"?: string | null,"campus_id"?: string,"created_at"?: string,"guardian_id"?: string,"id"?: string,"source"?: Database["public"]['Enums']["inquiry_source"],"stage"?: Database["public"]['Enums']["inquiry_stage"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "inquiries_applicant_id_fkey"
      columns: ["applicant_id"]
isOneToOne: false
      referencedRelation: "applicants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiries_assigned_staff_id_fkey"
      columns: ["assigned_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiries_campus_id_fkey"
      columns: ["campus_id"]
isOneToOne: false
      referencedRelation: "campuses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiries_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "guardians"
      referencedColumns: ["id"]
    }
                  ]
                },"staff": {
                  Row: {
                    "campus_id": string | null,"email": string,"full_name": string,"id": string,"role": Database["public"]['Enums']["staff_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "campus_id"?: string | null,"email": string,"full_name": string,"id"?: string,"role": Database["public"]['Enums']["staff_role"]
                  }
                  Update: {
                    "campus_id"?: string | null,"email"?: string,"full_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["staff_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_campus_id_fkey"
      columns: ["campus_id"]
isOneToOne: false
      referencedRelation: "campuses"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "inquiry_activity": {
                  Row: {
                    "assigned_staff_id": string | null,"campus_id": string,"days_since_contact": number | null,"inquiry_id": string,"last_contact_at": string | null,"never_contacted": boolean | null,"stage": Database["public"]['Enums']["inquiry_stage"]
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "inquiries_assigned_staff_id_fkey"
      columns: ["assigned_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiries_campus_id_fkey"
      columns: ["campus_id"]
isOneToOne: false
      referencedRelation: "campuses"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "followup_channel": "email"|"phone"|"whatsapp"|"meeting","inquiry_source": "website"|"referral"|"walk_in"|"agent"|"event"|"phone"|"social_media","inquiry_stage": "new"|"contacted"|"tour_booked"|"applied"|"assessment"|"offered"|"enrolled"|"withdrawn"|"lost","staff_role": "counsellor"|"campus_head"|"leadership"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "followup_channel": ["email", "phone", "whatsapp", "meeting"],"inquiry_source": ["website", "referral", "walk_in", "agent", "event", "phone", "social_media"],"inquiry_stage": ["new", "contacted", "tour_booked", "applied", "assessment", "offered", "enrolled", "withdrawn", "lost"],"staff_role": ["counsellor", "campus_head", "leadership"]
          }
        }
} as const

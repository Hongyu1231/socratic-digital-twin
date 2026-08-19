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
    PostgrestVersion: "14.15"
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
      answer_reviews: {
        Row: {
          comments: string | null
          created_at: string
          id: string
          message_id: string
          reviewer_id: string
          rubric: Json
          score: number | null
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
        }
        Insert: {
          comments?: string | null
          created_at?: string
          id?: string
          message_id: string
          reviewer_id: string
          rubric?: Json
          score?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Update: {
          comments?: string | null
          created_at?: string
          id?: string
          message_id?: string
          reviewer_id?: string
          rubric?: Json
          score?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_reviews_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      case_phases: {
        Row: {
          case_id: string
          created_at: string
          expected_findings: Json
          id: string
          metadata: Json
          objectives: string[]
          phase_key: string
          phase_order: number
          questions: string[]
          teaching_notes: string | null
          title: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          expected_findings?: Json
          id?: string
          metadata?: Json
          objectives: string[]
          phase_key: string
          phase_order: number
          questions: string[]
          teaching_notes?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          expected_findings?: Json
          id?: string
          metadata?: Json
          objectives?: string[]
          phase_key?: string
          phase_order?: number
          questions?: string[]
          teaching_notes?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_phases_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          attachments: Json
          created_at: string
          created_by: string
          diagnosis: string | null
          id: string
          patient_context: Json
          presenting_complaint: string | null
          published_at: string | null
          slug: string
          source_case_id: string | null
          specialty: string
          status: Database["public"]["Enums"]["case_status"]
          tags: string[]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          attachments?: Json
          created_at?: string
          created_by: string
          diagnosis?: string | null
          id?: string
          patient_context?: Json
          presenting_complaint?: string | null
          published_at?: string | null
          slug: string
          source_case_id?: string | null
          specialty: string
          status?: Database["public"]["Enums"]["case_status"]
          tags?: string[]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          attachments?: Json
          created_at?: string
          created_by?: string
          diagnosis?: string | null
          id?: string
          patient_context?: Json
          presenting_complaint?: string | null
          published_at?: string | null
          slug?: string
          source_case_id?: string | null
          specialty?: string
          status?: Database["public"]["Enums"]["case_status"]
          tags?: string[]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      class_case_assignments: {
        Row: {
          assigned_by: string
          case_id: string
          class_id: string
          created_at: string
          due_at: string | null
          id: string
          opens_at: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_by: string
          case_id: string
          class_id: string
          created_at?: string
          due_at?: string | null
          id?: string
          opens_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          case_id?: string
          class_id?: string
          created_at?: string
          due_at?: string | null
          id?: string
          opens_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_case_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_case_assignments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_case_assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      class_memberships: {
        Row: {
          class_id: string
          created_at: string
          is_lead: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          is_lead?: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          is_lead?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_memberships_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          code: string
          created_at: string
          created_by: string
          id: string
          name: string
          status: string
          term: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          status?: string
          term: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          status?: string
          term?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluations: {
        Row: {
          created_at: string
          criteria: Json
          evaluation_type: Database["public"]["Enums"]["evaluation_type"]
          evaluator_id: string | null
          feedback: string | null
          id: string
          message_id: string | null
          phase_id: string | null
          score: number | null
          session_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criteria?: Json
          evaluation_type?: Database["public"]["Enums"]["evaluation_type"]
          evaluator_id?: string | null
          feedback?: string | null
          id?: string
          message_id?: string | null
          phase_id?: string | null
          score?: number | null
          session_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criteria?: Json
          evaluation_type?: Database["public"]["Enums"]["evaluation_type"]
          evaluator_id?: string | null
          feedback?: string | null
          id?: string
          message_id?: string | null
          phase_id?: string | null
          score?: number | null
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluations_evaluator_id_fkey"
            columns: ["evaluator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluations_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "case_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_release_approvals: {
        Row: {
          created_at: string
          decision: string
          eval_run_id: string
          id: string
          notes: string
          professor_id: string
        }
        Insert: {
          created_at?: string
          decision: string
          eval_run_id: string
          id?: string
          notes?: string
          professor_id: string
        }
        Update: {
          created_at?: string
          decision?: string
          eval_run_id?: string
          id?: string
          notes?: string
          professor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_release_approvals_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "humanization_eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_release_approvals_professor_id_fkey"
            columns: ["professor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      humanization_dataset_entries: {
        Row: {
          created_at: string
          dataset_id: string
          id: string
          pseudonym: string
          sample: Json
          sample_hash: string
          sample_key: string
        }
        Insert: {
          created_at?: string
          dataset_id: string
          id?: string
          pseudonym: string
          sample: Json
          sample_hash: string
          sample_key: string
        }
        Update: {
          created_at?: string
          dataset_id?: string
          id?: string
          pseudonym?: string
          sample?: Json
          sample_hash?: string
          sample_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "humanization_dataset_entries_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "humanization_datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      humanization_datasets: {
        Row: {
          content_hash: string | null
          created_at: string
          created_by: string
          deidentification_version: string
          entry_count: number
          frozen_at: string | null
          id: string
          name: string
          source_from: string | null
          source_to: string | null
          status: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          created_by: string
          deidentification_version: string
          entry_count?: number
          frozen_at?: string | null
          id?: string
          name: string
          source_from?: string | null
          source_to?: string | null
          status?: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          created_by?: string
          deidentification_version?: string
          entry_count?: number
          frozen_at?: string | null
          id?: string
          name?: string
          source_from?: string | null
          source_to?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "humanization_datasets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      humanization_eval_runs: {
        Row: {
          baseline_metrics: Json | null
          candidate_id: string
          candidate_metrics: Json | null
          completed_at: string | null
          created_at: string
          created_by: string
          dataset_id: string
          error: string | null
          gate_result: Json | null
          id: string
          metric_deltas: Json | null
          status: string
        }
        Insert: {
          baseline_metrics?: Json | null
          candidate_id: string
          candidate_metrics?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          dataset_id: string
          error?: string | null
          gate_result?: Json | null
          id?: string
          metric_deltas?: Json | null
          status?: string
        }
        Update: {
          baseline_metrics?: Json | null
          candidate_id?: string
          candidate_metrics?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          dataset_id?: string
          error?: string | null
          gate_result?: Json | null
          id?: string
          metric_deltas?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "humanization_eval_runs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "tutor_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "humanization_eval_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "humanization_eval_runs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "humanization_datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      humanization_experiment_assignments: {
        Row: {
          arm: string
          assignment_hash: string
          assignment_key: string
          created_at: string
          experiment_id: string
          id: string
          sample_key: string | null
        }
        Insert: {
          arm: string
          assignment_hash: string
          assignment_key: string
          created_at?: string
          experiment_id: string
          id?: string
          sample_key?: string | null
        }
        Update: {
          arm?: string
          assignment_hash?: string
          assignment_key?: string
          created_at?: string
          experiment_id?: string
          id?: string
          sample_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "humanization_experiment_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "humanization_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      humanization_experiments: {
        Row: {
          candidate_id: string
          created_at: string
          created_by: string
          ended_at: string | null
          eval_run_id: string
          id: string
          mode: string
          name: string
          started_at: string | null
          status: string
          traffic_percent: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          created_by: string
          ended_at?: string | null
          eval_run_id: string
          id?: string
          mode: string
          name: string
          started_at?: string | null
          status?: string
          traffic_percent?: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          created_by?: string
          ended_at?: string | null
          eval_run_id?: string
          id?: string
          mode?: string
          name?: string
          started_at?: string | null
          status?: string
          traffic_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "humanization_experiments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "tutor_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "humanization_experiments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "humanization_experiments_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "humanization_eval_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      humanization_shadow_results: {
        Row: {
          arm: string
          baseline_output: Json
          candidate_output: Json
          created_at: string
          experiment_id: string
          id: string
          safety_passed: boolean
          sample_key: string | null
          turn_key: string | null
        }
        Insert: {
          arm: string
          baseline_output: Json
          candidate_output: Json
          created_at?: string
          experiment_id: string
          id?: string
          safety_passed: boolean
          sample_key?: string | null
          turn_key?: string | null
        }
        Update: {
          arm?: string
          baseline_output?: Json
          candidate_output?: Json
          created_at?: string
          experiment_id?: string
          id?: string
          safety_passed?: boolean
          sample_key?: string | null
          turn_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "humanization_shadow_results_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "humanization_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json
          phase_id: string | null
          role: Database["public"]["Enums"]["message_role"]
          sender_id: string | null
          sequence_no: number
          session_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json
          phase_id?: string | null
          role: Database["public"]["Enums"]["message_role"]
          sender_id?: string | null
          sequence_no: number
          session_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          phase_id?: string | null
          role?: Database["public"]["Enums"]["message_role"]
          sender_id?: string | null
          sequence_no?: number
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "case_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_reviews: {
        Row: {
          created_at: string
          id: string
          improvement_areas: string[]
          overall_score: number | null
          reviewer_id: string
          rubric: Json
          session_id: string
          status: Database["public"]["Enums"]["review_status"]
          strengths: string[]
          summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          improvement_areas?: string[]
          overall_score?: number | null
          reviewer_id: string
          rubric?: Json
          session_id: string
          status?: Database["public"]["Enums"]["review_status"]
          strengths?: string[]
          summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          improvement_areas?: string[]
          overall_score?: number | null
          reviewer_id?: string
          rubric?: Json
          session_id?: string
          status?: Database["public"]["Enums"]["review_status"]
          strengths?: string[]
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_state: {
        Row: {
          created_at: string
          current_phase_id: string | null
          facts: string[]
          id: string
          session_id: string
          state: Json
          unresolved_questions: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_phase_id?: string | null
          facts?: string[]
          id?: string
          session_id: string
          state?: Json
          unresolved_questions?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_phase_id?: string | null
          facts?: string[]
          id?: string
          session_id?: string
          state?: Json
          unresolved_questions?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_state_current_phase_id_fkey"
            columns: ["current_phase_id"]
            isOneToOne: false
            referencedRelation: "case_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_state_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          case_id: string
          class_case_assignment_id: string
          context: Json
          created_at: string
          current_phase_id: string | null
          ended_at: string | null
          id: string
          last_activity_at: string
          professor_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          case_id: string
          class_case_assignment_id: string
          context?: Json
          created_at?: string
          current_phase_id?: string | null
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          professor_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          class_case_assignment_id?: string
          context?: Json
          created_at?: string
          current_phase_id?: string | null
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          professor_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_class_case_assignment_id_fkey"
            columns: ["class_case_assignment_id"]
            isOneToOne: false
            referencedRelation: "class_case_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_current_phase_id_fkey"
            columns: ["current_phase_id"]
            isOneToOne: false
            referencedRelation: "case_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_professor_id_fkey"
            columns: ["professor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_candidates: {
        Row: {
          created_at: string
          created_by: string
          id: string
          instructions: string
          model: string
          name: string
          prompt_version: string
          provider: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          instructions: string
          model: string
          name: string
          prompt_version: string
          provider: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          instructions?: string
          model?: string
          name?: string
          prompt_version?: string
          provider?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_release_events: {
        Row: {
          actor_id: string
          created_at: string
          event_type: string
          id: string
          notes: string
          release_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_type: string
          id?: string
          notes?: string
          release_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_type?: string
          id?: string
          notes?: string
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_release_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_release_events_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "tutor_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_releases: {
        Row: {
          candidate_id: string
          created_at: string
          eval_run_id: string
          id: string
          release_notes: string
          released_by: string
          rollback_reason: string | null
          rolled_back_at: string | null
          rolled_back_by: string | null
          status: string
          traffic_percent: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          eval_run_id: string
          id?: string
          release_notes?: string
          released_by: string
          rollback_reason?: string | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          status?: string
          traffic_percent?: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          eval_run_id?: string
          id?: string
          release_notes?: string
          released_by?: string
          rollback_reason?: string | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          status?: string
          traffic_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "tutor_releases_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "tutor_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_releases_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "humanization_eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_releases_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_releases_rolled_back_by_fkey"
            columns: ["rolled_back_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_turn_reviews: {
        Row: {
          challenge_fit: number
          comments: string | null
          created_at: string
          evaluation_id: string
          failure_tags: string[]
          helpfulness: number
          id: string
          naturalness: number
          non_leading: number
          preferred_rewrite: string | null
          reviewer_id: string
          session_id: string
          specificity: number
          tutor_message_id: string
          updated_at: string
        }
        Insert: {
          challenge_fit: number
          comments?: string | null
          created_at?: string
          evaluation_id: string
          failure_tags?: string[]
          helpfulness: number
          id?: string
          naturalness: number
          non_leading: number
          preferred_rewrite?: string | null
          reviewer_id: string
          session_id: string
          specificity: number
          tutor_message_id: string
          updated_at?: string
        }
        Update: {
          challenge_fit?: number
          comments?: string | null
          created_at?: string
          evaluation_id?: string
          failure_tags?: string[]
          helpfulness?: number
          id?: string
          naturalness?: number
          non_leading?: number
          preferred_rewrite?: string | null
          reviewer_id?: string
          session_id?: string
          specificity?: number
          tutor_message_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_turn_reviews_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: true
            referencedRelation: "evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_turn_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_turn_reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_turn_reviews_tutor_message_id_fkey"
            columns: ["tutor_message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          is_active: boolean
          profile: Json
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          display_name: string
          email: string
          id?: string
          is_active?: boolean
          profile?: Json
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          is_active?: boolean
          profile?: Json
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      commit_tutor_turn: {
        Args: {
          p_ai_content: string
          p_ai_phase_id?: string
          p_current_phase_id?: string
          p_evaluation_criteria?: Json
          p_evaluation_feedback?: string
          p_evaluation_score?: number
          p_evaluation_type?: Database["public"]["Enums"]["evaluation_type"]
          p_evaluator_id?: string
          p_expected_version?: number
          p_facts?: string[]
          p_session_context?: Json
          p_session_id: string
          p_session_status?: Database["public"]["Enums"]["session_status"]
          p_state?: Json
          p_student_content: string
          p_student_phase_id: string
          p_student_sender_id: string
          p_unresolved_questions?: string[]
        }
        Returns: {
          ai_message_id: string
          evaluation_id: string
          session_state_id: string
          student_message_id: string
        }[]
      }
      humanization_require_user_role: {
        Args: { p_expected_role: string; p_user_id: string }
        Returns: undefined
      }
      humanization_sample_is_deidentified: {
        Args: { payload: Json }
        Returns: boolean
      }
    }
    Enums: {
      case_status: "draft" | "active" | "archived"
      evaluation_type:
        | "formative"
        | "summative"
        | "rubric"
        | "milestone"
        | "safety"
        | "overall"
      message_role: "student" | "tutor" | "assistant" | "system"
      review_status: "pending" | "approved" | "rejected" | "needs_revision"
      session_status: "active" | "completed" | "abandoned"
      user_role: "student" | "professor" | "admin"
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
      case_status: ["draft", "active", "archived"],
      evaluation_type: [
        "formative",
        "summative",
        "rubric",
        "milestone",
        "safety",
        "overall",
      ],
      message_role: ["student", "tutor", "assistant", "system"],
      review_status: ["pending", "approved", "rejected", "needs_revision"],
      session_status: ["active", "completed", "abandoned"],
      user_role: ["student", "professor", "admin"],
    },
  },
} as const

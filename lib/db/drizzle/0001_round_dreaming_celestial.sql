CREATE SEQUENCE IF NOT EXISTS "public"."mis_bulk_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smtp_settings" (
	"id" varchar(16) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"provider" varchar(16) DEFAULT 'smtp' NOT NULL,
	"host" varchar(255),
	"port" integer DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" varchar(255),
	"password" varchar(255),
	"from_email" varchar(255),
	"from_name" varchar(120),
	"graph_tenant_id" varchar(120),
	"graph_client_id" varchar(120),
	"graph_client_secret" varchar(255),
	"graph_sender_email" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"module" text NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"request_id" text,
	"path" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_name" text,
	"project_id" text,
	"project_name" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"changed_fields" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_meal_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_service_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"weight" numeric(6, 3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_cost_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_cost_entry_id" varchar NOT NULL,
	"meal_item_id" varchar,
	"name" varchar(255) NOT NULL,
	"weight" numeric(6, 3) NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_group_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_group_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"granted_by_id" varchar,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" varchar,
	"project_id" varchar,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"action" varchar(32) NOT NULL,
	"actor_id" varchar,
	"remarks" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_authorities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" varchar,
	"role" varchar(32) NOT NULL,
	"extra_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"tab_id" varchar NOT NULL,
	"service_id" varchar NOT NULL,
	"parent_id" varchar,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"calculation_mode" varchar(16) DEFAULT 'quantity_rate' NOT NULL,
	"rate_enabled" boolean DEFAULT true NOT NULL,
	"calculate_percent_against_income" boolean DEFAULT false NOT NULL,
	"remarks" text,
	"project_name" varchar(160) NOT NULL,
	"tab_name" varchar(120) NOT NULL,
	"service_name" varchar(160) NOT NULL,
	"type" varchar(16) NOT NULL,
	"financial_class" varchar(16) NOT NULL,
	"unit" varchar(40) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_by_id" varchar NOT NULL,
	"updated_by_id" varchar,
	"deleted_at" timestamp with time zone,
	"deleted_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_entry_parents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bulk_number" varchar(32) DEFAULT 'MIS-BULK-' || lpad(nextval('mis_bulk_number_seq')::text, 6, '0') NOT NULL,
	"project_id" varchar NOT NULL,
	"project_name" varchar(160) NOT NULL,
	"project_code" varchar(32) NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"entry_type" varchar(16) DEFAULT 'bulk' NOT NULL,
	"created_by_id" varchar NOT NULL,
	"updated_by_id" varchar,
	"deleted_at" timestamp with time zone,
	"deleted_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mis_entry_parents_bulk_number_unique" UNIQUE("bulk_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_project_tabs" (
	"project_id" varchar NOT NULL,
	"tab_id" varchar NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"calculate_percent_against_income" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"code" varchar(32) NOT NULL,
	"manager_id" varchar,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"currency" varchar(3) NOT NULL,
	"default_entry_status" varchar(16) DEFAULT 'approved' NOT NULL,
	"prevent_duplicate_periods" boolean DEFAULT true NOT NULL,
	"allow_multiple_mis_entries" boolean DEFAULT false NOT NULL,
	"overlap_policy" varchar(16) DEFAULT 'nonoverlap' NOT NULL,
	"max_entries_per_period" integer,
	"created_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_services" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"tab_id" varchar NOT NULL,
	"name" varchar(160) NOT NULL,
	"code" varchar(32) NOT NULL,
	"description" text,
	"unit" varchar(40) NOT NULL,
	"quantity_source_service_id" varchar,
	"default_rate" numeric(20, 6) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_tabs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(32) NOT NULL,
	"description" text,
	"type" varchar(16) NOT NULL,
	"financial_class" varchar(16) NOT NULL,
	"rate_enabled" boolean DEFAULT true NOT NULL,
	"calculate_percent_against_income" boolean DEFAULT false NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"allow_entry" boolean DEFAULT true NOT NULL,
	"allow_reporting" boolean DEFAULT true NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mis_percentage_services" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"kind" varchar(16) NOT NULL,
	"name" varchar(160) NOT NULL,
	"percentage" numeric(9, 6) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "allow_duplicate_dates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "backdated_days" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "future_days" integer;--> statement-breakpoint
ALTER TABLE "security_groups" ADD COLUMN IF NOT EXISTS "auto_assign_new_projects" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_meal_items" ADD CONSTRAINT "food_meal_items_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meal_cost_entries" ADD CONSTRAINT "meal_cost_entries_service_cost_entry_id_service_cost_entries_id_fk" FOREIGN KEY ("service_cost_entry_id") REFERENCES "public"."service_cost_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meal_cost_entries" ADD CONSTRAINT "meal_cost_entries_meal_item_id_food_meal_items_id_fk" FOREIGN KEY ("meal_item_id") REFERENCES "public"."food_meal_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "security_group_members" ADD CONSTRAINT "security_group_members_security_group_id_security_groups_id_fk" FOREIGN KEY ("security_group_id") REFERENCES "public"."security_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "security_group_members" ADD CONSTRAINT "security_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "security_group_members" ADD CONSTRAINT "security_group_members_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_audit_log" ADD CONSTRAINT "mis_audit_log_project_id_mis_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mis_projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_audit_log" ADD CONSTRAINT "mis_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_authorities" ADD CONSTRAINT "mis_authorities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_authorities" ADD CONSTRAINT "mis_authorities_project_id_mis_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mis_projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_authorities" ADD CONSTRAINT "mis_authorities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entries" ADD CONSTRAINT "mis_entries_project_id_mis_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mis_projects"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entries" ADD CONSTRAINT "mis_entries_tab_id_mis_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."mis_tabs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entries" ADD CONSTRAINT "mis_entries_service_id_mis_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."mis_services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entries" ADD CONSTRAINT "mis_entries_parent_id_mis_entry_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."mis_entry_parents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entries" ADD CONSTRAINT "mis_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entries" ADD CONSTRAINT "mis_entries_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entries" ADD CONSTRAINT "mis_entries_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entry_parents" ADD CONSTRAINT "mis_entry_parents_project_id_mis_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mis_projects"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entry_parents" ADD CONSTRAINT "mis_entry_parents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entry_parents" ADD CONSTRAINT "mis_entry_parents_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_entry_parents" ADD CONSTRAINT "mis_entry_parents_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_project_tabs" ADD CONSTRAINT "mis_project_tabs_project_id_mis_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mis_projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_project_tabs" ADD CONSTRAINT "mis_project_tabs_tab_id_mis_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."mis_tabs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_projects" ADD CONSTRAINT "mis_projects_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_projects" ADD CONSTRAINT "mis_projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_services" ADD CONSTRAINT "mis_services_project_id_mis_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mis_projects"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_services" ADD CONSTRAINT "mis_services_tab_id_mis_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."mis_tabs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_services" ADD CONSTRAINT "mis_services_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_tabs" ADD CONSTRAINT "mis_tabs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mis_percentage_services" ADD CONSTRAINT "mis_percentage_services_project_id_mis_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."mis_projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_reset_tokens_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_audit_time" ON "system_audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_audit_project" ON "system_audit_log" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_audit_actor" ON "system_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_meal_items_service" ON "food_meal_items" USING btree ("project_service_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_meal_costs_parent" ON "meal_cost_entries" USING btree ("service_cost_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_security_group_members_group_user" ON "security_group_members" USING btree ("security_group_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_security_group_members_user" ON "security_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_audit_entry" ON "mis_audit_log" USING btree ("entry_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_audit_entity" ON "mis_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_authorities_user" ON "mis_authorities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_authorities_project" ON "mis_authorities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_entries_scope_period" ON "mis_entries" USING btree ("project_id","tab_id","service_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_entries_parent" ON "mis_entries" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_entries_report" ON "mis_entries" USING btree ("status","currency","from_date","to_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_entries_deleted" ON "mis_entries" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_entry_parents_project_period" ON "mis_entry_parents" USING btree ("project_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_entry_parents_status" ON "mis_entry_parents" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_entry_parents_deleted" ON "mis_entry_parents" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mis_project_tabs" ON "mis_project_tabs" USING btree ("project_id","tab_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_project_tabs_project" ON "mis_project_tabs" USING btree ("project_id","enabled","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mis_projects_code" ON "mis_projects" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_projects_status" ON "mis_projects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mis_services_project_code" ON "mis_services" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_services_project_tab" ON "mis_services" USING btree ("project_id","tab_id","active","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mis_tabs_code" ON "mis_tabs" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_mis_tabs_active_sequence" ON "mis_tabs" USING btree ("active","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mis_percentage_services_project_idx" ON "mis_percentage_services" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "service_cost_entries" DROP COLUMN IF EXISTS "breakfast_qty";--> statement-breakpoint
ALTER TABLE "service_cost_entries" DROP COLUMN IF EXISTS "lunch_qty";--> statement-breakpoint
ALTER TABLE "service_cost_entries" DROP COLUMN IF EXISTS "dinner_qty";--> statement-breakpoint
ALTER TABLE "service_cost_entries" DROP COLUMN IF EXISTS "midnight_qty";--> statement-breakpoint
ALTER TABLE "service_cost_entries" DROP COLUMN IF EXISTS "meal_box_qty";
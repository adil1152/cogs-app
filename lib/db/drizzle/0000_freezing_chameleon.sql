CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"password_hash" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"mobile" varchar(32),
	"profile_image_url" varchar,
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "daily_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"entry_date" date NOT NULL,
	"location" varchar(255) NOT NULL,
	"total_mandays" numeric(12, 2) NOT NULL,
	"total_mandays_override" boolean DEFAULT false NOT NULL,
	"manual_mandays" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"current_approval_level" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"sequence_number" integer,
	"sequence_code" varchar(64),
	"notes" text,
	"created_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_approvals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_entry_id" varchar NOT NULL,
	"level" integer NOT NULL,
	"level_name" varchar(32) NOT NULL,
	"approver_id" varchar,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_entry_id" varchar NOT NULL,
	"object_path" varchar(512) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"mime_type" varchar(128) DEFAULT '' NOT NULL,
	"uploaded_by_id" varchar,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_entry_id" varchar,
	"project_id" varchar NOT NULL,
	"action" varchar(32) NOT NULL,
	"level" integer,
	"level_name" varchar(32),
	"field" varchar(64),
	"old_value" text,
	"new_value" text,
	"actor_id" varchar,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_access" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"security_group_id" varchar,
	"can_view_summary" boolean DEFAULT true NOT NULL,
	"can_edit_entries" boolean DEFAULT false NOT NULL,
	"can_reset_approval" boolean DEFAULT false NOT NULL,
	"granted_by_id" varchar,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_approval_chain" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"position" integer NOT NULL,
	"level_name" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_approver_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"level" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_services" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" varchar(16) DEFAULT 'standard' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" varchar(9),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(32),
	"location" varchar(255) NOT NULL,
	"contract_start" date NOT NULL,
	"contract_end" date NOT NULL,
	"notes" text,
	"pdf_required" boolean DEFAULT false NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"can_view_summary" boolean DEFAULT false NOT NULL,
	"can_edit_entries" boolean DEFAULT false NOT NULL,
	"can_reset_approval" boolean DEFAULT false NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_cost_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_entry_id" varchar NOT NULL,
	"project_service_id" varchar NOT NULL,
	"kind" varchar(16) NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mandays" numeric(10, 2),
	"manual_mandays" numeric(10, 2) DEFAULT '0' NOT NULL,
	"breakfast_qty" integer,
	"lunch_qty" integer,
	"dinner_qty" integer,
	"midnight_qty" integer,
	"meal_box_qty" integer
);
--> statement-breakpoint
CREATE TABLE "service_sub_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_service_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" varchar(9),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_service_cost_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_cost_entry_id" varchar NOT NULL,
	"sub_item_id" varchar NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mandays" numeric(10, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_entries" ADD CONSTRAINT "daily_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_entries" ADD CONSTRAINT "daily_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_approvals" ADD CONSTRAINT "entry_approvals_daily_entry_id_daily_entries_id_fk" FOREIGN KEY ("daily_entry_id") REFERENCES "public"."daily_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_approvals" ADD CONSTRAINT "entry_approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_daily_entry_id_daily_entries_id_fk" FOREIGN KEY ("daily_entry_id") REFERENCES "public"."daily_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_audit_log" ADD CONSTRAINT "entry_audit_log_daily_entry_id_daily_entries_id_fk" FOREIGN KEY ("daily_entry_id") REFERENCES "public"."daily_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_audit_log" ADD CONSTRAINT "entry_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_security_group_id_security_groups_id_fk" FOREIGN KEY ("security_group_id") REFERENCES "public"."security_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approval_chain" ADD CONSTRAINT "project_approval_chain_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approver_assignments" ADD CONSTRAINT "project_approver_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approver_assignments" ADD CONSTRAINT "project_approver_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_services" ADD CONSTRAINT "project_services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_groups" ADD CONSTRAINT "security_groups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_cost_entries" ADD CONSTRAINT "service_cost_entries_daily_entry_id_daily_entries_id_fk" FOREIGN KEY ("daily_entry_id") REFERENCES "public"."daily_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_cost_entries" ADD CONSTRAINT "service_cost_entries_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sub_items" ADD CONSTRAINT "service_sub_items_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_service_cost_entries" ADD CONSTRAINT "sub_service_cost_entries_service_cost_entry_id_service_cost_entries_id_fk" FOREIGN KEY ("service_cost_entry_id") REFERENCES "public"."service_cost_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_service_cost_entries" ADD CONSTRAINT "sub_service_cost_entries_sub_item_id_service_sub_items_id_fk" FOREIGN KEY ("sub_item_id") REFERENCES "public"."service_sub_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "IDX_daily_entries_project_date" ON "daily_entries" USING btree ("project_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_daily_entries_project_seq" ON "daily_entries" USING btree ("project_id","sequence_number");--> statement-breakpoint
CREATE INDEX "IDX_entry_approvals_entry" ON "entry_approvals" USING btree ("daily_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_entry_approvals_entry_level" ON "entry_approvals" USING btree ("daily_entry_id","level");--> statement-breakpoint
CREATE INDEX "IDX_entry_attachments_entry" ON "entry_attachments" USING btree ("daily_entry_id");--> statement-breakpoint
CREATE INDEX "IDX_entry_audit_entry" ON "entry_audit_log" USING btree ("daily_entry_id");--> statement-breakpoint
CREATE INDEX "IDX_entry_audit_project" ON "entry_audit_log" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_project_access_project_user" ON "project_access" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_approval_chain_project_position" ON "project_approval_chain" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "IDX_approver_assignments_project_level" ON "project_approver_assignments" USING btree ("project_id","level");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_approver_assignments_project_level_user" ON "project_approver_assignments" USING btree ("project_id","level","user_id");--> statement-breakpoint
CREATE INDEX "IDX_project_services_project" ON "project_services" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_projects_code" ON "projects" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_security_groups_name" ON "security_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "IDX_service_costs_entry" ON "service_cost_entries" USING btree ("daily_entry_id");--> statement-breakpoint
CREATE INDEX "IDX_sub_items_service" ON "service_sub_items" USING btree ("project_service_id");--> statement-breakpoint
CREATE INDEX "IDX_sub_costs_parent" ON "sub_service_cost_entries" USING btree ("service_cost_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_sub_costs_parent_sub" ON "sub_service_cost_entries" USING btree ("service_cost_entry_id","sub_item_id");
CREATE SEQUENCE "public"."application_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "application_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"doc_type" text NOT NULL,
	"label" text NOT NULL,
	"pathname" text NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"size" integer,
	"source" text DEFAULT 'applicant' NOT NULL,
	"ai_analysis" jsonb,
	"lms_file_url" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"message" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_to_customer" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"submission_key" text NOT NULL,
	"loan_type" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"customer_id" uuid,
	"applicant_email" text NOT NULL,
	"applicant_name" text NOT NULL,
	"applicant_phone" text,
	"company_name" text,
	"amount" numeric(14, 2) NOT NULL,
	"tenure" integer NOT NULL,
	"total_repayable" numeric(14, 2) NOT NULL,
	"monthly_instalment" numeric(14, 2) NOT NULL,
	"data" jsonb NOT NULL,
	"channel" text DEFAULT 'self' NOT NULL,
	"sourced_by" uuid,
	"assigned_rm" uuid,
	"assigned_officer" uuid,
	"referral_code" text,
	"info_request" jsonb,
	"lms_sync_status" text DEFAULT 'not_configured' NOT NULL,
	"lms_reference" text,
	"lms_error" text,
	"lms_attempts" integer DEFAULT 0 NOT NULL,
	"lms_synced_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_sourced_by_users_id_fk" FOREIGN KEY ("sourced_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_assigned_rm_users_id_fk" FOREIGN KEY ("assigned_rm") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_assigned_officer_users_id_fk" FOREIGN KEY ("assigned_officer") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_documents_application_idx" ON "application_documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_events_application_idx" ON "application_events" USING btree ("application_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_reference_key" ON "applications" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_submission_key" ON "applications" USING btree ("submission_key");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_email_idx" ON "applications" USING btree ("applicant_email");--> statement-breakpoint
CREATE INDEX "applications_sourced_by_idx" ON "applications" USING btree ("sourced_by");--> statement-breakpoint
CREATE INDEX "applications_assigned_rm_idx" ON "applications" USING btree ("assigned_rm");--> statement-breakpoint
CREATE INDEX "applications_assigned_officer_idx" ON "applications" USING btree ("assigned_officer");--> statement-breakpoint
CREATE INDEX "applications_submitted_at_idx" ON "applications" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "applications_lms_sync_idx" ON "applications" USING btree ("lms_sync_status");
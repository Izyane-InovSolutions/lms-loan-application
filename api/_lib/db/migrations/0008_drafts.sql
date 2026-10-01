CREATE TABLE "application_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"loan_type" text NOT NULL,
	"applicant_name" text,
	"applicant_phone" text,
	"company_name" text,
	"amount" numeric(14, 2),
	"tenure" integer,
	"current_step" integer DEFAULT 0 NOT NULL,
	"step_count" integer DEFAULT 5 NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"channel" text DEFAULT 'self' NOT NULL,
	"sourced_by" uuid,
	"assigned_rm" uuid,
	"started_by_staff" boolean DEFAULT false NOT NULL,
	"contact_consent_at" timestamp with time zone,
	"contact_consent_version" text,
	"reminded_at" timestamp with time zone,
	"last_saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_sourced_by_users_id_fk" FOREIGN KEY ("sourced_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_assigned_rm_users_id_fk" FOREIGN KEY ("assigned_rm") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_drafts_email_idx" ON "application_drafts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "application_drafts_sourced_by_idx" ON "application_drafts" USING btree ("sourced_by");--> statement-breakpoint
CREATE INDEX "application_drafts_expires_at_idx" ON "application_drafts" USING btree ("expires_at");
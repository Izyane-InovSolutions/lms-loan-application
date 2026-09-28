CREATE TABLE "appraisals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"verdict" text NOT NULL,
	"amount" numeric(14, 2),
	"tenure" integer,
	"conditions" text,
	"rationale" text NOT NULL,
	"officer_id" uuid,
	"officer_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "checks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "approved_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "approved_tenure" integer;--> statement-breakpoint
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appraisals_application_idx" ON "appraisals" USING btree ("application_id");
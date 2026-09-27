CREATE TABLE "prescreens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"ruleset_version" integer NOT NULL,
	"facts" jsonb NOT NULL,
	"rule_results" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"ai_review" jsonb,
	"ai_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulesets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer,
	"status" text NOT NULL,
	"rules" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prescreens" ADD CONSTRAINT "prescreens_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prescreens_application_key" ON "prescreens" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "prescreens_outcome_idx" ON "prescreens" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "rulesets_status_idx" ON "rulesets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "rulesets_version_key" ON "rulesets" USING btree ("version");
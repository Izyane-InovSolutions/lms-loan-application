CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer,
	"status" text NOT NULL,
	"definition" jsonb NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "workflow_version" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "state_assignee" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "state_entered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "workflow_versions_status_idx" ON "workflow_versions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_version_key" ON "workflow_versions" USING btree ("version");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_state_assignee_users_id_fk" FOREIGN KEY ("state_assignee") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_state_idx" ON "applications" USING btree ("workflow_version","state");
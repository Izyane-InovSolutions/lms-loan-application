CREATE TABLE "partner_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" text NOT NULL,
	"list_version" integer NOT NULL,
	"nrc" text NOT NULL,
	"employee_number" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "pre_approval" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "partner_id" text;--> statement-breakpoint
CREATE INDEX "partner_staff_lookup_idx" ON "partner_staff" USING btree ("partner_id","nrc");
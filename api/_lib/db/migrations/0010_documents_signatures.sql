CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'text' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"pdf_pathname" text,
	"pdf_url" text,
	"pdf_filename" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"method" text NOT NULL,
	"image" text NOT NULL,
	"code_verified" boolean DEFAULT false NOT NULL,
	"captured_by" uuid,
	"ip" text,
	"user_agent" text,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_kind_version_key" ON "document_templates" USING btree ("kind","version");--> statement-breakpoint
CREATE INDEX "document_templates_kind_status_idx" ON "document_templates" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "signatures_application_idx" ON "signatures" USING btree ("application_id");
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"scope" text DEFAULT 'own' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

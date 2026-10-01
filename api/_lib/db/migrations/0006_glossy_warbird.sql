ALTER TABLE "users" ADD COLUMN "approval_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approval_max" integer;--> statement-breakpoint
-- Preserve the previous role-wide default cap (K100,000) for existing staff, since
-- the per-user limit replaces the old workflow.officerApprovalLimit setting.
UPDATE "users" SET "approval_max" = 100000 WHERE "role" NOT IN ('admin', 'customer');
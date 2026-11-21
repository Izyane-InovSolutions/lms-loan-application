ALTER TABLE "applications" ADD COLUMN "contact_verification" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "identity_flags" jsonb;--> statement-breakpoint
CREATE INDEX "applications_phone_idx" ON "applications" USING btree ("applicant_phone");
ALTER TABLE "applications" ADD COLUMN "product_id" text;--> statement-breakpoint
CREATE INDEX "applications_product_idx" ON "applications" USING btree ("product_id");
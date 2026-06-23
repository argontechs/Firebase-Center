ALTER TYPE "public"."campaign_status" ADD VALUE IF NOT EXISTS 'scheduled';--> statement-breakpoint
ALTER TYPE "public"."campaign_status" ADD VALUE IF NOT EXISTS 'canceled';

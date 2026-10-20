-- The Bridge is gone (Diego, 2026-10-20): bots that thought with the owner's own Claude or ChatGPT plan
-- think with the default open model now, and the computers paired only to run it (the terminal
-- Bridge) are unpaired. The desktop app's pairing stays. Each bot switched says so in its Activity.
INSERT INTO "receipts" ("id", "bot_id", "owner_id", "kind", "status", "title", "detail") SELECT 'rcp_' || substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 17), "id", "owner_id", 'system', 'ok', 'Brain: Nemotron 3.5 Lightning, since thinking with your own Claude or ChatGPT plan is no longer offered', jsonb_build_object('changed', jsonb_build_array('brain'), 'brain', jsonb_build_object('kind', 'included', 'provider', 'nebius', 'model', 'nvidia/Nemotron-3_5-Lightning')) FROM "bots" WHERE "brain"->>'kind' = 'subscription';--> statement-breakpoint
UPDATE "bots" SET "brain" = jsonb_build_object('kind', 'included', 'provider', 'nebius', 'model', 'nvidia/Nemotron-3_5-Lightning', 'effort', 'low') WHERE "brain"->>'kind' = 'subscription';--> statement-breakpoint
UPDATE "bridge_devices" SET "revoked_at" = now() WHERE "revoked_at" IS NULL AND ("platform" IS NULL OR "platform" NOT LIKE 'desktop-%');--> statement-breakpoint
DROP TABLE "bridge_jobs" CASCADE;--> statement-breakpoint
DROP INDEX "study_sets_job_idx";--> statement-breakpoint
ALTER TABLE "bridge_devices" DROP COLUMN "clis";--> statement-breakpoint
ALTER TABLE "study_sets" DROP COLUMN "job_id";
-- Safety rails that live in the database, not only in app code.

-- 1) Receipts are append-only. Updates are never allowed. Deletes are allowed only
--    inside an explicit account/bot deletion transaction that sets
--    `SET LOCAL app.allow_receipt_delete = 'on'` (people can always delete their data).
CREATE OR REPLACE FUNCTION receipts_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'receipts are append-only';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.allow_receipt_delete', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'receipts can only be deleted with the bot or the account';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS receipts_append_only_trg ON "receipts";
--> statement-breakpoint
CREATE TRIGGER receipts_append_only_trg
  BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION receipts_append_only();
--> statement-breakpoint

-- 2) Row-level security on, with no policies: if a database URL or anon key ever leaks
--    to a browser (the Moltbook failure), non-owner roles read nothing. The app connects
--    as the table owner and enforces per-user scoping in its data layer.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "login_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bridge_devices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bridge_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pairing_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "waitlist" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "async_results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inbound_events" ENABLE ROW LEVEL SECURITY;

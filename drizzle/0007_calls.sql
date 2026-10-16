CREATE TABLE "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"speaker" text DEFAULT 'owner' NOT NULL,
	"from_address" text,
	"to_address" text,
	"call_sid" text,
	"conversation_id" text,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" jsonb,
	"duration_s" integer,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_pin_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_pin_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_pin_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_bot_idx" ON "calls" USING btree ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "calls_owner_idx" ON "calls" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_call_sid_uq" ON "calls" USING btree ("call_sid");--> statement-breakpoint
-- Same safety rail as 0001: row-level security on, no policies (the app connects as the table owner).
ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;

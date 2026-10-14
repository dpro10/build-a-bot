CREATE TABLE "meeting_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"track" text NOT NULL,
	"chunk" integer NOT NULL,
	"idx" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"app" text DEFAULT 'other' NOT NULL,
	"source" text NOT NULL,
	"device_id" text,
	"status" text DEFAULT 'recording' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"notes" text,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "meeting_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_segments" ADD CONSTRAINT "meeting_segments_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_segments_meeting_idx" ON "meeting_segments" USING btree ("meeting_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_segments_chunk_uq" ON "meeting_segments" USING btree ("meeting_id","track","chunk","idx");--> statement-breakpoint
CREATE INDEX "meetings_bot_idx" ON "meetings" USING btree ("bot_id","started_at");--> statement-breakpoint
CREATE INDEX "meetings_owner_status_idx" ON "meetings" USING btree ("owner_id","status");--> statement-breakpoint
-- Same safety rail as 0001: row-level security on, no policies (the app connects as the table owner).
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "meeting_segments" ENABLE ROW LEVEL SECURITY;

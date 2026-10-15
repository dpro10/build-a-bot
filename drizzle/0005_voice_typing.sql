CREATE TABLE "dictionary" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text DEFAULT 'word' NOT NULL,
	"text" text NOT NULL,
	"heard" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "dictation_words" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dictionary" ADD CONSTRAINT "dictionary_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dictionary_owner_idx" ON "dictionary" USING btree ("owner_id");--> statement-breakpoint
-- Same safety rail as 0001: row-level security on, no policies (the app connects as the table owner).
ALTER TABLE "dictionary" ENABLE ROW LEVEL SECURITY;

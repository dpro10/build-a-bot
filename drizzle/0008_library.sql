CREATE TABLE "file_passages" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"idx" integer NOT NULL,
	"page" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"mime" text DEFAULT 'application/octet-stream' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text,
	"status" text DEFAULT 'uploading' NOT NULL,
	"error" text,
	"pages" integer DEFAULT 0 NOT NULL,
	"chars" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_passages" ADD CONSTRAINT "file_passages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_passages" ADD CONSTRAINT "file_passages_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sets" ADD CONSTRAINT "study_sets_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_passages_file_idx" ON "file_passages" USING btree ("file_id","idx");--> statement-breakpoint
CREATE INDEX "file_passages_bot_idx" ON "file_passages" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "file_passages_tsv_idx" ON "file_passages" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "files_bot_idx" ON "files" USING btree ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_source_ref_uq" ON "files" USING btree ("bot_id","source_ref");--> statement-breakpoint
CREATE INDEX "study_sets_bot_idx" ON "study_sets" USING btree ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "study_sets_job_idx" ON "study_sets" USING btree ("job_id");--> statement-breakpoint
-- Same safety rail as 0001: row-level security on, no policies (the app connects as the table owner).
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_passages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "study_sets" ENABLE ROW LEVEL SECURITY;

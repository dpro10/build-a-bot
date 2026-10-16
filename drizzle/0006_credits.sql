CREATE TABLE "credits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"paid_cents" integer,
	"stripe_session_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credits_user_idx" ON "credits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credits_stripe_session_uq" ON "credits" USING btree ("stripe_session_id");--> statement-breakpoint
-- Same safety rail as 0001: row-level security on, no policies (the app connects as the table owner).
ALTER TABLE "credits" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "auth_sessions" (
	"sid" varchar(255) PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_sessions_expire_idx" ON "auth_sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree (("sess"->>'userId'));
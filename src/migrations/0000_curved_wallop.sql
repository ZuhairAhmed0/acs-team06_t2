-- Drizzle's UUID defaults use gen_random_uuid(), which requires pgcrypto on this PostgreSQL version.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('NOT_REQUIRED', 'NOT_STARTED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."financial_account_type" AS ENUM('PLATFORM_CASH', 'USER_AVAILABLE', 'USER_ALLOCATED', 'STATION_PAYABLE');--> statement-breakpoint
CREATE TYPE "public"."financial_entry_type" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."financial_transaction_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."financial_transaction_type" AS ENUM('TOP_UP', 'WITHDRAWAL', 'ALLOCATION', 'DEALLOCATION', 'TRANSFER', 'FUEL_PURCHASE', 'SETTLEMENT', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."station_member_role" AS ENUM('OWNER', 'ATTENDANT');--> statement-breakpoint
CREATE TYPE "public"."station_member_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."system_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INACTIVE', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_name" varchar(100) NOT NULL,
	"account_number" varchar(50) NOT NULL,
	"account_holder_name" varchar(150) NOT NULL,
	"user_id" uuid,
	"station_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_exactly_one_owner" CHECK (("bank_accounts"."user_id" IS NOT NULL AND "bank_accounts"."station_id" IS NULL) OR ("bank_accounts"."user_id" IS NULL AND "bank_accounts"."station_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_type" "financial_account_type" NOT NULL,
	"user_id" uuid,
	"station_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_accounts_ownership_valid" CHECK (
        ("financial_accounts"."account_type" = 'PLATFORM_CASH' AND "financial_accounts"."user_id" IS NULL AND "financial_accounts"."station_id" IS NULL)
        OR ("financial_accounts"."account_type" = 'USER_AVAILABLE' AND "financial_accounts"."user_id" IS NOT NULL AND "financial_accounts"."station_id" IS NULL)
        OR ("financial_accounts"."account_type" = 'USER_ALLOCATED' AND "financial_accounts"."user_id" IS NOT NULL AND "financial_accounts"."station_id" IS NOT NULL)
        OR ("financial_accounts"."account_type" = 'STATION_PAYABLE' AND "financial_accounts"."user_id" IS NULL AND "financial_accounts"."station_id" IS NOT NULL)
      )
);
--> statement-breakpoint
CREATE TABLE "financial_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"financial_account_id" uuid NOT NULL,
	"entry_type" "financial_entry_type" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_entries_amount_positive" CHECK ("financial_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "financial_transaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"previous_status" "financial_transaction_status",
	"new_status" "financial_transaction_status",
	"previous_execution_status" "execution_status",
	"new_execution_status" "execution_status",
	"actor_user_id" uuid,
	"idempotency_key" varchar(128),
	"request_hash" char(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_type" "financial_transaction_type" NOT NULL,
	"status" "financial_transaction_status" DEFAULT 'PENDING' NOT NULL,
	"execution_status" "execution_status" DEFAULT 'NOT_REQUIRED' NOT NULL,
	"requested_amount" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2),
	"user_id" uuid,
	"station_id" uuid,
	"source_station_id" uuid,
	"destination_station_id" uuid,
	"bank_account_id" uuid,
	"submitted_bank_reference" varchar(150),
	"outgoing_bank_reference" varchar(150),
	"reversal_of_transaction_id" uuid,
	"idempotency_key" varchar(128),
	"request_hash" char(64),
	"hold_account_id" uuid,
	"hold_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"captured_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"released_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"execution_started_at" timestamp with time zone,
	"resolution_note" text,
	"created_by_user_id" uuid NOT NULL,
	"processed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "financial_transactions_requested_amount_positive" CHECK ("financial_transactions"."requested_amount" > 0),
	CONSTRAINT "financial_transactions_amount_positive_when_present" CHECK ("financial_transactions"."amount" IS NULL OR "financial_transactions"."amount" > 0),
	CONSTRAINT "financial_transactions_hold_amounts_non_negative" CHECK ("financial_transactions"."hold_amount" >= 0 AND "financial_transactions"."captured_amount" >= 0 AND "financial_transactions"."released_amount" >= 0),
	CONSTRAINT "financial_transactions_hold_amounts_within_hold" CHECK ("financial_transactions"."captured_amount" <= "financial_transactions"."hold_amount" AND "financial_transactions"."captured_amount" + "financial_transactions"."released_amount" <= "financial_transactions"."hold_amount"),
	CONSTRAINT "financial_transactions_hold_account_presence" CHECK (("financial_transactions"."hold_amount" = 0 AND "financial_transactions"."hold_account_id" IS NULL) OR ("financial_transactions"."hold_amount" > 0 AND "financial_transactions"."hold_account_id" IS NOT NULL)),
	CONSTRAINT "financial_transactions_hold_backed_types" CHECK (
        ("financial_transactions"."transaction_type" IN ('FUEL_PURCHASE', 'WITHDRAWAL', 'SETTLEMENT')
          AND "financial_transactions"."hold_amount" = "financial_transactions"."requested_amount"
          AND "financial_transactions"."hold_account_id" IS NOT NULL)
        OR ("financial_transactions"."transaction_type" NOT IN ('FUEL_PURCHASE', 'WITHDRAWAL', 'SETTLEMENT')
          AND "financial_transactions"."hold_amount" = 0
          AND "financial_transactions"."hold_account_id" IS NULL)
      ),
	CONSTRAINT "financial_transactions_completed_amount_present" CHECK ("financial_transactions"."status" <> 'COMPLETED' OR "financial_transactions"."amount" IS NOT NULL),
	CONSTRAINT "financial_transactions_completed_holds_resolved" CHECK ("financial_transactions"."status" <> 'COMPLETED' OR "financial_transactions"."hold_amount" = 0 OR "financial_transactions"."captured_amount" + "financial_transactions"."released_amount" = "financial_transactions"."hold_amount"),
	CONSTRAINT "financial_transactions_unsuccessful_holds_released" CHECK ("financial_transactions"."status" NOT IN ('REJECTED', 'FAILED', 'CANCELLED') OR ("financial_transactions"."captured_amount" = 0 AND "financial_transactions"."released_amount" = "financial_transactions"."hold_amount")),
	CONSTRAINT "financial_transactions_unknown_holds_retained" CHECK ("financial_transactions"."execution_status" <> 'UNKNOWN' OR "financial_transactions"."hold_amount" = 0 OR ("financial_transactions"."captured_amount" = 0 AND "financial_transactions"."released_amount" = 0)),
	CONSTRAINT "financial_transactions_actual_amount_within_request" CHECK ("financial_transactions"."transaction_type" NOT IN ('FUEL_PURCHASE', 'WITHDRAWAL', 'SETTLEMENT') OR "financial_transactions"."amount" IS NULL OR "financial_transactions"."amount" <= "financial_transactions"."requested_amount"),
	CONSTRAINT "financial_transactions_completed_fuel_purchase_capture" CHECK ("financial_transactions"."transaction_type" <> 'FUEL_PURCHASE' OR "financial_transactions"."status" <> 'COMPLETED' OR ("financial_transactions"."amount" <= "financial_transactions"."requested_amount" AND "financial_transactions"."captured_amount" = "financial_transactions"."amount" AND "financial_transactions"."released_amount" = "financial_transactions"."hold_amount" - "financial_transactions"."amount")),
	CONSTRAINT "financial_transactions_completed_outgoing_full_capture" CHECK ("financial_transactions"."transaction_type" NOT IN ('WITHDRAWAL', 'SETTLEMENT') OR "financial_transactions"."status" <> 'COMPLETED' OR ("financial_transactions"."amount" = "financial_transactions"."requested_amount" AND "financial_transactions"."captured_amount" = "financial_transactions"."requested_amount" AND "financial_transactions"."released_amount" = 0)),
	CONSTRAINT "financial_transactions_required_references" CHECK (
        ("financial_transactions"."transaction_type" = 'TOP_UP' AND "financial_transactions"."user_id" IS NOT NULL AND "financial_transactions"."bank_account_id" IS NOT NULL)
        OR ("financial_transactions"."transaction_type" = 'WITHDRAWAL' AND "financial_transactions"."user_id" IS NOT NULL AND "financial_transactions"."bank_account_id" IS NOT NULL)
        OR ("financial_transactions"."transaction_type" = 'ALLOCATION' AND "financial_transactions"."user_id" IS NOT NULL AND "financial_transactions"."station_id" IS NOT NULL)
        OR ("financial_transactions"."transaction_type" = 'DEALLOCATION' AND "financial_transactions"."user_id" IS NOT NULL AND "financial_transactions"."station_id" IS NOT NULL)
        OR ("financial_transactions"."transaction_type" = 'TRANSFER' AND "financial_transactions"."user_id" IS NOT NULL AND "financial_transactions"."source_station_id" IS NOT NULL AND "financial_transactions"."destination_station_id" IS NOT NULL AND "financial_transactions"."source_station_id" <> "financial_transactions"."destination_station_id")
        OR ("financial_transactions"."transaction_type" = 'FUEL_PURCHASE' AND "financial_transactions"."user_id" IS NOT NULL AND "financial_transactions"."station_id" IS NOT NULL)
        OR ("financial_transactions"."transaction_type" = 'SETTLEMENT' AND "financial_transactions"."station_id" IS NOT NULL AND "financial_transactions"."bank_account_id" IS NOT NULL)
        OR ("financial_transactions"."transaction_type" = 'REVERSAL' AND "financial_transactions"."reversal_of_transaction_id" IS NOT NULL)
      ),
	CONSTRAINT "financial_transactions_reversal_reference_only_for_reversals" CHECK (("financial_transactions"."transaction_type" = 'REVERSAL' AND "financial_transactions"."reversal_of_transaction_id" IS NOT NULL) OR ("financial_transactions"."transaction_type" <> 'REVERSAL' AND "financial_transactions"."reversal_of_transaction_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "fuel_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financial_transaction_id" uuid NOT NULL,
	"fuel_type" varchar(30) NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"attendant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_purchases_financial_transaction_id_unique" UNIQUE("financial_transaction_id"),
	CONSTRAINT "fuel_purchases_quantity_positive" CHECK ("fuel_purchases"."quantity" > 0),
	CONSTRAINT "fuel_purchases_unit_price_positive" CHECK ("fuel_purchases"."unit_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "station_fuel_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"fuel_type" varchar(30) NOT NULL,
	"price_per_liter" numeric(18, 2) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_fuel_prices_price_positive" CHECK ("station_fuel_prices"."price_per_liter" > 0),
	CONSTRAINT "station_fuel_prices_valid_range" CHECK ("station_fuel_prices"."valid_until" IS NULL OR "station_fuel_prices"."valid_until" > "station_fuel_prices"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "station_members" (
	"station_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "station_member_role" NOT NULL,
	"status" "station_member_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_members_station_id_user_id_pk" PRIMARY KEY("station_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"address" text NOT NULL,
	"minimum_settlement_amount" numeric(18, 2) NOT NULL,
	"status" "station_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stations_minimum_settlement_amount_positive" CHECK ("stations"."minimum_settlement_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"system_role" "system_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_financial_account_id_financial_accounts_id_fk" FOREIGN KEY ("financial_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transaction_events" ADD CONSTRAINT "financial_transaction_events_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transaction_events" ADD CONSTRAINT "financial_transaction_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_source_station_id_stations_id_fk" FOREIGN KEY ("source_station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_destination_station_id_stations_id_fk" FOREIGN KEY ("destination_station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_reversal_of_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_hold_account_id_financial_accounts_id_fk" FOREIGN KEY ("hold_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_processed_by_user_id_users_id_fk" FOREIGN KEY ("processed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_purchases" ADD CONSTRAINT "fuel_purchases_financial_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_purchases" ADD CONSTRAINT "fuel_purchases_attendant_id_users_id_fk" FOREIGN KEY ("attendant_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_fuel_prices" ADD CONSTRAINT "station_fuel_prices_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_members" ADD CONSTRAINT "station_members_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_members" ADD CONSTRAINT "station_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_primary_user_unique" ON "bank_accounts" USING btree ("user_id") WHERE "bank_accounts"."user_id" IS NOT NULL AND "bank_accounts"."is_primary" = true AND "bank_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_primary_station_unique" ON "bank_accounts" USING btree ("station_id") WHERE "bank_accounts"."station_id" IS NOT NULL AND "bank_accounts"."is_primary" = true AND "bank_accounts"."is_active" = true;--> statement-breakpoint
CREATE INDEX "bank_accounts_user_id_idx" ON "bank_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_station_id_idx" ON "bank_accounts" USING btree ("station_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_platform_cash_unique" ON "financial_accounts" USING btree ("account_type") WHERE "financial_accounts"."account_type" = 'PLATFORM_CASH';--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_user_available_unique" ON "financial_accounts" USING btree ("user_id") WHERE "financial_accounts"."account_type" = 'USER_AVAILABLE';--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_user_station_allocated_unique" ON "financial_accounts" USING btree ("user_id","station_id") WHERE "financial_accounts"."account_type" = 'USER_ALLOCATED';--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_station_payable_unique" ON "financial_accounts" USING btree ("station_id") WHERE "financial_accounts"."account_type" = 'STATION_PAYABLE';--> statement-breakpoint
CREATE INDEX "financial_entries_transaction_id_idx" ON "financial_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "financial_entries_financial_account_id_idx" ON "financial_entries" USING btree ("financial_account_id");--> statement-breakpoint
CREATE INDEX "financial_transaction_events_transaction_created_at_idx" ON "financial_transaction_events" USING btree ("transaction_id","created_at");--> statement-breakpoint
CREATE INDEX "financial_transaction_events_actor_created_at_idx" ON "financial_transaction_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_transactions_creator_idempotency_key_unique" ON "financial_transactions" USING btree ("created_by_user_id","idempotency_key") WHERE "financial_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_transactions_completed_reversal_unique" ON "financial_transactions" USING btree ("reversal_of_transaction_id") WHERE "financial_transactions"."transaction_type" = 'REVERSAL' AND "financial_transactions"."status" = 'COMPLETED' AND "financial_transactions"."reversal_of_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "financial_transactions_user_created_at_idx" ON "financial_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "financial_transactions_station_created_at_idx" ON "financial_transactions" USING btree ("station_id","created_at");--> statement-breakpoint
CREATE INDEX "financial_transactions_type_status_idx" ON "financial_transactions" USING btree ("transaction_type","status");--> statement-breakpoint
CREATE INDEX "financial_transactions_execution_status_idx" ON "financial_transactions" USING btree ("execution_status");--> statement-breakpoint
CREATE INDEX "financial_transactions_hold_account_status_idx" ON "financial_transactions" USING btree ("hold_account_id","status");--> statement-breakpoint
CREATE INDEX "financial_transactions_submitted_bank_reference_idx" ON "financial_transactions" USING btree ("submitted_bank_reference");--> statement-breakpoint
CREATE INDEX "financial_transactions_outgoing_bank_reference_idx" ON "financial_transactions" USING btree ("outgoing_bank_reference");--> statement-breakpoint
CREATE INDEX "financial_transactions_reversal_of_idx" ON "financial_transactions" USING btree ("reversal_of_transaction_id");--> statement-breakpoint
CREATE INDEX "station_fuel_prices_station_fuel_valid_from_idx" ON "station_fuel_prices" USING btree ("station_id","fuel_type","valid_from");--> statement-breakpoint
CREATE INDEX "station_members_user_id_idx" ON "station_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "station_members_station_status_idx" ON "station_members" USING btree ("station_id","status");

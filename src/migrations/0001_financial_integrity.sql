CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

ALTER TABLE "station_fuel_prices"
  ADD CONSTRAINT "station_fuel_prices_no_overlapping_validity"
  EXCLUDE USING gist (
    "station_id" WITH =,
    "fuel_type" WITH =,
    tstzrange("valid_from", COALESCE("valid_until", 'infinity'::timestamptz), '[)') WITH &&
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION "prevent_financial_entry_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial_entries are append-only';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "financial_entries_append_only"
BEFORE UPDATE OR DELETE ON "financial_entries"
FOR EACH ROW
EXECUTE FUNCTION "prevent_financial_entry_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "prevent_financial_transaction_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial_transaction_events are append-only';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "financial_transaction_events_append_only"
BEFORE UPDATE OR DELETE ON "financial_transaction_events"
FOR EACH ROW
EXECUTE FUNCTION "prevent_financial_transaction_event_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ensure_reversal_does_not_reverse_reversal"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."transaction_type" = 'REVERSAL' AND NEW."reversal_of_transaction_id" IS NOT NULL THEN
    PERFORM 1
    FROM "financial_transactions"
    WHERE "id" = NEW."reversal_of_transaction_id"
      AND "transaction_type" = 'REVERSAL';

    IF FOUND THEN
      RAISE EXCEPTION 'a reversal cannot reverse another reversal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "financial_transactions_no_reversal_of_reversal"
BEFORE INSERT OR UPDATE ON "financial_transactions"
FOR EACH ROW
EXECUTE FUNCTION "ensure_reversal_does_not_reverse_reversal"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "assert_completed_transaction_ledger_balance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checked_transaction_id uuid;
  transaction_status "financial_transaction_status";
  entry_count integer;
  total_debit numeric(18, 2);
  total_credit numeric(18, 2);
BEGIN
  IF TG_TABLE_NAME = 'financial_entries' THEN
    checked_transaction_id := COALESCE(NEW."transaction_id", OLD."transaction_id");
  ELSE
    checked_transaction_id := COALESCE(NEW."id", OLD."id");
  END IF;

  SELECT "status"
  INTO transaction_status
  FROM "financial_transactions"
  WHERE "id" = checked_transaction_id;

  IF NOT FOUND OR transaction_status <> 'COMPLETED' THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN "entry_type" = 'DEBIT' THEN "amount" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "entry_type" = 'CREDIT' THEN "amount" ELSE 0 END), 0)
  INTO entry_count, total_debit, total_credit
  FROM "financial_entries"
  WHERE "transaction_id" = checked_transaction_id;

  IF entry_count < 2 OR total_debit <> total_credit THEN
    RAISE EXCEPTION 'completed financial transaction % must have at least two balanced entries', checked_transaction_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "financial_entries_completed_ledger_balance"
AFTER INSERT OR UPDATE OR DELETE ON "financial_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "assert_completed_transaction_ledger_balance"();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "financial_transactions_completed_ledger_balance"
AFTER INSERT OR UPDATE OR DELETE ON "financial_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "assert_completed_transaction_ledger_balance"();

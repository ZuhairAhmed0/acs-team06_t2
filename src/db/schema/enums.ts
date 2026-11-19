import { pgEnum } from "drizzle-orm/pg-core";

export const systemRoleEnum = pgEnum("system_role", ["USER", "ADMIN"]);
export const userStatusEnum = pgEnum("user_status", [
  "ACTIVE",
  "INACTIVE",
  "BLOCKED",
]);
export const stationStatusEnum = pgEnum("station_status", ["ACTIVE", "INACTIVE"]);
export const stationMemberRoleEnum = pgEnum("station_member_role", [
  "OWNER",
  "ATTENDANT",
]);
export const stationMemberStatusEnum = pgEnum("station_member_status", [
  "ACTIVE",
  "INACTIVE",
]);
export const financialAccountTypeEnum = pgEnum("financial_account_type", [
  "PLATFORM_CASH",
  "USER_AVAILABLE",
  "USER_ALLOCATED",
  "STATION_PAYABLE",
]);
export const financialTransactionTypeEnum = pgEnum("financial_transaction_type", [
  "TOP_UP",
  "WITHDRAWAL",
  "ALLOCATION",
  "DEALLOCATION",
  "TRANSFER",
  "FUEL_PURCHASE",
  "SETTLEMENT",
  "REVERSAL",
]);
export const financialTransactionStatusEnum = pgEnum(
  "financial_transaction_status",
  ["PENDING", "PROCESSING", "COMPLETED", "REJECTED", "FAILED", "CANCELLED"],
);
export const executionStatusEnum = pgEnum("execution_status", [
  "NOT_REQUIRED",
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
]);
export const financialEntryTypeEnum = pgEnum("financial_entry_type", [
  "DEBIT",
  "CREDIT",
]);

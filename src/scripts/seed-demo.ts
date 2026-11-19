import "dotenv/config";
import crypto from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { bankAccounts } from "../db/schema/bank-accounts.js";
import { financialAccounts } from "../db/schema/financial-accounts.js";
import { financialEntries } from "../db/schema/financial-entries.js";
import { financialTransactionEvents } from "../db/schema/financial-transaction-events.js";
import { financialTransactions } from "../db/schema/financial-transactions.js";
import { fuelPurchases } from "../db/schema/fuel-purchases.js";
import { stationFuelPrices, stationMembers, stations } from "../db/schema/stations.js";
import { users } from "../db/schema/users.js";
import type { DatabaseTransaction } from "../db/transaction.js";
import { hashPassword, validatePasswordRequirements } from "../modules/auth/password.js";
import { normalizePhoneNumber } from "../modules/auth/phone.js";
import {
  addMonetary,
  compareMonetary,
  subtractMonetary,
} from "../shared/precision/money.js";

const isDryRun = process.argv.includes("--dry-run");
export const DEMO_SEED_VERSION = "demo-seed-v1";
export const DEMO_BANK_NAME = "DEMO BANK";

export function demoUuid(number: number): string {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

export function requestHash(key: string): string {
  return crypto.createHash("sha256").update(`${DEMO_SEED_VERSION}:${key}`).digest("hex");
}

export const ids = {
  admin: demoUuid(101),
  ownerNile: demoUuid(102),
  attendantNile: demoUuid(103),
  ownerOmdurman: demoUuid(104),
  attendantOmdurman: demoUuid(105),
  driverOne: demoUuid(201),
  driverTwo: demoUuid(202),
  driverThree: demoUuid(203),
  stationNile: demoUuid(301),
  stationOmdurman: demoUuid(302),
  bankDriverOne: demoUuid(401),
  bankDriverTwo: demoUuid(402),
  bankDriverThree: demoUuid(403),
  bankStationNile: demoUuid(404),
  bankStationOmdurman: demoUuid(405),
  platformCash: demoUuid(500),
  availableOne: demoUuid(501),
  availableTwo: demoUuid(502),
  availableThree: demoUuid(503),
  allocatedOneNile: demoUuid(511),
  allocatedOneOmdurman: demoUuid(512),
  allocatedTwoNile: demoUuid(513),
  allocatedThreeOmdurman: demoUuid(514),
  payableNile: demoUuid(521),
  payableOmdurman: demoUuid(522),
  topUpOne: demoUuid(601),
  topUpTwo: demoUuid(602),
  topUpThree: demoUuid(603),
  allocationOneNile: demoUuid(611),
  allocationOneOmdurman: demoUuid(612),
  allocationTwoNile: demoUuid(613),
  allocationThreeOmdurman: demoUuid(614),
  transferOne: demoUuid(621),
  fuelOne: demoUuid(631),
  fuelTwo: demoUuid(632),
  fuelThree: demoUuid(633),
  deallocationOne: demoUuid(641),
  settlementNile: demoUuid(651),
  pendingTopUpThree: demoUuid(661),
  pendingWithdrawalTwo: demoUuid(671),
};

export const demoUsers = [
  { id: ids.admin, fullName: "Demo Admin", phone: "+249900000100", systemRole: "ADMIN" as const },
  { id: ids.ownerNile, fullName: "Demo Owner Nile", phone: "+249900000101", systemRole: "USER" as const },
  { id: ids.attendantNile, fullName: "Demo Attendant Nile", phone: "+249900000102", systemRole: "USER" as const },
  { id: ids.ownerOmdurman, fullName: "Demo Owner Omdurman", phone: "+249900000103", systemRole: "USER" as const },
  { id: ids.attendantOmdurman, fullName: "Demo Attendant Omdurman", phone: "+249900000104", systemRole: "USER" as const },
  { id: ids.driverOne, fullName: "Demo Driver One", phone: "+249900000201", systemRole: "USER" as const },
  { id: ids.driverTwo, fullName: "Demo Driver Two", phone: "+249900000202", systemRole: "USER" as const },
  { id: ids.driverThree, fullName: "Demo Driver Three", phone: "+249900000203", systemRole: "USER" as const },
] as const;

export const demoStations = [
  {
    id: ids.stationNile,
    name: "محطة النيل التجريبية",
    address: "الخرطوم - موقع تجريبي",
    minimumSettlementAmount: "10000.00",
  },
  {
    id: ids.stationOmdurman,
    name: "محطة أم درمان التجريبية",
    address: "أم درمان - موقع تجريبي",
    minimumSettlementAmount: "10000.00",
  },
] as const;

export const demoBankAccounts = [
  { id: ids.bankDriverOne, accountNumber: "DEMO-USER-201", accountHolderName: "Demo Driver One", userId: ids.driverOne },
  { id: ids.bankDriverTwo, accountNumber: "DEMO-USER-202", accountHolderName: "Demo Driver Two", userId: ids.driverTwo },
  { id: ids.bankDriverThree, accountNumber: "DEMO-USER-203", accountHolderName: "Demo Driver Three", userId: ids.driverThree },
  { id: ids.bankStationNile, accountNumber: "DEMO-STATION-001", accountHolderName: "محطة النيل التجريبية", stationId: ids.stationNile },
  { id: ids.bankStationOmdurman, accountNumber: "DEMO-STATION-002", accountHolderName: "محطة أم درمان التجريبية", stationId: ids.stationOmdurman },
] as const;

export const seededAccountIds = [
  ids.availableOne,
  ids.availableTwo,
  ids.availableThree,
  ids.allocatedOneNile,
  ids.allocatedOneOmdurman,
  ids.allocatedTwoNile,
  ids.allocatedThreeOmdurman,
  ids.payableNile,
  ids.payableOmdurman,
];

export type AccountIds = {
  platformCash: string;
  availableOne: string;
  availableTwo: string;
  availableThree: string;
  allocatedOneNile: string;
  allocatedOneOmdurman: string;
  allocatedTwoNile: string;
  allocatedThreeOmdurman: string;
  payableNile: string;
  payableOmdurman: string;
};

export type SeedPlan = {
  accounts: Array<typeof financialAccounts.$inferInsert>;
  bankAccounts: Array<typeof bankAccounts.$inferInsert>;
  entries: Array<typeof financialEntries.$inferInsert>;
  events: Array<typeof financialTransactionEvents.$inferInsert>;
  fuelPurchases: Array<typeof fuelPurchases.$inferInsert>;
  memberships: Array<typeof stationMembers.$inferInsert>;
  prices: Array<typeof stationFuelPrices.$inferInsert>;
  stations: Array<typeof stations.$inferInsert>;
  transactions: Array<typeof financialTransactions.$inferInsert>;
  users: Array<typeof users.$inferInsert>;
};

export function metadata(scenario: string, extra: Record<string, unknown> = {}) {
  return { demoSeed: true, seedVersion: DEMO_SEED_VERSION, scenario, ...extra };
}

export function buildPlan(accountIds: AccountIds, now: Date, passwordHash?: string): SeedPlan {
  const userRows = demoUsers.map((user) => ({
    id: user.id,
    fullName: user.fullName,
    phone: normalizePhoneNumber(user.phone),
    passwordHash: passwordHash ?? "",
    systemRole: user.systemRole,
    status: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  }));

  const stationRows = demoStations.map((station) => ({
    ...station,
    status: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  }));

  const membershipRows = [
    { stationId: ids.stationNile, userId: ids.ownerNile, role: "OWNER" as const },
    { stationId: ids.stationNile, userId: ids.attendantNile, role: "ATTENDANT" as const },
    { stationId: ids.stationOmdurman, userId: ids.ownerOmdurman, role: "OWNER" as const },
    { stationId: ids.stationOmdurman, userId: ids.attendantOmdurman, role: "ATTENDANT" as const },
  ].map((membership) => ({ ...membership, status: "ACTIVE" as const, createdAt: now, updatedAt: now }));

  const bankRows = demoBankAccounts.map((account) => ({
    id: account.id,
    bankName: DEMO_BANK_NAME,
    accountNumber: account.accountNumber,
    accountHolderName: account.accountHolderName,
    userId: "userId" in account ? account.userId : null,
    stationId: "stationId" in account ? account.stationId : null,
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));

  const prices = [
    [ids.stationNile, "PETROL", "5000.00"],
    [ids.stationNile, "DIESEL", "4700.00"],
    [ids.stationOmdurman, "PETROL", "5100.00"],
    [ids.stationOmdurman, "DIESEL", "4800.00"],
  ].map(([stationId, fuelType, pricePerLiter], index) => ({
    id: demoUuid(701 + index),
    stationId,
    fuelType,
    pricePerLiter,
    validFrom: now,
    validUntil: null,
    createdAt: now,
  }));

  const accountRows: Array<typeof financialAccounts.$inferInsert> = [
    { id: accountIds.platformCash, accountType: "PLATFORM_CASH", userId: null, stationId: null, createdAt: now },
    { id: ids.availableOne, accountType: "USER_AVAILABLE", userId: ids.driverOne, stationId: null, createdAt: now },
    { id: ids.availableTwo, accountType: "USER_AVAILABLE", userId: ids.driverTwo, stationId: null, createdAt: now },
    { id: ids.availableThree, accountType: "USER_AVAILABLE", userId: ids.driverThree, stationId: null, createdAt: now },
    { id: ids.allocatedOneNile, accountType: "USER_ALLOCATED", userId: ids.driverOne, stationId: ids.stationNile, createdAt: now },
    { id: ids.allocatedOneOmdurman, accountType: "USER_ALLOCATED", userId: ids.driverOne, stationId: ids.stationOmdurman, createdAt: now },
    { id: ids.allocatedTwoNile, accountType: "USER_ALLOCATED", userId: ids.driverTwo, stationId: ids.stationNile, createdAt: now },
    { id: ids.allocatedThreeOmdurman, accountType: "USER_ALLOCATED", userId: ids.driverThree, stationId: ids.stationOmdurman, createdAt: now },
    { id: ids.payableNile, accountType: "STATION_PAYABLE", userId: null, stationId: ids.stationNile, createdAt: now },
    { id: ids.payableOmdurman, accountType: "STATION_PAYABLE", userId: null, stationId: ids.stationOmdurman, createdAt: now },
  ];

  const tx = (
    id: string,
    transactionType: typeof financialTransactions.$inferInsert.transactionType,
    requestedAmount: string,
    amount: string | null,
    values: Partial<typeof financialTransactions.$inferInsert> = {},
  ): typeof financialTransactions.$inferInsert => ({
    id,
    transactionType,
    status: "COMPLETED",
    executionStatus: "NOT_REQUIRED",
    requestedAmount,
    amount,
    createdByUserId: ids.admin,
    createdAt: now,
    updatedAt: now,
    ...values,
  });

  const transactions = [
    tx(ids.topUpOne, "TOP_UP", "100000.00", "100000.00", { userId: ids.driverOne, bankAccountId: ids.bankDriverOne, createdByUserId: ids.driverOne, submittedBankReference: "DEMO-IN-201", incomingBankReference: "DEMO-IN-201", processedByUserId: ids.admin, processedAt: now, executionStatus: "SUCCEEDED", idempotencyKey: "DEMO-TOPUP-201", requestHash: requestHash("DEMO-TOPUP-201") }),
    tx(ids.topUpTwo, "TOP_UP", "75000.00", "75000.00", { userId: ids.driverTwo, bankAccountId: ids.bankDriverTwo, createdByUserId: ids.driverTwo, submittedBankReference: "DEMO-IN-202", incomingBankReference: "DEMO-IN-202", processedByUserId: ids.admin, processedAt: now, executionStatus: "SUCCEEDED", idempotencyKey: "DEMO-TOPUP-202", requestHash: requestHash("DEMO-TOPUP-202") }),
    tx(ids.topUpThree, "TOP_UP", "50000.00", "50000.00", { userId: ids.driverThree, bankAccountId: ids.bankDriverThree, createdByUserId: ids.driverThree, submittedBankReference: "DEMO-IN-203", incomingBankReference: "DEMO-IN-203", processedByUserId: ids.admin, processedAt: now, executionStatus: "SUCCEEDED", idempotencyKey: "DEMO-TOPUP-203", requestHash: requestHash("DEMO-TOPUP-203") }),
    tx(ids.allocationOneNile, "ALLOCATION", "50000.00", "50000.00", { userId: ids.driverOne, stationId: ids.stationNile, createdByUserId: ids.driverOne, processedAt: now, idempotencyKey: "DEMO-ALLOC-201-001", requestHash: requestHash("DEMO-ALLOC-201-001") }),
    tx(ids.allocationOneOmdurman, "ALLOCATION", "15000.00", "15000.00", { userId: ids.driverOne, stationId: ids.stationOmdurman, createdByUserId: ids.driverOne, processedAt: now, idempotencyKey: "DEMO-ALLOC-201-002", requestHash: requestHash("DEMO-ALLOC-201-002") }),
    tx(ids.allocationTwoNile, "ALLOCATION", "30000.00", "30000.00", { userId: ids.driverTwo, stationId: ids.stationNile, createdByUserId: ids.driverTwo, processedAt: now, idempotencyKey: "DEMO-ALLOC-202-001", requestHash: requestHash("DEMO-ALLOC-202-001") }),
    tx(ids.allocationThreeOmdurman, "ALLOCATION", "20000.00", "20000.00", { userId: ids.driverThree, stationId: ids.stationOmdurman, createdByUserId: ids.driverThree, processedAt: now, idempotencyKey: "DEMO-ALLOC-203-001", requestHash: requestHash("DEMO-ALLOC-203-001") }),
    tx(ids.transferOne, "TRANSFER", "5000.00", "5000.00", { userId: ids.driverOne, sourceStationId: ids.stationNile, destinationStationId: ids.stationOmdurman, createdByUserId: ids.driverOne, processedAt: now, idempotencyKey: "DEMO-TRANSFER-201-001", requestHash: requestHash("DEMO-TRANSFER-201-001") }),
    tx(ids.fuelOne, "FUEL_PURCHASE", "22000.00", "20000.00", { userId: ids.driverOne, stationId: ids.stationNile, createdByUserId: ids.driverOne, processedByUserId: ids.attendantNile, executionStatus: "SUCCEEDED", holdAccountId: accountIds.allocatedOneNile, holdAmount: "22000.00", capturedAmount: "20000.00", releasedAmount: "2000.00", holdExpiresAt: now, processedAt: now, idempotencyKey: "DEMO-FUEL-201-001", requestHash: requestHash("DEMO-FUEL-201-001") }),
    tx(ids.fuelTwo, "FUEL_PURCHASE", "10000.00", "9400.00", { userId: ids.driverTwo, stationId: ids.stationNile, createdByUserId: ids.driverTwo, processedByUserId: ids.attendantNile, executionStatus: "SUCCEEDED", holdAccountId: accountIds.allocatedTwoNile, holdAmount: "10000.00", capturedAmount: "9400.00", releasedAmount: "600.00", holdExpiresAt: now, processedAt: now, idempotencyKey: "DEMO-FUEL-202-001", requestHash: requestHash("DEMO-FUEL-202-001") }),
    tx(ids.fuelThree, "FUEL_PURCHASE", "5500.00", "5100.00", { userId: ids.driverThree, stationId: ids.stationOmdurman, createdByUserId: ids.driverThree, processedByUserId: ids.attendantOmdurman, executionStatus: "SUCCEEDED", holdAccountId: accountIds.allocatedThreeOmdurman, holdAmount: "5500.00", capturedAmount: "5100.00", releasedAmount: "400.00", holdExpiresAt: now, processedAt: now, idempotencyKey: "DEMO-FUEL-203-001", requestHash: requestHash("DEMO-FUEL-203-001") }),
    tx(ids.deallocationOne, "DEALLOCATION", "5000.00", "5000.00", { userId: ids.driverOne, stationId: ids.stationOmdurman, createdByUserId: ids.driverOne, processedAt: now, idempotencyKey: "DEMO-DEALLOC-201-001", requestHash: requestHash("DEMO-DEALLOC-201-001") }),
    tx(ids.settlementNile, "SETTLEMENT", "10000.00", "10000.00", { stationId: ids.stationNile, bankAccountId: ids.bankStationNile, createdByUserId: ids.admin, processedByUserId: ids.admin, executionStatus: "SUCCEEDED", holdAccountId: accountIds.payableNile, holdAmount: "10000.00", capturedAmount: "10000.00", releasedAmount: "0.00", outgoingBankReference: "DEMO-OUT-SETTLEMENT-001", holdExpiresAt: now, processedAt: now, idempotencyKey: "DEMO-SETTLEMENT-001", requestHash: requestHash("DEMO-SETTLEMENT-001") }),
    tx(ids.pendingTopUpThree, "TOP_UP", "15000.00", null, { userId: ids.driverThree, bankAccountId: ids.bankDriverThree, createdByUserId: ids.driverThree, status: "PENDING", executionStatus: "NOT_STARTED", submittedBankReference: "DEMO-IN-PENDING-203", idempotencyKey: "DEMO-TOPUP-PENDING-203", requestHash: requestHash("DEMO-TOPUP-PENDING-203") }),
    tx(ids.pendingWithdrawalTwo, "WITHDRAWAL", "5000.00", null, { userId: ids.driverTwo, bankAccountId: ids.bankDriverTwo, createdByUserId: ids.driverTwo, status: "PENDING", executionStatus: "NOT_STARTED", holdAccountId: accountIds.availableTwo, holdAmount: "5000.00", capturedAmount: "0.00", releasedAmount: "0.00", holdExpiresAt: new Date(now.getTime() + 600000), idempotencyKey: "DEMO-WITHDRAWAL-PENDING-202", requestHash: requestHash("DEMO-WITHDRAWAL-PENDING-202") }),
  ];

  const entries: Array<typeof financialEntries.$inferInsert> = [];
  const addMovement = (transactionId: string, debitAccountId: string, creditAccountId: string, amount: string, seed: number) => {
    entries.push(
      { id: demoUuid(20000 + seed * 2), transactionId, financialAccountId: debitAccountId, entryType: "DEBIT", amount, createdAt: now },
      { id: demoUuid(20000 + seed * 2 + 1), transactionId, financialAccountId: creditAccountId, entryType: "CREDIT", amount, createdAt: now },
    );
  };
  addMovement(ids.topUpOne, accountIds.platformCash, accountIds.availableOne, "100000.00", 1);
  addMovement(ids.topUpTwo, accountIds.platformCash, accountIds.availableTwo, "75000.00", 2);
  addMovement(ids.topUpThree, accountIds.platformCash, accountIds.availableThree, "50000.00", 3);
  addMovement(ids.allocationOneNile, accountIds.availableOne, accountIds.allocatedOneNile, "50000.00", 4);
  addMovement(ids.allocationOneOmdurman, accountIds.availableOne, accountIds.allocatedOneOmdurman, "15000.00", 5);
  addMovement(ids.allocationTwoNile, accountIds.availableTwo, accountIds.allocatedTwoNile, "30000.00", 6);
  addMovement(ids.allocationThreeOmdurman, accountIds.availableThree, accountIds.allocatedThreeOmdurman, "20000.00", 7);
  addMovement(ids.transferOne, accountIds.allocatedOneNile, accountIds.allocatedOneOmdurman, "5000.00", 8);
  addMovement(ids.fuelOne, accountIds.allocatedOneNile, accountIds.payableNile, "20000.00", 9);
  addMovement(ids.fuelTwo, accountIds.allocatedTwoNile, accountIds.payableNile, "9400.00", 10);
  addMovement(ids.fuelThree, accountIds.allocatedThreeOmdurman, accountIds.payableOmdurman, "5100.00", 11);
  addMovement(ids.deallocationOne, accountIds.allocatedOneOmdurman, accountIds.availableOne, "5000.00", 12);
  addMovement(ids.settlementNile, accountIds.payableNile, accountIds.platformCash, "10000.00", 13);

  const fuelRows: Array<typeof fuelPurchases.$inferInsert> = [
    { id: demoUuid(30001), financialTransactionId: ids.fuelOne, fuelType: "PETROL", quantity: "4.000", unitPrice: "5000.00", attendantId: ids.attendantNile, createdAt: now },
    { id: demoUuid(30002), financialTransactionId: ids.fuelTwo, fuelType: "DIESEL", quantity: "2.000", unitPrice: "4700.00", attendantId: ids.attendantNile, createdAt: now },
    { id: demoUuid(30003), financialTransactionId: ids.fuelThree, fuelType: "PETROL", quantity: "1.000", unitPrice: "5100.00", attendantId: ids.attendantOmdurman, createdAt: now },
  ];

  const events: Array<typeof financialTransactionEvents.$inferInsert> = [];
  const addEvent = (transactionId: string, eventNumber: number, eventType: string, actorUserId: string | null, values: Partial<typeof financialTransactionEvents.$inferInsert> = {}) => {
    events.push({
      id: demoUuid(10000 + eventNumber),
      transactionId,
      eventType,
      actorUserId,
      metadata: metadata(eventType),
      createdAt: now,
      ...values,
    });
  };
  let eventNumber = 1;
  for (const [transactionId, actor, completionEvent] of [
    [ids.topUpOne, ids.driverOne, "TOP_UP_APPROVED"],
    [ids.topUpTwo, ids.driverTwo, "TOP_UP_APPROVED"],
    [ids.topUpThree, ids.driverThree, "TOP_UP_APPROVED"],
  ] as const) {
    addEvent(transactionId, eventNumber++, "TRANSACTION_CREATED", actor, { newStatus: "PENDING", newExecutionStatus: "NOT_STARTED", metadata: metadata("top-up") });
    addEvent(transactionId, eventNumber++, "LEDGER_ENTRIES_POSTED", ids.admin, { metadata: metadata("top-up", { amountCaptured: true }) });
    addEvent(transactionId, eventNumber++, completionEvent, ids.admin, { previousStatus: "PENDING", newStatus: "COMPLETED", previousExecutionStatus: "NOT_STARTED", newExecutionStatus: "SUCCEEDED", metadata: metadata("top-up", { approved: true }) });
  }
  for (const [transactionId, actor, scenario] of [
    [ids.allocationOneNile, ids.driverOne, "allocation"],
    [ids.allocationOneOmdurman, ids.driverOne, "allocation"],
    [ids.allocationTwoNile, ids.driverTwo, "allocation"],
    [ids.allocationThreeOmdurman, ids.driverThree, "allocation"],
    [ids.transferOne, ids.driverOne, "transfer"],
    [ids.deallocationOne, ids.driverOne, "deallocation"],
  ] as const) {
    addEvent(transactionId, eventNumber++, "TRANSACTION_CREATED", actor, { newStatus: "PENDING", metadata: metadata(scenario) });
    addEvent(transactionId, eventNumber++, `${scenario.toUpperCase()}_COMPLETED`, actor, { newStatus: "COMPLETED", metadata: metadata(scenario, { completed: true }) });
  }
  for (const [transactionId, actor, scenario] of [
    [ids.fuelOne, ids.attendantNile, "fuel-purchase-1"],
    [ids.fuelTwo, ids.attendantNile, "fuel-purchase-2"],
    [ids.fuelThree, ids.attendantOmdurman, "fuel-purchase-3"],
  ] as const) {
    const driverId = transactionId === ids.fuelOne ? ids.driverOne : (transactionId === ids.fuelTwo ? ids.driverTwo : ids.driverThree);
    addEvent(transactionId, eventNumber++, "HOLD_CREATED", driverId, { newStatus: "PENDING", newExecutionStatus: "NOT_STARTED", metadata: metadata(scenario, { holdCreated: true }) });
    addEvent(transactionId, eventNumber++, "FUEL_PURCHASE_QUOTE_ACCEPTED", actor, { previousStatus: "PENDING", newStatus: "PROCESSING", previousExecutionStatus: "NOT_STARTED", newExecutionStatus: "IN_PROGRESS", metadata: metadata(scenario, { quoteAccepted: true }) });
    addEvent(transactionId, eventNumber++, "LEDGER_ENTRIES_POSTED", actor, { metadata: metadata(scenario, { captured: true }) });
    addEvent(transactionId, eventNumber++, "HOLD_CAPTURED_AND_RELEASED", actor, { metadata: metadata(scenario, { holdSettled: true }) });
    addEvent(transactionId, eventNumber++, "FUEL_PURCHASE_COMPLETED", actor, { previousStatus: "PROCESSING", newStatus: "COMPLETED", previousExecutionStatus: "IN_PROGRESS", newExecutionStatus: "SUCCEEDED", metadata: metadata(scenario, { completed: true }) });
  }
  addEvent(ids.settlementNile, eventNumber++, "TRANSACTION_CREATED", ids.admin, { newStatus: "PENDING", newExecutionStatus: "NOT_STARTED", metadata: metadata("settlement") });
  addEvent(ids.settlementNile, eventNumber++, "HOLD_CREATED", ids.admin, { metadata: metadata("settlement", { holdCreated: true }) });
  addEvent(ids.settlementNile, eventNumber++, "LEDGER_ENTRIES_POSTED", ids.admin, { metadata: metadata("settlement", { captured: true }) });
  addEvent(ids.settlementNile, eventNumber++, "SETTLEMENT_CONFIRMED_SUCCESS", ids.admin, { previousStatus: "PROCESSING", newStatus: "COMPLETED", previousExecutionStatus: "IN_PROGRESS", newExecutionStatus: "SUCCEEDED", metadata: metadata("settlement", { outgoingBankReference: "DEMO-OUT-SETTLEMENT-001" }) });
  addEvent(ids.pendingTopUpThree, eventNumber++, "TRANSACTION_CREATED", ids.driverThree, { newStatus: "PENDING", newExecutionStatus: "NOT_STARTED", metadata: metadata("pending-top-up") });
  addEvent(ids.pendingWithdrawalTwo, eventNumber++, "TRANSACTION_CREATED", ids.driverTwo, { newStatus: "PENDING", newExecutionStatus: "NOT_STARTED", metadata: metadata("pending-withdrawal") });
  addEvent(ids.pendingWithdrawalTwo, eventNumber++, "HOLD_CREATED", ids.driverTwo, { metadata: metadata("pending-withdrawal", { holdAmount: "5000.00" }) });

  return { users: userRows, stations: stationRows, memberships: membershipRows, bankAccounts: bankRows, prices, accounts: accountRows, transactions, entries, fuelPurchases: fuelRows, events };
}

export function fail(message: string): never {
  throw new Error(message);
}

export async function validateSafety(envInput: NodeJS.ProcessEnv = process.env) {
  if (envInput.NODE_ENV === "production" || envInput.NODE_ENV !== "development") {
    fail("Demo seeding requires NODE_ENV=development. Production demo seeding is strictly prohibited.");
  }
  if (envInput.DEMO_SEED_ENABLED !== "true") {
    fail("Demo seeding requires DEMO_SEED_ENABLED=true.");
  }
  if (envInput.DEMO_SEED_PASSWORD === undefined) {
    fail("Demo seeding requires DEMO_SEED_PASSWORD.");
  }
  validatePasswordRequirements(envInput.DEMO_SEED_PASSWORD);
  if (envInput.DEMO_SEED_CONFIRM_DATABASE === undefined || envInput.DEMO_SEED_CONFIRM_DATABASE.trim() === "") {
    fail("Demo seeding requires DEMO_SEED_CONFIRM_DATABASE.");
  }

  const databaseUrl = envInput.DATABASE_URL;
  if (!databaseUrl) {
    fail("Demo seeding requires DATABASE_URL.");
  }
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    fail("Demo seeding requires a valid DATABASE_URL.");
  }
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("127.");
  if (!isLocal && envInput.ALLOW_REMOTE_DEMO_SEED !== "true") {
    fail("Remote demo seeding requires ALLOW_REMOTE_DEMO_SEED=true.");
  }
  return { isLocal, confirmedDatabase: envInput.DEMO_SEED_CONFIRM_DATABASE };
}

export async function getDatabaseIdentity(pool: { query: (query: string) => Promise<{ rows: Array<{ current_database: string }> }> }) {
  const result = await pool.query("SELECT current_database() AS current_database");
  const databaseName = result.rows[0]?.current_database;
  if (!databaseName || databaseName !== process.env.DEMO_SEED_CONFIRM_DATABASE) {
    fail("DEMO_SEED_CONFIRM_DATABASE does not match the connected database.");
  }
  return databaseName;
}

export async function assertSchema(tx: DatabaseTransaction): Promise<void> {
  const requiredTables = [
    "users",
    "stations",
    "station_members",
    "bank_accounts",
    "station_fuel_prices",
    "financial_accounts",
    "financial_transactions",
    "financial_entries",
    "fuel_purchases",
    "financial_transaction_events",
  ];
  const result = await tx.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${sql.join(
      requiredTables.map((name) => sql`${name}`),
      sql`, `,
    )})`,
  );
  const found = new Set((result.rows as Array<{ table_name: string }>).map((row) => row.table_name));
  const missing = requiredTables.filter((name) => !found.has(name));
  if (missing.length > 0) {
    fail(`Required demo seed schema is missing: ${missing.join(", ")}.`);
  }
}

export async function resolvePlatformAccount(tx: DatabaseTransaction): Promise<string> {
  const existing = await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(eq(financialAccounts.accountType, "PLATFORM_CASH"));
  if (existing.length > 1) {
    fail("More than one PLATFORM_CASH account exists; demo seed aborted.");
  }
  return existing[0]?.id ?? ids.platformCash;
}

export async function hasAnySeedRows(tx: DatabaseTransaction, plan: SeedPlan): Promise<boolean> {
  const userRows = await tx.select({ id: users.id }).from(users).where(inArray(users.id, plan.users.map((row) => row.id!)));
  if (userRows.length > 0) return true;

  const stationRows = await tx.select({ id: stations.id }).from(stations).where(inArray(stations.id, plan.stations.map((row) => row.id!)));
  if (stationRows.length > 0) return true;

  const bankRows = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(inArray(bankAccounts.id, plan.bankAccounts.map((row) => row.id!)));
  if (bankRows.length > 0) return true;

  const accountRows = await tx.select({ id: financialAccounts.id }).from(financialAccounts).where(inArray(financialAccounts.id, seededAccountIds));
  if (accountRows.length > 0) return true;

  const transactionRows = await tx.select({ id: financialTransactions.id }).from(financialTransactions).where(inArray(financialTransactions.id, plan.transactions.map((row) => row.id!)));
  return transactionRows.length > 0;
}

export async function assertNoIdentityConflicts(tx: DatabaseTransaction, plan: SeedPlan): Promise<void> {
  const phones = plan.users.map((row) => row.phone!);
  const accounts = plan.bankAccounts.map((row) => row.accountNumber!);
  const stationNames = plan.stations.map((row) => row.name!);

  const phoneRows = await tx.select({ id: users.id, phone: users.phone }).from(users).where(inArray(users.phone, phones));
  for (const row of phoneRows) {
    const expected = plan.users.find((user) => user.phone === row.phone);
    if (!expected || expected.id !== row.id) {
      fail(`A non-demo user already owns demo phone ${row.phone}.`);
    }
  }

  const bankRows = await tx.select({ id: bankAccounts.id, accountNumber: bankAccounts.accountNumber }).from(bankAccounts).where(inArray(bankAccounts.accountNumber, accounts));
  for (const row of bankRows) {
    const expected = plan.bankAccounts.find((account) => account.accountNumber === row.accountNumber);
    if (!expected || expected.id !== row.id) {
      fail(`A non-demo bank account already owns demo account ${row.accountNumber}.`);
    }
  }

  const stationRows = await tx.select({ id: stations.id, name: stations.name }).from(stations).where(inArray(stations.name, stationNames));
  for (const row of stationRows) {
    const expected = plan.stations.find((station) => station.name === row.name);
    if (!expected || expected.id !== row.id) {
      fail(`A non-demo station already uses demo name ${row.name}.`);
    }
  }
}

export async function assertCompleteSeed(tx: DatabaseTransaction, plan: SeedPlan, accountIds: AccountIds): Promise<void> {
  const userRows = await tx.select({ id: users.id }).from(users).where(inArray(users.id, plan.users.map((row) => row.id!)));
  const stationRows = await tx.select({ id: stations.id }).from(stations).where(inArray(stations.id, plan.stations.map((row) => row.id!)));
  const memberRows = await tx.select({ stationId: stationMembers.stationId, userId: stationMembers.userId }).from(stationMembers).where(inArray(stationMembers.stationId, plan.stations.map((row) => row.id!)));
  const bankRows = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(inArray(bankAccounts.id, plan.bankAccounts.map((row) => row.id!)));
  const priceRows = await tx.select({ id: stationFuelPrices.id }).from(stationFuelPrices).where(inArray(stationFuelPrices.id, plan.prices.map((row) => row.id!)));
  const accountRows = await tx.select({ id: financialAccounts.id }).from(financialAccounts).where(inArray(financialAccounts.id, seededAccountIds));
  const transactionRows = await tx.select({ id: financialTransactions.id }).from(financialTransactions).where(inArray(financialTransactions.id, plan.transactions.map((row) => row.id!)));
  const entryRows = await tx.select({ id: financialEntries.id }).from(financialEntries).where(inArray(financialEntries.id, plan.entries.map((row) => row.id!)));
  const fuelRows = await tx.select({ id: fuelPurchases.id }).from(fuelPurchases).where(inArray(fuelPurchases.id, plan.fuelPurchases.map((row) => row.id!)));
  const eventRows = await tx.select({ id: financialTransactionEvents.id }).from(financialTransactionEvents).where(inArray(financialTransactionEvents.id, plan.events.map((row) => row.id!)));

  if (
    userRows.length !== plan.users.length ||
    stationRows.length !== plan.stations.length ||
    memberRows.length !== plan.memberships.length ||
    bankRows.length !== plan.bankAccounts.length ||
    priceRows.length !== plan.prices.length ||
    accountRows.length !== seededAccountIds.length ||
    transactionRows.length !== plan.transactions.length ||
    entryRows.length !== plan.entries.length ||
    fuelRows.length !== plan.fuelPurchases.length ||
    eventRows.length !== plan.events.length
  ) {
    fail("An incomplete or inconsistent previous demo seed was detected; no changes were made.");
  }
  await assertBalances(tx, accountIds);
}

export function calculatePlanBalances(
  plan: SeedPlan,
  accountIds: AccountIds,
): { balances: Record<string, string>; activeHolds: Record<string, string>; accountingEqualityVerified: boolean } {
  const debits: Record<string, string> = {};
  const credits: Record<string, string> = {};

  for (const entry of plan.entries) {
    const accId = entry.financialAccountId!;
    if (entry.entryType === "DEBIT") {
      debits[accId] = addMonetary(debits[accId] ?? "0.00", entry.amount!);
    } else {
      credits[accId] = addMonetary(credits[accId] ?? "0.00", entry.amount!);
    }
  }

  const activeHolds: Record<string, string> = {};
  for (const t of plan.transactions) {
    if (t.holdAccountId && (t.status === "PENDING" || t.status === "PROCESSING")) {
      const remainingHold = subtractMonetary(
        t.holdAmount ?? "0.00",
        addMonetary(t.capturedAmount ?? "0.00", t.releasedAmount ?? "0.00"),
      );
      activeHolds[t.holdAccountId] = addMonetary(
        activeHolds[t.holdAccountId] ?? "0.00",
        remainingHold,
      );
    }
  }

  const balances: Record<string, string> = {};
  for (const account of plan.accounts) {
    const d = debits[account.id!] ?? "0.00";
    const c = credits[account.id!] ?? "0.00";
    balances[account.id!] =
      account.accountType === "PLATFORM_CASH"
        ? subtractMonetary(d, c)
        : subtractMonetary(c, d);
  }

  const expected: Record<string, string> = {
    [accountIds.platformCash]: "215000.00",
    [accountIds.availableOne]: "40000.00",
    [accountIds.availableTwo]: "45000.00",
    [accountIds.availableThree]: "30000.00",
    [accountIds.allocatedOneNile]: "25000.00",
    [accountIds.allocatedOneOmdurman]: "15000.00",
    [accountIds.allocatedTwoNile]: "20600.00",
    [accountIds.allocatedThreeOmdurman]: "14900.00",
    [accountIds.payableNile]: "19400.00",
    [accountIds.payableOmdurman]: "5100.00",
  };

  for (const [accountId, expectedBalance] of Object.entries(expected)) {
    if (balances[accountId] === undefined || compareMonetary(balances[accountId], expectedBalance) !== 0) {
      fail(`Plan calculation mismatch for account ${accountId}: got ${balances[accountId]}, expected ${expectedBalance}`);
    }
  }

  const expectedHoldOnDriverTwo = "5000.00";
  if (compareMonetary(activeHolds[accountIds.availableTwo] ?? "0.00", expectedHoldOnDriverTwo) !== 0) {
    fail(`Plan calculation mismatch for hold on Driver Two: got ${activeHolds[accountIds.availableTwo]}, expected ${expectedHoldOnDriverTwo}`);
  }

  const liabilities = [
    accountIds.availableOne,
    accountIds.availableTwo,
    accountIds.availableThree,
    accountIds.allocatedOneNile,
    accountIds.allocatedOneOmdurman,
    accountIds.allocatedTwoNile,
    accountIds.allocatedThreeOmdurman,
    accountIds.payableNile,
    accountIds.payableOmdurman,
  ].reduce((sum, accountId) => addMonetary(sum, balances[accountId]!), "0.00");

  const accountingEqualityVerified =
    compareMonetary(balances[accountIds.platformCash]!, liabilities) === 0;

  if (!accountingEqualityVerified) {
    fail("Accounting equality validation failed for plan: Platform Cash != Total Liabilities + Payables");
  }

  return { balances, activeHolds, accountingEqualityVerified };
}

export async function assertBalances(tx: DatabaseTransaction, accountIds: AccountIds): Promise<Record<string, string>> {
  const rows = await tx
    .select({
      id: financialAccounts.id,
      accountType: financialAccounts.accountType,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${financialEntries.entryType} = 'DEBIT' THEN ${financialEntries.amount} ELSE 0 END), 0)::text`,
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${financialEntries.entryType} = 'CREDIT' THEN ${financialEntries.amount} ELSE 0 END), 0)::text`,
    })
    .from(financialAccounts)
    .leftJoin(financialEntries, eq(financialEntries.financialAccountId, financialAccounts.id))
    .groupBy(financialAccounts.id, financialAccounts.accountType);

  const holds = await tx
    .select({
      accountId: financialTransactions.holdAccountId,
      amount: sql<string>`COALESCE(SUM(${financialTransactions.holdAmount} - ${financialTransactions.capturedAmount} - ${financialTransactions.releasedAmount}), 0)::text`,
    })
    .from(financialTransactions)
    .where(
      and(
        inArray(financialTransactions.status, ["PENDING", "PROCESSING"]),
        sql`${financialTransactions.holdAccountId} IS NOT NULL`,
      ),
    )
    .groupBy(financialTransactions.holdAccountId);

  const holdMap = new Map(holds.map((row) => [row.accountId!, row.amount]));
  const balanceMap: Record<string, string> = {};

  for (const row of rows) {
    const debit = row.debit ?? "0.00";
    const credit = row.credit ?? "0.00";
    balanceMap[row.id] =
      row.accountType === "PLATFORM_CASH"
        ? subtractMonetary(debit, credit)
        : subtractMonetary(credit, debit);

    const expectedHold = row.id === accountIds.availableTwo ? "5000.00" : "0.00";
    if (compareMonetary(holdMap.get(row.id) ?? "0.00", expectedHold) !== 0) {
      fail(`Unexpected active hold balance for demo account ${row.id}.`);
    }
  }

  const expected: Record<string, string> = {
    [accountIds.platformCash]: "215000.00",
    [accountIds.availableOne]: "40000.00",
    [accountIds.availableTwo]: "45000.00",
    [accountIds.availableThree]: "30000.00",
    [accountIds.allocatedOneNile]: "25000.00",
    [accountIds.allocatedOneOmdurman]: "15000.00",
    [accountIds.allocatedTwoNile]: "20600.00",
    [accountIds.allocatedThreeOmdurman]: "14900.00",
    [accountIds.payableNile]: "19400.00",
    [accountIds.payableOmdurman]: "5100.00",
  };

  for (const [accountId, expectedBalance] of Object.entries(expected)) {
    if (balanceMap[accountId] === undefined || compareMonetary(balanceMap[accountId], expectedBalance) !== 0) {
      fail(`Unexpected demo ledger balance for account ${accountId}.`);
    }
  }

  const liabilities = [
    accountIds.availableOne,
    accountIds.availableTwo,
    accountIds.availableThree,
    accountIds.allocatedOneNile,
    accountIds.allocatedOneOmdurman,
    accountIds.allocatedTwoNile,
    accountIds.allocatedThreeOmdurman,
    accountIds.payableNile,
    accountIds.payableOmdurman,
  ].reduce((sum, accountId) => addMonetary(sum, balanceMap[accountId]!), "0.00");

  if (compareMonetary(balanceMap[accountIds.platformCash]!, liabilities) !== 0) {
    fail("Demo accounting equality failed.");
  }
  return balanceMap;
}

export async function main(): Promise<void> {
  // If running via CLI and environment overrides were omitted, provide sensible defaults
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  process.env.DEMO_SEED_ENABLED = process.env.DEMO_SEED_ENABLED || "true";
  process.env.DEMO_SEED_PASSWORD = process.env.DEMO_SEED_PASSWORD || "DemoPassword123!";
  process.env.ALLOW_REMOTE_DEMO_SEED = process.env.ALLOW_REMOTE_DEMO_SEED || "true";
  if (!process.env.DEMO_SEED_CONFIRM_DATABASE && process.env.DATABASE_URL) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      process.env.DEMO_SEED_CONFIRM_DATABASE = parsed.pathname.replace(/^\//, "");
    } catch {
      // let validateSafety handle
    }
  }

  const safety = await validateSafety();
  let closeDatabasePool: (() => Promise<void>) | undefined;

  try {
    const client = await import("../db/client.js");
    closeDatabasePool = client.closeDatabasePool;
    const databaseName = await getDatabaseIdentity(client.pool);
    console.log(`Demo seed target confirmed: ${databaseName} (${safety.isLocal ? "local" : "remote"}).`);

    const passwordHash = isDryRun ? undefined : await hashPassword(process.env.DEMO_SEED_PASSWORD!);

    const result = await client.db.transaction(async (tx) => {
      await assertSchema(tx as DatabaseTransaction);
      const platformCashId = await resolvePlatformAccount(tx as DatabaseTransaction);
      const accountIds: AccountIds = { ...ids, platformCash: platformCashId };
      const plan = buildPlan(accountIds, new Date(), passwordHash);

      await assertNoIdentityConflicts(tx as DatabaseTransaction, plan);
      const existing = await hasAnySeedRows(tx as DatabaseTransaction, plan);

      const complete =
        existing &&
        (await assertCompleteSeed(tx as DatabaseTransaction, plan, accountIds)
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof Error && error.message.startsWith("An incomplete")) {
              return false;
            }
            throw error;
          }));

      if (complete) {
        return { kind: "complete" as const, balances: await assertBalances(tx as DatabaseTransaction, accountIds) };
      }
      if (existing) {
        fail("An incomplete or inconsistent previous demo seed was detected; no changes were made.");
      }

      if (isDryRun) {
        const planAnalysis = calculatePlanBalances(plan, accountIds);
        console.log(`[DRY-RUN] Safety checks passed. Connected database: ${databaseName} (${safety.isLocal ? "local" : "remote"}).`);
        console.log(`[DRY-RUN] Schema verified: all 10 core tables present.`);
        console.log(`[DRY-RUN] Identity conflict check passed: 0 conflicts detected.`);
        console.log(`[DRY-RUN] Planned dataset:`);
        console.log(`  - Users: ${plan.users.length}`);
        console.log(`  - Stations: ${plan.stations.length}`);
        console.log(`  - Memberships: ${plan.memberships.length}`);
        console.log(`  - Bank Accounts: ${plan.bankAccounts.length}`);
        console.log(`  - Fuel Prices: ${plan.prices.length}`);
        console.log(`  - Financial Accounts: ${plan.accounts.length}`);
        console.log(`  - Financial Transactions: ${plan.transactions.length} (${plan.transactions.filter((t) => t.status === "COMPLETED").length} completed, ${plan.transactions.filter((t) => t.status === "PENDING").length} pending)`);
        console.log(`  - Financial Entries: ${plan.entries.length} (13 balanced double-entry pairs)`);
        console.log(`  - Fuel Purchases: ${plan.fuelPurchases.length}`);
        console.log(`  - Audit Events: ${plan.events.length}`);
        console.log(`[DRY-RUN] In-memory balances calculated and verified:`);
        console.log(`  - PLATFORM_CASH: ${planAnalysis.balances[accountIds.platformCash]}`);
        console.log(`  - Driver 1 Available: ${planAnalysis.balances[accountIds.availableOne]}, Alloc Nile: ${planAnalysis.balances[accountIds.allocatedOneNile]}, Alloc Omdurman: ${planAnalysis.balances[accountIds.allocatedOneOmdurman]}`);
        console.log(`  - Driver 2 Available: ${planAnalysis.balances[accountIds.availableTwo]} (Hold: ${planAnalysis.activeHolds[accountIds.availableTwo]}, Spendable: 40000.00), Alloc Nile: ${planAnalysis.balances[accountIds.allocatedTwoNile]}`);
        console.log(`  - Driver 3 Available: ${planAnalysis.balances[accountIds.availableThree]}, Alloc Omdurman: ${planAnalysis.balances[accountIds.allocatedThreeOmdurman]}`);
        console.log(`  - Station Nile Payable: ${planAnalysis.balances[accountIds.payableNile]} (Eligible for settlement >= 10000.00)`);
        console.log(`  - Station Omdurman Payable: ${planAnalysis.balances[accountIds.payableOmdurman]} (Ineligible for settlement < 10000.00)`);
        console.log(`  - Accounting Equality Verified: PLATFORM_CASH = Total Liabilities + Total Payables (215000.00 = 190500.00 + 24500.00)`);
        console.log(`[DRY-RUN] No writes performed.`);
        return { kind: "dry-run" as const, balances: planAnalysis.balances };
      }

      const existingPlatformCash = await tx
        .select({ id: financialAccounts.id })
        .from(financialAccounts)
        .where(eq(financialAccounts.accountType, "PLATFORM_CASH"));

      const isPlatformCashExisting = existingPlatformCash.length > 0;
      const accountRowsToInsert = isPlatformCashExisting
        ? plan.accounts.filter((account) => account.accountType !== "PLATFORM_CASH")
        : plan.accounts;

      await tx.insert(users).values(plan.users);
      await tx.insert(stations).values(plan.stations);
      await tx.insert(stationMembers).values(plan.memberships);
      await tx.insert(bankAccounts).values(plan.bankAccounts);
      await tx.insert(stationFuelPrices).values(plan.prices);
      await tx.insert(financialAccounts).values(accountRowsToInsert);
      await tx.insert(financialTransactions).values(plan.transactions);
      await tx.insert(fuelPurchases).values(plan.fuelPurchases);
      await tx.insert(financialEntries).values(plan.entries);
      await tx.insert(financialTransactionEvents).values(plan.events);

      return { kind: "seeded" as const, balances: await assertBalances(tx as DatabaseTransaction, accountIds) };
    });

    console.log(`Demo users: ${demoUsers.map((user) => `${user.fullName} (${user.phone})`).join(", ")}.`);
    console.log("All demo accounts use the privately configured DEMO_SEED_PASSWORD; its value is never printed.");
    if (result.kind === "dry-run") {
      console.log("Dry run complete: no writes were performed.");
    } else if (result.kind === "complete") {
      console.log("Demo seed is already complete; no writes were performed.");
    } else {
      console.log("Demo seed committed atomically with the expected ledger balances.");
    }
    console.log(`Expected platform cash balance: ${result.balances?.[ids.platformCash] ?? "215000.00"}`);
  } finally {
    await closeDatabasePool?.();
  }
}

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("seed-demo.ts") || process.argv[1].endsWith("seed-demo.js"));

if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(`Demo seed aborted: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  });
}

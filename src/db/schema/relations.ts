import { relations } from "drizzle-orm";

import { bankAccounts } from "./bank-accounts.js";
import { financialAccounts } from "./financial-accounts.js";
import { financialEntries } from "./financial-entries.js";
import { financialTransactionEvents } from "./financial-transaction-events.js";
import { financialTransactions } from "./financial-transactions.js";
import { fuelPurchases } from "./fuel-purchases.js";
import { stationFuelPrices, stationMembers, stations } from "./stations.js";
import { users } from "./users.js";

export const usersRelations = relations(users, ({ many }) => ({
  stationMemberships: many(stationMembers),
  bankAccounts: many(bankAccounts),
  financialAccounts: many(financialAccounts),
  createdFinancialTransactions: many(financialTransactions, {
    relationName: "financial_transaction_creator",
  }),
  processedFinancialTransactions: many(financialTransactions, {
    relationName: "financial_transaction_processor",
  }),
  attendedFuelPurchases: many(fuelPurchases),
  financialTransactionEvents: many(financialTransactionEvents),
}));

export const stationsRelations = relations(stations, ({ many }) => ({
  members: many(stationMembers),
  bankAccounts: many(bankAccounts),
  fuelPrices: many(stationFuelPrices),
  financialAccounts: many(financialAccounts),
  financialTransactions: many(financialTransactions, {
    relationName: "financial_transaction_station",
  }),
  sourceFinancialTransactions: many(financialTransactions, {
    relationName: "financial_transaction_source_station",
  }),
  destinationFinancialTransactions: many(financialTransactions, {
    relationName: "financial_transaction_destination_station",
  }),
}));

export const stationMembersRelations = relations(stationMembers, ({ one }) => ({
  station: one(stations, {
    fields: [stationMembers.stationId],
    references: [stations.id],
  }),
  user: one(users, {
    fields: [stationMembers.userId],
    references: [users.id],
  }),
}));

export const stationFuelPricesRelations = relations(stationFuelPrices, ({ one }) => ({
  station: one(stations, {
    fields: [stationFuelPrices.stationId],
    references: [stations.id],
  }),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [bankAccounts.userId],
    references: [users.id],
  }),
  station: one(stations, {
    fields: [bankAccounts.stationId],
    references: [stations.id],
  }),
  financialTransactions: many(financialTransactions),
}));

export const financialAccountsRelations = relations(financialAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [financialAccounts.userId],
    references: [users.id],
  }),
  station: one(stations, {
    fields: [financialAccounts.stationId],
    references: [stations.id],
  }),
  entries: many(financialEntries),
  heldFinancialTransactions: many(financialTransactions),
}));

export const financialTransactionsRelations = relations(
  financialTransactions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [financialTransactions.userId],
      references: [users.id],
    }),
    station: one(stations, {
      fields: [financialTransactions.stationId],
      references: [stations.id],
      relationName: "financial_transaction_station",
    }),
    sourceStation: one(stations, {
      fields: [financialTransactions.sourceStationId],
      references: [stations.id],
      relationName: "financial_transaction_source_station",
    }),
    destinationStation: one(stations, {
      fields: [financialTransactions.destinationStationId],
      references: [stations.id],
      relationName: "financial_transaction_destination_station",
    }),
    bankAccount: one(bankAccounts, {
      fields: [financialTransactions.bankAccountId],
      references: [bankAccounts.id],
    }),
    holdAccount: one(financialAccounts, {
      fields: [financialTransactions.holdAccountId],
      references: [financialAccounts.id],
    }),
    createdBy: one(users, {
      fields: [financialTransactions.createdByUserId],
      references: [users.id],
      relationName: "financial_transaction_creator",
    }),
    processedBy: one(users, {
      fields: [financialTransactions.processedByUserId],
      references: [users.id],
      relationName: "financial_transaction_processor",
    }),
    reversalOf: one(financialTransactions, {
      fields: [financialTransactions.reversalOfTransactionId],
      references: [financialTransactions.id],
      relationName: "financial_transaction_reversals",
    }),
    reversals: many(financialTransactions, {
      relationName: "financial_transaction_reversals",
    }),
    entries: many(financialEntries),
    fuelPurchase: one(fuelPurchases),
    events: many(financialTransactionEvents),
  }),
);

export const financialEntriesRelations = relations(financialEntries, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [financialEntries.transactionId],
    references: [financialTransactions.id],
  }),
  financialAccount: one(financialAccounts, {
    fields: [financialEntries.financialAccountId],
    references: [financialAccounts.id],
  }),
}));

export const fuelPurchasesRelations = relations(fuelPurchases, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [fuelPurchases.financialTransactionId],
    references: [financialTransactions.id],
  }),
  attendant: one(users, {
    fields: [fuelPurchases.attendantId],
    references: [users.id],
  }),
}));

export const financialTransactionEventsRelations = relations(
  financialTransactionEvents,
  ({ one }) => ({
    transaction: one(financialTransactions, {
      fields: [financialTransactionEvents.transactionId],
      references: [financialTransactions.id],
    }),
    actor: one(users, {
      fields: [financialTransactionEvents.actorUserId],
      references: [users.id],
    }),
  }),
);

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { financialAccounts } from "../../db/schema/financial-accounts.js";
import { financialEntries } from "../../db/schema/financial-entries.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { stations } from "../../db/schema/stations.js";
import type { TransactionContext } from "../../db/transaction.js";
import { NotFoundError } from "../../shared/errors/app-error.js";
import {
  addMonetary,
  compareMonetary,
  subtractMonetary,
} from "../../shared/precision/money.js";
import { financialAccountService } from "./financial-account.service.js";
import type {
  AccountBalanceSummary,
  FinancialAccountType,
  PlatformCashSummary,
  StationPayableSummary,
  UserStationAllocationSummary,
  UserWalletSummary,
} from "./financial.types.js";

export class BalanceService {
  /**
   * Calculates the double-entry ledger balance for an account using normal-balance conventions:
   * - PLATFORM_CASH: Debit - Credit
   * - USER_AVAILABLE: Credit - Debit
   * - USER_ALLOCATED: Credit - Debit
   * - STATION_PAYABLE: Credit - Debit
   */
  async getLedgerBalance(
    accountId: string,
    accountType: FinancialAccountType,
    tx: TransactionContext = db,
  ): Promise<string> {
    const entries = await tx
      .select({
        totalDebit: sql<string>`COALESCE(SUM(CASE WHEN ${financialEntries.entryType} = 'DEBIT' THEN ${financialEntries.amount} ELSE 0 END), 0)::text`,
        totalCredit: sql<string>`COALESCE(SUM(CASE WHEN ${financialEntries.entryType} = 'CREDIT' THEN ${financialEntries.amount} ELSE 0 END), 0)::text`,
      })
      .from(financialEntries)
      .where(eq(financialEntries.financialAccountId, accountId));

    const totalDebit = entries[0]?.totalDebit || "0.00";
    const totalCredit = entries[0]?.totalCredit || "0.00";

    if (accountType === "PLATFORM_CASH") {
      return subtractMonetary(totalDebit, totalCredit);
    } else {
      // USER_AVAILABLE, USER_ALLOCATED, STATION_PAYABLE
      return subtractMonetary(totalCredit, totalDebit);
    }
  }

  /**
   * Calculates active outstanding holds for an account.
   * Outstanding Hold = hold_amount - captured_amount - released_amount.
   * Active holds include transactions with status PENDING or PROCESSING.
   */
  async getActiveHolds(accountId: string, tx: TransactionContext = db): Promise<string> {
    const rows = await tx
      .select({
        holdAmount: financialTransactions.holdAmount,
        capturedAmount: financialTransactions.capturedAmount,
        releasedAmount: financialTransactions.releasedAmount,
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.holdAccountId, accountId),
          inArray(financialTransactions.status, ["PENDING", "PROCESSING"]),
        ),
      );

    let totalActiveHolds = "0.00";
    for (const row of rows) {
      const remainingHold = subtractMonetary(
        row.holdAmount,
        addMonetary(row.capturedAmount, row.releasedAmount),
      );
      if (compareMonetary(remainingHold, "0.00") > 0) {
        totalActiveHolds = addMonetary(totalActiveHolds, remainingHold);
      }
    }

    return totalActiveHolds;
  }

  /**
   * Computes available balance: Available Balance = Ledger Balance - Outstanding Holds.
   */
  async getAvailableBalance(
    accountId: string,
    accountType: FinancialAccountType,
    tx: TransactionContext = db,
  ): Promise<string> {
    const ledger = await this.getLedgerBalance(accountId, accountType, tx);
    const holds = await this.getActiveHolds(accountId, tx);
    return subtractMonetary(ledger, holds);
  }

  /**
   * Retrieves comprehensive balance summary for an individual financial account.
   */
  async getAccountSummary(
    accountId: string,
    tx: TransactionContext = db,
  ): Promise<AccountBalanceSummary> {
    const account = await tx
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.id, accountId))
      .limit(1);

    if (account.length === 0) {
      throw new NotFoundError(`Financial account not found: ${accountId}`);
    }

    const acc = account[0]!;
    const ledger = await this.getLedgerBalance(acc.id, acc.accountType, tx);
    const holds = await this.getActiveHolds(acc.id, tx);
    const available = subtractMonetary(ledger, holds);

    return {
      accountId: acc.id,
      accountType: acc.accountType,
      userId: acc.userId,
      stationId: acc.stationId,
      ledgerBalance: ledger,
      activeHolds: holds,
      availableBalance: available,
    };
  }

  /**
   * Builds the complete user wallet summary including available balance and station allocations.
   */
  async getUserWalletSummary(userId: string, tx: TransactionContext = db): Promise<UserWalletSummary> {
    const availableAccount = await financialAccountService.getOrCreateUserAvailableAccount(
      userId,
      tx,
    );

    const availableLedger = await this.getLedgerBalance(availableAccount.id, "USER_AVAILABLE", tx);
    const availableHolds = await this.getActiveHolds(availableAccount.id, tx);
    const spendableBalance = subtractMonetary(availableLedger, availableHolds);

    // Fetch all user allocation accounts joined with station information
    const allocatedAccounts = await tx
      .select({
        accountId: financialAccounts.id,
        stationId: financialAccounts.stationId,
        stationName: stations.name,
      })
      .from(financialAccounts)
      .innerJoin(stations, eq(financialAccounts.stationId, stations.id))
      .where(
        and(
          eq(financialAccounts.accountType, "USER_ALLOCATED"),
          eq(financialAccounts.userId, userId),
        ),
      );

    const stationAllocations: UserStationAllocationSummary[] = [];
    let totalAllocatedBalance = "0.00";

    for (const alloc of allocatedAccounts) {
      const ledger = await this.getLedgerBalance(alloc.accountId, "USER_ALLOCATED", tx);
      const holds = await this.getActiveHolds(alloc.accountId, tx);
      const available = subtractMonetary(ledger, holds);

      stationAllocations.push({
        stationId: alloc.stationId!,
        stationName: alloc.stationName,
        accountId: alloc.accountId,
        ledgerBalance: ledger,
        activeHolds: holds,
        availableBalance: available,
      });

      totalAllocatedBalance = addMonetary(totalAllocatedBalance, available);
    }

    return {
      userId,
      availableAccount: {
        accountId: availableAccount.id,
        ledgerBalance: availableLedger,
        activeHolds: availableHolds,
        spendableBalance,
      },
      stationAllocations,
      totalAllocatedBalance,
      currency: "SDG",
    };
  }

  /**
   * Retrieves station payable balance and eligibility for settlement.
   */
  async getStationPayableSummary(
    stationId: string,
    tx: TransactionContext = db,
  ): Promise<StationPayableSummary> {
    const stationRow = await tx
      .select()
      .from(stations)
      .where(eq(stations.id, stationId))
      .limit(1);

    if (stationRow.length === 0) {
      throw new NotFoundError(`Station not found: ${stationId}`);
    }

    const station = stationRow[0]!;
    const payableAccount = await financialAccountService.getOrCreateStationPayableAccount(
      stationId,
      tx,
    );

    const ledger = await this.getLedgerBalance(payableAccount.id, "STATION_PAYABLE", tx);
    const holds = await this.getActiveHolds(payableAccount.id, tx);
    const availableSettlement = subtractMonetary(ledger, holds);

    const isEligible =
      compareMonetary(availableSettlement, station.minimumSettlementAmount) >= 0;

    return {
      stationId,
      accountId: payableAccount.id,
      ledgerBalance: ledger,
      activeHolds: holds,
      availableSettlement,
      minimumSettlementAmount: station.minimumSettlementAmount,
      isEligibleForSettlement: isEligible,
    };
  }

  /**
   * Calculates total outgoing bank-transfer commitments from WITHDRAWAL and SETTLEMENT transactions
   * in PROCESSING status or IN_PROGRESS/UNKNOWN execution states.
   */
  async getPlatformOutgoingCommitments(tx: TransactionContext = db): Promise<string> {
    const activeCommitments = await tx
      .select({
        requestedAmount: financialTransactions.requestedAmount,
        amount: financialTransactions.amount,
        status: financialTransactions.status,
        executionStatus: financialTransactions.executionStatus,
      })
      .from(financialTransactions)
      .where(
        and(
          inArray(financialTransactions.transactionType, ["WITHDRAWAL", "SETTLEMENT"]),
          sql`(${financialTransactions.status} = 'PROCESSING' OR ${financialTransactions.executionStatus} IN ('IN_PROGRESS', 'UNKNOWN'))`,
        ),
      );

    let totalCommitment = "0.00";
    for (const item of activeCommitments) {
      const amountToReserve = item.amount ?? item.requestedAmount;
      totalCommitment = addMonetary(totalCommitment, amountToReserve);
    }

    return totalCommitment;
  }

  /**
   * Retrieves platform cash summary: ledger cash balance, outgoing commitments, available uncommitted cash.
   */
  async getPlatformCashSummary(tx: TransactionContext = db): Promise<PlatformCashSummary> {
    const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
    const ledger = await this.getLedgerBalance(cashAccount.id, "PLATFORM_CASH", tx);
    const outgoingCommitments = await this.getPlatformOutgoingCommitments(tx);
    const availableCash = subtractMonetary(ledger, outgoingCommitments);

    return {
      accountId: cashAccount.id,
      ledgerBalance: ledger,
      outgoingCommitments,
      availableCash,
    };
  }
}

export const balanceService = new BalanceService();

export type FinancialAccountType =
  | "PLATFORM_CASH"
  | "USER_AVAILABLE"
  | "USER_ALLOCATED"
  | "STATION_PAYABLE";

export type FinancialEntryType = "DEBIT" | "CREDIT";

export interface AccountBalanceSummary {
  accountId: string;
  accountType: FinancialAccountType;
  userId?: string | null;
  stationId?: string | null;
  ledgerBalance: string;
  activeHolds: string;
  availableBalance: string;
}

export interface UserStationAllocationSummary {
  stationId: string;
  stationName: string;
  accountId: string;
  ledgerBalance: string;
  activeHolds: string;
  availableBalance: string;
}

export interface UserWalletSummary {
  userId: string;
  availableAccount: {
    accountId: string;
    ledgerBalance: string;
    activeHolds: string;
    spendableBalance: string;
  };
  stationAllocations: UserStationAllocationSummary[];
  totalAllocatedBalance: string;
  currency: "SDG";
}

export interface StationPayableSummary {
  stationId: string;
  accountId: string;
  ledgerBalance: string;
  activeHolds: string;
  availableSettlement: string;
  minimumSettlementAmount: string;
  isEligibleForSettlement: boolean;
}

export interface PlatformCashSummary {
  accountId: string;
  ledgerBalance: string;
  outgoingCommitments: string;
  availableCash: string;
}

export interface LedgerEntryInput {
  financialAccountId: string;
  entryType: FinancialEntryType;
  amount: string;
}

export interface FuelPurchaseQuoteSnapshot {
  fuelType: string;
  plannedQuantity: string;
  unitPrice: string;
  plannedTotal: string;
  attendantId: string;
  quotedAt: string;
}

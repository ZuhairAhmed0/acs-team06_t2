import { closeDatabasePool, db } from "../db/client.js";
import { financialAccountService } from "../modules/financial-core/financial-account.service.js";

async function main() {
  try {
    const cashAccount = await financialAccountService.ensurePlatformCashAccount(db);

    if (cashAccount.userId !== null || cashAccount.stationId !== null) {
      throw new Error(
        "PLATFORM_CASH account invariant violated: userId and stationId must be null",
      );
    }

    // Success message without exposing credentials or internal connection strings
    process.stdout.write(
      `Financial bootstrap completed successfully: PLATFORM_CASH account is active.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Financial bootstrap failed: ${error instanceof Error ? error.message : "Unknown error"}\n`,
    );
    process.exit(1);
  } finally {
    await closeDatabasePool();
  }
}

void main();

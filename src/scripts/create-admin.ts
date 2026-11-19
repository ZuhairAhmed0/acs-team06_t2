import { db } from "../db/client.js";
import { users } from "../db/schema/users.js";
import { hashPassword } from "../modules/auth/password.js";
import { normalizePhoneNumber } from "../modules/auth/phone.js";

/**
 * CLI Administrator Provisioning Script.
 *
 * Usage:
 *   npx tsx src/scripts/create-admin.ts "Admin Name" "+249912345678" "SecureAdminPassword123"
 *
 * Security Guarantees:
 * - Public registration API can NEVER create ADMIN accounts.
 * - Password is encrypted with bcrypt (12 rounds).
 * - Never logs or stores plaintext passwords.
 */
async function main() {
  const [, , fullName, rawPhone, password] = process.argv;

  if (!fullName || !rawPhone || !password) {
    console.error(
      'Usage: npx tsx src/scripts/create-admin.ts "<Full Name>" "<Phone>" "<Password>"',
    );
    process.exit(1);
  }

  const phone = normalizePhoneNumber(rawPhone);
  const passwordHash = await hashPassword(password);

  const [admin] = await db
    .insert(users)
    .values({
      fullName,
      phone,
      passwordHash,
      systemRole: "ADMIN",
      status: "ACTIVE",
    })
    .returning({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      systemRole: users.systemRole,
    });

  console.log(`[SUCCESS] Admin user provisioned: ${admin.fullName} (${admin.phone}) [ID: ${admin.id}]`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[ERROR] Failed to provision administrator:", err.message);
  process.exit(1);
});

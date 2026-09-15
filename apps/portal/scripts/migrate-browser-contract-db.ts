import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "@aomi-labs/account/better-auth";

async function main() {
  if (process.env.AOMI_TEST_DATABASE_DISPOSABLE !== "1") {
    throw new Error(
      "Browser contract migrations require a disposable database",
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const schemaPath = fileURLToPath(
      new URL(
        "../../../tests/e2e/fixtures/canonical-account-schema.sql",
        import.meta.url,
      ),
    );
    await pool.query(await readFile(schemaPath, "utf8"));
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
    const required = await pool.query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
      [
        [
          "auth_providers",
          "ba_accounts",
          "ba_sessions",
          "ba_users",
          "ba_verifications",
          "ba_wallet_addresses",
          "public_keys",
          "users",
        ],
      ],
    );
    if (required.rowCount !== 8) {
      throw new Error(
        `Browser contract schema incomplete: ${required.rows
          .map((row) => row.table_name)
          .join(",")}`,
      );
    }
    console.log("Browser contract account and Better Auth schemas ready");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

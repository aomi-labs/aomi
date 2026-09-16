import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "@aomi-labs/account/better-auth";

const accountRequire = createRequire(
  new URL("../../../packages/account/package.json", import.meta.url),
);
const { Pool } = accountRequire("pg") as {
  Pool: new (input: { connectionString: string }) => {
    query(
      sql: string,
      values?: unknown[],
    ): Promise<{
      rowCount: number | null;
      rows: unknown[];
    }>;
    end(): Promise<void>;
  };
};

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
    const required = (await pool.query(
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
    )) as { rowCount: number | null; rows: Array<{ table_name: string }> };
    if (required.rowCount !== 8) {
      throw new Error(
        `Browser contract schema incomplete: ${required.rows
          .map((row) => row.table_name)
          .join(",")}`,
      );
    }
    const publicKeyTimestamps = (await pool.query(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'public_keys'
          and column_name = any($1::text[])
        order by column_name`,
      [["created_at", "updated_at"]],
    )) as { rowCount: number | null; rows: Array<{ column_name: string }> };
    if (publicKeyTimestamps.rowCount !== 2) {
      throw new Error(
        `Browser contract public_keys schema incomplete: ${publicKeyTimestamps.rows
          .map((row) => row.column_name)
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

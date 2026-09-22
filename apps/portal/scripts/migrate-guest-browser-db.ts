import { getMigrations } from "better-auth/db/migration";
import { auth } from "@aomi-labs/account/better-auth";

async function main() {
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  console.log("Guest browser Better Auth schema ready");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

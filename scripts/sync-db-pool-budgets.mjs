import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The portal's connection allowance is owned by product-mono's database crate
// (aomi/crates/database/pool-budgets.json), which also sizes every backend
// process against the same Supabase pooler. This keeps the account pool's
// copy byte-identical; `--check` fails instead of writing.
const root = resolve(import.meta.dirname, "..");
const rustRepo = resolve(
  process.env.AOMI_RUST_REPO ?? join(root, "../product-mono/aomi"),
);
const source = join(rustRepo, "crates/database/pool-budgets.json");
const target = join(root, "packages/account/src/db/pool-budgets.json");

const canonical = readFileSync(source, "utf8");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== canonical) {
    console.error(
      "packages/account/src/db/pool-budgets.json drifted from product-mono. Run `pnpm sync:db-pool-budgets`.",
    );
    process.exit(1);
  }
  console.log("db pool budgets match product-mono");
} else {
  writeFileSync(target, canonical);
  console.log(`synced ${target.slice(root.length + 1)}`);
}

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PERSIST = [".wrangler/e2e"];

const wrangler = (...args: string[]) =>
  execFileSync("npx", ["wrangler", ...args, "--persist-to", ...PERSIST], { cwd: ROOT, stdio: "pipe" });

/** Fresh local state for the e2e Worker: migrated D1 and the demo fixtures in R2. */
export default async function globalSetup(): Promise<void> {
  if (!existsSync(join(ROOT, "fixtures/data/expected.json"))) execFileSync("npm", ["run", "fixtures"], { cwd: ROOT, stdio: "pipe" });
  wrangler("d1", "migrations", "apply", "openhealth", "--local");
  for (const key of ["wodup/training_sessions.json", "mindbody/client_visits.json"]) {
    wrangler("r2", "object", "put", `openhealth-raw/mock/${key}`, "--file", join(ROOT, "fixtures/data", key), "--local");
  }
}

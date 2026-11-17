import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const target = process.argv[2];
if (!target) throw new Error("Pass an acceptance test file path");

if (!existsSync(target)) {
  console.log(`${target} does not exist yet; its acceptance requirements remain pending.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--test", target], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);

import { mkdir, readFile, readdir, rm, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["run", "check:acceptance"], { stdio: "inherit" });
if (result.status !== 0) process.exit(1);
const root = resolve("submission");
const staging = join(root, "COMP5521_HTLC_GroupXX");
await mkdir(root, { recursive: true });
await rm(staging, { recursive: true, force: true });

async function copy(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === ".DS_Store" || entry.name === ".gitkeep") continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copy(from, to);
    else await copyFile(from, to);
  }
}

await mkdir(staging, { recursive: true });
for (const directory of ["contracts", "scripts", "shared", "src", "test", "docs", ".agent", ".github"]) await copy(directory, join(staging, directory));
for (const file of [".env.example", ".gitignore", "README.md", "Changes.md", "package.json", "package-lock.json", "hardhat.config.ts", "tsconfig.json", "vite.config.ts", "index.html", "Report.pdf", "presentation.pptx"]) {
  await copyFile(file, join(staging, file));
}
// The allowlist excludes .env, local swap secrets, dependencies and build caches.
const archive = join(root, "COMP5521_HTLC_GroupXX.zip");
await rm(archive, { force: true });
const zip = spawnSync("zip", ["-qr", archive, "COMP5521_HTLC_GroupXX"], { cwd: root, stdio: "inherit" });
if (zip.status !== 0) throw new Error("Unable to create submission archive");
await rm(staging, { recursive: true });
const contribution = await readFile("docs/contributions.md", "utf8");
console.log(`Created ${archive}`);
if (/\bTBD\b/.test(contribution)) console.log("Before uploading: fill the real name/student ID and replace GroupXX with your group identifier, then package again. Live demonstration remains a separate assessment.");

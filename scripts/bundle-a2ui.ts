import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hashFile = path.join(repoRoot, "src", "canvas-host", "a2ui", ".bundle.hash");
const outputFile = path.join(repoRoot, "src", "canvas-host", "a2ui", "a2ui.bundle.js");
const a2uiRendererDir = path.join(repoRoot, "vendor", "a2ui", "renderers", "lit");
const a2uiAppDir = path.join(repoRoot, "apps", "shared", "OpenClawKit", "Tools", "CanvasA2UI");

const inputPaths = [
  path.join(repoRoot, "package.json"),
  path.join(repoRoot, "pnpm-lock.yaml"),
  a2uiRendererDir,
  a2uiAppDir,
];

async function exists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(entryPath: string, out: string[]) {
  const st = await fs.stat(entryPath);
  if (st.isDirectory()) {
    const entries = await fs.readdir(entryPath);
    for (const entry of entries) {
      await walk(path.join(entryPath, entry), out);
    }
    return;
  }
  out.push(entryPath);
}

function normalize(p: string) {
  return p.split(path.sep).join("/");
}

async function computeHash() {
  const files: string[] = [];
  for (const input of inputPaths) {
    await walk(input, files);
  }

  files.sort((a, b) => normalize(a).localeCompare(normalize(b)));

  const hash = createHash("sha256");
  for (const filePath of files) {
    hash.update(normalize(path.relative(repoRoot, filePath)));
    hash.update("\0");
    hash.update(await fs.readFile(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

function runPnpm(args: string[]) {
  const npmExecPath = process.env.npm_execpath;
  const isProbablyPnpmExecPath =
    typeof npmExecPath === "string" &&
    npmExecPath.length > 0 &&
    npmExecPath.toLowerCase().includes("pnpm");

  const command = isProbablyPnpmExecPath
    ? process.execPath
    : process.platform === "win32"
      ? "pnpm.cmd"
      : "pnpm";
  const fullArgs = isProbablyPnpmExecPath ? [npmExecPath, ...args] : args;

  const res = spawnSync(command, fullArgs, { cwd: repoRoot, stdio: "inherit" });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`Command failed: pnpm ${args.join(" ")}`);
  }
}

async function main() {
  if (!(await exists(a2uiRendererDir)) || !(await exists(a2uiAppDir))) {
    console.log("A2UI sources missing; keeping prebuilt bundle.");
    return;
  }

  const currentHash = await computeHash();
  if (await exists(hashFile)) {
    const previousHash = (await fs.readFile(hashFile, "utf8")).trim();
    if (previousHash === currentHash && (await exists(outputFile))) {
      console.log("A2UI bundle up to date; skipping.");
      return;
    }
  }

  runPnpm(["-s", "exec", "tsc", "-p", path.join(a2uiRendererDir, "tsconfig.json")]);
  runPnpm(["-s", "exec", "rolldown", "-c", path.join(a2uiAppDir, "rolldown.config.mjs")]);

  await fs.writeFile(hashFile, `${currentHash}\n`, "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle");
    console.error("If this persists, verify pnpm deps and try again.");
    console.error(String(err));
    process.exit(1);
  });
}

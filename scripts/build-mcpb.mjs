#!/usr/bin/env node
// Build college-roi-mcp.mcpb, the bundle Smithery hosts (tj-r4v3/college-roi-mcp).
//
// manifest.json's `tools` are regenerated from the built server's own tools/list
// reply, never written by hand: the July manifest carried paraphrased copies of
// the tool descriptions that drifted from src. Smithery requires per-tool
// inputSchema, which `mcpb pack` strips, so the bundle is a plain zip.
//
//   node scripts/build-mcpb.mjs       # writes manifest.json + college-roi-mcp.mcpb
// Then publish (SMITHERY_API_KEY from le-teen's infra/distribution-secrets.sops.yaml):
//   SMITHERY_API_KEY=... npx @smithery/cli mcp publish college-roi-mcp.mcpb -n tj-r4v3/college-roi-mcp
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "inherit"] });

run("npm", ["run", "build"]);

function listTools() {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [join(root, "dist/index.js")], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => (p.kill(), reject(new Error("tools/list timed out"))), 15000);
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 2) { clearTimeout(timer); p.kill(); m.result ? resolve(m.result.tools) : reject(new Error(JSON.stringify(m.error))); }
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "build-mcpb", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
manifest.version = pkg.version;
manifest.tools = (await listTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const stage = mkdtempSync(join(tmpdir(), "mcpb-"));
try {
  for (const f of ["dist", "package.json", "package-lock.json", "README.md", "LICENSE", "manifest.json"]) cpSync(join(root, f), join(stage, f), { recursive: true });
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stage);
  rmSync(join(stage, "package-lock.json"));
  rmSync(join(root, "college-roi-mcp.mcpb"), { force: true });
  run("zip", ["-qr", join(root, "college-roi-mcp.mcpb"), "."], stage);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
console.log(`built college-roi-mcp.mcpb ${pkg.version} with ${manifest.tools.length} tools from tools/list`);

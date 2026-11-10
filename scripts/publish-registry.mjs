#!/usr/bin/env node
// Publish server.json to the official MCP registry (registry.modelcontextprotocol.io)
// as com.le-teen/*, using HTTP domain auth: the ed25519 public key is served at
// https://le-teen.com/.well-known/mcp-registry-auth, the private key lives in the
// le-teen repo's SOPS store. Calls the registry API directly, so mcp-publisher
// does not need to be installed.
//
// Run after `npm publish`, from the le-teen repo root (where the SOPS file is):
//   MCP_REGISTRY_KEY_HEX="$(sops -d --extract '["MCP_REGISTRY_ED25519_PRIVATE_KEY_HEX"]' infra/distribution-secrets.sops.yaml)" \
//     node ~/projects/college-roi-mcp/scripts/publish-registry.mjs
// The key is read from the environment and never printed.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const REG = "https://registry.modelcontextprotocol.io";
const DOMAIN = "le-teen.com";
const serverJsonPath = new URL("../server.json", import.meta.url);
const server = JSON.parse(readFileSync(serverJsonPath, "utf8"));

const hex = (process.env.MCP_REGISTRY_KEY_HEX || "").trim();
if (!hex) throw new Error("MCP_REGISTRY_KEY_HEX is not set");
const seed = Buffer.from(hex, "hex").subarray(0, 32); // 32-byte seed, or seed+pub (64)
const key = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), // PKCS#8 ed25519 prefix
  format: "der",
  type: "pkcs8",
});

// Refuse before signing anything if the key is not the one the domain advertises.
const pub = crypto.createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12).toString("base64");
const wellKnown = await (await fetch(`https://${DOMAIN}/.well-known/mcp-registry-auth`)).text();
if (!wellKnown.includes(`p=${pub}`)) throw new Error("key does not match the public key at /.well-known/mcp-registry-auth");

const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const signed_timestamp = crypto.sign(null, Buffer.from(timestamp), key).toString("hex");
const auth = await fetch(`${REG}/v0/auth/http`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ domain: DOMAIN, timestamp, signed_timestamp }),
});
if (!auth.ok) throw new Error(`auth failed ${auth.status}: ${await auth.text()}`);
const { registry_token } = await auth.json();

const res = await fetch(`${REG}/v0/publish`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${registry_token}` },
  body: JSON.stringify(server),
});
const body = await res.text();
if (!res.ok) throw new Error(`publish failed ${res.status}: ${body}`);
console.log(`published ${server.name}@${server.version} to ${REG}`);

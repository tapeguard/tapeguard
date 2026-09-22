import { readFileSync, writeFileSync } from "node:fs";

const art = JSON.parse(readFileSync("out/TapeGuard.sol/TapeGuard.json", "utf8"));
const header = `/**
 * TapeGuard ABI, generated from the Foundry artifact.
 *
 * Generated rather than hand-written: the digest depends on the exact field
 * order of the Verdict tuple, and a hand-kept copy that drifts by one field
 * still typechecks while every signature silently fails to recover.
 *
 *   npm run abi
 */

export const TAPEGUARD_ABI = `;
writeFileSync("src/chain/abi.ts", header + JSON.stringify(art.abi, null, 2) + " as const;\n");
console.log(`abi.ts: ${art.abi.length} entries`);

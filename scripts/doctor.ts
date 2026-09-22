/**
 * Pre-deployment checks.
 *
 *   npm run doctor
 *   npm run doctor -- rh-testnet
 *
 * Exists because the failure it diagnoses is not obvious from its symptom.
 * Some networks resolve robinhood.com and every subdomain to one unrelated
 * address, which makes the RPC look down when the chain is fine and the path
 * to it works. A connection error says nothing about that; this says it by
 * name, and proves it by fetching the real address over encrypted DNS and
 * connecting to it directly.
 */

import { request as httpsRequest } from "node:https";
import { TAPEGUARD_ABI } from "../src/chain/abi.ts";

interface Target {
  name: string;
  host: string;
  url: string;
  chainId: number;
}

const TARGETS: Target[] = [
  {
    name: "rh-mainnet",
    host: "rpc.mainnet.chain.robinhood.com",
    url: "https://rpc.mainnet.chain.robinhood.com",
    chainId: 4663,
  },
  {
    name: "rh-testnet",
    host: "rpc.testnet.chain.robinhood.com",
    url: "https://rpc.testnet.chain.robinhood.com",
    chainId: 46630,
  },
  {
    name: "arb-sepolia",
    host: "sepolia-rollup.arbitrum.io",
    url: "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
  },
];

const ok = (s: string) => `  ok    ${s}`;
const bad = (s: string) => `  FAIL  ${s}`;
const warn = (s: string) => `  warn  ${s}`;

async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result;
}

/**
 * Make the RPC call against a known address while still presenting the real
 * hostname.
 *
 * `fetch` cannot do this: connecting to the address means the TLS handshake
 * offers no server name, the certificate does not match, and the request
 * fails for a reason that looks exactly like the outage being diagnosed.
 * `servername` sets SNI independently of the address dialled, which is what
 * `curl --resolve` does.
 */
function rpcViaAddress(address: string, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    const req = httpsRequest(
      {
        host: address,
        servername: host,
        port: 443,
        path: "/",
        method: "POST",
        headers: {
          host,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
        timeout: 12_000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve((JSON.parse(body) as { result?: string }).result ?? "");
          } catch {
            reject(new Error("bad rpc body"));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end(payload);
  });
}

/** Resolve over DNS-over-HTTPS, which a plain-DNS interception cannot touch. */
async function realAddresses(host: string): Promise<string[]> {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10_000) },
  );
  const body = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
  return (body.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

async function checkTarget(t: Target): Promise<boolean> {
  console.log(`\n${t.name}  ${t.url}`);
  try {
    const hex = (await rpc(t.url, "eth_chainId")) as string;
    const id = Number(hex);
    if (id === t.chainId) {
      console.log(ok(`reachable, chainId ${id}`));
      return true;
    }
    console.log(bad(`chainId ${id}, expected ${t.chainId} — this is not the chain you think`));
    return false;
  } catch (err) {
    console.log(bad(`unreachable: ${err instanceof Error ? err.message : String(err)}`));
  }

  // Unreachable. Find out whether that is the chain or the name lookup.
  let real: string[] = [];
  try {
    real = await realAddresses(t.host);
  } catch {
    console.log(warn("could not resolve over DoH either; check general connectivity"));
    return false;
  }
  if (real.length === 0) {
    console.log(warn("no A record even over DoH; the host may genuinely be gone"));
    return false;
  }

  try {
    const id = Number(await rpcViaAddress(real[0] as string, t.host));
    if (id === t.chainId) {
      console.log(bad(`DNS for ${t.host} is being intercepted on this network.`));
      console.log(`        The chain is up: reaching ${real[0]} directly returned chainId ${id}.`);
      console.log(`        Real addresses: ${real.join(", ")}`);
      console.log("");
      console.log("        Fixes, in order of preference:");
      console.log("          1. Deploy and relay from the VPS instead. It is outside this");
      console.log("             network and is where the relayer belongs anyway.");
      console.log(`          2. Add to /etc/hosts:   ${real[0]}  ${t.host}`);
      console.log("          3. Use a VPN. Node resolves through the system resolver, so");
      console.log("             changing DNS servers alone does not help when the");
      console.log("             interception is transparent.");
      return false;
    }
  } catch {
    // fall through
  }
  console.log(warn(`resolved over DoH to ${real.join(", ")} but still no answer`));
  return false;
}

async function main(): Promise<void> {
  const wanted = process.argv[2];
  const targets = wanted ? TARGETS.filter((t) => t.name === wanted) : TARGETS;
  if (targets.length === 0) {
    console.error(`unknown target ${wanted}. one of: ${TARGETS.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  console.log("tapeguard doctor");
  console.log(`  node    ${process.version}`);
  console.log(`  abi     ${TAPEGUARD_ABI.length} entries`);

  let allOk = true;
  for (const t of targets) allOk = (await checkTarget(t)) && allOk;

  console.log(
    allOk
      ? "\nall targets reachable\n"
      : "\nat least one target is not reachable from here; see above\n",
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

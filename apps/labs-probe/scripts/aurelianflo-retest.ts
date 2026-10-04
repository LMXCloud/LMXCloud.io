import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { probeTarget, type ProbeTarget, type SpendLedger } from "../src/probe.js";
import { usdcToAtomic } from "../src/price.js";
import { createLabsBuyer } from "../src/wallet.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsPath = path.join(root, "results.jsonl");
const HOST = "https://api.aurelianflo.com/api/ofac-wallet-screen";

/** SDN comment 24003, field "Digital Currency Address - ETH". */
const SDN_ETH = "0x9697749A9e8D6C119D8EEb0d6268a1b99C40684c";

const cases: { id: string; address: string; assertions: ProbeTarget["assertions"] }[] = [
  {
    id: "aurelianflo-not-an-address",
    address: "not-an-address",
    assertions: [{ path: "data.summary.status", op: "matches", value: "^(?!clear$).+" }],
  },
  {
    id: "aurelianflo-vitalik",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    assertions: [{ path: "data.summary.status", op: "eq", value: "clear" }],
  },
  {
    id: "aurelianflo-sdn-eth",
    address: SDN_ETH,
    assertions: [{ path: "data.summary.status", op: "matches", value: "^(?!clear$).+" }],
  },
];

function targetOf(item: (typeof cases)[number]): ProbeTarget {
  const url = new URL(`${HOST}/${encodeURIComponent(item.address)}`);
  url.searchParams.set("asset", "ETH");
  return {
    id: item.id,
    url: url.toString(),
    method: "GET",
    listedPriceUsdc: 0.01,
    paid: true,
    source: "bazaar",
    level: 1,
    assertions: item.assertions,
    ...(item.id === "aurelianflo-not-an-address" ? { testInduced: true } : {}),
  };
}

const ledger: SpendLedger = { spentAtomic: 0n, capAtomic: usdcToAtomic(0.25), projectedAtomic: 0n };
const runId = `aurelianflo-${Date.now()}`;

dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.resolve(root, "../../.env") });

const privateKey = process.env.LMX_LABS_WALLET_PRIVATE_KEY;
if (!privateKey) throw new Error("LMX_LABS_WALLET_PRIVATE_KEY is required");
const buyer = createLabsBuyer(privateKey, process.env.LMX_LABS_RPC_URL);
console.log(`run ${runId} wallet ${buyer.address}`);

for (let index = 0; index < cases.length; index += 1) {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
  const item = cases[index]!;
  const result = await probeTarget(targetOf(item), {
    dryRun: false,
    ledger,
    signPayment: (required) => buyer.signPayment(required),
    readUsdcBalance: () => buyer.readUsdcBalance(),
    timeoutMs: 120_000,
    rpcUrl: process.env.LMX_LABS_RPC_URL,
    role: "probe",
    runId,
  });
  await appendFile(resultsPath, `${JSON.stringify(result)}\n`, "utf8");
  console.log(`CALL ${item.id} http ${result.httpStatus} outcome ${result.outcome ?? "-"} quoted ${result.quotedPriceUsdc ?? "-"}`);
  console.log(result.bodyTruncated ?? "");
  console.log(`INCOMPLETE ${result.bodyIncomplete}`);
}

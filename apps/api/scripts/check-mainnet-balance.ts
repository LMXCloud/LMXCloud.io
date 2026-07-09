/**
 * Check payer wallet ETH + USDC on Base mainnet before running mainnet canary.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, formatEther, formatUnits, http } from "viem";
import { base } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.argv.includes("--mainnet")
  ? ".env.mainnet"
  : ".env";
dotenv.config({ path: path.resolve(__dirname, "../../../", envFile) });

const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

async function main(): Promise<void> {
  const rpcUrl = process.env.BASE_RPC_URL;
  const privateKeyRaw = process.env.PAYER_PRIVATE_KEY;
  if (!rpcUrl) throw new Error("BASE_RPC_URL is required");
  if (!privateKeyRaw) throw new Error("PAYER_PRIVATE_KEY is required");

  const trimmed = privateKeyRaw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  const account = privateKeyToAccount(hex as `0x${string}`);
  const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.readContract({
      address: MAINNET_USDC,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        chainId: 8453,
        payer: account.address,
        eth: formatEther(eth),
        usdc: formatUnits(usdc as bigint, 6),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

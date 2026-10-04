import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network, PaymentRequired } from "@x402/core/types";
import {
  ExactEvmScheme,
  UptoEvmScheme,
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
  toClientEvmSigner,
} from "@x402/evm";

import { paymentAuthFromPayload, type SignedPayment } from "./auth.js";
import { BASE_NETWORK, BASE_USDC, MAX_CALL_ATOMIC, parseQuotedAtomic } from "./price.js";
import { baseRpcUrls, baseTransport, retryRead } from "./rpc.js";

const USDC_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface LabsBuyer {
  address: Address;
  signPayment: (required: PaymentRequired) => Promise<SignedPayment>;
  /** Base USDC balance of the Labs wallet, in atomic units. */
  readUsdcBalance: () => Promise<bigint>;
}

/** Address of the Labs buyer key. The key itself is not returned. */
export function labsAddress(privateKey: string): Address {
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address;
}

/** Base USDC balance for an address. Does not sign and does not take a key. */
export async function readBaseUsdcBalance(address: Address, rpcUrl?: string | null): Promise<bigint> {
  const publicClient = createPublicClient({ chain: base, transport: baseTransport(rpcUrl) });
  return retryRead(() => publicClient.readContract({
    address: getAddress(BASE_USDC),
    abi: USDC_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address],
  }));
}

export function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "LMX_LABS_WALLET_PRIVATE_KEY must be 64 hex characters (with or without 0x)",
    );
  }
  return `0x${hex}`;
}

/**
 * Official x402 buyer for Base mainnet.
 * Registers exact (EIP-3009) and upto (Permit2), then signs a single payload.
 * The caller must already have filtered the 402 down to one acceptable requirement.
 */
export function createLabsBuyer(privateKey: string, rpcUrl?: string | null): LabsBuyer {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  const urls = baseRpcUrls(rpcUrl);
  const publicClient = createPublicClient({ chain: base, transport: baseTransport(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(urls[0], { retryCount: 0 }),
  });
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client();
  const network = BASE_NETWORK as Network;
  client.register(network, new ExactEvmScheme(signer));
  client.register(network, new UptoEvmScheme(signer, { rpcUrl: urls[0]! }));
  const httpClient = new x402HTTPClient(client);

  async function usdcBalance(token: Address): Promise<bigint> {
    return retryRead(() => publicClient.readContract({
      address: token,
      abi: USDC_BALANCE_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }));
  }

  async function ensurePermit2(token: Address, amount: bigint): Promise<void> {
    const [ethBalance, balance, allowance] = await Promise.all([
      retryRead(() => publicClient.getBalance({ address: account.address })),
      usdcBalance(token),
      retryRead(() => publicClient.readContract(
        getPermit2AllowanceReadParams({
          tokenAddress: token,
          ownerAddress: account.address,
        }),
      )),
    ]);
    if (balance < amount) {
      throw new Error(
        `Labs wallet has ${formatUnits(balance, 6)} USDC, needs ${formatUnits(amount, 6)}`,
      );
    }
    if (typeof allowance !== "bigint") {
      throw new Error("Unexpected Permit2 allowance");
    }
    if (allowance >= amount) return;
    if (ethBalance === 0n) {
      throw new Error("Labs wallet needs a little ETH on Base to approve Permit2");
    }
    console.log("Approving USDC for Permit2 (one-time)...");
    const approval = createPermit2ApprovalTx(token);
    const hash = await walletClient.sendTransaction({
      account,
      chain: base,
      to: approval.to,
      data: approval.data,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Permit2 approval confirmed: ${hash}`);
  }

  return {
    address: account.address,
    readUsdcBalance() {
      return usdcBalance(getAddress(BASE_USDC));
    },
    async signPayment(required) {
      const selected = required.accepts[0];
      if (!selected) throw new Error("No payment requirement to sign");
      if (selected.network !== BASE_NETWORK) {
        throw new Error(`Refusing to sign network ${selected.network}`);
      }
      if (selected.asset.toLowerCase() !== BASE_USDC) {
        throw new Error("Refusing to sign a non-USDC asset");
      }
      const atomic = parseQuotedAtomic(selected.amount);
      if (atomic > MAX_CALL_ATOMIC) {
        throw new Error("Refusing to sign a payment above the $0.05 cap");
      }
      const token = getAddress(selected.asset);
      if (selected.scheme === "upto") {
        await ensurePermit2(token, atomic);
      } else if (selected.scheme === "exact") {
        const balance = await usdcBalance(token);
        if (balance < atomic) {
          throw new Error(
            `Labs wallet has ${formatUnits(balance, 6)} USDC, needs ${formatUnits(atomic, 6)}`,
          );
        }
      } else {
        throw new Error(`Refusing unsupported scheme ${selected.scheme}`);
      }

      const payload = await httpClient.createPaymentPayload(required);
      return {
        headers: httpClient.encodePaymentSignatureHeader(payload),
        auth: paymentAuthFromPayload(payload),
      };
    },
  };
}

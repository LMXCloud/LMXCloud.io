import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseUnits,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { roundCredits } from "../../credits/pricing.js";

export interface TreasuryWalletConfig {
  rpcUrl: string;
  chainId: number;
  usdcContractAddress: `0x${string}`;
  privateKey: `0x${string}`;
}

function resolveChain(chainId: number): Chain {
  if (chainId === baseSepolia.id) return baseSepolia;
  return base;
}

export interface TreasuryRefundClient {
  transferUsdc(to: `0x${string}`, amountUsdc: number): Promise<`0x${string}`>;
}

export class TreasuryWallet implements TreasuryRefundClient {
  private readonly chain: Chain;
  private readonly publicClient;
  private readonly walletClient;
  private readonly account;

  constructor(private readonly config: TreasuryWalletConfig) {
    this.chain = resolveChain(config.chainId);
    this.account = privateKeyToAccount(config.privateKey);
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(config.rpcUrl),
    });
  }

  get address(): `0x${string}` {
    return this.account.address;
  }

  async transferUsdc(
    to: `0x${string}`,
    amountUsdc: number,
  ): Promise<`0x${string}`> {
    const normalized = roundCredits(amountUsdc);
    if (normalized <= 0) {
      throw new Error("Refund amount must be positive");
    }

    const atomic = parseUnits(normalized.toFixed(6), 6);
    const txHash = await this.walletClient.writeContract({
      address: this.config.usdcContractAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, atomic],
      chain: this.chain,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    if (receipt.status !== "success") {
      throw new Error(`USDC refund tx ${txHash} reverted`);
    }

    return txHash;
  }
}

export function createTreasuryWallet(
  config: TreasuryWalletConfig | null,
): TreasuryWallet | null {
  if (!config) return null;
  return new TreasuryWallet(config);
}

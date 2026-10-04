import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { LMX_LOG_ANCHOR_ABI } from "./contract.js";
import type { AnchorBatchRecord, AnchorStore } from "./store.js";

export interface AnchorPollerConfig {
  rpcUrl: string;
  chainId: number;
  contractAddress: `0x${string}`;
  privateKey: `0x${string}`;
  pollIntervalMs: number;
  minEvents: number;
  maxEvents: number;
}

function resolveChain(chainId: number): Chain {
  if (chainId === baseSepolia.id) return baseSepolia;
  return base;
}

export class AnchorPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly chain: Chain;
  private readonly publicClient;
  private readonly walletClient;
  private readonly contract;

  constructor(
    private readonly config: AnchorPollerConfig,
    private readonly store: AnchorStore,
    private readonly log: (message: string) => void = console.log,
  ) {
    this.chain = resolveChain(config.chainId);
    const account = privateKeyToAccount(config.privateKey);
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    });
    this.walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(config.rpcUrl),
    });
    this.contract = getContract({
      address: config.contractAddress,
      abi: LMX_LOG_ANCHOR_ABI,
      client: this.walletClient,
    });
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
    this.log(
      `Log anchor poller started on ${this.chain.name} (chain ${this.chain.id})`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const pending = await this.store.listPendingBatches();
      for (const batch of pending) {
        await this.submitBatch(batch);
      }

      const unanchored = await this.store.countUnanchoredEvents();
      if (unanchored < this.config.minEvents) {
        return;
      }

      const claimed = await this.store.claimEventsForBatch(
        this.config.maxEvents,
        this.config.chainId,
      );
      if (!claimed) return;

      this.log(
        `Claimed anchor batch ${claimed.batchId} with ${claimed.leaves.length} receipts (root ${claimed.merkleRoot})`,
      );

      await this.submitBatch({
        id: claimed.batchId,
        merkleRoot: claimed.merkleRoot,
        eventCount: claimed.leaves.length,
        status: "submitting",
        txHash: null,
        blockNumber: null,
        chainId: this.config.chainId,
        contractAddress: null,
        createdAt: new Date().toISOString(),
        anchoredAt: null,
      });
    } catch (err) {
      this.log(
        `Anchor poller error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async submitBatch(batch: AnchorBatchRecord): Promise<void> {
    const anchoredAt = await this.publicClient.readContract({
      address: this.config.contractAddress,
      abi: LMX_LOG_ANCHOR_ABI,
      functionName: "anchoredAt",
      args: [batch.merkleRoot],
    });

    if (anchoredAt > 0n) {
      this.log(`Root ${batch.merkleRoot} already anchored on-chain`);
      await this.store.markBatchAnchored(
        batch.id,
        batch.txHash ?? "0x0",
        0n,
        this.config.contractAddress,
      );
      return;
    }

    try {
      const txHash = await this.contract.write.anchor([batch.merkleRoot], {
        chain: this.chain,
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status !== "success") {
        await this.store.markBatchFailed(batch.id);
        this.log(`Anchor tx ${txHash} reverted for batch ${batch.id}`);
        return;
      }

      await this.store.markBatchAnchored(
        batch.id,
        txHash,
        receipt.blockNumber,
        this.config.contractAddress,
      );
      this.log(
        `Anchored batch ${batch.id} (${batch.eventCount} receipts) in tx ${txHash}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const alreadyAnchored =
        message.includes("AlreadyAnchored") ||
        message.toLowerCase().includes("already anchored");

      if (alreadyAnchored) {
        await this.store.markBatchAnchored(
          batch.id,
          "0x0",
          0n,
          this.config.contractAddress,
        );
        this.log(`Root ${batch.merkleRoot} was already anchored`);
        return;
      }

      await this.store.markBatchFailed(batch.id);
      this.log(`Failed to anchor batch ${batch.id}: ${message}`);
    }
  }
}

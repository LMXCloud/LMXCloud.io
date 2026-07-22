import {

  createPublicClient,

  decodeEventLog,

  erc20Abi,

  formatUnits,

  http,

  parseAbiItem,

  type Chain,

  type Log,

} from "viem";

import { base, baseSepolia } from "viem/chains";

import type { ApiKeyStore } from "../auth/store.js";
import { notifyCreditsAdded } from "../notify/events.js";
import type { DepositStore } from "./store.js";
import { isDepositAmountAllowed } from "./limits.js";



export interface DepositPollerConfig {

  rpcUrl: string;

  treasuryAddress: string;

  usdcContractAddress: string;

  chainId: number;

  confirmations: number;

  pollIntervalMs: number;

  lookbackBlocks: number;

  maxLogBlockRange: number;

  maxDepositUsdc: number;

}



const TRANSFER_EVENT = parseAbiItem(

  "event Transfer(address indexed from, address indexed to, uint256 value)",

);



function isRangeLimitError(err: unknown): boolean {

  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  return (
    message.includes("block range") ||
    (message.includes("max") && message.includes("block")) ||
    message.includes("eth_getlogs")
  );

}



function resolveChain(chainId: number): Chain {

  if (chainId === baseSepolia.id) return baseSepolia;

  return base;

}



export class DepositPoller {

  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  private readonly client;

  private readonly chain: Chain;



  constructor(

    private readonly config: DepositPollerConfig,

    private readonly depositStore: DepositStore,

    private readonly apiKeyStore: ApiKeyStore,

    private readonly log: (message: string) => void = console.log,

  ) {

    this.chain = resolveChain(config.chainId);

    this.client = createPublicClient({

      chain: this.chain,

      transport: http(config.rpcUrl),

    });

  }



  start(): void {

    if (this.timer) return;

    void this.poll();

    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);

    this.log(

      `USDC deposit poller started on ${this.chain.name} (chain ${this.chain.id})`,

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

      const latestBlock = await this.client.getBlockNumber();

      let fromBlock = await this.depositStore.getLastScannedBlock();



      if (fromBlock === 0n) {

        const lookback = BigInt(this.config.lookbackBlocks);

        fromBlock = latestBlock > lookback ? latestBlock - lookback : 0n;

      } else {

        fromBlock = fromBlock + 1n;

      }



      if (fromBlock <= latestBlock) {

        const logs = await this.fetchTransferLogs(fromBlock, latestBlock);



        for (const log of logs) {

          try {

            await this.handleTransferLog(log);

          } catch (err) {

            this.log(

              `Failed to process transfer log ${log.transactionHash ?? "unknown"}: ${err instanceof Error ? err.message : String(err)}`,

            );

            throw err;

          }

        }



        await this.depositStore.setLastScannedBlock(latestBlock);

      }



      await this.processPendingDeposits(latestBlock);

    } catch (err) {

      this.log(

        `Deposit poller error: ${err instanceof Error ? err.message : String(err)}`,

      );

    } finally {

      this.running = false;

    }

  }



  private async fetchTransferLogs(

    fromBlock: bigint,

    toBlock: bigint,

  ): Promise<Log[]> {

    const maxRange = BigInt(this.config.maxLogBlockRange);
    try {
      return await this.fetchTransferLogsChunked(fromBlock, toBlock, maxRange);
    } catch (err) {
      if (!isRangeLimitError(err) || maxRange <= 1n) {
        throw err;
      }
      const retryRange = maxRange > 10n ? 10n : maxRange / 2n;
      const safeRetryRange = retryRange >= 1n ? retryRange : 1n;
      this.log(
        `Deposit poller range-limit hit; retrying once with ${safeRetryRange.toString()}-block chunks`,
      );
      return this.fetchTransferLogsChunked(fromBlock, toBlock, safeRetryRange);
    }
  }

  private async fetchTransferLogsChunked(
    fromBlock: bigint,
    toBlock: bigint,
    chunkSize: bigint,
  ): Promise<Log[]> {

    const logs: Log[] = [];



    for (let start = fromBlock; start <= toBlock; start += chunkSize) {

      const end =

        start + chunkSize - 1n > toBlock

          ? toBlock

          : start + chunkSize - 1n;



      const chunk = await this.client.getLogs({

        address: this.config.usdcContractAddress as `0x${string}`,

        event: TRANSFER_EVENT,

        args: {

          to: this.config.treasuryAddress as `0x${string}`,

        },

        fromBlock: start,

        toBlock: end,

      });



      logs.push(...chunk);

    }



    return logs;

  }



  private async handleTransferLog(log: Log): Promise<void> {

    if (!log.transactionHash || log.logIndex === null || log.logIndex === undefined) {

      return;

    }



    let decoded;

    try {

      decoded = decodeEventLog({

        abi: erc20Abi,

        data: log.data,

        topics: log.topics,

      });

    } catch {

      return;

    }



    if (decoded.eventName !== "Transfer") return;



    const { from, to, value } = decoded.args;

    if (to.toLowerCase() !== this.config.treasuryAddress.toLowerCase()) {

      return;

    }



    const amountUsdc = Number(formatUnits(value, 6));

    if (!isDepositAmountAllowed(amountUsdc, this.config.maxDepositUsdc)) {

      this.log(

        `Ignored USDC deposit ${log.transactionHash} — amount ${amountUsdc} outside allowed range`,

      );

      return;

    }



    await this.depositStore.insertPendingDeposit({

      txHash: log.transactionHash,

      logIndex: log.logIndex,

      fromAddress: from.toLowerCase(),

      toAddress: to.toLowerCase(),

      amountUsdc,

      blockNumber: log.blockNumber ?? 0n,

    });

  }



  private async processPendingDeposits(latestBlock: bigint): Promise<void> {

    const pending = await this.depositStore.listPendingDeposits();



    for (const deposit of pending) {

      const confirmations = Number(latestBlock - deposit.blockNumber + 1n);

      await this.depositStore.updateConfirmations(

        deposit.txHash,

        deposit.logIndex,

        confirmations,

      );



      if (confirmations < this.config.confirmations) {

        continue;

      }



      const record = await this.apiKeyStore.findPrimaryKeyForWallet(

        deposit.fromAddress,

      );



      if (!record) {

        await this.depositStore.markUnmatched(deposit.txHash, deposit.logIndex);

        this.log(

          `Unmatched USDC deposit ${deposit.txHash} from ${deposit.fromAddress}`,

        );

        continue;

      }



      const credited = await this.depositStore.creditPendingDeposit(

        deposit.txHash,

        deposit.logIndex,

        record.id,

      );

      if (!credited) {

        continue;

      }

      notifyCreditsAdded({
        apiKeyId: record.id,
        amount: credited.amount,
        balance: credited.balance,
        source: "usdc_deposit",
        detail: `tx ${deposit.txHash.slice(0, 10)}…`,
      });

      this.log(

        `Credited ${deposit.amountUsdc} USD to ${record.id} from ${deposit.txHash}`,

      );

    }

  }

}



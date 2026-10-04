#!/usr/bin/env node
/**
 * Deploy LmxLogAnchor to Base or Base Sepolia.
 *
 * Usage (from repo root):
 *   pnpm deploy:anchor
 *
 * Reads BASE_RPC_URL, ANCHOR_PRIVATE_KEY, and optional SIWE_CHAIN_ID from
 * the repo-root .env. Values already exported in the shell take precedence.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../", ".env"), override: true });

const BYTECODE =
  "0x608060405234801561000f575f80fd5b5060405161058a38038061058a833981810160405281019061003191906100d4565b805f806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550506100ff565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6100a38261007a565b9050919050565b6100b381610099565b81146100bd575f80fd5b50565b5f815190506100ce816100aa565b92915050565b5f602082840312156100e9576100e8610076565b5b5f6100f6848285016100c0565b91505092915050565b61047e8061010c5f395ff3fe608060405234801561000f575f80fd5b506004361061004a575f3560e01c80638da5cb5b1461004e5780639591a6101461006c578063eecdf9271461009c578063f2fde38b146100b8575b5f80fd5b6100566100d4565b6040516100639190610347565b60405180910390f35b61008660048036038101906100819190610397565b6100f7565b60405161009391906103da565b60405180910390f35b6100b660048036038101906100b19190610397565b61010c565b005b6100d260048036038101906100cd919061041d565b610242565b005b5f8054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b6001602052805f5260405f205f915090505481565b5f8054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614610190576040517f30cd747100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b5f60015f8381526020019081526020015f2054146101da576040517fa0094ce300000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b4260015f8381526020019081526020015f20819055503373ffffffffffffffffffffffffffffffffffffffff16817fe921eb4bf6ea0aadb86d175193eccf6ef65e0fa9f467f0be8bcc3aea6d98ffe24260405161023791906103da565b60405180910390a350565b5f8054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff16146102c6576040517f30cd747100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b805f806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050565b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f61033182610308565b9050919050565b61034181610327565b82525050565b5f60208201905061035a5f830184610338565b92915050565b5f80fd5b5f819050919050565b61037681610364565b8114610380575f80fd5b50565b5f813590506103918161036d565b92915050565b5f602082840312156103ac576103ab610360565b5b5f6103b984828501610383565b91505092915050565b5f819050919050565b6103d4816103c2565b82525050565b5f6020820190506103ed5f8301846103cb565b92915050565b6103fc81610327565b8114610406575f80fd5b50565b5f81359050610417816103f3565b92915050565b5f6020828403121561043257610431610360565b5b5f61043f84828501610409565b9150509291505056fea2646970667358221220d0463a3f5622e58514f4d4634db1868957e4a03f984d2756e209c6b7692b428c64736f6c63430008140033";

const ABI = [
  {
    inputs: [{ internalType: "address", name: "initialOwner", type: "address" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
];

const rpcUrl = process.env.BASE_RPC_URL;
const privateKeyRaw = process.env.ANCHOR_PRIVATE_KEY;
const chainId = Number(process.env.SIWE_CHAIN_ID ?? 8453);

if (!rpcUrl) {
  console.error("Set BASE_RPC_URL");
  process.exit(1);
}

if (!privateKeyRaw) {
  console.error("Set ANCHOR_PRIVATE_KEY to the deployer/owner wallet");
  process.exit(1);
}

const privateKey = privateKeyRaw.trim().startsWith("0x")
  ? privateKeyRaw.trim()
  : `0x${privateKeyRaw.trim()}`;

const chain = chainId === 84532 ? baseSepolia : base;
const account = privateKeyToAccount(privateKey);

const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});

const hash = await walletClient.deployContract({
  abi: ABI,
  bytecode: BYTECODE,
  args: [account.address],
  chain,
});

console.error(`Deploy tx submitted: ${hash}`);
console.error("Waiting for confirmation…");

const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("Deploy failed — check the transaction on Basescan.");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      chain: chain.name,
      chain_id: chain.id,
      deployer: account.address,
      tx_hash: hash,
      contract_address: receipt.contractAddress,
    },
    null,
    2,
  ),
);

console.error(`\nAdd to .env:\nANCHOR_CONTRACT_ADDRESS=${receipt.contractAddress}`);

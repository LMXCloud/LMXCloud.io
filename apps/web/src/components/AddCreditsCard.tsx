import { useCallback, useMemo, useState } from "react";
import { erc20Abi, formatUnits, getAddress } from "viem";
import {
  useBalance,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  useWalletConnect,
  walletConnectButtonLabel,
} from "../hooks/useWalletConnect";
import { formatUsd, formatWallet, txExplorerUrl } from "../lib/format";
import { targetChain } from "../lib/wagmi";
import {
  MIN_ETH_FOR_GAS,
  USDC_DECIMALS,
  parseUsdcAmount,
  validateDepositAmount,
} from "../lib/usdc";
import { formatWalletError } from "../lib/wallet-errors";
import type { DepositInfoResponse } from "../types";
import { AlertBanner } from "./console/AlertBanner";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

const PRESET_AMOUNTS = [10, 25, 50, 100] as const;

type DepositStep = "idle" | "amount" | "connect" | "confirm" | "submitted";

interface AddCreditsCardProps {
  depositInfo: DepositInfoResponse;
  onDepositSubmitted: (txHash: string) => void;
}

export function AddCreditsCard({ depositInfo, onDepositSubmitted }: AddCreditsCardProps) {
  const [step, setStep] = useState<DepositStep>("idle");
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [flowError, setFlowError] = useState<string | null>(null);
  const [submittedHash, setSubmittedHash] = useState<`0x${string}` | null>(null);

  const usdcContractAddress = useMemo(() => {
    try {
      return getAddress(depositInfo.usdc_contract_address);
    } catch {
      return null;
    }
  }, [depositInfo.usdc_contract_address]);

  const treasuryAddress = useMemo(() => {
    try {
      return getAddress(depositInfo.treasury_address);
    } catch {
      return null;
    }
  }, [depositInfo.treasury_address]);

  const verifiedWallet = useMemo(() => {
    try {
      return getAddress(depositInfo.wallet);
    } catch {
      return null;
    }
  }, [depositInfo.wallet]);

  const chainMismatch = depositInfo.chain_id !== targetChain.id;

  const presetAmounts = useMemo(
    () =>
      PRESET_AMOUNTS.filter(
        (amount) =>
          amount >= depositInfo.min_deposit_usdc &&
          amount <= depositInfo.max_deposit_usdc,
      ),
    [depositInfo.min_deposit_usdc, depositInfo.max_deposit_usdc],
  );

  const {
    address,
    isConnected,
    wrongNetwork,
    targetChain: walletChain,
    phase,
    error: connectError,
    busy: connectBusy,
    setError: setConnectError,
    connectWallet,
    switchToTargetChain,
    ensureConnectedOnTargetChain,
    connector,
    connectors,
  } = useWalletConnect();

  const connectedWallet = useMemo(() => {
    if (!address) return null;
    try {
      return getAddress(address);
    } catch {
      return null;
    }
  }, [address]);

  const walletReady =
    !chainMismatch &&
    isConnected &&
    !wrongNetwork &&
    connectedWallet &&
    verifiedWallet &&
    connectedWallet === verifiedWallet;

  const { data: ethBalance, refetch: refetchEth } = useBalance({
    address: connectedWallet ?? undefined,
    chainId: walletChain.id,
    query: { enabled: Boolean(walletReady) },
  });

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: usdcContractAddress ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedWallet ? [connectedWallet] : undefined,
    chainId: walletChain.id,
    query: { enabled: Boolean(walletReady && usdcContractAddress) },
  });

  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({
    hash: submittedHash ?? undefined,
    chainId: walletChain.id,
  });

  const chainLabel =
    depositInfo.chain === "base-sepolia" ? "Base Sepolia" : "Base";

  const resolvedAmount = useMemo(() => {
    if (selectedAmount !== null) return selectedAmount;
    const parsed = Number(customAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }, [selectedAmount, customAmount]);

  const amountValidationError = useMemo(() => {
    if (resolvedAmount === null) return null;
    return validateDepositAmount(
      resolvedAmount,
      depositInfo.min_deposit_usdc,
      depositInfo.max_deposit_usdc,
    );
  }, [resolvedAmount, depositInfo.min_deposit_usdc, depositInfo.max_deposit_usdc]);

  const usdcBalanceUsd = useMemo(() => {
    if (usdcBalance === undefined) return null;
    return Number(formatUnits(usdcBalance, USDC_DECIMALS));
  }, [usdcBalance]);

  const resetFlow = useCallback(() => {
    setStep("idle");
    setSelectedAmount(null);
    setCustomAmount("");
    setFlowError(null);
    setConnectError(null);
    setSubmittedHash(null);
  }, [setConnectError]);

  const validateBalances = useCallback(
    (
      amount: number,
      eth: typeof ethBalance,
      usdc: typeof usdcBalance,
    ) => {
      if (!eth || eth.value < MIN_ETH_FOR_GAS) {
        return `You need a small amount of ETH on ${walletChain.name} to pay for gas. USDC transfers still require ETH for the network fee, separate from the USDC you are sending.`;
      }

      const required = parseUsdcAmount(amount);
      if (usdc === undefined || usdc < required) {
        const available = usdc ? Number(formatUnits(usdc, USDC_DECIMALS)) : 0;
        return `Insufficient USDC. Your wallet holds ${formatUsd(available)} but you are trying to send ${formatUsd(amount)}.`;
      }

      return null;
    },
    [walletChain.name],
  );

  const handleConnectAction = useCallback(() => {
    const activeConnector = connector ?? connectors[0];
    if (!activeConnector) {
      setFlowError("No wallet connector available");
      return;
    }

    if (wrongNetwork && isConnected) {
      void switchToTargetChain();
      return;
    }

    connectWallet(activeConnector);
  }, [
    connector,
    connectors,
    wrongNetwork,
    isConnected,
    switchToTargetChain,
    connectWallet,
  ]);

  const handleSend = useCallback(async () => {
    if (!resolvedAmount) {
      setFlowError("Enter a valid amount greater than zero");
      return;
    }

    const amountError = validateDepositAmount(
      resolvedAmount,
      depositInfo.min_deposit_usdc,
      depositInfo.max_deposit_usdc,
    );
    if (amountError) {
      setFlowError(amountError);
      return;
    }

    if (!usdcContractAddress || !treasuryAddress) {
      setFlowError("Deposit configuration is invalid. Contact support.");
      return;
    }

    if (chainMismatch) {
      setFlowError(
        `Dashboard is configured for chain ${targetChain.id} but the API expects ${depositInfo.chain_id}. Update VITE_CHAIN_ID and redeploy.`,
      );
      return;
    }

    setFlowError(null);
    setConnectError(null);

    try {
      const activeAddress = await ensureConnectedOnTargetChain();
      const checksummed = getAddress(activeAddress);

      if (verifiedWallet && checksummed !== verifiedWallet) {
        setFlowError(
          `Connect the wallet linked to your account (${formatWallet(verifiedWallet)}). Deposits from other addresses are not credited automatically.`,
        );
        setStep("connect");
        return;
      }

      const [{ data: freshEth }, { data: freshUsdc }] = await Promise.all([
        refetchEth(),
        refetchUsdc(),
      ]);

      const balanceError = validateBalances(resolvedAmount, freshEth, freshUsdc);
      if (balanceError) {
        setFlowError(balanceError);
        return;
      }

      setStep("confirm");

      const hash = await writeContractAsync({
        address: usdcContractAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [treasuryAddress, parseUsdcAmount(resolvedAmount)],
        chainId: walletChain.id,
      });

      setSubmittedHash(hash);
      setStep("submitted");
      onDepositSubmitted(hash);
    } catch (err) {
      setFlowError(formatWalletError(err));
      setStep(walletReady ? "amount" : "connect");
    }
  }, [
    resolvedAmount,
    depositInfo.min_deposit_usdc,
    depositInfo.max_deposit_usdc,
    depositInfo.chain_id,
    usdcContractAddress,
    treasuryAddress,
    chainMismatch,
    ensureConnectedOnTargetChain,
    verifiedWallet,
    refetchEth,
    refetchUsdc,
    validateBalances,
    writeContractAsync,
    walletChain.id,
    onDepositSubmitted,
    setConnectError,
    walletReady,
  ]);

  const connectLabel = walletConnectButtonLabel(phase, {
    defaultLabel: "Connect wallet",
    wrongNetwork,
    isConnected,
    targetChainName: walletChain.name,
  });

  const isBusy = connectBusy || isWriting || isConfirming;
  const configBroken = !usdcContractAddress || !treasuryAddress;

  return (
    <Card>
      <p className="text-label-sm text-on-surface-muted">Fund with USDC</p>
      <h3 className="mt-2 text-body-sm font-semibold text-on-surface">
        Add credits on {chainLabel}
      </h3>
      <p className="mt-2 text-body-sm text-on-surface-muted">
        Send USDC from your verified wallet ({formatWallet(depositInfo.wallet)}).
        Credits appear after {depositInfo.confirmations_required} confirmations.
      </p>

      {chainMismatch && (
        <AlertBanner tone="error" className="mt-4 border-0 py-0">
          Chain configuration mismatch — this dashboard targets {walletChain.name}{" "}
          (chain {targetChain.id}) but billing is configured for chain{" "}
          {depositInfo.chain_id}. Deposits are disabled until{" "}
          <code className="text-mono-sm">VITE_CHAIN_ID</code> matches the API.
        </AlertBanner>
      )}

      {configBroken && (
        <AlertBanner tone="error" className="mt-4 border-0 py-0">
          Deposit addresses from the API are invalid. Contact support.
        </AlertBanner>
      )}

      {step === "idle" && !chainMismatch && !configBroken && (
        <div className="mt-6">
          <Button type="button" onClick={() => setStep("amount")}>
            Add Credits
          </Button>
        </div>
      )}

      {step === "amount" && !chainMismatch && !configBroken && (
        <div className="mt-6 space-y-4">
          <div>
            <p className="text-label-sm text-on-surface-muted">Choose amount</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {presetAmounts.map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant={selectedAmount === amount ? "primary" : "secondary"}
                  disabled={isBusy}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount("");
                    setFlowError(null);
                  }}
                >
                  {formatUsd(amount)}
                </Button>
              ))}
            </div>
          </div>

          <Input
            label="Custom amount (USDC)"
            type="number"
            min={depositInfo.min_deposit_usdc}
            max={depositInfo.max_deposit_usdc}
            step="0.01"
            placeholder="e.g. 15.00"
            value={customAmount}
            onChange={(event) => {
              setCustomAmount(event.target.value);
              setSelectedAmount(null);
              setFlowError(null);
            }}
            error={amountValidationError ?? undefined}
            helperText={`${formatUsd(depositInfo.min_deposit_usdc)} – ${formatUsd(depositInfo.max_deposit_usdc)} per transfer · 1 USDC = $1.00 in credits`}
          />

          {walletReady && usdcBalanceUsd !== null && (
            <p className="text-body-sm text-on-surface-muted">
              Wallet balance: {formatUsd(usdcBalanceUsd)} USDC
              {ethBalance && ethBalance.value < MIN_ETH_FOR_GAS && (
                <span className="text-warning">
                  {" "}
                  · Low ETH for gas on {walletChain.name}
                </span>
              )}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!resolvedAmount || Boolean(amountValidationError) || isBusy}
              onClick={() => {
                if (!walletReady) {
                  setStep("connect");
                  return;
                }
                void handleSend();
              }}
            >
              {resolvedAmount
                ? walletReady
                  ? `Send ${formatUsd(resolvedAmount)} USDC`
                  : "Continue"
                : "Select amount"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy}
              onClick={resetFlow}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "connect" && !chainMismatch && !configBroken && (
        <div className="mt-6 space-y-4">
          <p className="text-body-sm text-on-surface-muted">
            {wrongNetwork && isConnected
              ? `Your wallet is on the wrong network. Switch to ${walletChain.name} to send USDC.`
              : `Connect ${formatWallet(depositInfo.wallet)} to send your deposit.`}
          </p>

          {connectedWallet && verifiedWallet && connectedWallet !== verifiedWallet && (
            <p className="text-body-sm text-error">
              Connected wallet ({formatWallet(connectedWallet)}) does not match your
              verified account ({formatWallet(verifiedWallet)}). Switch accounts in
              your wallet extension.
            </p>
          )}

          <Button
            type="button"
            variant="secondary"
            disabled={connectBusy}
            onClick={handleConnectAction}
          >
            {connectLabel}
          </Button>

          {walletReady && (
            <Button
              type="button"
              disabled={!resolvedAmount || Boolean(amountValidationError) || isBusy}
              onClick={() => void handleSend()}
            >
              {resolvedAmount ? `Send ${formatUsd(resolvedAmount)} USDC` : "Send USDC"}
            </Button>
          )}

          <Button
            type="button"
            variant="tertiary"
            disabled={isBusy}
            onClick={() => setStep("amount")}
          >
            Back
          </Button>
        </div>
      )}

      {(step === "confirm" || step === "submitted") && resolvedAmount && (
        <div className="mt-6 space-y-3">
          <p className="text-body-sm text-on-surface">
            {step === "confirm" || isWriting
              ? "Confirm the USDC transfer in your wallet…"
              : isReceiptError
                ? "Transaction failed on-chain. No USDC was sent — check your wallet and try again."
                : isConfirming
                  ? `Transaction submitted. Waiting for on-chain confirmation (${formatUsd(resolvedAmount)} USDC)…`
                  : isConfirmed
                    ? `Transfer confirmed. Your deposit will appear in history and credit after ${depositInfo.confirmations_required} confirmations.`
                    : "Processing transaction…"}
          </p>
          {submittedHash && (
            <a
              href={txExplorerUrl(depositInfo.chain, submittedHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-mono text-body-sm text-primary hover:underline"
            >
              View transaction
            </a>
          )}
          {(isConfirmed || isReceiptError) && (
            <Button type="button" variant="secondary" onClick={resetFlow}>
              {isReceiptError ? "Try again" : "Add more credits"}
            </Button>
          )}
        </div>
      )}

      {(flowError || connectError) && (
        <p className="mt-3 text-body-sm text-error">{flowError ?? connectError}</p>
      )}
    </Card>
  );
}

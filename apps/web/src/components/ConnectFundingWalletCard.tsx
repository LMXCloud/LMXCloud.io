import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { useSignMessage } from "wagmi";
import { fetchWalletNonce, linkWalletToSession } from "../api";
import { useAuth } from "../context/AuthContext";
import {
  useWalletConnect,
  walletConnectButtonLabel,
} from "../hooks/useWalletConnect";
import { formatWallet } from "../lib/format";
import { buildSiweMessage } from "../lib/siwe";
import { formatWalletError } from "../lib/wallet-errors";
import { targetChain } from "../lib/wagmi";
import { AlertBanner } from "./console/AlertBanner";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

interface ConnectFundingWalletCardProps {
  onLinked: (wallet: string) => void;
}

export function ConnectFundingWalletCard({ onLinked }: ConnectFundingWalletCardProps) {
  const { apiKey, setLinkedWallet } = useAuth();
  const { signMessageAsync } = useSignMessage();
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

  const [linking, setLinking] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const pendingLinkRef = useRef(false);

  const connectLabel = walletConnectButtonLabel(phase, {
    defaultLabel: isConnected ? "Verify & link wallet" : "Connect wallet",
    wrongNetwork,
    isConnected,
    targetChainName: walletChain.name,
  });

  const handleLink = useCallback(async () => {
    if (!apiKey) return;
    setFlowError(null);
    setConnectError(null);
    setLinking(true);
    pendingLinkRef.current = false;

    try {
      const activeAddress = await ensureConnectedOnTargetChain();
      const checksummed = getAddress(activeAddress);

      const nonceResponse = await fetchWalletNonce(checksummed);
      const message = buildSiweMessage({
        domain: nonceResponse.domain,
        address: checksummed,
        statement: "Sign in to LMX Cloud",
        uri: nonceResponse.uri,
        chainId: nonceResponse.chain_id,
        nonce: nonceResponse.nonce,
      });
      const signature = await signMessageAsync({ message });
      const linked = await linkWalletToSession(apiKey, message, signature);

      setLinkedWallet(linked.wallet);
      onLinked(linked.wallet);
    } catch (err) {
      setFlowError(formatWalletError(err));
    } finally {
      setLinking(false);
    }
  }, [
    apiKey,
    ensureConnectedOnTargetChain,
    signMessageAsync,
    setLinkedWallet,
    onLinked,
    setConnectError,
  ]);

  useEffect(() => {
    if (!pendingLinkRef.current || !isConnected || !address || wrongNetwork) return;
    void handleLink();
  }, [isConnected, address, wrongNetwork, handleLink]);

  const handlePrimary = useCallback(() => {
    if (wrongNetwork && isConnected) {
      void switchToTargetChain().then(() => {
        pendingLinkRef.current = true;
      });
      return;
    }
    if (isConnected && address) {
      void handleLink();
      return;
    }
    const activeConnector = connector ?? connectors[0];
    if (!activeConnector) {
      setFlowError("No wallet connector available. Install a browser wallet extension.");
      return;
    }
    pendingLinkRef.current = true;
    connectWallet(activeConnector);
  }, [
    wrongNetwork,
    isConnected,
    address,
    switchToTargetChain,
    handleLink,
    connector,
    connectors,
    connectWallet,
  ]);

  const busy = linking || connectBusy;

  return (
    <Card accent="primary">
      <p className="text-label-sm text-primary">Buy credits</p>
      <h3 className="mt-2 text-title-md text-on-surface">Fund with USDC</h3>
      <p className="mt-2 text-body-sm text-on-surface-muted">
        Credits are funded on stablecoin rails only. Connect a wallet, verify it with a
        signature, then send USDC on {targetChain.name}. 1 USDC = $1.00 in API credits.
      </p>

      <AlertBanner tone="info" className="mt-4">
        Email sign-in stays active after linking. The connected wallet is used only for
        deposits — send USDC from that verified address.
      </AlertBanner>

      {isConnected && address && (
        <p className="mt-4 text-body-sm text-on-surface-muted">
          Connected: <span className="font-mono text-on-surface">{formatWallet(address)}</span>
          {wrongNetwork ? ` · switch to ${walletChain.name}` : ""}
        </p>
      )}

      <div className="mt-5">
        <Button type="button" disabled={busy} onClick={handlePrimary}>
          {linking
            ? "Confirm in wallet…"
            : wrongNetwork && isConnected
              ? `Switch to ${walletChain.name}`
              : isConnected
                ? "Verify & link wallet"
                : connectLabel}
        </Button>
      </div>

      {(flowError || connectError) && (
        <p className="mt-3 text-body-sm text-error">{flowError ?? connectError}</p>
      )}
    </Card>
  );
}

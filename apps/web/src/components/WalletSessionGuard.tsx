import { useEffect, useMemo } from "react";
import { getAddress } from "viem";
import { useConnection } from "wagmi";
import { useAuth } from "../context/AuthContext";
import { formatWallet } from "../lib/format";
import { targetChain } from "../lib/wagmi";
import { useWalletSignIn, walletSignInButtonLabel } from "../hooks/useWalletSignIn";
import { AlertBanner } from "./console/AlertBanner";
import { Button } from "./ui/Button";

/**
 * Keeps the wagmi wallet connection aligned with an active LMX wallet session.
 * Surfaces account/network drift and offers one-click recovery.
 */
export function WalletSessionGuard() {
  const { wallet, authMode, walletSignedIn } = useAuth();
  const { address, status } = useConnection();
  const isConnected = status === "connected";

  const {
    wrongNetwork,
    phase,
    error,
    busy,
    signIn,
    switchToTargetChain,
    connectWallet,
    setError,
  } = useWalletSignIn();

  const sessionWallet = useMemo(() => {
    if (!wallet) return null;
    try {
      return getAddress(wallet);
    } catch {
      return null;
    }
  }, [wallet]);

  const connectedWallet = useMemo(() => {
    if (!address) return null;
    try {
      return getAddress(address);
    } catch {
      return null;
    }
  }, [address]);

  const accountMismatch =
    walletSignedIn &&
    isConnected &&
    sessionWallet &&
    connectedWallet &&
    sessionWallet !== connectedWallet;

  const walletDisconnected = walletSignedIn && !isConnected;

  const needsNetworkSwitch = walletSignedIn && isConnected && wrongNetwork;
  const needsReSign = walletSignedIn && accountMismatch && !wrongNetwork;

  useEffect(() => {
    if (!accountMismatch && !needsNetworkSwitch && !walletDisconnected) {
      setError(null);
    }
  }, [accountMismatch, needsNetworkSwitch, walletDisconnected, setError]);

  if (authMode !== "wallet" || !walletSignedIn) return null;

  if (!walletDisconnected && !needsNetworkSwitch && !needsReSign) return null;

  const actionLabel = walletSignInButtonLabel(phase, {
    defaultLabel: needsReSign ? "Sign in with current wallet" : "Connect wallet",
    wrongNetwork: needsNetworkSwitch,
    isConnected,
    targetChainName: targetChain.name,
  });

  async function handleAction() {
    if (needsNetworkSwitch) {
      try {
        await switchToTargetChain();
      } catch {
        // error surfaced via hook state
      }
      return;
    }

    if (walletDisconnected) {
      connectWallet();
      return;
    }

    if (needsReSign && connectedWallet) {
      signIn(connectedWallet);
    }
  }

  return (
    <div>
      {walletDisconnected && (
        <AlertBanner tone="info">
          <p className="font-semibold">Wallet disconnected</p>
          <p className="mt-1 text-on-surface-muted">
            Your LMX session is still active, but your browser wallet is not connected.
            Reconnect to stay in sync with deposits and signing.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void handleAction()}
            >
              {actionLabel}
            </Button>
          </div>
        </AlertBanner>
      )}

      {needsNetworkSwitch && (
        <AlertBanner tone="info">
          <p className="font-semibold">Wrong network</p>
          <p className="mt-1 text-on-surface-muted">
            Your wallet is not on {targetChain.name}. Switch networks to keep your session
            aligned with LMX billing and deposits.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void handleAction()}
            >
              {actionLabel}
            </Button>
          </div>
        </AlertBanner>
      )}

      {needsReSign && sessionWallet && connectedWallet && (
        <AlertBanner tone="info">
          <p className="font-semibold">Wallet account changed</p>
          <p className="mt-1 text-on-surface-muted">
            Your session is linked to {formatWallet(sessionWallet)}, but your wallet is
            connected as {formatWallet(connectedWallet)}. Sign in again with your current
            account, or switch back in your wallet extension.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void handleAction()}
            >
              {actionLabel}
            </Button>
          </div>
        </AlertBanner>
      )}

      {error && <p className="py-3 text-body-sm text-error">{error}</p>}
    </div>
  );
}

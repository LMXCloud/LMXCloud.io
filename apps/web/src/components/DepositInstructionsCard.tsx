import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { contractExplorerUrl, formatUsd, formatWallet } from "../lib/format";
import type { DepositInfoResponse } from "../types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

interface DepositInstructionsCardProps {
  depositInfo: DepositInfoResponse;
}

function chainLabel(chain: string): string {
  if (chain === "base-sepolia") return "Base Sepolia";
  if (chain === "base") return "Base";
  return chain;
}

function CopyableValue({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-label-sm text-on-surface-muted">{label}</p>
      <div className="mt-1 flex min-w-0 items-center gap-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 break-all font-mono text-body-sm text-primary hover:underline"
            title={value}
          >
            {value}
          </a>
        ) : (
          <p className="min-w-0 break-all font-mono text-body-sm text-on-surface" title={value}>
            {value}
          </p>
        )}
        <Button
          type="button"
          variant="tertiary"
          size="sm"
          className="h-8 w-8 shrink-0 px-0"
          aria-label={`Copy ${label}`}
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </Button>
      </div>
    </div>
  );
}

export function DepositInstructionsCard({ depositInfo }: DepositInstructionsCardProps) {
  return (
    <Card>
      <p className="text-label-sm text-on-surface-muted">Deposit details</p>
      <h3 className="mt-2 text-body-sm font-semibold text-on-surface">
        USDC on {chainLabel(depositInfo.chain)}
      </h3>
      <p className="mt-2 text-body-sm text-on-surface-muted">
        Send USDC from your verified wallet ({formatWallet(depositInfo.wallet)}). Credits
        appear after {depositInfo.confirmations_required} confirmations. 1 USDC = $1.00 in
        API credits.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <CopyableValue
          label="Treasury address"
          value={depositInfo.treasury_address}
          href={contractExplorerUrl(depositInfo.chain_id, depositInfo.treasury_address)}
        />
        <CopyableValue
          label="USDC contract"
          value={depositInfo.usdc_contract_address}
          href={contractExplorerUrl(depositInfo.chain_id, depositInfo.usdc_contract_address)}
        />
        <div>
          <p className="text-label-sm text-on-surface-muted">Min / max per transfer</p>
          <p className="mt-1 text-body-sm text-on-surface">
            {formatUsd(depositInfo.min_deposit_usdc, 2)} – {formatUsd(depositInfo.max_deposit_usdc, 2)}
          </p>
        </div>
        <div>
          <p className="text-label-sm text-on-surface-muted">Confirmations required</p>
          <p className="mt-1 text-body-sm text-on-surface">
            {depositInfo.confirmations_required}
          </p>
        </div>
      </div>
    </Card>
  );
}

import { SignUp } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router-dom";
import { WalletConnectButton } from "../components/WalletConnectButton";
import { CLERK_PUBLISHABLE_KEY, clerkAppearance } from "../lib/clerk";
import { peekAuthNext } from "../lib/auth-next";

export function SignUpPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 text-center">
        <Link
          to="/"
          className="text-headline-md text-on-surface hover:text-primary"
        >
          LMX Cloud
        </Link>
        <p className="mt-1 text-body-sm text-on-surface-muted">
          Create an account — $1.00 starting credits included
        </p>
      </div>

      {CLERK_PUBLISHABLE_KEY ? (
        <>
          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            appearance={clerkAppearance}
          />
          <div className="my-6 flex w-full max-w-[400px] items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-body-sm text-on-surface-muted">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <WalletConnectButton
        label="Connect Wallet"
        onSuccess={() => navigate(peekAuthNext() ?? "/console/overview", { replace: true })}
      />

      <p className="mt-6 max-w-[400px] text-center text-body-sm text-on-surface-muted">
        By signing up or connecting a wallet, you agree to our{" "}
        <Link to="/legal/terms" className="text-primary hover:text-primary-hover">
          Terms of Service
        </Link>
        ,{" "}
        <Link to="/legal/privacy" className="text-primary hover:text-primary-hover">
          Privacy Policy
        </Link>
        , and{" "}
        <Link to="/legal/acceptable-use" className="text-primary hover:text-primary-hover">
          Acceptable Use Policy
        </Link>
        .
      </p>

      <p className="mt-4 text-body-sm text-on-surface-muted">
        <Link to="/" className="hover:text-on-surface">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}

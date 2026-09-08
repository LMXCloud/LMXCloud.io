import { SignIn } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router-dom";
import { WalletConnectButton } from "../components/WalletConnectButton";
import { CLERK_PUBLISHABLE_KEY, clerkAppearance } from "../lib/clerk";
import { peekAuthNext } from "../lib/auth-next";

export function SignInPage() {
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
        <p className="mt-1 text-body-sm text-on-surface-muted">Sign in to open your console</p>
      </div>

      {CLERK_PUBLISHABLE_KEY ? (
        <>
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
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

      <p className="mt-6 text-center text-body-sm text-on-surface-muted">
        <Link to="/legal/terms" className="hover:text-on-surface">
          Terms
        </Link>
        {" · "}
        <Link to="/legal/privacy" className="hover:text-on-surface">
          Privacy
        </Link>
        {" · "}
        <Link to="/" className="hover:text-on-surface">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}

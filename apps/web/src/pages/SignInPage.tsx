import { SignIn } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { clerkAppearance } from "../lib/clerk";

export function SignInPage() {
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
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        appearance={clerkAppearance}
      />
      <p className="mt-6 text-body-sm text-on-surface-muted">
        <Link to="/" className="hover:text-on-surface">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}

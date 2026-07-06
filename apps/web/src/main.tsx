import { ClerkProvider } from "@clerk/clerk-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { Card } from "./components/ui/Card";
import { CLERK_PUBLISHABLE_KEY } from "./lib/clerk";

function MissingClerkConfig() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="max-w-md text-center">
        <h1 className="text-title-md text-on-surface">Clerk not configured</h1>
        <p className="mt-2 text-body-sm text-on-surface-muted">
          Set <code className="text-on-surface">VITE_CLERK_PUBLISHABLE_KEY</code> in{" "}
          <code className="text-on-surface">apps/web/.env</code> and restart the dev server.
        </p>
      </Card>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {CLERK_PUBLISHABLE_KEY ? (
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        afterSignInUrl="/auth/callback"
        afterSignUpUrl="/auth/callback"
      >
        <App />
      </ClerkProvider>
    ) : (
      <MissingClerkConfig />
    )}
  </StrictMode>,
);

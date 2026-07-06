import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../context/AuthContext";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { sessionReady, loading, error, retrySession } = useAuth();
  const navigated = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate("/sign-in", { replace: true });
      return;
    }
    if (sessionReady && !navigated.current) {
      navigated.current = true;
      navigate("/console/overview", { replace: true });
    }
  }, [isLoaded, isSignedIn, sessionReady, navigate]);

  if (!isLoaded || loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4">
        <p className="text-body-sm text-on-surface-muted">Connecting to your console…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md" accent="error">
          <h1 className="text-title-md text-on-surface">Could not open console</h1>
          <p className="mt-2 text-body-sm text-error">{error}</p>
          <p className="mt-3 text-body-sm text-on-surface-muted">
            {error.toLowerCase().includes("rate limit")
              ? "Too many requests from this IP. Restart the API (pnpm dev) to clear the dev rate limit, or wait for the window to reset."
              : "Make sure the API is running (pnpm dev) and CLERK_SECRET_KEY is set in the root .env, then restart the API."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void retrySession()}>
              Try again
            </Button>
            <Button to="/" variant="secondary">
              Back to home
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4">
      <p className="text-body-sm text-on-surface-muted">Connecting to your console…</p>
    </div>
  );
}

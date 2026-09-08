import { Navigate } from "react-router-dom";
import { NewAgentQuickstart } from "../components/console/NewAgentQuickstart";
import { PublicLayout } from "../components/PublicLayout";
import { SeoHead } from "../components/SeoHead";
import { useAuth } from "../context/AuthContext";

export function PublicNewAgentPage() {
  const { sessionReady, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-body-sm text-on-surface-muted">Loading…</p>
      </div>
    );
  }

  if (sessionReady) {
    return <Navigate to="/console/agents/new" replace />;
  }

  return (
    <PublicLayout>
      <SeoHead
        title="New agent — LMX Cloud quickstart"
        description="Clone lmx-agent-template, choose a named API key or wallet identity, and run your first agent request on LMX Cloud."
        path="/new-agent"
      />
      <div className="mx-auto max-w-[800px] px-[clamp(20px,4vw,48px)] py-10 sm:py-14">
        <NewAgentQuickstart variant="page" />
      </div>
    </PublicLayout>
  );
}

export function ConsoleNewAgentPage() {
  return <NewAgentQuickstart variant="page" />;
}

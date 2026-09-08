import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useRef } from "react";
import { DashboardLayout } from "./components/DashboardLayout";
import { useAuth } from "./context/AuthContext";
import { CLERK_PUBLISHABLE_KEY } from "./lib/clerk";
import { peekAuthNext, rememberAuthNext } from "./lib/auth-next";
import { NotificationsProvider } from "./hooks/useNotifications";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AgentsPage } from "./pages/AgentsPage";
import { BillingPage } from "./pages/BillingPage";
import { CreditsPage } from "./pages/CreditsPage";
import { KeysPage } from "./pages/KeysPage";
import { DocsPage } from "./pages/DocsPage";
import { LandingPage } from "./pages/LandingPage";
import { LegalPage } from "./pages/LegalPage";
import { StatusPage } from "./pages/StatusPage";
import { LogsPage } from "./pages/LogsPage";
import { ModelsPage } from "./pages/ModelsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ConsoleNewAgentPage, PublicNewAgentPage } from "./pages/NewAgentPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { UsagePage } from "./pages/UsagePage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { sessionReady, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-body-sm text-on-surface-muted">Loading session…</p>
      </div>
    );
  }

  if (!sessionReady) {
    rememberAuthNext(`${window.location.pathname}${window.location.search}`);
    return <Navigate to="/sign-in" replace />;
  }

  return children;
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { sessionReady, loading } = useAuth();
  const nextRef = useRef<string | null>(null);

  if (sessionReady && !loading && nextRef.current === null) {
    nextRef.current = peekAuthNext() ?? "/console/overview";
  }

  if (sessionReady && !loading) {
    return <Navigate to={nextRef.current ?? "/console/overview"} replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/new-agent" element={<PublicNewAgentPage />} />
      <Route path="/legal" element={<Navigate to="/legal/terms" replace />} />
      <Route path="/legal/:doc" element={<LegalPage />} />
      <Route
        path="/auth/callback"
        element={
          CLERK_PUBLISHABLE_KEY ? (
            <AuthCallbackPage />
          ) : (
            <Navigate to="/sign-in" replace />
          )
        }
      />
      <Route
        path="/sign-in/*"
        element={
          <GuestRoute>
            <SignInPage />
          </GuestRoute>
        }
      />
      <Route
        path="/sign-up/*"
        element={
          <GuestRoute>
            <SignUpPage />
          </GuestRoute>
        }
      />
      <Route
        path="/console"
        element={
          <ProtectedRoute>
            <NotificationsProvider>
              <DashboardLayout />
            </NotificationsProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="agents/new" element={<ConsoleNewAgentPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="credits" element={<CreditsPage />} />
        <Route path="billing" element={<BillingPage />} />
      </Route>
      <Route
        path="/demo"
        element={
          <ProtectedRoute>
            <Navigate to="/console/playground" replace />
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<Navigate to="/sign-in" replace />} />
      <Route path="/signup" element={<Navigate to="/sign-up" replace />} />
      <Route path="/overview" element={<Navigate to="/console/overview" replace />} />
      <Route path="/agents" element={<Navigate to="/console/agents" replace />} />
      <Route path="/agents/new" element={<Navigate to="/new-agent" replace />} />
      <Route path="/keys" element={<Navigate to="/console/keys" replace />} />
      <Route path="/projects" element={<Navigate to="/console/projects" replace />} />
      <Route path="/playground" element={<Navigate to="/console/playground" replace />} />
      <Route path="/models" element={<Navigate to="/console/models" replace />} />
      <Route path="/usage" element={<Navigate to="/console/usage" replace />} />
      <Route path="/logs" element={<Navigate to="/console/logs" replace />} />
      <Route path="/notifications" element={<Navigate to="/console/notifications" replace />} />
      <Route path="/credits" element={<Navigate to="/console/credits" replace />} />
      <Route path="/billing" element={<Navigate to="/console/billing" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

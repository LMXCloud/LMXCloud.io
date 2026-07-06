import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "./components/DashboardLayout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { BillingPage } from "./pages/BillingPage";
import { KeysPage } from "./pages/KeysPage";
import { LandingPage } from "./pages/LandingPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { UsagePage } from "./pages/UsagePage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { clerkSignedIn, sessionReady, loading } = useAuth();

  if (!clerkSignedIn) return <Navigate to="/sign-in" replace />;
  if (loading || !sessionReady) return <Navigate to="/auth/callback" replace />;

  return children;
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { sessionReady, loading } = useAuth();

  if (sessionReady && !loading) {
    return <Navigate to="/console/overview" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
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
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="billing" element={<BillingPage />} />
      </Route>
      <Route path="/login" element={<Navigate to="/sign-in" replace />} />
      <Route path="/signup" element={<Navigate to="/sign-up" replace />} />
      <Route path="/overview" element={<Navigate to="/console/overview" replace />} />
      <Route path="/keys" element={<Navigate to="/console/keys" replace />} />
      <Route path="/usage" element={<Navigate to="/console/usage" replace />} />
      <Route path="/billing" element={<Navigate to="/console/billing" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

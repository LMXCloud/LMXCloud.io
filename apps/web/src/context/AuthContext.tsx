import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";
import { exchangeClerkSession } from "../api";
import { readEmail, writeApiKey, writeEmail } from "../lib/storage";

interface AuthContextValue {
  apiKey: string | null;
  email: string;
  loading: boolean;
  error: string | null;
  clerkSignedIn: boolean;
  sessionReady: boolean;
  logout: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [email, setEmailState] = useState(() => readEmail());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exchangingRef = useRef(false);

  const exchangeForApiSession = useCallback(async () => {
    if (exchangingRef.current) return;
    exchangingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error("Could not get Clerk session token");

      const session = await exchangeClerkSession(token);
      setEmailState(session.email);
      writeEmail(session.email);
      setApiKey(session.session_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to establish session");
      setApiKey(null);
      writeApiKey(null);
    } finally {
      exchangingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setApiKey(null);
      writeApiKey(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (apiKey) return;

    void exchangeForApiSession();
  }, [isLoaded, isSignedIn, user?.id, apiKey, exchangeForApiSession]);

  useEffect(() => {
    writeApiKey(apiKey);
  }, [apiKey]);

  const retrySession = useCallback(async () => {
    if (!isSignedIn) return;
    await exchangeForApiSession();
  }, [isSignedIn, exchangeForApiSession]);

  const logout = useCallback(async () => {
    setApiKey(null);
    setError(null);
    writeApiKey(null);
    await signOut();
  }, [signOut]);

  const value = useMemo(
    () => ({
      apiKey,
      email,
      loading: !isLoaded || loading,
      error,
      clerkSignedIn: Boolean(isSignedIn),
      sessionReady: Boolean(isSignedIn && apiKey),
      logout,
      retrySession,
    }),
    [apiKey, email, isLoaded, loading, error, isSignedIn, logout, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

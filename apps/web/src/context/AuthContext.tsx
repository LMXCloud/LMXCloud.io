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
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { exchangeClerkSession, validateSession } from "../api";
import {
  clearAuthStorage,
  readApiKey,
  readAuthMode,
  readEmail,
  readWallet,
  writeApiKey,
  writeAuthMode,
  writeEmail,
  writeWallet,
  type StoredAuthMode,
} from "../lib/storage";

interface AuthContextValue {
  apiKey: string | null;
  email: string;
  wallet: string | null;
  authMode: StoredAuthMode | null;
  loading: boolean;
  error: string | null;
  clerkSignedIn: boolean;
  walletSignedIn: boolean;
  sessionReady: boolean;
  logout: () => Promise<void>;
  retrySession: () => Promise<void>;
  completeWalletSession: (sessionToken: string, walletAddress: string) => void;
  /** Attach a verified funding wallet to the current email (Clerk) session. */
  setLinkedWallet: (walletAddress: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function ClerkAuthEffects() {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { apiKey, authMode, exchangeClerk, clearWalletSession } = useAuthInternals();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (authMode === "wallet") return;
    if (apiKey) return;
    void exchangeClerk(getToken);
  }, [isLoaded, isSignedIn, apiKey, authMode, getToken, exchangeClerk]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn && authMode === "clerk") {
      clearWalletSession();
    }
  }, [isLoaded, isSignedIn, authMode, clearWalletSession]);

  return null;
}

interface AuthInternals extends AuthContextValue {
  exchangeClerk: (getToken: () => Promise<string | null>) => Promise<void>;
  clearWalletSession: () => void;
}

const AuthInternalsContext = createContext<AuthInternals | null>(null);

function useAuthInternals(): AuthInternals {
  const ctx = useContext(AuthInternalsContext);
  if (!ctx) throw new Error("Auth internals missing");
  return ctx;
}

export function AuthProvider({
  children,
  clerkEnabled,
}: {
  children: ReactNode;
  clerkEnabled: boolean;
}) {
  const [apiKey, setApiKey] = useState<string | null>(() => readApiKey());
  const [email, setEmailState] = useState(() => readEmail());
  const [wallet, setWallet] = useState<string | null>(() => readWallet());
  const [authMode, setAuthMode] = useState<StoredAuthMode | null>(() => readAuthMode());
  const [loading, setLoading] = useState(() => Boolean(readApiKey()));
  const [error, setError] = useState<string | null>(null);
  const exchangingRef = useRef(false);
  const restoredRef = useRef(false);

  const clearWalletSession = useCallback(() => {
    setApiKey(null);
    setWallet(null);
    setAuthMode(null);
    writeApiKey(null);
    writeWallet(null);
    writeAuthMode(null);
    setError(null);
  }, []);

  const completeWalletSession = useCallback((sessionToken: string, walletAddress: string) => {
    setApiKey(sessionToken);
    setWallet(walletAddress);
    setAuthMode("wallet");
    setEmailState("");
    writeApiKey(sessionToken);
    writeWallet(walletAddress);
    writeAuthMode("wallet");
    writeEmail("");
    setError(null);
  }, []);

  const setLinkedWallet = useCallback((walletAddress: string) => {
    setWallet(walletAddress);
    writeWallet(walletAddress);
  }, []);

  const exchangeClerk = useCallback(async (getToken: () => Promise<string | null>) => {
    if (exchangingRef.current) return;
    exchangingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Could not get Clerk session token");

      const session = await exchangeClerkSession(token);
      if (!session.email) throw new Error("Clerk session did not return an email");

      setEmailState(session.email);
      writeEmail(session.email);
      const linkedWallet = session.wallet?.trim() ? session.wallet.trim() : null;
      writeWallet(linkedWallet);
      setWallet(linkedWallet);
      setAuthMode("clerk");
      writeAuthMode("clerk");
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
    if (restoredRef.current) return;
    restoredRef.current = true;

    const storedKey = readApiKey();
    const storedMode = readAuthMode();
    if (!storedKey || storedMode !== "wallet") {
      setLoading(false);
      return;
    }

    void validateSession(storedKey)
      .then(() => {
        setLoading(false);
      })
      .catch(() => {
        clearAuthStorage();
        setApiKey(null);
        setWallet(null);
        setAuthMode(null);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    writeApiKey(apiKey);
  }, [apiKey]);

  const retrySession = useCallback(async () => {
    if (authMode === "wallet" && apiKey) {
      setLoading(true);
      setError(null);
      try {
        await validateSession(apiKey);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to validate session");
        clearWalletSession();
      } finally {
        setLoading(false);
      }
      return;
    }

    if (clerkEnabled) {
      setApiKey(null);
      writeApiKey(null);
      setError(null);
    }
  }, [authMode, apiKey, clerkEnabled, clearWalletSession]);

  const logout = useCallback(async () => {
    clearAuthStorage();
    setApiKey(null);
    setEmailState("");
    setWallet(null);
    setAuthMode(null);
    setError(null);
  }, []);

  const clerkSignedIn = authMode === "clerk" && Boolean(apiKey);
  const walletSignedIn = authMode === "wallet" && Boolean(apiKey);
  const sessionReady = Boolean(apiKey);

  const value = useMemo<AuthInternals>(
    () => ({
      apiKey,
      email,
      wallet,
      authMode,
      loading,
      error,
      clerkSignedIn,
      walletSignedIn,
      sessionReady,
      logout,
      retrySession,
      completeWalletSession,
      setLinkedWallet,
      exchangeClerk,
      clearWalletSession,
    }),
    [
      apiKey,
      email,
      wallet,
      authMode,
      loading,
      error,
      clerkSignedIn,
      walletSignedIn,
      sessionReady,
      logout,
      retrySession,
      completeWalletSession,
      setLinkedWallet,
      exchangeClerk,
      clearWalletSession,
    ],
  );

  return (
    <AuthInternalsContext.Provider value={value}>
      <AuthContext.Provider value={value}>
        {clerkEnabled ? <ClerkAuthEffects /> : null}
        {children}
      </AuthContext.Provider>
    </AuthInternalsContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

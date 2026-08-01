import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PlanCode } from "@/lib/quota";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

function isDefinitiveAuthFailure(status: number) {
  return status === 401 || status === 403;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    AUTH_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  plan?: PlanCode;
  role?: "user" | "support" | "finance" | "admin" | "super_admin";
  accountStatus?: "active" | "blocked";
  organization?: string;
  jobRole?: string;
  usagePurpose?: string;
  preferredLanguage?: string;
  onboardingCompleted?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  token: string | null;
  setToken: (token: string, user?: User) => Promise<boolean>;
  updateUser: (partial: Partial<User>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  token: null,
  setToken: async () => false,
  updateUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setTokenState] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const userRef = useRef<User | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const fetchUser = useCallback(async (authToken: string) => {
    setIsLoading(true);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (isDefinitiveAuthFailure(res.status)) {
        setTokenState(null);
        setUser(null);
        return false;
      }
      if (!res.ok) throw new Error("auth service temporarily unavailable");
      const data = (await res.json()) as User;
      setUser(data);
      userRef.current = data;
      return true;
    } catch {
      // Keep the current session during timeouts and temporary 5xx responses.
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshSession = useCallback(({ showLoading = false } = {}) => {
    if (refreshInFlight.current) return refreshInFlight.current;
    if (showLoading) setIsLoading(true);

    const run = async () => {
      try {
        const requestRefresh = () =>
          fetchWithTimeout(`${API_URL}/api/auth/refresh`, {
            method: "POST",
            credentials: "include",
          });
        let res = await requestRefresh();
        let data = (await res.json().catch(() => ({}))) as {
          token?: string;
          user?: User;
          retry?: boolean;
        };
        if (res.status === 409 && data.retry) {
          await new Promise((resolve) => window.setTimeout(resolve, 300));
          res = await requestRefresh();
          data = (await res.json().catch(() => ({}))) as typeof data;
        }
        if (isDefinitiveAuthFailure(res.status)) {
          setTokenState(null);
          setUser(null);
          return false;
        }
        if (!res.ok || !data.token || !data.user) {
          throw new Error("auth service temporarily unavailable");
        }
        setTokenState(data.token);
        setUser(data.user);
        return true;
      } catch {
        return Boolean(userRef.current && tokenRef.current);
      } finally {
        if (showLoading) setIsLoading(false);
      }
    };

    refreshInFlight.current = run().finally(() => {
      refreshInFlight.current = null;
    });
    return refreshInFlight.current;
  }, []);

  async function setToken(newToken: string, sessionUser?: User) {
    setTokenState(newToken);
    tokenRef.current = newToken;
    if (sessionUser) {
      setUser(sessionUser);
      userRef.current = sessionUser;
      setIsLoading(false);
      return true;
    }
    return fetchUser(newToken);
  }

  function updateUser(partial: Partial<User>) {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function logout() {
    const currentToken = token;
    void fetchWithTimeout(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: currentToken
        ? { Authorization: `Bearer ${currentToken}` }
        : undefined,
    }).catch(() => {});
    setTokenState(null);
    setUser(null);
  }

  useEffect(() => {
    localStorage.removeItem("auth_token");
    void refreshSession({ showLoading: true });
  }, [refreshSession]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(
      () => void refreshSession(),
      TOKEN_REFRESH_INTERVAL_MS,
    );
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user, refreshSession]);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, token, setToken, updateUser, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

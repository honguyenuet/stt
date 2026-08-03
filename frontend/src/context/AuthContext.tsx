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
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const ACCOUNT_STATUS_CHECK_INTERVAL_MS = 60 * 1000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

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

interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  plan?: PlanCode;
  role?: "user" | "support" | "admin";
  accountStatus?: "active" | "suspended" | "deleted";
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  token: string | null;
  setToken: (token: string) => void;
  updateUser: (partial: Partial<User>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  token: null,
  setToken: () => {},
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

  const clearSession = useCallback(() => {
    setTokenState(null);
    setUser(null);
  }, []);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

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
        if (res.status === 401 || res.status === 403) {
          clearSession();
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
  }, [clearSession]);

  const fetchUser = useCallback(
    async (authToken: string, showLoading = true) => {
      if (showLoading) setIsLoading(true);
      try {
        const res = await fetchWithTimeout(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.status === 403) {
          clearSession();
          return;
        }
        if (res.status === 401) {
          await refreshSession();
          return;
        }
        if (!res.ok) throw new Error("auth service temporarily unavailable");
        const data = (await res.json()) as User;
        setUser(data);
      } catch {
        // Keep the current session during timeouts and temporary 5xx responses.
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [clearSession, refreshSession],
  );

  function setToken(newToken: string) {
    setTokenState(newToken);
    void fetchUser(newToken);
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

  useEffect(() => {
    if (!user || !token) return;
    const checkAccountStatus = () => {
      const currentToken = tokenRef.current;
      if (currentToken) void fetchUser(currentToken, false);
    };
    const timer = window.setInterval(
      checkAccountStatus,
      ACCOUNT_STATUS_CHECK_INTERVAL_MS,
    );
    window.addEventListener("focus", checkAccountStatus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkAccountStatus);
    };
  }, [fetchUser, token, user]);

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

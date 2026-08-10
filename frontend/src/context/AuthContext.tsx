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
const DEFAULT_TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const MIN_TOKEN_REFRESH_DELAY_MS = 30_000;
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

export interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  plan?: PlanCode;
  role?: "user" | "support" | "finance" | "admin" | "super_admin";
  accountStatus?: "active" | "blocked" | "suspended" | "deleted";
  emailVerified?: boolean;
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
  setToken: (token: string, user?: User, expiresIn?: number) => void;
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
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const userRef = useRef<User | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tokenExpiresAtRef = useRef<number | null>(null);

  const clearSession = useCallback(() => {
    setTokenState(null);
    setTokenExpiresAt(null);
    setUser(null);
    tokenRef.current = null;
    tokenExpiresAtRef.current = null;
    userRef.current = null;
  }, []);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    tokenExpiresAtRef.current = tokenExpiresAt;
  }, [tokenExpiresAt]);

  const getTokenExpiresAt = useCallback((authToken: string, expiresIn?: number) => {
    if (Number.isFinite(expiresIn) && Number(expiresIn) > 0) {
      return Date.now() + Number(expiresIn) * 1000;
    }
    try {
      const payload = JSON.parse(window.atob(authToken.split(".")[1] || ""));
      const exp = Number(payload.exp);
      return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
    } catch {
      return null;
    }
  }, []);

  const applySession = useCallback((nextToken: string, nextUser?: User, expiresIn?: number) => {
    const expiresAt = getTokenExpiresAt(nextToken, expiresIn);
    setTokenState(nextToken);
    setTokenExpiresAt(expiresAt);
    tokenRef.current = nextToken;
    tokenExpiresAtRef.current = expiresAt;
    if (nextUser) {
      setUser(nextUser);
      userRef.current = nextUser;
    }
  }, [getTokenExpiresAt]);

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
          expiresIn?: number;
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
        applySession(data.token, data.user, data.expiresIn);
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
  }, [applySession, clearSession]);

  const fetchUser = useCallback(
    async (authToken: string, showLoading = true) => {
      if (showLoading) setIsLoading(true);
      try {
        const requestMe = (activeToken: string) =>
          fetchWithTimeout(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${activeToken}` },
          });
        let res = await requestMe(authToken);
        if (res.status === 403) {
          clearSession();
          return;
        }
        if (res.status === 401) {
          const refreshed = await refreshSession();
          const refreshedToken = tokenRef.current;
          if (!refreshed || !refreshedToken || refreshedToken === authToken) {
            return;
          }
          res = await requestMe(refreshedToken);
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

  function setToken(newToken: string, nextUser?: User, expiresIn?: number) {
    applySession(newToken, nextUser, expiresIn);
    if (!nextUser) void fetchUser(newToken);
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
    clearSession();
  }

  useEffect(() => {
    localStorage.removeItem("auth_token");
    void refreshSession({ showLoading: true });
  }, [refreshSession]);

  useEffect(() => {
    if (!user) return;
    const expiresAt = tokenExpiresAtRef.current;
    const refreshDelay = expiresAt
      ? Math.max(
          MIN_TOKEN_REFRESH_DELAY_MS,
          expiresAt - Date.now() - 60_000,
        )
      : DEFAULT_TOKEN_REFRESH_INTERVAL_MS;
    const timer = window.setTimeout(
      () => void refreshSession(),
      refreshDelay,
    );
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user, tokenExpiresAt, refreshSession]);

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

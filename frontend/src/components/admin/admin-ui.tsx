import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardList,
  FileAudio,
  Gauge,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import { useAuth } from "@/context/AuthContext";
import {
  exchangeAdminSession,
  logoutAdmin,
  readAdminSession,
  validateAdminSession,
} from "@/lib/admin/admin-auth";
import {
  jobStatusLabel,
  storageStatusLabel,
  userStatusLabel,
} from "@/lib/admin/formatters";
import { listSupportTickets } from "@/lib/admin/support-service";
import { useAdminSession } from "@/lib/admin/use-admin-session";
import type {
  AdminRole,
  AdminSession,
  JobStatus,
  StorageStatus,
  UserStatus,
} from "@/lib/admin/types";

type CmsNavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: readonly string[];
};

const adminRoles = ["admin"] as const;
const navItems: readonly CmsNavItem[] = [
  { to: "/admin", label: "Tổng quan", icon: LayoutDashboard, roles: adminRoles },
  { to: "/admin/users", label: "Người dùng", icon: Users, roles: adminRoles },
  { to: "/admin/jobs", label: "Job chuyển giọng nói", icon: Activity, roles: adminRoles },
  { to: "/admin/files", label: "Tệp âm thanh", icon: FileAudio, roles: adminRoles },
  { to: "/admin/plans", label: "Gói dịch vụ", icon: SlidersHorizontal, roles: adminRoles },
  { to: "/admin/providers", label: "Nhà cung cấp API", icon: Shield, roles: adminRoles },
  { to: "/admin/usage", label: "Sử dụng & quota", icon: Gauge, roles: adminRoles },
  { to: "/admin/reports", label: "Báo cáo", icon: BarChart3, roles: adminRoles },
  {
    to: "/admin/support",
    label: "Phản hồi hỗ trợ",
    icon: MessageSquare,
    roles: ["admin", "supporter"],
  },
  { to: "/admin/audit-logs", label: "Nhật ký kiểm toán", icon: ClipboardList, roles: adminRoles },
  { to: "/admin/settings", label: "Cài đặt", icon: Settings, roles: adminRoles },
];

const roleDisplay: Record<AdminRole, string> = {
  admin: "Administrator",
  supporter: "Support agent",
  user: "User",
};

export function AdminRouteShell() {
  const location = useLocation();
  if (location.pathname === "/admin/login") return <Outlet />;
  return (
    <AdminGuard>
      <AdminLayout>
        <Outlet />
        <Toaster />
      </AdminLayout>
    </AdminGuard>
  );
}

function AdminGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isLoading, token } = useAuth();
  const [session, setSession] = useState<AdminSession | null>(() =>
    readAdminSession(),
  );
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    async function ensureAdminSession() {
      const current = readAdminSession();
      try {
        if (current) {
          const { user } = await validateAdminSession();
          if (active) setSession({ ...current, user });
          return;
        }
        if (isLoading) return;
        if (!token) {
          void navigate({
            to: "/admin/login",
            search: { from: window.location.pathname },
          });
          return;
        }
        const nextSession = await exchangeAdminSession(token);
        if (active) setSession(nextSession);
      } catch {
        if (!active) return;
        logoutAdmin();
        setSession(null);
        void navigate({
          to: "/admin/login",
          search: { from: window.location.pathname },
        });
      } finally {
        if (active && !isLoading) setChecking(false);
      }
    }

    void ensureAdminSession();
    return () => {
      active = false;
    };
  }, [isLoading, navigate, token]);

  if (checking || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-950">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }
  return <>{children}</>;
}

function AdminLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAdminSession();
  const [openSupportCount, setOpenSupportCount] = useState(0);
  const visibleNavItems = useMemo(
    () =>
      navItems.filter((item) =>
        item.roles.includes((session?.user.role || "user") as AdminRole),
      ),
    [session?.user.role],
  );
  const current = useMemo(() => {
    const found = [...visibleNavItems]
      .reverse()
      .find(
        (item) =>
          location.pathname === item.to ||
          location.pathname.startsWith(`${item.to}/`),
      );
    return found ?? visibleNavItems[0] ?? navItems[0];
  }, [location.pathname, visibleNavItems]);

  function handleLogout() {
    logoutAdmin();
    void navigate({ to: "/admin/login", search: { from: "/admin" } });
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function loadOpenSupportCount() {
      try {
        const result = await listSupportTickets({
          page: 1,
          limit: 1,
          status: "open",
        });
        if (!cancelled) setOpenSupportCount(result.total);
      } catch {
        if (!cancelled) setOpenSupportCount(0);
      }
    }

    void loadOpenSupportCount();
    const timer = window.setInterval(() => void loadOpenSupportCount(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    if (session?.user.role !== "supporter") return;
    if (location.pathname !== "/admin/support") {
      void navigate({ to: "/admin/support" });
    }
  }, [location.pathname, navigate, session?.user.role]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200 bg-white lg:block">
        <Link
          to="/dashboard"
          aria-label="Về Không gian làm việc"
          className="flex h-16 items-center gap-3 border-b border-slate-200 px-5 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        >
          <VbeeBrandLogo size="compact" className="h-9" />
          <div>
            <p className="text-sm font-black text-slate-950">Vbee Admin</p>
            <p className="text-xs font-medium text-slate-500">Operations console</p>
          </div>
        </Link>
        <nav className="space-y-0.5 p-3">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = current.to === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition ${
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                {active && (
                  <span className="absolute left-0 h-6 w-1 rounded-r-full bg-indigo-600" />
                )}
                <span
                  className={`grid h-8 w-8 place-items-center rounded-md ${
                    active
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "bg-transparent text-slate-500 group-hover:bg-white group-hover:text-slate-700"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1">{item.label}</span>
                {item.to === "/admin/support" && openSupportCount > 0 && (
                  <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-black leading-none text-white">
                    {openSupportCount > 99 ? "99+" : openSupportCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-3 bottom-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Signed in
          </p>
          <p className="mt-1 truncate text-sm font-black text-slate-950">
            {session?.user.name}
          </p>
          <p className="truncate text-xs text-slate-500">{session?.user.email}</p>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-16 flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Admin console / {current.label}
              </div>
              <h1 className="mt-1 text-xl font-black tracking-tight text-slate-950">
                {current.label}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="relative grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                title="Thông báo"
              >
                <Bell className="h-4 w-4" />
                {openSupportCount > 0 && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
                )}
              </button>
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="font-bold text-slate-950">{session?.user.name}</span>
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-black uppercase text-slate-600">
                  {roleDisplay[(session?.user.role || "user") as AdminRole]}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Đăng xuất
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto border-t border-slate-200 px-4 py-2 lg:hidden">
            {visibleNavItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-bold ${
                  current.to === item.to
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

export function AdminPanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-black tracking-tight text-slate-950">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function PageState({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string;
  empty?: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-slate-300 bg-white">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm font-bold text-slate-500">
            Đang tải dữ liệu...
          </p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
        <p className="font-bold">Không tải được dữ liệu</p>
        <p className="mt-1 text-sm">{error}</p>
        <button
          onClick={onRetry}
          className="mt-4 rounded-md bg-red-700 px-3 py-2 text-sm font-bold text-white"
        >
          Thử lại
        </button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="font-black text-slate-950">Không có dữ liệu</p>
        <p className="mt-1 text-sm text-slate-500">
          Thử đổi bộ lọc hoặc tải lại trang.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function StatusBadge({
  status,
}: {
  status: JobStatus | UserStatus | StorageStatus;
}) {
  const tone =
    status === "completed" || status === "active" || status === "available"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : status === "failed" ||
          status === "suspended" ||
          status === "error" ||
          status === "missing"
        ? "bg-red-50 text-red-700 ring-1 ring-red-200"
        : status === "processing" || status === "queued"
          ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
          : "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  const label =
    status in jobStatusLabel
      ? jobStatusLabel[status as JobStatus]
      : status in userStatusLabel
        ? userStatusLabel[status as UserStatus]
        : storageStatusLabel[status as StorageStatus];
  return (
    <span
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-black leading-none ${tone}`}
    >
      {label}
    </span>
  );
}

export function Pager({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-200 p-3">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
      >
        Trước
      </button>
      <span className="text-sm font-bold text-slate-500">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
      >
        Sau
      </button>
    </div>
  );
}

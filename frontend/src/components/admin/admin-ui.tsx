import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  ClipboardList,
  FileAudio,
  Gauge,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import {
  logoutAdmin,
  readAdminSession,
  validateAdminSession,
} from "@/lib/admin/admin-auth";
import {
  jobStatusLabel,
  storageStatusLabel,
  userStatusLabel,
} from "@/lib/admin/formatters";
import { useAdminSession } from "@/lib/admin/use-admin-session";
import type {
  AdminSession,
  JobStatus,
  StorageStatus,
  UserStatus,
} from "@/lib/admin/types";

const navItems = [
  { to: "/admin", label: "Tổng quan", icon: LayoutDashboard },
  { to: "/admin/users", label: "Người dùng", icon: Users },
  { to: "/admin/jobs", label: "Job chuyển giọng nói", icon: Activity },
  { to: "/admin/files", label: "Tệp âm thanh", icon: FileAudio },
  { to: "/admin/plans", label: "Gói dịch vụ", icon: SlidersHorizontal },
  { to: "/admin/providers", label: "Nhà cung cấp API", icon: Shield },
  { to: "/admin/usage", label: "Sử dụng & quota", icon: Gauge },
  { to: "/admin/reports", label: "Báo cáo", icon: BarChart3 },
  { to: "/admin/audit-logs", label: "Nhật ký kiểm toán", icon: ClipboardList },
  { to: "/admin/settings", label: "Cài đặt", icon: Settings },
] as const;

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
  const [session, setSession] = useState<AdminSession | null>(() =>
    readAdminSession(),
  );
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const current = readAdminSession();
    if (!current) {
      setChecking(false);
      void navigate({
        to: "/admin/login",
        search: { from: window.location.pathname },
      });
      return () => {
        active = false;
      };
    }
    void validateAdminSession()
      .then(({ user }) => {
        if (!active) return;
        setSession({ ...current, user });
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        void navigate({
          to: "/admin/login",
          search: { from: window.location.pathname },
        });
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (checking || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f4ec] text-[#21104a]">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#ffcb05] border-t-transparent" />
      </div>
    );
  }
  return <>{children}</>;
}

function AdminLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAdminSession();
  const current = useMemo(() => {
    const found = [...navItems]
      .reverse()
      .find(
        (item) =>
          location.pathname === item.to ||
          location.pathname.startsWith(`${item.to}/`),
      );
    return found ?? navItems[0];
  }, [location.pathname]);

  function handleLogout() {
    logoutAdmin();
    void navigate({ to: "/admin/login", search: { from: "/admin" } });
  }

  return (
    <div className="min-h-screen bg-[#f7f4ec] text-[#21104a]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-[#e4ddcf] bg-white lg:block">
        <Link
          to="/dashboard"
          aria-label="Về Không gian làm việc"
          className="flex h-16 items-center gap-3 border-b border-[#e4ddcf] px-5 transition hover:bg-[#fbf8ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ffcb05]"
        >
          <VbeeBrandLogo size="compact" className="h-9" />
          <div>
            <p className="text-sm font-black">Vbee CMS</p>
            <p className="text-xs text-[#756894]">Cổng quản trị</p>
          </div>
        </Link>
        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = current.to === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition ${
                  active
                    ? "bg-[#21104a] text-white"
                    : "text-[#574875] hover:bg-[#f3ead5] hover:text-[#21104a]"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-[#e4ddcf] bg-white/90 backdrop-blur">
          <div className="flex min-h-16 flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-[#8a7100]">
                Quản trị / {current.label}
              </div>
              <h1 className="mt-1 text-xl font-black">{current.label}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-md border border-[#e4ddcf] bg-[#fbf8ef] px-3 py-2 text-sm">
                <span className="font-bold">{session?.user.name}</span>
                <span className="ml-2 text-xs uppercase text-[#756894]">
                  {session?.user.role}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-md border border-[#e4ddcf] bg-white px-3 py-2 text-sm font-bold hover:bg-[#fbf8ef]"
              >
                <LogOut className="h-4 w-4" />
                Đăng xuất
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto border-t border-[#efe7d8] px-4 py-2 lg:hidden">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-bold ${
                  current.to === item.to
                    ? "bg-[#21104a] text-white"
                    : "bg-[#fbf8ef] text-[#574875]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>
        <main className="px-4 py-5 md:px-6">{children}</main>
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
      className={`rounded-lg border border-[#e4ddcf] bg-white shadow-sm ${className}`}
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
    <div className="flex flex-col gap-3 border-b border-[#efe7d8] p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-black">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-[#756894]">{description}</p>
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
      <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-[#e4ddcf] bg-white">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#ffcb05] border-t-transparent" />
          <p className="text-sm font-bold text-[#756894]">
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
      <div className="rounded-lg border border-dashed border-[#e4ddcf] bg-white p-8 text-center">
        <p className="font-black">Không có dữ liệu</p>
        <p className="mt-1 text-sm text-[#756894]">
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
      ? "bg-emerald-100 text-emerald-800"
      : status === "failed" ||
          status === "suspended" ||
          status === "error" ||
          status === "missing"
        ? "bg-red-100 text-red-800"
        : status === "processing" || status === "queued"
          ? "bg-blue-100 text-blue-800"
          : "bg-slate-100 text-slate-700";
  const label =
    status in jobStatusLabel
      ? jobStatusLabel[status as JobStatus]
      : status in userStatusLabel
        ? userStatusLabel[status as UserStatus]
        : storageStatusLabel[status as StorageStatus];
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tone}`}
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
    <div className="flex items-center justify-end gap-2 border-t border-[#efe7d8] p-3">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm font-bold disabled:opacity-40"
      >
        Trước
      </button>
      <span className="text-sm font-bold text-[#756894]">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm font-bold disabled:opacity-40"
      >
        Sau
      </button>
    </div>
  );
}

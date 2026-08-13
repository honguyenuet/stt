import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  Pencil,
  PlugZap,
  Radio,
  ShieldCheck,
  Upload,
  User,
} from "lucide-react";
import { AppIcon } from "@/components/ui/app-icon";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import { useAuth } from "@/context/AuthContext";
import { fetchQuota, formatQuotaTime, type QuotaStatus } from "@/lib/quota";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_ITEMS = [
  { to: "/upload", label: "Tải tệp lên", icon: Upload },
  { to: "/record", label: "Ghi âm", icon: Mic },
  { to: "/realtime", label: "Realtime", icon: Radio },
  { to: "/history", label: "Lịch sử", icon: History },
  { to: "/api", label: "API", icon: PlugZap },
] as const;

type AuthenticatedHeaderProps = {
  onEditProfile?: () => void;
};

export function AuthenticatedHeader({ onEditProfile }: AuthenticatedHeaderProps = {}) {
  const { user, token, logout } = useAuth();
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const canAccessCms = ["supporter", "admin"].includes(
    user?.role || "user",
  );

  useEffect(() => {
    if (!token) {
      setQuota(null);
      return;
    }
    let cancelled = false;
    const loadQuota = async () => {
      try {
        const nextQuota = await fetchQuota(token);
        if (!cancelled) setQuota(nextQuota);
      } catch {
        if (!cancelled) setQuota(null);
      }
    };
    void loadQuota();
    const timer = window.setInterval(() => void loadQuota(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, pathname]);

  if (!user) return null;

  const initials =
    `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();

  function handleLogout() {
    logout();
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[#e8decc] bg-white/92 text-[#21104a] shadow-[0_8px_28px_rgba(33,16,74,.05)] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 md:px-6">
        <Link to="/" className="flex items-center" aria-label="Về trang chủ Vbee">
          <VbeeBrandLogo size="compact" />
        </Link>

        <div className="hidden items-center gap-1 text-sm md:flex">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold transition ${
                  active
                    ? "bg-[#21104a] text-white"
                    : "text-[#65587c] hover:bg-[#fbf8ef] hover:text-[#21104a]"
                }`}
              >
                <AppIcon icon={Icon} size="sm" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full border border-[#e8decc] bg-white px-2 py-1 transition hover:bg-[#fbf8ef] focus:outline-none focus:ring-2 focus:ring-[#ffcb05]/50">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt="avatar"
                    className="h-7 w-7 rounded-full object-cover ring-1 ring-[#ffcb05]/50"
                  />
                ) : (
                  <span className="flex h-7 w-7 select-none items-center justify-center rounded-full bg-[#ffcb05] text-xs font-bold text-[#21104a]">
                    {initials}
                  </span>
                )}
                <span className="hidden max-w-[120px] truncate text-sm font-bold text-[#21104a] sm:block">
                  {user.firstName} {user.lastName}
                </span>
                <AppIcon icon={User} size="sm" className="text-[#756894]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 rounded-xl border-[#e8decc] bg-white text-[#21104a]"
            >
              <DropdownMenuLabel className="pb-1">
                <p className="text-sm font-semibold text-[#21104a]">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-xs font-normal text-[#756894]">
                  {user.email}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="gap-2 cursor-pointer">
                <Link to="/dashboard">
                  <AppIcon icon={LayoutDashboard} size="sm" className="text-[#21104a]" />
                  Không gian làm việc
                </Link>
              </DropdownMenuItem>
              {canAccessCms && (
                <DropdownMenuItem asChild className="gap-2 cursor-pointer">
                  <Link to="/admin">
                    <AppIcon icon={ShieldCheck} size="sm" className="text-[#21104a]" />
                    Trung tâm quản trị
                  </Link>
                </DropdownMenuItem>
              )}
              {onEditProfile && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onSelect={onEditProfile}
                  >
                    <AppIcon icon={Pencil} size="sm" className="text-[#21104a]" />
                    Chỉnh sửa thông tin
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 cursor-pointer text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
                onSelect={handleLogout}
              >
                <AppIcon icon={LogOut} size="sm" />
                Đăng xuất
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e8decc] bg-white text-[#21104a] transition hover:bg-[#fbf8ef] md:hidden"
                aria-label="Mở menu điều hướng"
              >
                <AppIcon icon={Menu} size="md" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 rounded-xl border-[#e8decc] bg-white text-[#21104a] md:hidden"
            >
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem
                    asChild
                    key={item.to}
                    className="gap-2 cursor-pointer"
                  >
                    <Link to={item.to}>
                      <AppIcon icon={Icon} size="sm" className="text-[#21104a]" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <div className="grid grid-cols-5 border-t border-[#e8decc] bg-white md:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center gap-1 px-2 py-1.5 text-[11px] font-bold transition ${
                active ? "bg-[#fbf8ef] text-[#21104a]" : "text-[#756894]"
              }`}
            >
              <AppIcon icon={Icon} size="sm" />
              {item.label}
            </Link>
          );
        })}
      </div>
      {(quota?.shouldAlert || quota?.isLimitReached) && (
        <div
          role="status"
          className={`border-t px-4 py-2 text-center text-xs font-bold ${
            quota.isLimitReached
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-[#ffcb05]/40 bg-[#fff8d7] text-[#21104a]"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <AppIcon icon={AlertTriangle} size="sm" />
            {quota.isLimitReached
              ? "Bạn đã hết thời lượng sử dụng."
              : `Bạn chỉ còn ${formatQuotaTime(quota.remainingSeconds)} xử lý.`}
            <Link to="/pricing" className="underline underline-offset-2">
              Xem gói cước
            </Link>
          </span>
        </div>
      )}
    </header>
  );
}

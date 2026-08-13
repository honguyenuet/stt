import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
} from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import {
  DESKTOP_WORKSPACE_NAV_ITEMS,
  MOBILE_MORE_NAV_ITEMS,
  PRIMARY_MOBILE_NAV_ITEMS,
  canAccessWorkspaceCms,
  getActiveWorkspaceNavItem,
} from "@/components/workspace/workspace-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { fetchQuota, formatQuotaTime, type QuotaStatus } from "@/lib/quota";

type AuthenticatedHeaderProps = {
  onEditProfile?: () => void;
};

export function AuthenticatedHeader({ onEditProfile }: AuthenticatedHeaderProps = {}) {
  const { user, token, logout } = useAuth();
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const activeItem = getActiveWorkspaceNavItem(pathname);
  const canAccessCms = canAccessWorkspaceCms(user?.role);

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
  const moreMenuIsActive = MOBILE_MORE_NAV_ITEMS.some(
    (item) => item.to === activeItem?.to,
  );

  function handleLogout() {
    logout();
    window.location.href = "/login";
  }

  const accountMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 items-center gap-2 rounded-lg border border-[#e5e0f0] bg-white px-1.5 text-[#21104a] transition hover:bg-[#f7f5ff] focus:outline-none"
          aria-label={`Mở tài khoản của ${user.firstName} ${user.lastName}`}
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="h-7 w-7 rounded-md object-cover"
            />
          ) : (
            <span className="flex h-7 w-7 select-none items-center justify-center rounded-md bg-[#ffcb05] text-xs font-black text-[#21104a]">
              {initials}
            </span>
          )}
          <span className="hidden max-w-28 truncate text-xs font-bold sm:block">
            {user.firstName}
          </span>
          <AppIcon
            icon={ChevronDown}
            size="sm"
            className="hidden text-[#756894] sm:block"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 rounded-lg border-[#e5e0f0] bg-white text-[#21104a]"
      >
        <DropdownMenuLabel className="pb-1">
          <p className="text-sm font-semibold">
            {user.firstName} {user.lastName}
          </p>
          <p className="truncate text-xs font-normal text-[#756894]">
            {user.email}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <Link to="/dashboard">
            <AppIcon icon={LayoutDashboard} size="sm" />
            Không gian làm việc
          </Link>
        </DropdownMenuItem>
        {canAccessCms && (
          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link to="/admin">
              <AppIcon icon={ShieldCheck} size="sm" />
              Trung tâm quản trị
            </Link>
          </DropdownMenuItem>
        )}
        {onEditProfile && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={onEditProfile}
            >
              <AppIcon icon={Pencil} size="sm" />
              Chỉnh sửa thông tin
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer gap-2 text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
          onSelect={handleLogout}
        >
          <AppIcon icon={LogOut} size="sm" />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <aside
        className="fixed inset-y-0 left-0 z-50 hidden w-[72px] flex-col border-r border-white/10 bg-[#21104a] text-white lg:flex"
        aria-label="Điều hướng không gian làm việc"
        data-desktop-workspace-rail
      >
        <Link
          to="/dashboard"
          className="flex h-14 items-center justify-center border-b border-white/10 px-2"
          aria-label="Vbee AIVoice - Không gian làm việc"
        >
          <VbeeBrandLogo size="compact" className="h-7 max-w-12" />
        </Link>

        <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
          {DESKTOP_WORKSPACE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeItem?.to === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-bold leading-tight transition ${
                  active
                    ? "bg-[#ffcb05] text-[#21104a]"
                    : "text-[#d8d0e9] hover:bg-white/10 hover:text-white"
                }`}
              >
                <AppIcon icon={Icon} size="md" />
                <span className="max-w-full truncate">{item.shortLabel}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <header
        className="sticky top-0 z-40 flex h-14 items-center border-b border-[#e5e0f0] bg-white/95 px-3 text-[#21104a] backdrop-blur-xl sm:px-4"
        data-workspace-shell
      >
        <Link
          to="/dashboard"
          className="flex items-center lg:hidden"
          aria-label="Về không gian làm việc"
        >
          <VbeeBrandLogo size="compact" className="h-8 max-w-[120px]" />
        </Link>

        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-sm font-black">
            {activeItem?.label ?? "Không gian làm việc"}
          </p>
          <p className="text-[11px] text-[#756894]">
            Không gian làm việc sẵn sàng
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {quota && (
            <Link
              to="/pricing"
              title={`Còn ${formatQuotaTime(quota.remainingSeconds)} xử lý`}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-2 text-xs font-bold transition hover:bg-[#f7f5ff] ${
                quota.isLimitReached
                  ? "border-red-200 bg-red-50 text-red-700"
                  : quota.shouldAlert
                    ? "border-[#ffcb05]/60 bg-[#fff8d7] text-[#21104a]"
                    : "border-[#e5e0f0] bg-white text-[#65587c]"
              }`}
            >
              <AppIcon
                icon={quota.shouldAlert ? AlertTriangle : Clock3}
                size="sm"
              />
              <span className="hidden sm:inline">
                {quota.isLimitReached
                  ? "Hết thời lượng"
                  : formatQuotaTime(quota.remainingSeconds)}
              </span>
            </Link>
          )}
          {accountMenu}
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-5 border-t border-[#e5e0f0] bg-white px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_28px_rgba(33,16,74,.08)] lg:hidden"
        aria-label="Điều hướng nhanh"
        data-mobile-workspace-nav
      >
        {PRIMARY_MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeItem?.to === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${
                active ? "text-[#21104a]" : "text-[#756894]"
              }`}
            >
              <span
                className={`flex h-7 w-10 items-center justify-center rounded-lg ${
                  active ? "bg-[#ffcb05]" : ""
                }`}
              >
                <AppIcon icon={Icon} size="md" />
              </span>
              <span className="max-w-full truncate px-1">{item.shortLabel}</span>
            </Link>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${
                moreMenuIsActive ? "text-[#21104a]" : "text-[#756894]"
              }`}
              aria-label="Mở thêm chức năng"
            >
              <span
                className={`flex h-7 w-10 items-center justify-center rounded-lg ${
                  moreMenuIsActive ? "bg-[#ffcb05]" : ""
                }`}
              >
                <AppIcon icon={MoreHorizontal} size="md" />
              </span>
              Thêm
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-52 rounded-lg border-[#e5e0f0] bg-white text-[#21104a]"
          >
            {MOBILE_MORE_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  asChild
                  key={item.to}
                  className="cursor-pointer gap-2"
                >
                  <Link to={item.to}>
                    <AppIcon icon={Icon} size="sm" />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            {canAccessCms && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer gap-2">
                  <Link to="/admin">
                    <AppIcon icon={ShieldCheck} size="sm" />
                    Trung tâm quản trị
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </>
  );
}

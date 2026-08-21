import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  Crown,
  LayoutDashboard,
  LogOut,
  Pencil,
  ShieldCheck,
  Users,
} from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { User } from "@/context/AuthContext";
import type { QuotaStatus } from "@/lib/quota";
import { WorkspaceAccountSummary } from "./workspace-account-summary";
import { getAccountBadge } from "./workspace-account";

type WorkspaceAccountMenuProps = {
  user: User;
  quota: QuotaStatus | null;
  placement: "rail" | "topbar";
  canAccessCms: boolean;
  onEditProfile?: () => void;
  onLogout: () => void;
};

export function WorkspaceAccountMenu({
  user,
  quota,
  placement,
  canAccessCms,
  onEditProfile,
  onLogout,
}: WorkspaceAccountMenuProps) {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const isRail = placement === "rail";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={
            isRail
              ? "flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[#d8d0e9] transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcb05]"
              : "flex h-9 items-center gap-2 rounded-lg border border-[#e5e0f0] bg-white px-1.5 text-[#21104a] transition hover:bg-[#f7f5ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcb05]"
          }
          aria-label={`Mở tài khoản của ${fullName}`}
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className={
                isRail
                  ? "h-8 w-8 rounded-full object-cover"
                  : "h-7 w-7 rounded-md object-cover"
              }
            />
          ) : (
            <span
              className={`flex select-none items-center justify-center bg-[#ffcb05] font-black text-[#21104a] ${
                isRail
                  ? "h-8 w-8 rounded-full text-xs"
                  : "h-7 w-7 rounded-md text-xs"
              }`}
              aria-hidden="true"
            >
              {getAccountBadge(user.firstName, user.lastName)}
            </span>
          )}
          {isRail ? (
            <span className="max-w-full truncate text-[11px] font-bold">
              Tài khoản
            </span>
          ) : (
            <>
              <span className="hidden max-w-28 truncate text-xs font-bold sm:block">
                {user.firstName}
              </span>
              <AppIcon
                icon={ChevronDown}
                size="sm"
                className="hidden text-[#756894] sm:block"
              />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={isRail ? "right" : "bottom"}
        align="end"
        sideOffset={isRail ? 12 : 8}
        className={`z-[100] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-xl border-[#e5e0f0] bg-white p-0 text-[#21104a] shadow-[0_18px_48px_rgba(33,16,74,.18)] ${
          isRail ? "max-h-[calc(100vh-24px)]" : "max-h-[calc(100vh-68px)]"
        }`}
      >
        <WorkspaceAccountSummary
          firstName={user.firstName}
          lastName={user.lastName}
          avatar={user.avatar}
          quota={quota}
        />

        <div className="border-t border-[#eee7da] p-2">
          <p className="truncate px-2 pb-2 text-xs font-semibold text-[#756894]">
            {user.email}
          </p>
          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link to="/dashboard">
              <AppIcon icon={LayoutDashboard} size="sm" />
              Không gian làm việc
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link to="/pricing">
              <AppIcon icon={Crown} size="sm" />
              Gói cước và nâng cấp
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <Link to="/team">
              <AppIcon icon={Users} size="sm" />
              Nhóm và hạn mức dùng chung
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
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={onEditProfile}
            >
              <AppIcon icon={Pencil} size="sm" />
              Chỉnh sửa thông tin
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
            onSelect={onLogout}
          >
            <AppIcon icon={LogOut} size="sm" />
            Đăng xuất
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import {
  History,
  LayoutDashboard,
  Mic,
  PlugZap,
  Radio,
  Upload,
  Files,
  Users,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceNavItem = {
  to: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
};

export const DESKTOP_WORKSPACE_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  {
    to: "/dashboard",
    label: "Không gian làm việc",
    shortLabel: "Tổng quan",
    icon: LayoutDashboard,
  },
  {
    to: "/upload",
    label: "Tải tệp lên",
    shortLabel: "Tải tệp",
    icon: Upload,
  },
  {
    to: "/batch",
    label: "Xử lý hàng loạt",
    shortLabel: "Hàng loạt",
    icon: Files,
  },
  {
    to: "/record",
    label: "Ghi âm",
    shortLabel: "Ghi âm",
    icon: Mic,
  },
  {
    to: "/realtime",
    label: "Chuyển đổi trực tiếp",
    shortLabel: "Trực tiếp",
    icon: Radio,
  },
  {
    to: "/history",
    label: "Lịch sử chuyển đổi",
    shortLabel: "Lịch sử",
    icon: History,
    matchPrefixes: ["/transcript"],
  },
  {
    to: "/api",
    label: "Tích hợp API",
    shortLabel: "API",
    icon: PlugZap,
  },
  {
    to: "/team",
    label: "Nhóm làm việc",
    shortLabel: "Nhóm",
    icon: Users,
  },
];

const PRIMARY_MOBILE_PATHS = new Set([
  "/dashboard",
  "/upload",
  "/record",
  "/history",
]);

export const PRIMARY_MOBILE_NAV_ITEMS = DESKTOP_WORKSPACE_NAV_ITEMS.filter(
  (item) => PRIMARY_MOBILE_PATHS.has(item.to),
);

export const MOBILE_MORE_NAV_ITEMS = DESKTOP_WORKSPACE_NAV_ITEMS.filter(
  (item) => !PRIMARY_MOBILE_PATHS.has(item.to),
);

const WORKSPACE_CMS_ROLES = new Set([
  "support",
  "supporter",
  "admin",
  "super_admin",
]);

export function canAccessWorkspaceCms(role?: string | null) {
  return WORKSPACE_CMS_ROLES.has(role || "");
}

function matchesPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getActiveWorkspaceNavItem(pathname: string) {
  return DESKTOP_WORKSPACE_NAV_ITEMS.find(
    (item) =>
      matchesPath(pathname, item.to) ||
      item.matchPrefixes?.some((prefix) => matchesPath(pathname, prefix)),
  );
}

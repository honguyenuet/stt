import { createFileRoute } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  Pager,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { canMutate, canManageSettings } from "@/lib/admin/admin-auth";
import { useAdminSession } from "@/lib/admin/use-admin-session";
import {
  formatDateTime,
  formatMinutes,
  roleLabel,
  userStatusLabel,
  validateQuotaAdjustment,
} from "@/lib/admin/formatters";
import {
  adjustUserQuota,
  listUsers,
  updateUserRole,
  updateUserStatus,
} from "@/lib/admin/users-service";
import type {
  AdminRole,
  AdminUser,
  PaginatedResponse,
  UserStatus,
} from "@/lib/admin/types";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsersPage,
});

const roles: Array<AdminRole | "all"> = [
  "all",
  "super_admin",
  "admin",
  "viewer",
];
const statuses: Array<UserStatus | "all"> = [
  "all",
  "active",
  "suspended",
  "deleted",
];

function AdminUsersPage() {
  const session = useAdminSession();
  const [rows, setRows] = useState<PaginatedResponse<AdminUser> | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<AdminRole | "all">("all");
  const [status, setStatus] = useState<UserStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [quotaDelta, setQuotaDelta] = useState(30);
  const [quotaReason, setQuotaReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState("");
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    void listUsers({ page, limit: 5, search, role, status })
      .then(setRows)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Không tải được users"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, [page, search, role, status]);

  async function mutate(
    actionKey: string,
    action: () => Promise<AdminUser>,
    success: string,
  ) {
    setSavingAction(actionKey);
    try {
      const user = await action();
      setSelected(user);
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Thao tác thất bại");
    } finally {
      setSavingAction("");
    }
  }

  const mayMutate = session ? canMutate(session.user.role) : false;
  const mayChangeRole = session ? canManageSettings(session.user.role) : false;
  const quotaError = selected
    ? validateQuotaAdjustment(selected.quota_minutes, quotaDelta)
    : "";
  const canSaveQuota =
    mayMutate &&
    !savingAction &&
    !quotaError &&
    Boolean(quotaReason.trim());

  return (
    <div className="space-y-5">
      <AdminPanel>
        <AdminPanelHeader
          title="Quản lý người dùng"
          description="Tìm kiếm, lọc, phân trang và quản trị thời lượng/vai trò người dùng."
        />
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm tên hoặc thư điện tử"
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as AdminRole | "all");
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            {roles.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "Tất cả vai trò" : roleLabel[item]}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as UserStatus | "all");
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "Tất cả trạng thái" : userStatusLabel[item]}
              </option>
            ))}
          </select>
          <button
            onClick={load}
            className="rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white"
          >
            Tải lại
          </button>
        </div>
        <PageState
          loading={loading}
          error={error}
          empty={!rows?.data.length}
          onRetry={load}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[#fbf8ef] text-xs uppercase text-[#756894]">
                <tr>
                  {[
                    "Tên",
                    "Thư điện tử",
                    "Vai trò",
                    "Trạng thái",
                    "Thời lượng",
                    "Đã dùng",
                    "Ngày tạo",
                    "Đăng nhập gần nhất",
                    "",
                  ].map((head) => (
                    <th key={head} className="px-4 py-3">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#efe7d8]">
                {rows?.data.map((user) => (
                  <tr key={user.id} className="hover:bg-[#fbf8ef]">
                    <td className="px-4 py-3 font-black">{user.name}</td>
                    <td className="px-4 py-3">{user.email}</td>
                    <td className="px-4 py-3">{roleLabel[user.role]}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-3">
                      {formatMinutes(user.quota_minutes)}
                    </td>
                    <td className="px-4 py-3">
                      {formatMinutes(user.used_minutes)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(user.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(user.last_login_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(user)}
                        aria-label={`Xem chi tiết ${user.name}`}
                        title={`Xem chi tiết ${user.name}`}
                        className="inline-grid h-8 w-8 place-items-center rounded-md border border-[#e4ddcf] text-[#21104a] transition hover:bg-[#fbf8ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcb05]"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows && (
            <Pager
              page={rows.page}
              totalPages={rows.total_pages}
              onPageChange={setPage}
            />
          )}
        </PageState>
      </AdminPanel>

      {selected && (
        <AdminPanel>
          <AdminPanelHeader
            title={`Chi tiết người dùng: ${selected.name}`}
            action={
              <button
                onClick={() => setSelected(null)}
                className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm font-bold"
              >
                Đóng
              </button>
            }
          />
          <div className="grid gap-5 p-4 xl:grid-cols-3">
            <div className="space-y-2 text-sm">
              <p>
                <b>Thư điện tử:</b> {selected.email}
              </p>
              <p>
                <b>Trạng thái:</b> <StatusBadge status={selected.status} />
              </p>
              <p>
                <b>Thời lượng:</b> {formatMinutes(selected.quota_minutes)}
              </p>
              <p>
                <b>Đã dùng:</b> {formatMinutes(selected.used_minutes)}
              </p>
              <p className="text-[#756894]">
                Tệp và tác vụ chuyển giọng nói của người dùng được tổng hợp từ
                API quản trị máy chủ.
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="font-black">Trạng thái</h3>
              <div className="flex gap-2">
                <button
                  disabled={!mayMutate || selected.status === "active"}
                  title={
                    selected.status === "active"
                      ? "Tài khoản đang hoạt động"
                      : "Mở lại quyền truy cập của tài khoản"
                  }
                  onClick={() =>
                    void mutate(
                      "status",
                      () => updateUserStatus(selected.id, "active"),
                      "Đã mở khóa user",
                    )
                  }
                  className="rounded-md border px-3 py-2 text-sm font-bold disabled:opacity-40"
                >
                  Mở khóa
                </button>
                <button
                  disabled={!mayMutate || selected.status === "suspended"}
                  title={
                    selected.status === "suspended"
                      ? "Tài khoản đã bị khóa"
                      : "Khóa quyền truy cập của tài khoản"
                  }
                  onClick={() =>
                    void mutate(
                      "status",
                      () => updateUserStatus(selected.id, "suspended"),
                      "Đã khóa user",
                    )
                  }
                  className="rounded-md border px-3 py-2 text-sm font-bold disabled:opacity-40"
                >
                  Khóa
                </button>
              </div>
              <h3 className="font-black">Vai trò</h3>
              <select
                disabled={!mayChangeRole || Boolean(savingAction)}
                value={selected.role}
                onChange={(e) =>
                  void mutate(
                    "role",
                    () =>
                      updateUserRole(selected.id, e.target.value as AdminRole),
                    "Đã cập nhật role",
                  )
                }
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
              >
                <option value="viewer">Chỉ xem</option>
                <option value="admin">Quản trị viên</option>
                <option value="super_admin">Quản trị cao nhất</option>
              </select>
              <p className="text-xs text-[#756894]">
                Vai trò được lưu ngay sau khi bạn chọn.
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="font-black">Điều chỉnh thời lượng</h3>
              <input
                type="number"
                value={quotaDelta}
                onChange={(e) => setQuotaDelta(Number(e.target.value))}
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
              />
              <input
                value={quotaReason}
                onChange={(e) => setQuotaReason(e.target.value)}
                placeholder="Lý do điều chỉnh"
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
              />
              {quotaError && (
                <p className="text-sm text-red-700">
                  {quotaError}
                </p>
              )}
              {!quotaReason.trim() && (
                <p className="text-xs text-[#756894]">
                  Nhập lý do điều chỉnh để bật nút lưu thời lượng.
                </p>
              )}
              <button
                disabled={!canSaveQuota}
                onClick={() =>
                  void mutate(
                    "quota",
                    () => adjustUserQuota(selected.id, quotaDelta, quotaReason),
                    "Đã điều chỉnh thời lượng",
                  )
                }
                className="w-full rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white disabled:opacity-40"
              >
                {savingAction === "quota" ? "Đang lưu..." : "Lưu thời lượng"}
              </button>
            </div>
          </div>
        </AdminPanel>
      )}
    </div>
  );
}

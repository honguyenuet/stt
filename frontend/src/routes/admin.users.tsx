import { createFileRoute } from "@tanstack/react-router";
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
  validateQuotaMinutes,
} from "@/lib/admin/formatters";
import {
  adjustUserQuota,
  deleteUserAccount,
  listUsers,
  updateUserPlan,
  updateUserRole,
  updateUserStatus,
} from "@/lib/admin/users-service";
import type {
  AdminRole,
  AdminUser,
  BillingCycle,
  ManagedUserPlan,
  PaginatedResponse,
  UserStatus,
} from "@/lib/admin/types";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsersPage,
});

const roles: Array<AdminRole | "all"> = ["all", "admin", "support", "user"];
const statuses: Array<UserStatus | "all"> = [
  "all",
  "active",
  "suspended",
  "deleted",
];
const planOptions: Array<{ value: ManagedUserPlan; label: string }> = [
  { value: "free", label: "Theo lượt" },
  { value: "standard", label: "Tiêu chuẩn" },
  { value: "special", label: "Đặc biệt" },
  { value: "business", label: "Chuyên nghiệp" },
];
const billingCycles: Array<{ value: BillingCycle; label: string }> = [
  { value: "monthly", label: "Tháng" },
  { value: "yearly", label: "Năm" },
];

function AdminUsersPage() {
  const session = useAdminSession();
  const [rows, setRows] = useState<PaginatedResponse<AdminUser> | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<AdminRole | "all">("all");
  const [status, setStatus] = useState<UserStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [quotaMinutes, setQuotaMinutes] = useState(0);
  const [quotaReason, setQuotaReason] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<ManagedUserPlan>("free");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (!selected) return;
    setQuotaMinutes(selected.quota_minutes);
    setSelectedPlan(selected.plan);
    setBillingCycle("monthly");
  }, [selected]);

  async function mutate(action: () => Promise<AdminUser>, success: string) {
    try {
      const user = await action();
      setSelected(user);
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Thao tác thất bại");
    }
  }

  async function handleDeleteUser() {
    if (!selected) return;
    const confirmed = window.confirm(
      `Xóa tài khoản ${selected.email}? Tài khoản sẽ bị chuyển sang trạng thái đã xóa.`,
    );
    if (!confirmed) return;
    try {
      await deleteUserAccount(selected.id);
      setSelected(null);
      toast.success("Đã xóa tài khoản");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không xóa được user");
    }
  }

  const mayMutate = session ? canMutate(session.user.role) : false;
  const mayChangeRole = session ? canManageSettings(session.user.role) : false;

  return (
    <div className="space-y-5">
      <AdminPanel>
        <AdminPanelHeader
          title="Quản lý người dùng"
          description="Tìm kiếm, lọc, phân trang và quản trị quota/vai trò người dùng."
        />
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm tên hoặc email"
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
                    "Email",
                    "Vai trò",
                    "Gói",
                    "Trạng thái",
                    "Quota",
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
                      {planOptions.find((item) => item.value === user.plan)
                        ?.label ?? user.plan}
                    </td>
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
                        className="font-black text-[#21104a] underline"
                      >
                        Chi tiết
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
                <b>Email:</b> {selected.email}
              </p>
              <p>
                <b>Trạng thái:</b> <StatusBadge status={selected.status} />
              </p>
              <p>
                <b>Gói:</b>{" "}
                {planOptions.find((item) => item.value === selected.plan)
                  ?.label ?? selected.plan}
              </p>
              <p>
                <b>Hết hạn gói:</b> {formatDateTime(selected.plan_expires_at)}
              </p>
              <p>
                <b>Quota:</b> {formatMinutes(selected.quota_minutes)}
              </p>
              <p>
                <b>Đã dùng:</b> {formatMinutes(selected.used_minutes)}
              </p>
              <p className="text-[#756894]">
                Tệp và job chuyển giọng nói của người dùng được tổng hợp từ
                backend admin API.
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="font-black">Trạng thái</h3>
              <div className="flex gap-2">
                <button
                  disabled={!mayMutate || selected.status === "active"}
                  onClick={() =>
                    void mutate(
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
                  onClick={() =>
                    void mutate(
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
                disabled={!mayChangeRole}
                value={selected.role}
                onChange={(e) =>
                  void mutate(
                    () =>
                      updateUserRole(selected.id, e.target.value as AdminRole),
                    "Đã cập nhật role",
                  )
                }
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
              >
                <option value="admin">Quản trị viên</option>
                <option value="support">Hỗ trợ viên</option>
                <option value="user">Người dùng</option>
              </select>
              <button
                disabled={!mayMutate || selected.status === "deleted"}
                onClick={() => void handleDeleteUser()}
                className="w-full rounded-md border border-red-200 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-40"
              >
                Xóa tài khoản
              </button>
            </div>
            <div className="space-y-3">
              <h3 className="font-black">Gói người dùng</h3>
              <select
                value={selectedPlan}
                onChange={(e) =>
                  setSelectedPlan(e.target.value as ManagedUserPlan)
                }
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
              >
                {planOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                disabled={selectedPlan === "free"}
                value={billingCycle}
                onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
              >
                {billingCycles.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                disabled={!mayMutate}
                onClick={() =>
                  void mutate(
                    () =>
                      updateUserPlan(
                        selected.id,
                        selectedPlan,
                        selectedPlan === "free" ? "monthly" : billingCycle,
                      ),
                    "Đã cập nhật gói",
                  )
                }
                className="w-full rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white disabled:opacity-40"
              >
                Lưu gói
              </button>

              <h3 className="pt-2 font-black">Đặt quota</h3>
              <input
                type="number"
                min={0}
                value={quotaMinutes}
                onChange={(e) => setQuotaMinutes(Number(e.target.value))}
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
              />
              <input
                value={quotaReason}
                onChange={(e) => setQuotaReason(e.target.value)}
                placeholder="Lý do điều chỉnh"
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
              />
              {validateQuotaMinutes(quotaMinutes) && (
                <p className="text-sm text-red-700">
                  {validateQuotaMinutes(quotaMinutes)}
                </p>
              )}
              <button
                disabled={!mayMutate}
                onClick={() =>
                  void mutate(
                    () =>
                      adjustUserQuota(selected.id, quotaMinutes, quotaReason),
                    "Đã đặt lại quota",
                  )
                }
                className="w-full rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white disabled:opacity-40"
              >
                Lưu quota
              </button>
            </div>
          </div>
        </AdminPanel>
      )}
    </div>
  );
}

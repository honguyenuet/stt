import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Eye, Trash2 } from "lucide-react";
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
  deleteUserAccount,
  listUsers,
  updateUserPlan,
  updateUserRole,
  updateUserStatus,
} from "@/lib/admin/users-service";
import type {
  AdminUser,
  AssignableAdminRole,
  BillingCycle,
  ManagedUserPlan,
  PaginatedResponse,
  UserStatus,
} from "@/lib/admin/types";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsersPage,
});

const roles: Array<AssignableAdminRole | "all"> = [
  "all",
  "user",
  "supporter",
  "admin",
];
const statuses: Array<UserStatus | "all"> = [
  "all",
  "active",
  "suspended",
  "deleted",
];
const plans: ManagedUserPlan[] = ["free", "standard", "special", "business"];
const planLabel: Record<ManagedUserPlan, string> = {
  free: "Free",
  standard: "Tiêu chuẩn",
  special: "Đặc biệt",
  business: "Chuyên nghiệp",
};

function AdminUsersPage() {
  const session = useAdminSession();
  const [rows, setRows] = useState<PaginatedResponse<AdminUser> | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<AssignableAdminRole | "all">("all");
  const [status, setStatus] = useState<UserStatus | "all">("all");
  const [planFilter, setPlanFilter] = useState<ManagedUserPlan | "all">("all");
  const [quotaStatus, setQuotaStatus] =
    useState<"all" | "low" | "exceeded">("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [planDraft, setPlanDraft] = useState<ManagedUserPlan>("free");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [quotaDelta, setQuotaDelta] = useState(30);
  const [quotaReason, setQuotaReason] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(5);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState("");
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    void listUsers({
      page,
      limit: 5,
      search,
      role,
      status,
      plan: planFilter,
      quotaStatus,
      createdFrom,
      createdTo,
    })
      .then(setRows)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Không tải được users"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, [
    page,
    search,
    role,
    status,
    planFilter,
    quotaStatus,
    createdFrom,
    createdTo,
  ]);

  useEffect(() => {
    if (!selected) return;
    setPlanDraft(selected.plan);
    setBillingCycle("monthly");
    setDeleteArmed(false);
    setDeleteCountdown(5);
  }, [selected]);

  useEffect(() => {
    if (!deleteArmed || deleteCountdown <= 0) return;
    const timeout = window.setTimeout(
      () => setDeleteCountdown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timeout);
  }, [deleteArmed, deleteCountdown]);

  async function mutate(
    actionKey: string,
    action: () => Promise<AdminUser>,
    success: string,
  ) {
    setSavingAction(actionKey);
    try {
      const user = await action();
      setSelected(user);
      setPlanDraft(user.plan);
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Thao tác thất bại");
    } finally {
      setSavingAction("");
    }
  }

  function openUser(user: AdminUser) {
    setSelected(user);
    setPlanDraft(user.plan);
    setBillingCycle("monthly");
  }

  async function deleteSelectedAccount() {
    if (!selected) return;
    setSavingAction("delete");
    try {
      await deleteUserAccount(selected.id);
      toast.success("Đã xóa tài khoản người dùng");
      setSelected(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không xóa được user");
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
    selected?.status !== "deleted" &&
    !savingAction &&
    !quotaError &&
    Boolean(quotaReason.trim());
  const canSavePlan =
    mayMutate && !savingAction && Boolean(selected);
  const canDelete =
    mayChangeRole &&
    deleteArmed &&
    deleteCountdown === 0 &&
    !savingAction &&
    selected?.status !== "deleted" &&
    selected?.id !== session?.user.id;

  return (
    <div className="space-y-5">
      <AdminPanel>
        <AdminPanelHeader
          title="Quản lý người dùng"
          description="Tìm kiếm, lọc, phân trang và quản trị thời lượng/vai trò người dùng."
        />
        <div className="grid gap-3 p-4 md:grid-cols-4 xl:grid-cols-8">
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
              setRole(e.target.value as AssignableAdminRole | "all");
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
          <select
            value={planFilter}
            onChange={(e) => {
              setPlanFilter(e.target.value as ManagedUserPlan | "all");
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            <option value="all">Tất cả gói</option>
            {plans.map((item) => (
              <option key={item} value={item}>
                {planLabel[item]}
              </option>
            ))}
          </select>
          <select
            value={quotaStatus}
            onChange={(e) => {
              setQuotaStatus(e.target.value as "all" | "low" | "exceeded");
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            <option value="all">Tất cả quota</option>
            <option value="low">Sắp hết quota</option>
            <option value="exceeded">Đã hết quota</option>
          </select>
          <input
            type="date"
            value={createdFrom}
            onChange={(e) => {
              setCreatedFrom(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
            aria-label="Tạo từ ngày"
          />
          <input
            type="date"
            value={createdTo}
            onChange={(e) => {
              setCreatedTo(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
            aria-label="Tạo đến ngày"
          />
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
                    "Gói",
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
                    <td className="px-4 py-3">{planLabel[user.plan]}</td>
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
                        onClick={() => openUser(user)}
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
                <b>Gói:</b> {planLabel[selected.plan]}
              </p>
              <p>
                <b>Hết hạn gói:</b> {formatDateTime(selected.plan_expires_at)}
              </p>
              <p>
                <b>Thời lượng:</b> {formatMinutes(selected.quota_minutes)}
              </p>
              <p>
                <b>Đã dùng:</b> {formatMinutes(selected.used_minutes)}
              </p>
              <p>
                <b>Bắt đầu gói:</b> {formatDateTime(selected.plan_started_at)}
              </p>
              <p>
                <b>Hết hạn gói:</b> {formatDateTime(selected.plan_expires_at)}
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
                  disabled={
                    !mayMutate ||
                    selected.status === "active" ||
                    selected.status === "deleted"
                  }
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
                  disabled={
                    !mayMutate ||
                    selected.status === "suspended" ||
                    selected.status === "deleted"
                  }
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
                disabled={
                  !mayChangeRole ||
                  selected.status === "deleted" ||
                  Boolean(savingAction)
                }
                value={selected.role}
                onChange={(e) =>
                  void mutate(
                    "role",
                    () =>
                      updateUserRole(
                        selected.id,
                        e.target.value as AssignableAdminRole,
                      ),
                    "Đã cập nhật role",
                  )
                }
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
              >
                <option value="user">Người dùng</option>
                <option value="supporter">Hỗ trợ viên</option>
                <option value="admin">Quản trị viên</option>
              </select>
              <p className="text-xs text-[#756894]">
                Vai trò được lưu ngay sau khi bạn chọn.
              </p>
              <div className="space-y-3 border-t border-[#efe7d8] pt-3">
                <h3 className="font-black">Gói tài khoản</h3>
                <select
                  disabled={!mayMutate || Boolean(savingAction)}
                  value={planDraft}
                  onChange={(e) =>
                    setPlanDraft(e.target.value as ManagedUserPlan)
                  }
                  className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
                >
                  {plans.map((plan) => (
                    <option key={plan} value={plan}>
                      {planLabel[plan]}
                    </option>
                  ))}
                </select>
                <select
                  disabled={
                    !mayMutate || Boolean(savingAction) || planDraft === "free"
                  }
                  value={billingCycle}
                  onChange={(e) =>
                    setBillingCycle(e.target.value as BillingCycle)
                  }
                  className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
                >
                  <option value="monthly">Theo tháng</option>
                  <option value="yearly">Theo năm</option>
                </select>
                <button
                  disabled={!canSavePlan}
                  onClick={() =>
                    void mutate(
                      "plan",
                      () =>
                        updateUserPlan(selected.id, planDraft, billingCycle),
                      "Đã cập nhật gói tài khoản",
                    )
                  }
                  className="w-full rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  {savingAction === "plan" ? "Đang lưu..." : "Lưu gói"}
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="font-black">Gói người dùng</h3>
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="Chọn gói người dùng"
                  disabled={
                    !mayChangeRole ||
                    selected.status === "deleted" ||
                    Boolean(savingAction)
                  }
                  value={planDraft}
                  onChange={(event) =>
                    setPlanDraft(event.target.value as ManagedUserPlan)
                  }
                  className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
                >
                  {plans.map((plan) => (
                    <option key={plan} value={plan}>
                      {planLabel[plan]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Chọn chu kỳ gói người dùng"
                  disabled={
                    !mayChangeRole ||
                    selected.status === "deleted" ||
                    Boolean(savingAction)
                  }
                  value={billingCycle}
                  onChange={(event) =>
                    setBillingCycle(event.target.value as BillingCycle)
                  }
                  className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:opacity-40"
                >
                  <option value="monthly">Theo tháng</option>
                  <option value="yearly">Theo năm</option>
                </select>
              </div>
              <button
                disabled={
                  !mayChangeRole ||
                  selected.status === "deleted" ||
                  Boolean(savingAction)
                }
                onClick={() =>
                  void mutate(
                    "plan",
                    () => updateUserPlan(selected.id, planDraft, billingCycle),
                    "Đã cập nhật gói người dùng",
                  )
                }
                className="w-full rounded-md border border-[#21104a] px-3 py-2 text-sm font-black text-[#21104a] disabled:opacity-40"
              >
                {savingAction === "plan" ? "Đang cập nhật..." : "Cập nhật gói"}
              </button>
              <h3 className="font-black">Điều chỉnh thời lượng</h3>
              <input
                type="number"
                disabled={selected.status === "deleted"}
                value={quotaDelta}
                onChange={(e) => setQuotaDelta(Number(e.target.value))}
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
              />
              <input
                disabled={selected.status === "deleted"}
                value={quotaReason}
                onChange={(e) => setQuotaReason(e.target.value)}
                placeholder="Lý do điều chỉnh"
                className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
              />
              {quotaError && (
                <p className="text-sm text-red-700">{quotaError}</p>
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
              <div className="space-y-3 border-t border-[#efe7d8] pt-3">
                <h3 className="flex items-center gap-2 font-black text-red-700">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Xóa tài khoản
                </h3>
                <p className="text-xs text-[#756894]">
                  Tài khoản và dữ liệu liên quan sẽ bị xóa khỏi hệ thống.
                </p>
                {!deleteArmed ? (
                  <button
                    disabled={
                      !mayChangeRole ||
                      selected.status === "deleted" ||
                      selected.id === session?.user.id
                    }
                    onClick={() => {
                      setDeleteArmed(true);
                      setDeleteCountdown(5);
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-red-300 px-3 py-2 text-sm font-black text-red-700 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Bắt đầu xác nhận xóa
                  </button>
                ) : (
                  <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="text-sm font-bold text-red-800">
                      Bạn có chắc muốn xóa {selected.email}?
                    </p>
                    <button
                      disabled={!canDelete}
                      onClick={() => void deleteSelectedAccount()}
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {savingAction === "delete"
                        ? "Đang xóa..."
                        : deleteCountdown > 0
                          ? `Chờ ${deleteCountdown}s để xóa`
                          : "Xóa tài khoản"}
                    </button>
                    <button
                      disabled={Boolean(savingAction)}
                      onClick={() => {
                        setDeleteArmed(false);
                        setDeleteCountdown(5);
                      }}
                      className="w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm font-bold"
                    >
                      Hủy
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </AdminPanel>
      )}
    </div>
  );
}

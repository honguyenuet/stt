import { createFileRoute } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { canManageSettings } from "@/lib/admin/admin-auth";
import { formatDateTime, formatMinutes } from "@/lib/admin/formatters";
import { ADMIN_PLAN_COLUMNS } from "@/lib/admin/plan-columns";
import { listServicePlans, saveServicePlan } from "@/lib/admin/plans-service";
import type { ServicePlan } from "@/lib/admin/types";
import { useAdminSession } from "@/lib/admin/use-admin-session";

export const Route = createFileRoute("/admin/plans")({
  component: AdminPlansPage,
});

function AdminPlansPage() {
  const session = useAdminSession();
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [selected, setSelected] = useState<ServicePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canEdit = session ? canManageSettings(session.user.role) : false;

  function load() {
    setLoading(true);
    setError("");
    void listServicePlans()
      .then(setPlans)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Không tải được gói dịch vụ",
        ),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function save() {
    if (!selected) return;
    try {
      const updated = await saveServicePlan(selected);
      setSelected(updated);
      toast.success("Đã lưu gói dịch vụ");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được gói");
    }
  }

  return (
    <PageState
      loading={loading}
      error={error}
      empty={!plans.length}
      onRetry={load}
    >
      <div className="space-y-5">
        <AdminPanel>
          <AdminPanelHeader
            title="Quản lý gói dịch vụ"
            description="Cấu hình thời lượng, giá, giới hạn tải lên và trạng thái gói."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-[#fbf8ef] text-xs uppercase text-[#756894]">
                <tr>
                  {ADMIN_PLAN_COLUMNS.map((column) => (
                    <th key={column.key} className="px-4 py-3">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#efe7d8]">
                {plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-[#fbf8ef]">
                    <td className="px-4 py-3 font-mono">{plan.code}</td>
                    <td className="px-4 py-3 font-black">{plan.name}</td>
                    <td className="px-4 py-3">
                      {formatMinutes(plan.quota_minutes)}
                    </td>
                    <td className="px-4 py-3">
                      {plan.price_vnd.toLocaleString("vi-VN")} VND
                    </td>
                    <td className="px-4 py-3">{plan.max_upload_mb} MB</td>
                    <td className="px-4 py-3">
                      {plan.max_file_duration_minutes} phút
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={plan.enabled ? "active" : "suspended"}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(plan.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(plan)}
                        aria-label={`Sửa gói ${plan.name}`}
                        title={`Sửa gói ${plan.name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#21104a] transition hover:bg-[#f3ead5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcb05]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminPanel>
        {selected && (
          <AdminPanel>
            <AdminPanelHeader
              title={`Sửa gói: ${selected.name}`}
              action={
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-md border px-3 py-2 text-sm font-bold"
                >
                  Đóng
                </button>
              }
            />
            <div className="grid gap-4 p-4 md:grid-cols-3">
              <Input
                label="Tên gói"
                value={selected.name}
                onChange={(value) => setSelected({ ...selected, name: value })}
                disabled={!canEdit}
              />
              <NumberInput
                label="Thời lượng (phút)"
                value={selected.quota_minutes}
                onChange={(value) =>
                  setSelected({ ...selected, quota_minutes: value })
                }
                disabled={!canEdit}
              />
              <NumberInput
                label="Giá VND"
                value={selected.price_vnd}
                onChange={(value) =>
                  setSelected({ ...selected, price_vnd: value })
                }
                disabled={!canEdit}
              />
              <NumberInput
                label="Dung lượng tải lên tối đa (MB)"
                value={selected.max_upload_mb}
                onChange={(value) =>
                  setSelected({ ...selected, max_upload_mb: value })
                }
                disabled={!canEdit}
              />
              <NumberInput
                label="Thời lượng tối đa (phút)"
                value={selected.max_file_duration_minutes}
                onChange={(value) =>
                  setSelected({ ...selected, max_file_duration_minutes: value })
                }
                disabled={!canEdit}
              />
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSelected({ ...selected, enabled: e.target.checked })
                  }
                />{" "}
                Đang bật
              </label>
              <div className="md:col-span-3">
                <button
                  disabled={!canEdit}
                  onClick={() => void save()}
                  className="rounded-md bg-[#21104a] px-4 py-3 text-sm font-black text-white disabled:opacity-40"
                >
                  Lưu gói
                </button>
              </div>
            </div>
          </AdminPanel>
        )}
      </div>
    </PageState>
  );
}

function Input({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        type="number"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
      />
    </label>
  );
}

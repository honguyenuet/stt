import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { canManageSettings, canMutate } from "@/lib/admin/admin-auth";
import {
  checkSpeechProvider,
  listSpeechProviders,
  saveSpeechProvider,
} from "@/lib/admin/providers-service";
import type { RoutingMode, SpeechProvider } from "@/lib/admin/types";
import { useAdminSession } from "@/lib/admin/use-admin-session";

export const Route = createFileRoute("/admin/providers")({
  component: AdminProvidersPage,
});

const routingModeLabel: Record<RoutingMode, string> = {
  manual: "Thủ công",
  auto: "Tự động",
  rule_based: "Theo quy tắc",
};

const healthStatusLabel: Record<string, string> = {
  healthy: "Ổn định",
  degraded: "Suy giảm",
  down: "Ngừng hoạt động",
  unknown: "Chưa rõ",
};

function AdminProvidersPage() {
  const session = useAdminSession();
  const [providers, setProviders] = useState<SpeechProvider[]>([]);
  const [selected, setSelected] = useState<SpeechProvider | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [routingRulesDraft, setRoutingRulesDraft] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canEdit = session ? canManageSettings(session.user.role) : false;
  const canCheck = session ? canMutate(session.user.role) : false;

  function load() {
    setLoading(true);
    setError("");
    void listSpeechProviders()
      .then(setProviders)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Không tải được nhà cung cấp",
        ),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function save() {
    if (!selected) return;
    try {
      const routingRules = JSON.parse(routingRulesDraft || "{}");
      if (
        !routingRules ||
        typeof routingRules !== "object" ||
        Array.isArray(routingRules)
      ) {
        throw new Error("Quy tắc định tuyến phải là một JSON object");
      }
      const updated = await saveSpeechProvider({
        ...selected,
        routing_rules: routingRules,
        api_key: apiKeyDraft.trim() || undefined,
      });
      setApiKeyDraft("");
      setRoutingRulesDraft(JSON.stringify(updated.routing_rules, null, 2));
      setSelected(updated);
      toast.success("Đã lưu nhà cung cấp");
      load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Không lưu được nhà cung cấp",
      );
    }
  }

  async function health(provider: SpeechProvider) {
    try {
      const updated = await checkSpeechProvider(provider.id);
      setSelected(updated);
      toast.success("Đã kiểm tra trạng thái hoạt động");
      load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Không kiểm tra được trạng thái",
      );
    }
  }

  return (
    <PageState
      loading={loading}
      error={error}
      empty={!providers.length}
      onRetry={load}
    >
      <div className="space-y-5">
        <AdminPanel>
          <AdminPanelHeader
            title="Quản lý nhà cung cấp Speech-to-Text"
            description="API endpoint, bật/tắt, mặc định, định tuyến, dự phòng, trạng thái hoạt động, hiệu năng và chi phí."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-[#fbf8ef] text-xs uppercase text-[#756894]">
                <tr>
                  {[
                    "Nhà cung cấp",
                    "Endpoint",
                    "API key",
                    "Trạng thái",
                    "Mặc định",
                    "Định tuyến",
                    "Hoạt động",
                    "Độ trễ",
                    "Chi phí",
                    "",
                  ].map((h) => (
                    <th key={h} className="px-4 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#efe7d8]">
                {providers.map((provider) => (
                  <tr key={provider.id} className="hover:bg-[#fbf8ef]">
                    <td className="px-4 py-3">
                      <b>{provider.name}</b>
                      <br />
                      <span className="font-mono text-xs">{provider.code}</span>
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate">
                      {provider.endpoint}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {provider.api_key_masked || "Chưa có"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={provider.enabled ? "active" : "suspended"}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {provider.is_default ? "Có" : "Không"}
                    </td>
                    <td className="px-4 py-3">
                      {routingModeLabel[provider.routing_mode]}
                    </td>
                    <td className="px-4 py-3">
                      {healthStatusLabel[provider.health_status] ??
                        provider.health_status}
                    </td>
                    <td className="px-4 py-3">{provider.avg_latency_ms} ms</td>
                    <td className="px-4 py-3">
                      ${provider.monthly_cost_usd.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          setSelected(provider);
                          setApiKeyDraft("");
                          setRoutingRulesDraft(
                            JSON.stringify(provider.routing_rules, null, 2),
                          );
                        }}
                        className="font-black underline"
                      >
                        Sửa
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
              title={`Nhà cung cấp: ${selected.name}`}
              action={
                <button
                  onClick={() => {
                    setSelected(null);
                    setApiKeyDraft("");
                    setRoutingRulesDraft("{}");
                  }}
                  className="rounded-md border px-3 py-2 text-sm font-bold"
                >
                  Đóng
                </button>
              }
            />
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <Input
                label="Tên nhà cung cấp"
                value={selected.name}
                disabled={!canEdit}
                onChange={(value) => setSelected({ ...selected, name: value })}
              />
              <Input
                label="Endpoint"
                value={selected.endpoint}
                disabled={!canEdit}
                onChange={(value) =>
                  setSelected({ ...selected, endpoint: value })
                }
              />
              <Input
                label={selected.api_key_masked ? "API key mới" : "API key"}
                type="password"
                value={apiKeyDraft}
                placeholder={
                  selected.api_key_masked
                    ? "Để trống nếu không đổi key"
                    : "Nhập API key của provider"
                }
                disabled={!canEdit}
                onChange={setApiKeyDraft}
              />
              <label className="block text-sm font-bold">
                Chế độ định tuyến
                <select
                  disabled={!canEdit}
                  value={selected.routing_mode}
                  onChange={(e) =>
                    setSelected({
                      ...selected,
                      routing_mode: e.target.value as RoutingMode,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
                >
                  <option value="manual">Thủ công</option>
                  <option value="auto">Tự động</option>
                  <option value="rule_based">Theo quy tắc</option>
                </select>
              </label>
              <label className="block text-sm font-bold">
                Nhà cung cấp dự phòng
                <select
                  disabled={!canEdit}
                  value={selected.failover_provider_id || ""}
                  onChange={(event) =>
                    setSelected({
                      ...selected,
                      failover_provider_id: event.target.value || null,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
                >
                  <option value="">Tự động chọn</option>
                  {providers
                    .filter(
                      (provider) =>
                        provider.id !== selected.id && provider.enabled,
                    )
                    .map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                </select>
              </label>
              <NumberInput
                label="Chi phí / phút (USD)"
                value={selected.cost_per_minute_usd}
                disabled={!canEdit}
                onChange={(value) =>
                  setSelected({ ...selected, cost_per_minute_usd: value })
                }
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
                Bật nhà cung cấp
              </label>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={selected.is_default}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSelected({ ...selected, is_default: e.target.checked })
                  }
                />{" "}
                Provider mặc định
              </label>
              <label className="block text-sm font-bold md:col-span-2">
                Quy tắc định tuyến JSON
                <textarea
                  disabled={!canEdit}
                  value={routingRulesDraft}
                  onChange={(event) =>
                    setRoutingRulesDraft(event.target.value)
                  }
                  rows={6}
                  spellCheck={false}
                  className="mt-1 w-full rounded-md border border-[#e4ddcf] bg-[#fbf8ef] px-3 py-2 font-mono text-xs disabled:opacity-60"
                />
                <span className="mt-1 block text-xs font-normal text-[#756894]">
                  Hỗ trợ: languages, audio_modes và priority. Ví dụ:{" "}
                  {`{"languages":["vi"],"audio_modes":["speech"],"priority":200}`}
                </span>
              </label>
              <div className="flex gap-2 md:col-span-2">
                <button
                  disabled={!canEdit}
                  onClick={() => void save()}
                  className="rounded-md bg-[#21104a] px-4 py-3 text-sm font-black text-white disabled:opacity-40"
                >
                  Lưu nhà cung cấp
                </button>
                <button
                  disabled={!canCheck}
                  onClick={() => void health(selected)}
                  className="rounded-md border px-4 py-3 text-sm font-black disabled:opacity-40"
                >
                  Kiểm tra trạng thái
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
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  type?: "text" | "password";
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        type={type}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
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
        step="0.0001"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
      />
    </label>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Languages,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import { useAuth, type User } from "@/context/AuthContext";
import { redirectAfterAuth } from "@/lib/auth-redirect";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

const JOB_ROLES = [
  { value: "creator", label: "Sáng tạo nội dung" },
  { value: "marketing", label: "Marketing và truyền thông" },
  { value: "education", label: "Giáo dục và nghiên cứu" },
  { value: "journalism", label: "Báo chí và phỏng vấn" },
  { value: "business", label: "Doanh nghiệp" },
  { value: "other", label: "Công việc khác" },
] as const;

const USAGE_PURPOSES = [
  { value: "meeting", label: "Cuộc họp và hội thảo" },
  {
    value: "content",
    label: "Nội dung nghe nhìn, chương trình âm thanh và nội dung khác",
  },
  { value: "interview", label: "Phỏng vấn và nghiên cứu" },
  { value: "education", label: "Bài giảng và học tập" },
  { value: "subtitles", label: "Phụ đề và bản dịch" },
  { value: "other", label: "Mục đích khác" },
] as const;

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { from } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { user, token, isLoading, updateUser } = useAuth();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    organization: "",
    jobRole: "",
    usagePurpose: "",
    preferredLanguage: "vi",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/onboarding" },
        replace: true,
      });
      return;
    }
    if (user.onboardingCompleted) {
      redirectAfterAuth(from);
      return;
    }
    setForm((current) => ({
      ...current,
      firstName: current.firstName || user.firstName || "",
      lastName: current.lastName || user.lastName || "",
      organization: current.organization || user.organization || "",
      jobRole: current.jobRole || user.jobRole || "",
      usagePurpose: current.usagePurpose || user.usagePurpose || "",
      preferredLanguage:
        current.preferredLanguage || user.preferredLanguage || "vi",
    }));
  }, [from, isLoading, navigate, user]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || submitting) return;
    if (
      !form.firstName.trim() ||
      !form.lastName.trim() ||
      !form.jobRole ||
      !form.usagePurpose
    ) {
      setError("Vui lòng hoàn tất các trường bắt buộc.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/auth/onboarding`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => ({}))) as User & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Không lưu được thông tin thiết lập.");
      }
      updateUser(data);
      redirectAfterAuth(from);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Không lưu được thông tin thiết lập.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f4ec]">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-[#ffcb05] border-t-[#21104a]" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-8 text-[#21104a] md:py-12">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-lg border border-[#e4ddcf] bg-white shadow-[0_20px_70px_-40px_rgba(33,16,74,.45)] lg:grid-cols-[.82fr_1.18fr]">
        <aside className="relative overflow-hidden bg-[#21104a] p-7 text-white md:p-10">
          <div className="absolute inset-0 opacity-15 [background-image:linear-gradient(rgba(255,255,255,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.18)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div className="relative">
            <div className="inline-flex rounded-md bg-white px-3 py-2">
              <VbeeBrandLogo size="compact" className="h-9" />
            </div>
            <p className="mt-10 text-xs font-black uppercase tracking-[0.16em] text-[#ffdc45]">
              Thiết lập lần đầu
            </p>
            <h1 className="mt-3 text-3xl font-black leading-tight">
              Chuẩn bị thông tin đăng nhập của bạn
            </h1>
            <p className="mt-4 text-sm leading-7 text-white/75">
              Vbee dùng thông tin này để gợi ý luồng chuyển đổi, ngôn ngữ và trợ
              giúp phù hợp. Bạn chỉ cần hoàn tất một lần.
            </p>
            <ul className="mt-8 space-y-4 text-sm font-bold">
              {[
                "30 phút trải nghiệm miễn phí",
                "Tự động lưu văn bản vào lịch sử",
                "Chỉnh sửa văn bản đồng bộ với âm thanh",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[#ffcb05] text-[#21104a]">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <form onSubmit={handleSubmit} className="p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#fff2a3]">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[#8a7100]">
                Xin chào, {user.firstName}
              </p>
              <h2 className="mt-1 text-xl font-black">
                Cho Vbee biết thêm về bạn
              </h2>
            </div>
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <Field label="Tên" icon={UserRound}>
              <input
                value={form.firstName}
                onChange={(event) =>
                  setForm({ ...form, firstName: event.target.value })
                }
                maxLength={100}
                required
                className="onboarding-input"
              />
            </Field>
            <Field label="Họ" icon={UserRound}>
              <input
                value={form.lastName}
                onChange={(event) =>
                  setForm({ ...form, lastName: event.target.value })
                }
                maxLength={100}
                required
                className="onboarding-input"
              />
            </Field>
            <Field
              label="Công ty hoặc nhóm"
              icon={UsersRound}
              className="sm:col-span-2"
              optional
            >
              <input
                value={form.organization}
                onChange={(event) =>
                  setForm({ ...form, organization: event.target.value })
                }
                maxLength={160}
                placeholder="Ví dụ: Vbee, trường học hoặc nhóm cá nhân"
                className="onboarding-input"
              />
            </Field>
            <Field label="Vai trò công việc" icon={BriefcaseBusiness}>
              <select
                value={form.jobRole}
                onChange={(event) =>
                  setForm({ ...form, jobRole: event.target.value })
                }
                required
                className="onboarding-input"
              >
                <option value="">Chọn vai trò</option>
                {JOB_ROLES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ngôn ngữ mặc định" icon={Languages}>
              <select
                value={form.preferredLanguage}
                onChange={(event) =>
                  setForm({
                    ...form,
                    preferredLanguage: event.target.value,
                  })
                }
                className="onboarding-input"
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">Tiếng Anh</option>
                <option value="auto">Tự động nhận diện</option>
              </select>
            </Field>
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm font-black">
              Bạn chủ yếu dùng Vbee để làm gì?
            </legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {USAGE_PURPOSES.map((item) => (
                <label
                  key={item.value}
                  className={`cursor-pointer rounded-md border px-3 py-3 text-sm font-bold transition ${
                    form.usagePurpose === item.value
                      ? "border-[#ffcb05] bg-[#fff9dd]"
                      : "border-[#e4ddcf] hover:border-[#cbbd9f]"
                  }`}
                >
                  <input
                    type="radio"
                    name="usagePurpose"
                    value={item.value}
                    checked={form.usagePurpose === item.value}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        usagePurpose: event.target.value,
                      })
                    }
                    className="sr-only"
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a] transition hover:bg-[#ffdc45] disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? "Đang lưu..." : "Bắt đầu sử dụng Vbee"}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </button>
          <p className="mt-3 text-center text-xs leading-5 text-[#8a7da1]">
            Bạn có thể cập nhật họ tên trong menu tài khoản sau này.
          </p>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  icon: Icon,
  optional = false,
  className = "",
  children,
}: {
  label: string;
  icon: typeof UserRound;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <span className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.08em] text-[#574875]">
        <Icon className="h-3.5 w-3.5 text-[#8a7100]" />
        {label}
        {optional && (
          <span className="font-medium normal-case tracking-normal text-[#9a8eac]">
            (không bắt buộc)
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAdminSession, saveAdminSession } from "./api-client";
import {
  formatDuration,
  formatFileSize,
  validateQuotaAdjustment,
} from "./formatters";
import {
  canReplySupport,
  canUpdateSupportStatus,
  exchangeCurrentSessionForAdmin,
  loginAdmin,
  readAdminSession,
} from "./admin-auth";
import {
  adjustUserQuota,
  deleteUserAccount,
  listUsers,
  updateUserPlan,
} from "./users-service";
import {
  listTranscriptionJobs,
  retryTranscriptionJob,
} from "./transcriptions-service";

const storage = new Map<string, string>();

const sessionStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key: string) => {
    storage.delete(key);
  },
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
};

vi.stubGlobal("sessionStorage", sessionStorageMock);
vi.stubGlobal("window", { setTimeout });

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function seedSession() {
  saveAdminSession({
    token: "test-token",
    expiresAt: Date.now() + 60_000,
    user: {
      id: "admin_test",
      name: "Test Admin",
      email: "admin@test.local",
      role: "admin",
    },
  });
}

describe("admin utilities", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("formats duration and file size consistently", () => {
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatFileSize(1_572_864)).toBe("1.5 MB");
  });

  it("validates quota adjustment and prevents negative quota", () => {
    expect(validateQuotaAdjustment(30, -31)).toBe("Quota không được âm");
    expect(validateQuotaAdjustment(30, 15)).toBe("");
  });

  it("stores an admin session after backend login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            token: "api-token",
            expiresAt: Date.now() + 60_000,
            user: {
              id: "1",
              name: "Vbee Admin",
              email: "superadmin@vbee.local",
              role: "admin",
            },
          }),
        ),
      ),
    );

    await loginAdmin("superadmin@vbee.local", "admin123");
    expect(readAdminSession()?.user.role).toBe("admin");
  });

  it("exchanges the current app token for an admin session", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          token: "cms-token",
          expiresAt: Date.now() + 60_000,
          user: {
            id: "2",
            name: "Support Agent",
            email: "support@vbee.local",
            role: "support",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await exchangeCurrentSessionForAdmin("app-token");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init as RequestInit).method).toBe("POST");
    expect(
      new Headers((init as RequestInit).headers).get("Authorization"),
    ).toBe("Bearer app-token");
    expect(readAdminSession()?.user.role).toBe("support");
  });

  it("allows support replies without allowing support status changes", () => {
    expect(canReplySupport("support")).toBe(true);
    expect(canReplySupport("admin")).toBe(true);
    expect(canReplySupport("viewer")).toBe(false);

    expect(canUpdateSupportStatus("support")).toBe(false);
    expect(canUpdateSupportStatus("admin")).toBe(true);
  });
});

describe("admin services", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    seedSession();
  });

  it("calls users API with search, filters and pagination", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse({
          data: [
            {
              id: "2",
              name: "Tran Hoang Nam",
              email: "nam.tran@example.com",
              role: "support",
              status: "active",
              quota_minutes: 300,
              used_minutes: 20,
              created_at: new Date().toISOString(),
              last_login_at: null,
            },
          ],
          page: 1,
          limit: 10,
          total: 1,
          total_pages: 1,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listUsers({
      page: 1,
      limit: 10,
      search: "nam.tran",
      role: "support",
      status: "active",
    });

    expect(result.total).toBe(1);
    expect(result.data[0]?.email).toBe("nam.tran@example.com");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/admin/users?page=1&limit=10&search=nam.tran&role=support&status=active",
    );
  });

  it("sets user quota with an absolute minute value", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          id: "2",
          name: "Tran Hoang Nam",
          email: "nam.tran@example.com",
          role: "user",
          status: "active",
          plan: "standard",
          quota_minutes: 120,
          used_minutes: 20,
          created_at: new Date().toISOString(),
          last_login_at: null,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adjustUserQuota("2", 120, "Set quota theo hợp đồng");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      quotaMinutes: 120,
      reason: "Set quota theo hợp đồng",
    });
  });

  it("updates user plan and deletes users through admin API", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          id: "2",
          name: "Tran Hoang Nam",
          email: "nam.tran@example.com",
          role: "user",
          status: "deleted",
          plan: "business",
          quota_minutes: 2400,
          used_minutes: 20,
          created_at: new Date().toISOString(),
          last_login_at: null,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateUserPlan("2", "business", "yearly");
    await deleteUserAccount("2");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/admin/users/2/plan",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      plan: "business",
      billingCycle: "yearly",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/api/admin/users/2",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("retries failed jobs through backend API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/retry")) {
          return Promise.resolve(
            jsonResponse({ job_id: "job_2KJ9AA", status: "queued" }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            data: [{ job_id: "job_2KJ9AA", status: "queued" }],
            page: 1,
            limit: 10,
            total: 1,
            total_pages: 1,
          }),
        );
      }),
    );

    const failed = await retryTranscriptionJob("job_2KJ9AA");
    expect(failed.status).toBe("queued");

    const queuedJobs = await listTranscriptionJobs({
      page: 1,
      limit: 10,
      search: "job_2KJ9AA",
      status: "queued",
      language: "all",
    });
    expect(queuedJobs.total).toBe(1);
  });

  it("rejects service calls when route protection session is missing", async () => {
    clearAdminSession();

    await expect(
      listUsers({ page: 1, limit: 10, search: "", role: "all", status: "all" }),
    ).rejects.toThrow("Phiên admin đã hết hạn");
  });
});

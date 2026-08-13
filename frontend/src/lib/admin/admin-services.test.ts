import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "@/components/admin/admin-ui";
import { clearAdminSession, saveAdminSession } from "./api-client";
import {
  formatDuration,
  formatFileSize,
  roleLabel,
  validateQuotaAdjustment,
} from "./formatters";
import {
  exchangeAdminSession,
  loginAdmin,
  readAdminSession,
  validateAdminSession,
} from "./admin-auth";
import {
  adjustUserQuota,
  deleteUserAccount,
  getUserDetail,
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
      role: "super_admin",
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

  it("provides a visible label for every CMS role", () => {
    expect(roleLabel.super_admin).toBe("Quản trị cao nhất");
    expect(roleLabel.admin).toBe("Quản trị viên");
    expect(roleLabel.support).toBe("Hỗ trợ viên");
    expect(roleLabel.viewer).toBe("Chỉ xem");
  });

  it("keeps status badges on one horizontal line", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusBadge, { status: "available" }),
    );

    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("Có sẵn");
  });

  it("validates quota adjustment and prevents negative quota", () => {
    expect(validateQuotaAdjustment(30, -31)).toBe("Thời lượng không được âm");
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
              role: "super_admin",
            },
          }),
        ),
      ),
    );

    await loginAdmin("superadmin@vbee.local", "admin123");
    expect(readAdminSession()?.user.role).toBe("super_admin");
  });

  it("exchanges an authenticated Vbee session for a CMS session", async () => {
    const fetchMock = vi.fn(
      (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        Promise.resolve(
          jsonResponse({
            token: "cms-token",
            expiresAt: Date.now() + 60_000,
            user: {
              id: "5",
              name: "Vbee Admin",
              email: "admin@example.com",
              role: "super_admin",
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await exchangeAdminSession("vbee-access-token");

    expect(readAdminSession()?.token).toBe("cms-token");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer vbee-access-token");
  });

  it("validates an existing CMS session before opening admin routes", async () => {
    seedSession();
    const fetchMock = vi.fn(
      (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        Promise.resolve(
          jsonResponse({
            user: {
              id: "admin_test",
              name: "Test Admin",
              email: "admin@test.local",
              role: "super_admin",
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await validateAdminSession();

    expect(result.user.role).toBe("super_admin");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
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
              role: "viewer",
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
      role: "viewer",
      status: "active",
    });

    expect(result.total).toBe(1);
    expect(result.data[0]?.email).toBe("nam.tran@example.com");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/admin/users?page=1&limit=10&search=nam.tran&role=viewer&status=active",
    );
  });

  it("looks up an exact CMS user by id", async () => {
    const fetchMock = vi.fn(
      (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        Promise.resolve(
          jsonResponse({
            data: [{ id: "42", email: "user@example.com" }],
            page: 1,
            limit: 1,
            total: 1,
            total_pages: 1,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getUserDetail("42");

    expect(result?.id).toBe("42");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/admin/users?search=42&page=1&limit=1",
    );
  });

  it("updates a managed user plan through the CMS API", async () => {
    const fetchMock = vi.fn(
      (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        Promise.resolve(jsonResponse({ id: "42", plan: "standard" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateUserPlan("42", "standard", "yearly");

    expect(result.plan).toBe("standard");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/admin/users/42/plan",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ plan: "standard", billingCycle: "yearly" }),
      }),
    );
  });

  it("sends the quota delta field expected by the backend", async () => {
    const fetchMock = vi.fn(
      (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        Promise.resolve(jsonResponse({ id: "42", quota_minutes: 90 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adjustUserQuota("42", 30, "Tặng thời lượng hỗ trợ");

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          deltaMinutes: 30,
          reason: "Tặng thời lượng hỗ trợ",
        }),
      }),
    );
  });

  it("soft-deletes a managed user through the CMS API", async () => {
    const fetchMock = vi.fn(
      (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        Promise.resolve(jsonResponse({ id: "42", status: "deleted" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteUserAccount("42");

    expect(result.status).toBe("deleted");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/admin/users/42",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "DELETE" }),
    );
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
    ).rejects.toThrow("Phiên quản trị đã hết hạn");
  });

  it("keeps the CMS session when the current role is forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { error: "Bạn không có quyền thực hiện thao tác này" },
            false,
            403,
          ),
        ),
      ),
    );

    await expect(
      listUsers({ page: 1, limit: 10, search: "", role: "all", status: "all" }),
    ).rejects.toThrow("Bạn không có quyền thực hiện thao tác này");
    expect(readAdminSession()?.token).toBe("test-token");
  });

  it("clears the CMS session when its token is no longer valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ error: "Token admin đã hết hạn" }, false, 401),
        ),
      ),
    );

    await expect(
      listUsers({ page: 1, limit: 10, search: "", role: "all", status: "all" }),
    ).rejects.toThrow("Token admin đã hết hạn");
    expect(readAdminSession()).toBeNull();
  });
});

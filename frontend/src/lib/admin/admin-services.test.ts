import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAdminSession, saveAdminSession } from "./api-client";
import {
  formatDuration,
  formatFileSize,
  validateQuotaAdjustment,
} from "./formatters";
import {
  exchangeAdminSession,
  loginAdmin,
  readAdminSession,
  validateAdminSession,
} from "./admin-auth";
import { listUsers } from "./users-service";
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
    const fetchMock = vi.fn(() =>
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
    const fetchMock = vi.fn(() =>
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
          jsonResponse({ error: "Bạn không có quyền thực hiện thao tác này" }, false, 403),
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

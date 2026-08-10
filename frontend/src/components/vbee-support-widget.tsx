import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Home,
  Inbox,
  Mail,
  MessageCircle,
  Mic,
  Search,
  Send,
  UploadCloud,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fetchQuota, formatQuotaTime, type QuotaStatus } from "@/lib/quota";
import {
  createSupportTicket,
  fetchSupportMessages,
  fetchSupportTickets,
  replySupportTicket,
  type SupportMessage,
  type SupportTicket,
} from "@/lib/support";

type SupportView = "home" | "messages" | "thread" | "chat" | "help";
type SupportReadState = Record<string, number>;

const SUPPORT_READ_STATE_KEY = "vbee_support_read_state";

const HELP_QUESTIONS = [
  {
    title: "Không tải tệp lên được",
    answer:
      "Kiểm tra định dạng tệp, dung lượng tối đa theo gói và thời lượng còn lại. Nếu tệp quá dài, hãy cắt tệp hoặc nâng cấp gói.",
    icon: UploadCloud,
  },
  {
    title: "Không ghi âm được",
    answer:
      "Hãy cấp quyền micrô cho trình duyệt, đóng ứng dụng đang dùng micrô và thử tải lại trang ghi âm.",
    icon: Mic,
  },
  {
    title: "Lỗi API nhà cung cấp 401",
    answer:
      "Khóa API của nhà cung cấp không hợp lệ hoặc hết quyền. Kiểm tra tệp .env của máy chủ rồi khởi động lại máy chủ.",
    icon: AlertTriangle,
  },
  {
    title: "Mua gói nhưng chưa được cộng thời gian",
    answer:
      "Vào trang thanh toán để kiểm tra trạng thái đơn hàng. Nếu đã thanh toán, gửi yêu cầu kèm thư điện tử và mã đơn hàng.",
    icon: Wallet,
  },
  {
    title: "Không xuất được văn bản",
    answer:
      "Bạn cần xử lý xong văn bản trước khi tải TXT/DOCX/SRT. Nếu văn bản rỗng, hãy thử chuyển giọng nói lại cho tệp.",
    icon: MessageCircle,
  },
];

const CATEGORY_OPTIONS = [
  { value: "upload", label: "Tải tệp lên" },
  { value: "record", label: "Ghi âm" },
  { value: "realtime", label: "Realtime" },
  { value: "quota", label: "Thời lượng / gói cước" },
  { value: "payment", label: "Thanh toán" },
  { value: "api", label: "API nhà cung cấp" },
  { value: "general", label: "Khác" },
];

function getPageUrl() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

function statusLabel(status: string) {
  if (status === "resolved") return "Đã xử lý";
  if (status === "closed") return "Đã đóng";
  if (status === "pending") return "Đang chờ";
  return "Đang mở";
}

function formatSupportTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function readSupportReadState(): SupportReadState {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(SUPPORT_READ_STATE_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as SupportReadState;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function saveSupportReadState(value: SupportReadState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SUPPORT_READ_STATE_KEY, JSON.stringify(value));
}

export function VbeeSupportWidget() {
  const { user, token } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SupportView>("home");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("upload");
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [readState, setReadState] = useState<SupportReadState>(() =>
    readSupportReadState(),
  );
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(
    null,
  );
  const [threadMessages, setThreadMessages] = useState<SupportMessage[]>([]);
  const [threadReply, setThreadReply] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const displayName = user?.firstName || "bạn";
  const contactEmail = user?.email || email;
  const unreadSupportCount = useMemo(
    () =>
      tickets.reduce((total, ticket) => {
        const readCount = readState[String(ticket.id)] || 0;
        return total + Math.max(0, ticket.adminMessageCount - readCount);
      }, 0),
    [readState, tickets],
  );

  const filteredQuestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return HELP_QUESTIONS;
    return HELP_QUESTIONS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q),
    );
  }, [search]);

  useEffect(() => {
    if (!open || !token) {
      if (!token) setQuota(null);
      return;
    }

    const authToken = token;
    let cancelled = false;
    async function loadQuota() {
      try {
        const data = await fetchQuota(authToken);
        if (!cancelled) setQuota(data);
      } catch {
        if (!cancelled) setQuota(null);
      }
    }

    void loadQuota();
    const timer = window.setInterval(() => void loadQuota(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, token]);

  const loadTickets = useCallback(
    async (showLoading = false) => {
      if (!token) {
        setTickets([]);
        return;
      }

      if (showLoading) setIsLoadingTickets(true);
      try {
        const data = await fetchSupportTickets(token);
        setTickets(data.tickets);
        setError("");
      } catch (err) {
        if (showLoading || open) {
          setError(
            err instanceof Error
              ? err.message
              : "Không tải được yêu cầu hỗ trợ",
          );
        }
      } finally {
        if (showLoading) setIsLoadingTickets(false);
      }
    },
    [open, token],
  );

  useEffect(() => {
    if (!token) {
      setTickets([]);
      return;
    }

    let cancelled = false;
    async function syncTickets() {
      if (!cancelled) await loadTickets(false);
    }

    void syncTickets();
    const timer = window.setInterval(() => void syncTickets(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadTickets, token]);

  useEffect(() => {
    if (!open || view !== "messages" || !token) return;
    void loadTickets(true);
  }, [loadTickets, open, token, view, notice]);

  useEffect(() => {
    function openSupport() {
      setOpen(true);
      setView("home");
    }

    window.addEventListener("vbee:open-support", openSupport);
    return () => window.removeEventListener("vbee:open-support", openSupport);
  }, []);

  async function handleSend() {
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setError("Vui lòng nhập nội dung cần Vbee hỗ trợ");
      return;
    }
    if (!user && !email.trim()) {
      setError("Vui lòng nhập thư điện tử để Vbee liên hệ lại");
      return;
    }

    setIsSending(true);
    setError("");
    setNotice("");

    try {
      const categoryLabel =
        CATEGORY_OPTIONS.find((item) => item.value === category)?.label ||
        "Hỗ trợ Vbee";
      await createSupportTicket(token, {
        subject: `Hỗ trợ ${categoryLabel}`,
        category,
        message: cleanMessage,
        email: contactEmail,
        name: user ? `${user.firstName} ${user.lastName}`.trim() : undefined,
        pageUrl: getPageUrl(),
        priority:
          category === "payment" || category === "api" ? "high" : "normal",
        metadata: {
          plan: user?.plan || "guest",
          quotaRemainingSeconds: quota?.remainingSeconds,
          page: getPageUrl(),
        },
      });
      setMessage("");
      setNotice("Đã gửi yêu cầu hỗ trợ. Vbee sẽ phản hồi sớm.");
      setView("messages");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi được hỗ trợ");
    } finally {
      setIsSending(false);
    }
  }

  async function openTicketThread(ticket: SupportTicket) {
    if (!token) {
      setError("Vui lòng đăng nhập để xem hội thoại hỗ trợ");
      return;
    }

    setSelectedTicket(ticket);
    setView("thread");
    setThreadReply("");
    setIsLoadingThread(true);
    setError("");
    try {
      const data = await fetchSupportMessages(token, ticket.id);
      setThreadMessages(data.messages);
      const adminMessageCount = data.messages.filter(
        (item) => item.sender === "admin",
      ).length;
      setReadState((current) => {
        const next = {
          ...current,
          [ticket.id]: Math.max(ticket.adminMessageCount, adminMessageCount),
        };
        saveSupportReadState(next);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được hội thoại");
    } finally {
      setIsLoadingThread(false);
    }
  }

  async function handleThreadReply() {
    const cleanReply = threadReply.trim();
    if (!token || !selectedTicket || cleanReply.length < 2) {
      setError("Vui lòng nhập nội dung phản hồi");
      return;
    }

    setIsSending(true);
    setError("");
    try {
      const data = await replySupportTicket(token, selectedTicket.id, cleanReply);
      setThreadMessages((current) => [...current, data.message]);
      setThreadReply("");
      setNotice("Đã gửi phản hồi cho admin.");
      await loadTickets(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi được phản hồi");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-[90] flex flex-col items-end gap-3">
      {open && (
        <div className="w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#e8decc] bg-white text-[#21104a] shadow-[0_18px_60px_rgba(33,16,74,.18)]">
          {view === "home" && (
            <SupportHome
              displayName={displayName}
              quota={quota}
              setOpen={setOpen}
              setView={setView}
            />
          )}
          {view === "messages" && (
            <SupportMessages
              token={token}
              tickets={tickets}
              isLoading={isLoadingTickets}
              notice={notice}
              error={error}
              setOpen={setOpen}
              setView={setView}
              openTicket={openTicketThread}
              readState={readState}
            />
          )}
          {view === "thread" && selectedTicket && (
            <SupportThread
              ticket={selectedTicket}
              messages={threadMessages}
              reply={threadReply}
              isLoading={isLoadingThread}
              isSending={isSending}
              error={error}
              setOpen={setOpen}
              setView={setView}
              setReply={setThreadReply}
              handleReply={handleThreadReply}
            />
          )}
          {view === "chat" && (
            <SupportChatView
              userEmail={user?.email || ""}
              email={email}
              setEmail={setEmail}
              message={message}
              setMessage={setMessage}
              category={category}
              setCategory={setCategory}
              isSending={isSending}
              error={error}
              setOpen={setOpen}
              handleSend={handleSend}
            />
          )}
          {view === "help" && (
            <SupportHelp
              search={search}
              setSearch={setSearch}
              questions={filteredQuestions}
              setOpen={setOpen}
              setView={setView}
            />
          )}
          <SupportBottomNav
            view={view}
            setView={setView}
            unreadCount={unreadSupportCount}
          />
        </div>
      )}

      <button
        onClick={() => {
          setOpen((value) => !value);
          if (!open) setView("home");
        }}
        className="relative grid h-12 w-12 place-items-center rounded-full bg-[#ffcb05] text-[#21104a] shadow-[0_12px_35px_rgba(255,203,5,.28)] transition hover:-translate-y-0.5 hover:bg-[#ffdc45]"
        aria-label={open ? "Đóng hỗ trợ Vbee" : "Mở hỗ trợ Vbee"}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && unreadSupportCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-black leading-none text-white ring-2 ring-white">
            {unreadSupportCount > 99 ? "99+" : unreadSupportCount}
          </span>
        )}
      </button>
    </div>
  );
}

function SupportHome({
  displayName,
  quota,
  setOpen,
  setView,
}: {
  displayName: string;
  quota: QuotaStatus | null;
  setOpen: (open: boolean) => void;
  setView: (view: SupportView) => void;
}) {
  return (
    <>
      <div className="bg-[#21104a] px-5 pb-12 pt-5 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-black">
            <MessageCircle className="h-5 w-5 text-[#ffcb05]" />
            Hỗ trợ Vbee
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-full p-1 text-white/65 transition hover:bg-white/10 hover:text-white"
            aria-label="Đóng hỗ trợ"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 className="mt-10 text-2xl font-black leading-tight">
          Xin chào {displayName}!
          <br />
          Vbee có thể hỗ trợ gì?
        </h2>
      </div>

      <div className="-mt-8 space-y-3 px-4 pb-4">
        <button
          onClick={() => setView("chat")}
          className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 text-left shadow-[0_10px_32px_rgba(33,16,74,.10)] transition hover:-translate-y-0.5"
        >
          <span>
            <span className="block font-black">Gửi yêu cầu hỗ trợ</span>
            <span className="mt-1 block text-sm font-semibold text-[#756894]">
              Vbee sẽ phản hồi lại trong thời gian sớm nhất
            </span>
          </span>
          <ChevronRight className="h-6 w-6 text-[#ffcb05]" />
        </button>

        <div className="rounded-xl border border-[#eee8ff] bg-white p-3 shadow-[0_10px_28px_rgba(33,16,74,.06)]">
          <button
            onClick={() => setView("help")}
            className="mb-3 flex w-full items-center justify-between rounded-xl bg-[#f7f4ff] px-3 py-3 text-left text-sm font-black"
          >
            Tìm hướng dẫn nhanh
            <Search className="h-4 w-4 text-[#ffcb05]" />
          </button>
          <div className="space-y-1">
            {HELP_QUESTIONS.slice(0, 4).map((question) => (
              <button
                key={question.title}
                onClick={() => setView("help")}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[#62557b] transition hover:bg-[#fff8cf]"
              >
                <span>{question.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#ffcb05]" />
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-[#21104a] p-4 text-white">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#ffcb05]">
            <Clock3 className="h-4 w-4" />
            Thời lượng hiện tại
          </div>
          {quota ? (
            <>
              <p className="mt-3 text-2xl font-black">
                {formatQuotaTime(quota.remainingSeconds)} còn lại
              </p>
              <p className="mt-1 text-sm font-semibold text-white/62">
                Đã dùng {formatQuotaTime(quota.usedSeconds)} /{" "}
                {formatQuotaTime(quota.quotaSeconds)}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#ffcb05]"
                  style={{ width: `${quota.percentUsed}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm font-semibold text-white/62">
              Đăng nhập để xem thời gian còn lại và trạng thái gói.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function SupportMessages({
  token,
  tickets,
  isLoading,
  notice,
  error,
  setOpen,
  setView,
  openTicket,
  readState,
}: {
  token: string | null;
  tickets: SupportTicket[];
  isLoading: boolean;
  notice: string;
  error: string;
  setOpen: (open: boolean) => void;
  setView: (view: SupportView) => void;
  openTicket: (ticket: SupportTicket) => void;
  readState: SupportReadState;
}) {
  return (
    <>
      <SupportHeader title="Tin nhắn hỗ trợ" setOpen={setOpen} />
      <div className="min-h-[400px] px-4 py-4">
        {notice && (
          <div className="mb-4 rounded-lg bg-[#fff8cf] px-4 py-3 text-sm font-bold text-[#21104a]">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}
        {!token ? (
          <div className="flex min-h-[330px] flex-col items-center justify-center text-center">
            <Inbox className="h-10 w-10 text-[#756894]" />
            <h3 className="mt-5 text-xl font-black">Bạn chưa đăng nhập</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#756894]">
              Bạn vẫn có thể gửi hỗ trợ bằng thư điện tử, nhưng cần đăng nhập để xem
              lại lịch sử yêu cầu.
            </p>
            <button
              onClick={() => setView("chat")}
              className="mt-6 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a]"
            >
              Gửi yêu cầu
            </button>
          </div>
        ) : isLoading ? (
          <p className="py-10 text-center text-sm font-bold text-[#756894]">
            Đang tải yêu cầu hỗ trợ...
          </p>
        ) : tickets.length === 0 ? (
          <div className="flex min-h-[330px] flex-col items-center justify-center text-center">
            <Inbox className="h-10 w-10 text-[#756894]" />
            <h3 className="mt-5 text-xl font-black">Chưa có tin nhắn</h3>
            <p className="mt-2 text-sm font-semibold text-[#756894]">
              Các yêu cầu hỗ trợ của bạn sẽ hiển thị tại đây.
            </p>
            <button
              onClick={() => setView("chat")}
              className="mt-6 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a]"
            >
              Gửi yêu cầu
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((ticket) => {
              const unreadCount = Math.max(
                0,
                ticket.adminMessageCount - (readState[String(ticket.id)] || 0),
              );
              return (
                <button
                  key={ticket.id}
                  onClick={() => openTicket(ticket)}
                  className="w-full rounded-lg border border-[#eee8ff] bg-[#fbfaff] p-4 text-left transition hover:border-[#ffcb05]/70 hover:bg-[#fffbea]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-black">{ticket.subject}</h4>
                      <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-[#756894]">
                        {ticket.latestMessage}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {unreadCount > 0 && (
                        <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-black leading-none text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                      <span className="inline-flex whitespace-nowrap rounded-full bg-[#fff8cf] px-3 py-1 text-xs font-black text-[#21104a]">
                        {statusLabel(ticket.status)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs font-bold text-[#8b829d]">
                    <span>{formatSupportTime(ticket.updatedAt)}</span>
                    <span className="inline-flex items-center gap-1 text-[#21104a]">
                      Phản hồi <ChevronRight className="h-4 w-4" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function SupportThread({
  ticket,
  messages,
  reply,
  isLoading,
  isSending,
  error,
  setOpen,
  setView,
  setReply,
  handleReply,
}: {
  ticket: SupportTicket;
  messages: SupportMessage[];
  reply: string;
  isLoading: boolean;
  isSending: boolean;
  error: string;
  setOpen: (open: boolean) => void;
  setView: (view: SupportView) => void;
  setReply: (reply: string) => void;
  handleReply: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-[#eee8ff] px-4 py-3">
        <button
          onClick={() => setView("messages")}
          className="rounded-full p-1 text-[#756894] transition hover:bg-[#f7f4ff] hover:text-[#21104a]"
          aria-label="Quay lại tin nhắn"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-center">
          <h2 className="truncate text-lg font-black">{ticket.subject}</h2>
          <p className="text-xs font-bold text-[#756894]">
            {statusLabel(ticket.status)} - {formatSupportTime(ticket.updatedAt)}
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-full p-1 text-[#756894] transition hover:bg-[#f7f4ff] hover:text-[#21104a]"
          aria-label="Đóng hỗ trợ"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="py-10 text-center text-sm font-bold text-[#756894]">
            Đang tải hội thoại...
          </p>
        ) : (
          <div className="max-h-[330px] space-y-3 overflow-y-auto rounded-xl bg-[#f7f4ff] p-3 scrollbar-primary">
            {messages.map((item) => (
              <div
                key={item.id}
                className={`flex ${
                  item.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[82%] rounded-xl px-3 py-2 text-sm font-semibold leading-6 ${
                    item.sender === "user"
                      ? "bg-[#21104a] text-white"
                      : "border border-[#eee8ff] bg-white text-[#21104a]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{item.message}</p>
                  <p
                    className={`mt-2 text-xs ${
                      item.sender === "user"
                        ? "text-white/65"
                        : "text-[#756894]"
                    }`}
                  >
                    {item.sender === "user" ? "Bạn" : "Admin"} -{" "}
                    {formatSupportTime(item.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="block">
          <span className="text-xs font-black uppercase text-[#756894]">
            Phản hồi admin
          </span>
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            placeholder="Nhập phản hồi của bạn..."
            className="mt-2 w-full resize-none rounded-lg border border-[#eee8ff] bg-[#fbfaff] px-4 py-2.5 text-sm font-semibold leading-6 outline-none focus:border-[#ffcb05]"
          />
        </label>

        <button
          onClick={handleReply}
          disabled={isSending || reply.trim().length < 2}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 font-black text-[#21104a] transition hover:bg-[#ffdc45] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSending ? "Đang gửi..." : "Gửi phản hồi"}
          <Send className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

function SupportChatView({
  userEmail,
  email,
  setEmail,
  message,
  setMessage,
  category,
  setCategory,
  isSending,
  error,
  setOpen,
  handleSend,
}: {
  userEmail: string;
  email: string;
  setEmail: (email: string) => void;
  message: string;
  setMessage: (message: string) => void;
  category: string;
  setCategory: (category: string) => void;
  isSending: boolean;
  error: string;
  setOpen: (open: boolean) => void;
  handleSend: () => void;
}) {
  return (
    <>
      <SupportHeader title="Gửi hỗ trợ Vbee" setOpen={setOpen} />
      <div className="space-y-4 px-4 py-4">
        <p className="text-sm font-semibold leading-6 text-[#62557b]">
          Mô tả vấn đề bạn đang gặp. Vbee sẽ lưu yêu cầu kèm trang hiện tại,
          thư điện tử và gói sử dụng để hỗ trợ nhanh hơn.
        </p>

        {!userEmail && (
          <label className="block">
            <span className="text-xs font-black uppercase text-[#756894]">
              Thư điện tử liên hệ
            </span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@example.com"
              className="mt-2 w-full rounded-lg border border-[#eee8ff] bg-[#fbfaff] px-4 py-2.5 text-sm font-semibold outline-none focus:border-[#ffcb05]"
            />
          </label>
        )}

        <label className="block">
          <span className="text-xs font-black uppercase text-[#756894]">
            Nhóm vấn đề
          </span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="mt-2 w-full rounded-lg border border-[#eee8ff] bg-[#fbfaff] px-4 py-2.5 text-sm font-semibold outline-none focus:border-[#ffcb05]"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-black uppercase text-[#756894]">
            Nội dung cần hỗ trợ
          </span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            placeholder="Ví dụ: Tôi tải tệp mp3 lên nhưng báo lỗi API nhà cung cấp 401..."
            className="mt-2 w-full resize-none rounded-lg border border-[#eee8ff] bg-[#fbfaff] px-4 py-2.5 text-sm font-semibold leading-6 outline-none focus:border-[#ffcb05]"
          />
        </label>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={isSending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 font-black text-[#21104a] transition hover:bg-[#ffdc45] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSending ? "Đang gửi..." : "Gửi yêu cầu hỗ trợ"}
          <Send className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

function SupportHelp({
  search,
  setSearch,
  questions,
  setOpen,
  setView,
}: {
  search: string;
  setSearch: (search: string) => void;
  questions: typeof HELP_QUESTIONS;
  setOpen: (open: boolean) => void;
  setView: (view: SupportView) => void;
}) {
  return (
    <>
      <SupportHeader title="Trung tâm trợ giúp" setOpen={setOpen} />
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 rounded-lg bg-[#f7f4ff] px-4 py-3">
          <Search className="h-4 w-4 text-[#756894]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm lỗi tải tệp, thời lượng, API..."
            className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-[#9b94a8]"
          />
        </div>
        <div className="mt-5 max-h-[420px] space-y-3 overflow-y-auto pr-1 scrollbar-primary">
          {questions.map((item) => (
            <details
              key={item.title}
              className="rounded-lg border border-[#eee8ff] bg-white p-4"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 font-black">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff8cf] text-[#21104a]">
                  <item.icon className="h-5 w-5" />
                </span>
                {item.title}
              </summary>
              <p className="mt-3 pl-12 text-sm font-semibold leading-6 text-[#62557b]">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
        <button
          onClick={() => setView("chat")}
          className="mt-5 w-full rounded-full bg-[#21104a] px-5 py-3 text-sm font-black text-white"
        >
          Không tìm thấy câu trả lời? Gửi yêu cầu
        </button>
      </div>
    </>
  );
}

function SupportHeader({
  title,
  setOpen,
}: {
  title: string;
  setOpen: (open: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#eee8ff] px-4 py-3">
      <span className="w-8" />
      <h2 className="text-lg font-black">{title}</h2>
      <button
        onClick={() => setOpen(false)}
        className="rounded-full p-1 text-[#756894] transition hover:bg-[#f7f4ff] hover:text-[#21104a]"
        aria-label="Đóng hỗ trợ"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function SupportBottomNav({
  view,
  setView,
  unreadCount,
}: {
  view: SupportView;
  setView: (view: SupportView) => void;
  unreadCount: number;
}) {
  const items: Array<{
    view: SupportView;
    label: string;
    icon: typeof Home;
  }> = [
    { view: "home", label: "Trang chính", icon: Home },
    { view: "messages", label: "Tin nhắn", icon: Inbox },
    { view: "help", label: "Trợ giúp", icon: CircleHelp },
  ];

  return (
    <div className="grid grid-cols-3 border-t border-[#eee8ff] bg-white px-4 py-3">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          view === item.view ||
          ((view === "chat" || view === "thread") && item.view === "messages");
        return (
          <button
            key={item.view}
            onClick={() => setView(item.view)}
            className={`relative flex flex-col items-center gap-1 text-sm font-black transition ${
              active ? "text-[#21104a]" : "text-[#8b829d]"
            }`}
          >
            {item.view === "messages" && unreadCount > 0 && (
              <span className="absolute right-7 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-black leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
            <Icon className={`h-5 w-5 ${active ? "text-[#ffcb05]" : ""}`} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

import axios from "axios";

// In-memory CSRF token storage (NEVER in localStorage or sessionStorage)
let inMemoryCsrfToken = null;
let csrfPromise = null;

export function setCsrfToken(token) {
  inMemoryCsrfToken = token || null;
}

export function getStoredCsrfToken() {
  return inMemoryCsrfToken;
}

export function clearCsrfToken() {
  inMemoryCsrfToken = null;
  csrfPromise = null;
}

// Fetch CSRF token from the backend session
export async function fetchCsrfToken(force = false) {
  if (inMemoryCsrfToken && !force) {
    return inMemoryCsrfToken;
  }
  if (!csrfPromise || force) {
    csrfPromise = axios
      .get(`${import.meta.env.VITE_API_BASE_URL || "/api/v1"}/auth/csrf`, {
        withCredentials: true,
      })
      .then((res) => {
        const token = res.data?.data?.csrfToken || res.data?.csrfToken;
        inMemoryCsrfToken = token || null;
        return inMemoryCsrfToken;
      })
      .catch((err) => {
        inMemoryCsrfToken = null;
        throw err;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

// Generate deterministic or safe random idempotency key for financial mutations
export function generateIdempotencyKey(prefix = "act") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Determine if a request is a financial mutation requiring an Idempotency-Key
function isFinancialMutation(config) {
  if (config.method !== "post") return false;
  const url = config.url || "";
  return (
    url.includes("/topups") ||
    url.includes("/top-ups") ||
    url.includes("/allocations") ||
    url.includes("/transfers") ||
    url.includes("/allocation-transfers") ||
    url.includes("/purchases") ||
    url.includes("/fuel-purchases") ||
    url.includes("/withdrawals") ||
    url.includes("/settlements")
  );
}

// Session authentication: the server owns the session and sets an HttpOnly cookie.
// Axios sends that cookie automatically; the browser must never read/store it.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  timeout: 20000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Request interceptor: attach in-memory CSRF token and Idempotency-Key
api.interceptors.request.use(async (config) => {
  const method = (config.method || "get").toLowerCase();
  const isUnsafeMethod = ["post", "put", "patch", "delete"].includes(method);

  if (isUnsafeMethod) {
    if (!inMemoryCsrfToken) {
      try {
        await fetchCsrfToken();
      } catch {
        // Fallback: continue; server will return CSRF error if strictly needed
      }
    }
    if (inMemoryCsrfToken) {
      config.headers["X-CSRF-Token"] = inMemoryCsrfToken;
    }

    if (isFinancialMutation(config) && !config.headers["Idempotency-Key"]) {
      config.headers["Idempotency-Key"] = generateIdempotencyKey("fin");
    }
  }

  return config;
});

// Response interceptor: capture rotated CSRF tokens and map error messages
api.interceptors.response.use(
  (response) => {
    // If backend returns a rotated CSRF token, update in-memory state
    const newCsrf = response.data?.data?.csrfToken || response.data?.csrfToken;
    if (newCsrf) {
      inMemoryCsrfToken = newCsrf;
    }
    return response;
  },
  async (error) => {
    const status = error.response?.status;
    const data = error.response?.data;
    const errorCode = data?.error?.code || data?.code;
    const serverMsg = data?.error?.message || data?.message;

    // Friendly Arabic mappings for standard backend codes
    const CODE_MESSAGES = {
      INSUFFICIENT_BALANCE: "رصيد المحفظة أو التخصيص غير كافٍ لإتمام العملية.",
      UNAUTHORIZED: "انتهت جلستك. يرجى تسجيل الدخول مجدداً.",
      FORBIDDEN: "ليس لديك الصلاحية لتنفيذ هذا الإجراء.",
      NOT_FOUND: "العنصر المطلوب غير موجود.",
      CONFLICT: "تعارض في حالة المعاملة أو تمت معالجتها مسبقاً.",
      IDEMPOTENCY_KEY_REUSED: "تم إرسال هذا الطلب مسبقاً، يرجى تحديث الصفحة لمشاهدة النتيجة.",
      VALIDATION_ERROR: "يرجى التحقق من صحة البيانات المدخلة.",
      SERVICE_UNAVAILABLE: "الخدمة غير متاحة حالياً، يرجى المحاولة بعد قليل.",
      RATE_LIMIT_EXCEEDED: "تم تجاوز عدد الطلبات المسموح بها، يرجى الانتظار قليلاً.",
    };

    if (
      status === 403 &&
      !error.config?._csrfRetry &&
      typeof serverMsg === "string" &&
      serverMsg.toLowerCase().includes("csrf")
    ) {
      error.config._csrfRetry = true;
      try {
        const freshToken = await fetchCsrfToken(true);
        if (freshToken) {
          error.config.headers["X-CSRF-Token"] = freshToken;
          return api(error.config);
        }
      } catch {
        // Fallback to standard error response below
      }
    }

    if (status === 403 && typeof serverMsg === "string" && serverMsg.toLowerCase().includes("csrf")) {
      // CSRF token mismatch: refresh token for subsequent user action
      clearCsrfToken();
      error.userMessage = "انتهت صلاحية جلسة الحماية (CSRF). يرجى إعادة المحاولة.";
      return Promise.reject(error);
    }

    error.errorCode = errorCode;
    error.userMessage =
      CODE_MESSAGES[errorCode] ||
      serverMsg ||
      (status === 401
        ? "انتهت جلستك. سجّل الدخول مرة أخرى."
        : status === 403
          ? "غير مصرح لك بتنفيذ هذه العملية."
          : status === 404
            ? "البيانات المطلوبة غير موجودة."
            : "تعذر تنفيذ الطلب. تحقق من البيانات والاتصال.");

    return Promise.reject(error);
  },
);

export const errorMessage = (error) => error?.userMessage || "حدث خطأ غير متوقع.";

export const unwrap = (data) => {
  if (!data) return data;
  if (data.data !== undefined) return data.data;
  return data;
};

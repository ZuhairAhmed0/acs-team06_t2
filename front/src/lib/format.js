export const money = (value) => value == null ? "—" : `${new Intl.NumberFormat("ar-SD", { maximumFractionDigits: 2 }).format(Number(value))} ج.س`;
export const dateTime = (value) => value ? new Intl.DateTimeFormat("ar-SD", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
export const pickItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  return payload?.items ?? payload?.results ?? payload?.data?.items ?? payload?.data ?? [];
};
export const roleOf = (user) => String(user?.role ?? user?.system_role ?? user?.systemRole ?? "").toUpperCase();

const STATUS_AR = {
  PENDING: "قيد الانتظار",
  AWAITING: "بانتظار الإجراء",
  AWAITING_REVIEW: "بانتظار المراجعة",
  PENDING_REVIEW: "بانتظار المراجعة",
  UNDER_REVIEW: "قيد المراجعة",
  IN_REVIEW: "قيد المراجعة",
  NEEDS_REVIEW: "تحتاج إلى مراجعة",
  PROCESSING: "قيد التنفيذ",
  IN_PROGRESS: "قيد التنفيذ",
  APPROVED: "تمت الموافقة",
  ACCEPTED: "مقبول",
  REJECTED: "مرفوض",
  DECLINED: "مرفوض",
  COMPLETED: "مكتمل",
  SUCCEEDED: "ناجح",
  SUCCESS: "ناجح",
  FAILED: "فشل",
  FAILURE: "فشل",
  CANCELLED: "ملغي",
  CANCELED: "ملغي",
  EXPIRED: "منتهي الصلاحية",
  ACTIVE: "نشط",
  INACTIVE: "غير نشط",
  ELIGIBLE: "مؤهل للتسوية",
  ON_HOLD: "معلّق مؤقتاً",
  HOLD: "محجوز",
  RESERVED: "محجوز",
  PARTIAL: "جزئي",
  PARTIALLY_COMPLETED: "مكتمل جزئياً",
  SETTLED: "تمت التسوية",
  PAID: "مدفوع",
  REVERSED: "تم عكس العملية",
  REFUNDED: "تم استرداد المبلغ",
  DRAFT: "مسودة",
  OPEN: "مفتوح",
  CLOSED: "مغلق",
  VERIFIED: "تم التحقق",
  UNVERIFIED: "لم يتم التحقق",
  NOT_STARTED: "لم يبدأ",
  CREATED: "تم الإنشاء",
  SUBMITTED: "تم الإرسال",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  AWAITING_CONFIRMATION: "بانتظار التأكيد",
  CONFIRMED: "تم التأكيد",
  REVIEWED: "تمت المراجعة",
  SUSPENDED: "موقوف مؤقتاً",
  PAUSED: "متوقف مؤقتاً",
  UNKNOWN: "غير محدد",
  PARTIALLY_SETTLED: "تمت تسوية جزء من المبلغ",
  PARTIALLY_PAID: "مدفوع جزئياً",
  RECONCILIATION_REQUIRED: "يحتاج إلى مطابقة",
};

/** Translate known API status codes; keep existing Arabic text and unknown values unchanged. */
export function formatStatus(value) {
  if (value == null || value === "") return "—";
  const original = String(value).trim();
  if (/[\u0600-\u06FF]/.test(original)) return original;
  const key = original.toUpperCase().replace(/[\s-]+/g, "_");
  return STATUS_AR[key] ?? original;
}

export function statusTone(value) {
  const key = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["COMPLETED", "SUCCEEDED", "SUCCESS", "APPROVED", "ACCEPTED", "ACTIVE", "SETTLED", "PAID", "VERIFIED"].includes(key)) return "success";
  if (["REJECTED", "DECLINED", "FAILED", "FAILURE", "CANCELLED", "CANCELED", "EXPIRED", "INACTIVE"].includes(key)) return "danger";
  if (["PENDING", "AWAITING", "AWAITING_REVIEW", "PENDING_REVIEW", "UNDER_REVIEW", "IN_REVIEW", "PROCESSING", "IN_PROGRESS", "NEEDS_REVIEW", "ON_HOLD", "HOLD", "RESERVED", "ELIGIBLE"].includes(key)) return "warning";
  return "neutral";
}

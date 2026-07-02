// ============================================================
// 🛡️ أدوات الحماية: تعقيم النصوص قبل عرضها في الـ DOM
// (يمنع XSS في المذكرات، رسائل الدعم، وأي إدخال من المستخدم)
// ============================================================

/** يحوّل أي نص خام إلى نص آمن للعرض داخل HTML */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

/** ينشئ عنصر DOM آمن مباشرة (الطريقة المفضّلة بدل innerHTML) */
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => c && node.appendChild(c));
  return node;
}

/** يتحقق من رابط قبل استخدامه (يمنع javascript: وروابط خبيثة) */
export function sanitizeUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch (_) {
    /* رابط غير صالح */
  }
  return "#";
}

/** رسالة خطأ ودّية بدل عرض تفاصيل تقنية للمستخدم */
export function friendlyError(err) {
  const map = {
    "Invalid login credentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "User already registered": "هذا البريد الإلكتروني مسجل بالفعل.",
    "Email not confirmed": "يرجى تأكيد بريدك الإلكتروني أولاً.",
    "Password should be at least 6 characters": "كلمة المرور يجب ألا تقل عن 6 أحرف.",
  };
  const msg = err?.message || String(err);
  return map[msg] || "حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى.";
}

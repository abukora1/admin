import { CONFIG } from "./config.js";
import { state, subscribe, STAGES, isSupervisor } from "./state.js";
import { signUp, signIn, signOut, loadProfile, updateProfileStage, initAuthListener } from "./auth.js";
import { loadContents, loadProgress, markComplete, getStageLabel, getProgressSummary, loadLessonDetails } from "./dashboard.js";
import { listJournalEntries, addJournalEntry } from "./journal.js";
import { listTickets, createTicket, listMessages, sendMessage, subscribeToTicket } from "./support.js";
import { el, escapeHtml, sanitizeUrl } from "./utils/sanitize.js";
import { renderAdmin, teardownAdmin } from "./admin/admin.js";

// ---------------------------------------------------------------
// عناصر DOM الرئيسية
// ---------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const viewAuth = $("#view-auth");
const viewOnboarding = $("#view-onboarding");
const appShell = $("#app-shell");

let activeUnsubscribeTicket = null;
let selectedMood = "😊";
let currentTicketId = null;

// ---------------------------------------------------------------
// Toast بسيط
// ---------------------------------------------------------------
function toast(message, type = "info") {
  const node = el("div", { className: `toast ${type === "error" ? "error" : ""}`, text: message });
  $("#toast-root").appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

// ---------------------------------------------------------------
// المصادقة: تبديل بين تسجيل الدخول وإنشاء الحساب
// ---------------------------------------------------------------
$("#link-to-signup").addEventListener("click", (e) => {
  e.preventDefault();
  $("#form-signin").classList.add("hidden");
  $("#form-signup").classList.remove("hidden");
});
$("#link-to-signin").addEventListener("click", (e) => {
  e.preventDefault();
  $("#form-signup").classList.add("hidden");
  $("#form-signin").classList.remove("hidden");
});

$("#form-signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await signIn({
      email: $("#signin-email").value.trim(),
      password: $("#signin-password").value,
    });
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

$("#form-signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await signUp({
      email: $("#signup-email").value.trim(),
      password: $("#signup-password").value,
      displayName: $("#signup-name").value.trim(),
      gender: $("#signup-gender").value,
    });
    toast("تم إنشاء الحساب! يمكنك الآن تسجيل الدخول.");
    $("#form-signup").classList.add("hidden");
    $("#form-signin").classList.remove("hidden");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

$("#btn-signout").addEventListener("click", async () => {
  if (activeUnsubscribeTicket) activeUnsubscribeTicket();
  await signOut();
});

// ---------------------------------------------------------------
// Onboarding (مرة واحدة لكل مستخدم — تُحفظ محلياً)
// ---------------------------------------------------------------
const ONBOARDING_SLIDES = [
  { icon: "🧭", title: "رحلة من 4 مراحل", text: "من ما قبل الخطوبة حتى استقرار الأسرة، محتوى مخصص لكل مرحلة تمر بها." },
  { icon: "📔", title: "مذكراتك خاصة تماماً", text: "مساحة شخصية لتدوين أفكارك ومشاعرك، لا يراها أحد حتى المشرفون." },
  { icon: "💬", title: "دعم دائم بجانبك", text: "افتح تذكرة دعم أو تواصل مباشرة عبر واتساب في أي وقت." },
];
let onboardingIndex = 0;

function renderOnboarding() {
  const slide = ONBOARDING_SLIDES[onboardingIndex];
  const container = $("#onboarding-slide");
  container.innerHTML = "";
  container.appendChild(
    el("div", {}, [
      el("div", { text: slide.icon, attrs: { style: "font-size:3rem; margin-bottom: 12px;" } }),
      el("h2", { text: slide.title, attrs: { style: "margin-bottom: 8px; color: var(--color-primary-dark);" } }),
      el("p", { text: slide.text, attrs: { style: "color: var(--color-text-muted); font-family: var(--font-utility);" } }),
    ])
  );
  const dots = $("#onboarding-dots");
  dots.innerHTML = "";
  ONBOARDING_SLIDES.forEach((_, i) => {
    dots.appendChild(el("span", { className: i === onboardingIndex ? "active" : "" }));
  });
  $("#btn-onboarding-next").textContent = onboardingIndex === ONBOARDING_SLIDES.length - 1 ? "ابدأ الآن" : "التالي";
}

$("#btn-onboarding-next").addEventListener("click", () => {
  if (onboardingIndex < ONBOARDING_SLIDES.length - 1) {
    onboardingIndex++;
    renderOnboarding();
  } else {
    finishOnboarding();
  }
});
$("#btn-onboarding-skip").addEventListener("click", finishOnboarding);

function finishOnboarding() {
  localStorage.setItem(`onboarding_done_${state.session.user.id}`, "1");
  showApp();
}

// ---------------------------------------------------------------
// حلقات المراحل: تلوين الحلقة بناءً على المرحلة الحالية للمستخدم
// ---------------------------------------------------------------
function paintStageRings() {
  const order = ["pre_engagement", "engaged", "newlywed", "settled"];
  const currentIndex = order.indexOf(state.profile?.stage);
  $$(".stage-ring").forEach((ring) => {
    order.forEach((key, i) => {
      ring.style.setProperty(`--seg${i + 1}`, i <= currentIndex ? "var(--color-accent)" : "var(--color-border)");
    });
  });
}

// ---------------------------------------------------------------
// إظهار التطبيق الرئيسي بعد تسجيل الدخول
// ---------------------------------------------------------------
async function showApp() {
  viewAuth.classList.add("hidden");
  viewOnboarding.classList.add("hidden");
  appShell.classList.remove("hidden");

  $("#header-username").textContent = state.profile.display_name || "مستخدم";
  $("#header-stage").textContent = getStageLabel(state.profile.stage);
  $("#profile-name").value = state.profile.display_name || "";
  $("#profile-stage").value = state.profile.stage;

  const waNumber = state.profile.whatsapp_number || CONFIG.WHATSAPP_DEFAULT_NUMBER;
  $("#whatsapp-fab").href = sanitizeUrl(`https://wa.me/${waNumber.replace(/\D/g, "")}`);

  $$("#nav-admin-sidebar, #nav-admin-bottom").forEach((n) => n.classList.toggle("hidden", !isSupervisor()));

  paintStageRings();

  try {
    await loadContents();
    await loadProgress();
  } catch (err) {
    toast(err.message, "error");
  }

  navigate(location.hash.replace("#", "") || "dashboard");
}

// ---------------------------------------------------------------
// الراوتر (Hash-based)
// ---------------------------------------------------------------
const ROUTES = ["dashboard", "lesson", "journal", "support", "ticket", "profile", "admin"];

function navigate(route) {
  if (!ROUTES.includes(route)) route = "dashboard";
  if (route === "admin" && !isSupervisor()) route = "dashboard"; // حماية: توجيه أي مستخدم عادي بعيداً عن #admin
  if (activeUnsubscribeTicket && route !== "ticket") {
    activeUnsubscribeTicket();
    activeUnsubscribeTicket = null;
  }
  if (route !== "admin") teardownAdmin();
  ROUTES.forEach((r) => $(`#view-${r}`).classList.toggle("hidden", r !== route));
  $$(".nav-item[data-route]").forEach((n) => n.classList.toggle("active", n.dataset.route === route));
  location.hash = route;

  if (route === "dashboard") renderDashboard();
  if (route === "journal") renderJournal();
  if (route === "support") renderTickets();
  if (route === "admin") renderAdmin(toast);
}

$$(".nav-item[data-route]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigate(link.dataset.route);
  });
});

// ---------------------------------------------------------------
// لوحة التحكم + قائمة الدروس
// ---------------------------------------------------------------
function renderDashboard() {
  const summary = getProgressSummary();
  $("#hero-title").textContent = `أهلاً ${state.profile.display_name || ""} 👋`;
  $("#hero-subtitle").textContent = `أنت الآن في مرحلة: ${getStageLabel(state.profile.stage)}`;
  $("#hero-percent").textContent = `${summary.percent}%`;

  const list = $("#content-list");
  list.innerHTML = "";

  if (state.contents.length === 0) {
    list.appendChild(
      el("div", { className: "empty-state" }, [
        el("div", { className: "icon", text: "📭" }),
        el("p", { text: "لا توجد دروس متاحة لمرحلتك حالياً، تابعنا قريباً." }),
      ])
    );
    return;
  }

  state.contents.forEach((content) => {
    const done = state.progressByContentId.has(content.id);
    const card = el("div", { className: "lesson-card", attrs: { "data-id": content.id, tabindex: "0", role: "button" } }, [
      done ? el("span", { className: "badge-done", text: "✓ مكتمل" }) : null,
      el("span", { className: "category", text: content.category || "درس عام" }),
      el("h3", { text: content.title }),
      el("p", { className: "excerpt", text: (content.body || "").slice(0, 90) + "…" }),
    ]);
    card.addEventListener("click", () => openLesson(content.id));
    card.addEventListener("keypress", (e) => e.key === "Enter" && openLesson(content.id));
    list.appendChild(card);
  });
}

let currentLessonId = null;

async function openLesson(id) {
  const content = state.contents.find((c) => c.id === id);
  if (!content) return;
  currentLessonId = id;
  $("#lesson-category").textContent = content.category || "درس عام";
  $("#lesson-title").textContent = content.title;

  const bodyEl = $("#lesson-body");
  bodyEl.innerHTML = "";
  bodyEl.appendChild(el("div", { className: "spinner" }));

  const done = state.progressByContentId.has(id);
  const btn = $("#btn-mark-complete");
  btn.textContent = done ? "✓ تم إنهاء هذا الدرس" : "أنهيت هذا الدرس ✓";
  btn.disabled = done;

  navigate("lesson");

  try {
    const { sections, media } = await loadLessonDetails(id);
    bodyEl.innerHTML = "";

    if (sections.length === 0) {
      // توافق خلفي: لا توجد فقرات بعد لهذا الدرس، اعرض النص الاحتياطي القديم
      bodyEl.appendChild(el("p", { className: "lesson-section-paragraph", text: content.body }));
    } else {
      sections.forEach((s) => {
        if (s.type === "header") {
          bodyEl.appendChild(el("h3", { className: "lesson-section-header", text: s.body }));
        } else {
          bodyEl.appendChild(el("p", { className: "lesson-section-paragraph", text: s.body }));
        }
      });
    }

    if (media.length > 0) {
      const mediaList = el("div", { className: "lesson-media-list" });
      const icons = { youtube: "▶️", pdf: "📄", link: "🔗" };
      media.forEach((m) => {
        const link = el("a", {
          className: "lesson-media-link",
          text: `${icons[m.type] || "🔗"} ${m.title || m.url}`,
          attrs: { href: sanitizeUrl(m.url), target: "_blank", rel: "noopener" },
        });
        mediaList.appendChild(link);
      });
      bodyEl.appendChild(mediaList);
    }
  } catch (err) {
    bodyEl.innerHTML = "";
    bodyEl.appendChild(el("p", { className: "lesson-section-paragraph", text: content.body }));
    toast(err.message, "error");
  }
}

$("#btn-back-to-dashboard").addEventListener("click", () => navigate("dashboard"));

$("#btn-mark-complete").addEventListener("click", async () => {
  if (!currentLessonId) return;
  try {
    await markComplete(currentLessonId);
    $("#btn-mark-complete").textContent = "✓ تم إنهاء هذا الدرس";
    $("#btn-mark-complete").disabled = true;
    $("#btn-mark-complete").classList.add("success-pulse");
    toast("أحسنت! تم تسجيل إتمام الدرس 🎉");
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------------------------------------------------------------
// المذكرات
// ---------------------------------------------------------------
$$(".mood-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedMood = btn.dataset.mood;
    $$(".mood-option").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});
$(".mood-option")?.classList.add("selected");

async function renderJournal() {
  const list = $("#journal-list");
  list.innerHTML = "";
  list.appendChild(el("div", { className: "spinner" }));
  try {
    const entries = await listJournalEntries();
    list.innerHTML = "";
    if (entries.length === 0) {
      list.appendChild(
        el("div", { className: "empty-state" }, [
          el("div", { className: "icon", text: "📝" }),
          el("p", { text: "لم تكتب أي مذكرة بعد، ابدأ الآن." }),
        ])
      );
      return;
    }
    entries.forEach((entry) => {
      const date = new Date(entry.created_at).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
      list.appendChild(
        el("div", { className: "journal-entry" }, [
          el("div", {}, [
            el("span", { className: "mood", text: entry.mood || "📝" }),
            entry.title ? el("strong", { text: "  " + entry.title }) : null,
          ]),
          el("p", { text: entry.body, attrs: { style: "margin: 8px 0;" } }),
          el("div", { className: "date", text: date }),
        ])
      );
    });
  } catch (err) {
    list.innerHTML = "";
    toast(err.message, "error");
  }
}

$("#form-journal").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bodyEl = $("#journal-body");
  const titleEl = $("#journal-title");
  try {
    await addJournalEntry({ title: titleEl.value.trim(), body: bodyEl.value.trim(), mood: selectedMood });
    bodyEl.value = "";
    titleEl.value = "";
    toast("تم حفظ مذكرتك 📔");
    renderJournal();
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------------------------------------------------------------
// الدعم الفني
// ---------------------------------------------------------------
async function renderTickets() {
  const list = $("#ticket-list");
  list.innerHTML = "";
  list.appendChild(el("div", { className: "spinner" }));
  try {
    const tickets = await listTickets();
    list.innerHTML = "";
    if (tickets.length === 0) {
      list.appendChild(
        el("div", { className: "empty-state" }, [
          el("div", { className: "icon", text: "💬" }),
          el("p", { text: "لا توجد تذاكر دعم بعد." }),
        ])
      );
      return;
    }
    tickets.forEach((t) => {
      const item = el("div", { className: "ticket-item" }, [
        el("span", { text: t.subject }),
        el("span", { className: `ticket-status ${t.status}`, text: t.status === "open" ? "مفتوحة" : "مغلقة" }),
      ]);
      item.addEventListener("click", () => openTicket(t.id, t.subject));
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = "";
    toast(err.message, "error");
  }
}

$("#form-new-ticket").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#ticket-subject");
  try {
    const t = await createTicket(input.value.trim());
    input.value = "";
    toast("تم فتح التذكرة");
    await renderTickets();
    openTicket(t.id, t.subject);
  } catch (err) {
    toast(err.message, "error");
  }
});

async function openTicket(id, subject) {
  currentTicketId = id;
  $("#ticket-title").textContent = subject;
  navigate("ticket");
  await renderMessages();

  if (activeUnsubscribeTicket) activeUnsubscribeTicket();
  activeUnsubscribeTicket = subscribeToTicket(id, (msg) => {
    appendMessageBubble(msg);
  });
}

async function renderMessages() {
  const thread = $("#chat-thread");
  thread.innerHTML = "";
  try {
    const messages = await listMessages(currentTicketId);
    messages.forEach(appendMessageBubble);
    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    toast(err.message, "error");
  }
}

function appendMessageBubble(msg) {
  const isMe = msg.sender_id === state.session.user.id;
  const thread = $("#chat-thread");
  thread.appendChild(el("div", { className: `chat-bubble ${isMe ? "me" : "them"}`, text: msg.message }));
  thread.scrollTop = thread.scrollHeight;
}

$("#btn-back-to-support").addEventListener("click", () => navigate("support"));

$("#form-chat").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await sendMessage(currentTicketId, text);
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------------------------------------------------------------
// الحساب
// ---------------------------------------------------------------
$("#btn-save-stage").addEventListener("click", async () => {
  try {
    await updateProfileStage($("#profile-stage").value);
    $("#header-stage").textContent = getStageLabel(state.profile.stage);
    paintStageRings();
    toast("تم تحديث مرحلتك بنجاح");
    await loadContents();
    await loadProgress();
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------------------------------------------------------------
// نقطة البداية: مراقبة حالة الجلسة
// ---------------------------------------------------------------
initAuthListener(async (session) => {
  if (!session) {
    appShell.classList.add("hidden");
    viewOnboarding.classList.add("hidden");
    viewAuth.classList.remove("hidden");
    return;
  }
  try {
    await loadProfile(session.user.id);
    const onboardingDone = localStorage.getItem(`onboarding_done_${session.user.id}`);
    if (!onboardingDone) {
      viewAuth.classList.add("hidden");
      appShell.classList.add("hidden");
      viewOnboarding.classList.remove("hidden");
      onboardingIndex = 0;
      renderOnboarding();
    } else {
      showApp();
    }
  } catch (err) {
    toast(err.message, "error");
  }
});

window.addEventListener("hashchange", () => {
  if (!appShell.classList.contains("hidden")) {
    navigate(location.hash.replace("#", ""));
  }
});

// ---------------------------------------------------------------
// تسجيل Service Worker (PWA)
// ---------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

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
let currentLessonId = null;
let lessonScrollTimeout = null;

// ---------------------------------------------------------------
// Toast بسيط
// ---------------------------------------------------------------
function toast(message, type = "info") {
  const node = el("div", { className: `toast ${type === "error" ? "error" : ""}`, text: message });
  $("#toast-root").appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

// ---------------------------------------------------------------
// إدارة إظهار/إخفاء التنقل السفلي عند التمرير
// ---------------------------------------------------------------
function initLessonScrollBehavior() {
  const lessonView = $("#view-lesson");
  const bottomNav = $(".bottom-nav");
  let lastScrollTop = 0;
  let isNavigationVisible = true;

  lessonView.addEventListener("scroll", () => {
    clearTimeout(lessonScrollTimeout);
    const currentScroll = lessonView.scrollTop;

    if (currentScroll > lastScrollTop && isNavigationVisible) {
      // التمرير لأسفل → إخفاء التنقل
      bottomNav.style.opacity = "0";
      bottomNav.style.pointerEvents = "none";
      bottomNav.style.transform = "translateY(80px)";
      isNavigationVisible = false;
    } else if (currentScroll < lastScrollTop && !isNavigationVisible) {
      // التمرير لأعلى → إظهار التنقل
      bottomNav.style.opacity = "1";
      bottomNav.style.pointerEvents = "auto";
      bottomNav.style.transform = "translateY(0)";
      isNavigationVisible = true;
    }

    lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;

    // إظهار التنقل عند الوصول لأعلى الصفحة
    if (currentScroll === 0) {
      bottomNav.style.opacity = "1";
      bottomNav.style.pointerEvents = "auto";
      bottomNav.style.transform = "translateY(0)";
      isNavigationVisible = true;
    }
  });

  // إعادة تعيين عند فتح درس جديد
  lessonView.scrollTop = 0;
  bottomNav.style.opacity = "1";
  bottomNav.style.pointerEvents = "auto";
  bottomNav.style.transform = "translateY(0)";
  isNavigationVisible = true;
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
// Onboarding
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
// حلقات المراحل
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
// إظهار التطبيق الرئيسي
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
// الراوتر
// ---------------------------------------------------------------
const ROUTES = ["dashboard", "lesson", "journal", "support", "ticket", "profile", "admin"];

function navigate(route) {
  if (!ROUTES.includes(route)) route = "dashboard";
  if (route === "admin" && !isSupervisor()) route = "dashboard";
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
      el("span", { className: "category", text: content.category || "درس" }),
      el("h3", { text: content.title }),
      el("p", { className: "excerpt", text: content.body.substring(0, 100) + "..." }),
    ]);
    card.addEventListener("click", () => openLesson(content.id));
    list.appendChild(card);
  });
}

// ---------------------------------------------------------------
// فتح الدرس مع التبويبات
// ---------------------------------------------------------------
async function openLesson(contentId) {
  currentLessonId = contentId;
  navigate("lesson");

  const content = state.contents.find((c) => c.id === contentId);
  if (!content) {
    toast("لم يتم العثور على الدرس", "error");
    return;
  }

  $("#lesson-category").textContent = content.category || "درس";
  $("#lesson-title").textContent = content.title;

  // إنشاء عنصر التبويبات
  const tabsContainer = el("div", { className: "lesson-tabs-wrapper" });
  const tabsBar = el("div", { className: "lesson-tabs-bar" });
  const tabsContent = el("div", { className: "lesson-tabs-content" });

  // التبويب الأول: الفيديو
  const videoTab = el("button", {
    className: "lesson-tab-button active",
    text: "🎥 الفيديو",
    attrs: { type: "button", "data-tab": "video" },
  });

  // التبويب الثاني: المفكرة/النص
  const notesTab = el("button", {
    className: "lesson-tab-button",
    text: "📝 المفكرة",
    attrs: { type: "button", "data-tab": "notes" },
  });

  tabsBar.appendChild(videoTab);
  tabsBar.appendChild(notesTab);

  // محتوى التبويب الأول
  const videoContent = el("div", { className: "lesson-tab-pane active", attrs: { "data-tab": "video" } });
  if (content.video_url) {
    const iframe = el("iframe", {
      attrs: {
        src: content.video_url,
        width: "100%",
        height: "400px",
        frameborder: "0",
        allowfullscreen: "allowfullscreen",
        style: "border-radius: var(--radius-md); margin-bottom: var(--space-4);",
      },
    });
    videoContent.appendChild(iframe);
  } else {
    videoContent.appendChild(
      el("div", { className: "empty-state" }, [
        el("div", { className: "icon", text: "🎬" }),
        el("p", { text: "لا يوجد فيديو متاح لهذا الدرس." }),
      ])
    );
  }

  // النص الأساسي بعد الفيديو
  const mainText = el("div", { className: "lesson-body" });
  mainText.textContent = content.body;
  videoContent.appendChild(mainText);

  // محتوى التبويب الثاني
  const notesContent = el("div", { className: "lesson-tab-pane", attrs: { "data-tab": "notes" } });
  if (content.notes) {
    // دعم HTML في المفكرة
    notesContent.innerHTML = content.notes;
    // تطبيق CSS مخصص على المحتوى HTML
    notesContent.querySelectorAll("*").forEach((el) => {
      el.style.fontFamily = "var(--font-body)";
      el.style.fontSize = "1rem";
      el.style.lineHeight = "1.8";
      el.style.color = "var(--color-text)";
      el.style.marginBottom = "var(--space-3)";
    });
    notesContent.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
      el.style.fontFamily = "var(--font-display)";
      el.style.fontWeight = "700";
      el.style.color = "var(--color-primary-dark)";
      el.style.marginTop = "var(--space-4)";
      el.style.marginBottom = "var(--space-2)";
    });
    notesContent.querySelectorAll("p").forEach((el) => {
      el.style.marginBottom = "var(--space-3)";
    });
  } else {
    notesContent.appendChild(
      el("div", { className: "empty-state" }, [
        el("div", { className: "icon", text: "📓" }),
        el("p", { text: "لا توجد مفكرة لهذا الدرس." }),
      ])
    );
  }

  tabsContent.appendChild(videoContent);
  tabsContent.appendChild(notesContent);

  tabsContainer.appendChild(tabsBar);
  tabsContainer.appendChild(tabsContent);

  // إدارة تبديل التبويبات
  videoTab.addEventListener("click", () => switchTab("video", tabsBar, tabsContent));
  notesTab.addEventListener("click", () => switchTab("notes", tabsBar, tabsContent));

  // دالة تبديل التبويب
  function switchTab(tabName, bar, content) {
    bar.querySelectorAll(".lesson-tab-button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    content.querySelectorAll(".lesson-tab-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.tab === tabName);
    });
  }

  // مسح المحتوى القديم وإضافة التبويبات
  const lessonBody = $("#lesson-body");
  lessonBody.innerHTML = "";
  lessonBody.appendChild(tabsContainer);

  // تهيئة سلوك التمرير
  initLessonScrollBehavior();

  try {
    const done = state.progressByContentId.has(currentLessonId);
    const markBtn = $("#btn-mark-complete");
    if (done) {
      markBtn.textContent = "✓ تم إنهاء هذا الدرس";
      markBtn.disabled = true;
      markBtn.classList.add("success-pulse");
    } else {
      markBtn.textContent = "أنهيت هذا الدرس ✓";
      markBtn.disabled = false;
      markBtn.classList.remove("success-pulse");
    }
  } catch (err) {
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
// نقطة البداية
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
// تسجيل Service Worker
// ---------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

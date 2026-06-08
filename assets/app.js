/* ═══════════════════════════════════════════════════
   QCOM INTEL — app.js
   Loads articles.json + topics.json, renders the UI,
   handles filtering/search/bookmarks/dark mode
═══════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ── STATE ────────────────────────────────────── */
  let allArticles = [];
  let topics      = [];
  let activeTopic = "all";
  let activeDays  = 0;
  let searchQuery = "";
  let bookmarks   = new Set(JSON.parse(localStorage.getItem("qcom_bookmarks") || "[]"));

  /* ── TOPIC COLOUR MAP ─────────────────────────── */
  const TOPIC_COLORS = {
    quick_commerce: { bg: "#fff1eb", color: "#c44b0a" },
    ecommerce:      { bg: "#e0f5fd", color: "#0369a1" },
    fmcg:           { bg: "#f5edff", color: "#7e22ce" },
    retail_tech:    { bg: "#dcfce7", color: "#15803d" },
    funding:        { bg: "#fef9c3", color: "#854d0e" },
  };

  /* ── DARK MODE ────────────────────────────────── */
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const savedTheme  = localStorage.getItem("qcom_theme");
  const initTheme   = savedTheme || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", initTheme);

  document.getElementById("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("qcom_theme", next);
  });

  /* ── INIT ─────────────────────────────────────── */
  async function init() {
    try {
      const [topicsData, articlesData] = await Promise.all([
        fetchJSON("data/topics.json"),
        fetchJSON("data/articles.json"),
      ]);

      topics      = topicsData.topics || [];
      allArticles = articlesData.articles || [];

      updateLastUpdated(articlesData.generated_at);
      buildTopicTabs();
      renderAll();

      const hasFallback = allArticles.some(a => a.is_fallback);
      if (hasFallback) showFallbackBanner();

    } catch (err) {
      console.error("Init error:", err);
      showError();
    }
  }

  async function fetchJSON(path) {
    const res = await fetch(path + "?t=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  /* ── TIMESTAMP ────────────────────────────────── */
  function updateLastUpdated(isoStr) {
    const el = document.getElementById("lastUpdated");
    if (!isoStr) { el.textContent = ""; return; }
    try {
      const dt  = new Date(isoStr);
      const now = new Date();
      const diffH = Math.round((now - dt) / 3600000);
      let label;
      if (diffH < 1)      label = "Updated just now";
      else if (diffH < 24) label = `Updated ${diffH}h ago`;
      else                 label = `Updated ${dt.toLocaleDateString("en-IN", { day:"numeric", month:"short" })}`;
      el.textContent = label;
    } catch { el.textContent = ""; }
  }

  /* ── TOPIC TABS ───────────────────────────────── */
  function buildTopicTabs() {
    const nav = document.getElementById("topicTabs");
    topics.forEach(topic => {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.dataset.topic = topic.id;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", "false");
      btn.innerHTML = `${topic.label} <span class="tab-count" id="count-${topic.id}">—</span>`;
      btn.addEventListener("click", () => setTopic(topic.id));
      nav.appendChild(btn);
    });

    nav.querySelector('[data-topic="all"]').addEventListener("click", () => setTopic("all"));
    updateCounts();
  }

  function setTopic(topicId) {
    activeTopic = topicId;
    document.querySelectorAll(".tab").forEach(btn => {
      const active = btn.dataset.topic === topicId;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active);
    });
    renderAll();
  }

  function updateCounts() {
    const countEl = id => document.getElementById("count-" + id);
    const allEl   = countEl("all");
    if (allEl) allEl.textContent = allArticles.length;
    topics.forEach(t => {
      const el = countEl(t.id);
      if (el) el.textContent = allArticles.filter(a => a.topics && a.topics.includes(t.id)).length;
    });
  }

  /* ── FILTERING ────────────────────────────────── */
  function getFilteredArticles() {
    const cutoff = activeDays > 0
      ? new Date(Date.now() - activeDays * 86400000)
      : null;

    return allArticles.filter(a => {
      // topic filter
      if (activeTopic !== "all" && (!a.topics || !a.topics.includes(activeTopic))) return false;

      // date filter
      if (cutoff && a.published_at) {
        try {
          if (new Date(a.published_at) < cutoff) return false;
        } catch {}
      }

      // search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = [a.title, a.summary, a.source].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }

  /* ── RENDER ALL ───────────────────────────────── */
  function renderAll() {
    const filtered = getFilteredArticles();
    const isEmpty  = filtered.length === 0;

    document.getElementById("emptyState").hidden = !isEmpty;
    document.getElementById("featuredSection").hidden = isEmpty;
    document.getElementById("topHeadlinesSection").hidden = isEmpty;
    document.getElementById("latestSection").hidden = isEmpty;

    if (isEmpty) return;

    renderFeatured(filtered[0]);
    renderTopHeadlines(filtered.slice(1, 7));
    renderLatest(filtered.slice(7));
  }

  /* ── FEATURED ─────────────────────────────────── */
  function renderFeatured(article) {
    const el = document.getElementById("featuredCard");
    el.innerHTML = `
      <div class="featured-badge">Featured Story</div>
      <div class="featured-title">${esc(article.title)}</div>
      ${ article.summary ? `<div class="featured-summary">${esc(article.summary)}</div>` : "" }
      <div class="featured-footer">
        <span class="featured-source">${esc(article.source)}</span>
        <span>${formatDate(article.published_at)}</span>
        ${renderTopicChips(article.topics)}
        <a class="featured-cta" href="${article.url}" target="_blank" rel="noopener noreferrer">
          Read Article →
        </a>
      </div>
    `;
    el.onclick = e => {
      if (!e.target.closest(".featured-cta")) openModal(article);
    };
    el.classList.add("fade-in");
  }

  /* ── TOP HEADLINES ────────────────────────────── */
  function renderTopHeadlines(articles) {
    const grid = document.getElementById("topHeadlines");
    grid.innerHTML = "";
    if (!articles.length) {
      document.getElementById("topHeadlinesSection").hidden = true;
      return;
    }
    articles.forEach(a => {
      const card = document.createElement("div");
      card.className = "headline-card fade-in";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      // topic accent color
      const primaryTopic = a.topics && a.topics[0];
      const topicColor = primaryTopic ? (topics.find(t => t.id === primaryTopic) || {}).color : null;
      if (topicColor) card.style.setProperty("--topic-accent", topicColor);
      card.style.cssText += `border-left-color: ${topicColor || "var(--border)"}`;
      card.querySelector?.("::before");

      card.innerHTML = `
        <div class="headline-title">${esc(a.title)}</div>
        <div class="headline-meta">
          <span class="card-source">${esc(a.source)}</span>
          <span>${formatDate(a.published_at)}</span>
          ${freshnessBadge(a.published_at)}
        </div>
        ${renderTopicChips(a.topics)}
      `;

      // Apply left border color via inline style on pseudo-element workaround
      card.style.borderLeftColor = topicColor || "transparent";

      card.addEventListener("click", () => openModal(a));
      card.addEventListener("keydown", e => { if (e.key === "Enter") openModal(a); });
      grid.appendChild(card);
    });
  }

  /* ── LATEST LIST ──────────────────────────────── */
  function renderLatest(articles) {
    const list = document.getElementById("articlesList");
    list.innerHTML = "";
    if (!articles.length) {
      document.getElementById("latestSection").hidden = true;
      return;
    }
    articles.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "article-row fade-in";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");

      const isBookmarked = bookmarks.has(a.id);

      row.innerHTML = `
        <div class="article-row-num">${String(i + 8).padStart(2, "0")}</div>
        <div class="article-row-body">
          <div class="article-row-title">${esc(a.title)}</div>
          ${ a.summary ? `<div class="article-row-summary">${esc(a.summary)}</div>` : "" }
          <div class="article-row-meta">
            <span class="card-source">${esc(a.source)}</span>
            <span>${formatDate(a.published_at)}</span>
            ${freshnessBadge(a.published_at)}
            ${renderTopicChips(a.topics)}
          </div>
        </div>
        <button class="bookmark-btn ${isBookmarked ? "bookmarked" : ""}"
          aria-label="${isBookmarked ? "Remove bookmark" : "Bookmark"}"
          title="Bookmark">
          ${isBookmarked ? "★" : "☆"}
        </button>
      `;

      const bookmarkBtn = row.querySelector(".bookmark-btn");
      bookmarkBtn.addEventListener("click", e => {
        e.stopPropagation();
        toggleBookmark(a.id, bookmarkBtn);
      });

      row.addEventListener("click", () => openModal(a));
      row.addEventListener("keydown", e => { if (e.key === "Enter") openModal(a); });
      list.appendChild(row);
    });
  }

  /* ── BOOKMARKS ────────────────────────────────── */
  function toggleBookmark(id, btn) {
    if (bookmarks.has(id)) {
      bookmarks.delete(id);
      btn.textContent = "☆";
      btn.classList.remove("bookmarked");
      btn.setAttribute("aria-label", "Bookmark");
    } else {
      bookmarks.add(id);
      btn.textContent = "★";
      btn.classList.add("bookmarked");
      btn.setAttribute("aria-label", "Remove bookmark");
    }
    localStorage.setItem("qcom_bookmarks", JSON.stringify([...bookmarks]));
  }

  /* ── MODAL ────────────────────────────────────── */
  function openModal(article) {
    const overlay = document.getElementById("modalOverlay");
    const content = document.getElementById("modalContent");

    content.innerHTML = `
      <div class="modal-topics">${renderTopicChips(article.topics)}</div>
      <div class="modal-title">${esc(article.title)}</div>
      <div class="modal-meta">
        <span class="card-source">${esc(article.source)}</span>
        <span>${formatDate(article.published_at, true)}</span>
        ${freshnessBadge(article.published_at)}
      </div>
      ${ article.summary ? `<div class="modal-summary">${esc(article.summary)}</div>` : "" }
      <a class="modal-cta" href="${article.url}" target="_blank" rel="noopener noreferrer">
        Read Full Article ↗
      </a>
    `;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("modalClose").focus();
  }

  function closeModal() {
    document.getElementById("modalOverlay").hidden = true;
    document.body.style.overflow = "";
  }

  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalOverlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });

  /* ── SEARCH ───────────────────────────────────── */
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    searchClear.classList.toggle("visible", searchQuery.length > 0);
    renderAll();
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    searchClear.classList.remove("visible");
    searchInput.focus();
    renderAll();
  });

  /* ── DATE FILTER ──────────────────────────────── */
  document.querySelectorAll(".date-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".date-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeDays = parseInt(btn.dataset.days, 10);
      renderAll();
    });
  });

  /* ── HELPERS ──────────────────────────────────── */
  function esc(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(isoStr, long = false) {
    if (!isoStr) return "";
    try {
      const dt = new Date(isoStr);
      if (long) {
        return dt.toLocaleString("en-IN", {
          day: "numeric", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        });
      }
      const now  = new Date();
      const diff = now - dt;
      const mins = Math.round(diff / 60000);
      if (mins < 60)  return `${mins}m ago`;
      if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
      return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    } catch {
      return "";
    }
  }

  function freshnessBadge(isoStr) {
    if (!isoStr) return "";
    try {
      const diff = Date.now() - new Date(isoStr).getTime();
      const h = diff / 3600000;
      if (h < 3)  return `<span class="freshness-badge fresh-new">NEW</span>`;
      if (h < 12) return `<span class="freshness-badge fresh-today">TODAY</span>`;
      if (h < 72) return `<span class="freshness-badge fresh-recent">RECENT</span>`;
      return "";
    } catch { return ""; }
  }

  function renderTopicChips(topicIds) {
    if (!topicIds || !topicIds.length) return "";
    return `<div class="topic-chips">${
      topicIds.map(id => {
        const t = topics.find(t => t.id === id);
        const label = t ? t.label : id;
        const style = TOPIC_COLORS[id]
          ? `background:${TOPIC_COLORS[id].bg};color:${TOPIC_COLORS[id].color}`
          : "background:var(--surface-2);color:var(--text-muted)";
        return `<span class="topic-chip" style="${style}">${esc(label)}</span>`;
      }).join("")
    }</div>`;
  }

  function showFallbackBanner() {
    let banner = document.querySelector(".fallback-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "fallback-banner";
      banner.textContent = "⚠ Showing sample articles — live fetch hasn't run yet or no articles matched. Run the GitHub Action to populate live data.";
      document.querySelector(".main-content").prepend(banner);
    }
    banner.classList.add("visible");
  }

  function showError() {
    const el = document.getElementById("featuredCard");
    if (el) {
      el.innerHTML = `<div class="loading-state">
        <div class="empty-icon">⚠</div>
        <p>Could not load articles. Check console for details.</p>
      </div>`;
    }
  }

  /* ── BOOT ─────────────────────────────────────── */
  init();
})();

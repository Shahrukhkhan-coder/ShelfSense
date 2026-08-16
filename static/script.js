// ==========================================================================
// Configuration
// ==========================================================================
// If the frontend is served by the same FastAPI application, these can be
// simplified to relative paths:
//   const HEALTH_URL = "/health";
//   const BOOKS_URL = "/books";
//   const PREDICT_URL = "/predict";
const API_BASE_URL = "https://shelfsense-production-b655.up.railway.app";
const HEALTH_URL = `${API_BASE_URL}/health`;
const BOOKS_URL = `${API_BASE_URL}/books`;
const PREDICT_URL = `${API_BASE_URL}/predict`;

const REQUEST_TIMEOUT_MS = 20000;
const SESSION_KEY = "shelfsense-session";
const HISTORY_KEY = "shelfsense-history";
const THEME_KEY = "shelfsense-theme";
const MAX_HISTORY = 5;
const MAX_SUGGESTIONS = 8;

const INSIGHTS = [
  "Similarity in reading patterns often crosses genre boundaries.",
  "Two books can feel alike in structure long before they feel alike in subject.",
  "Nearest-neighbor models find patterns readers might never consciously notice.",
  "A dataset's shape is its own kind of literary fingerprint.",
  "The next great read is sometimes closer than the shelf suggests.",
];

const LOADING_MESSAGES = [
  "Reading the selected title",
  "Comparing dataset patterns",
  "Exploring nearby book vectors",
  "Measuring similarity",
  "Preparing your reading list",
];

// ==========================================================================
// Central state
// ==========================================================================
const recommenderState = {
  allBooks: [],
  filteredBooks: [],
  selectedBook: "",
  activeSuggestionIndex: -1,
  recommendations: [],
  isSubmitting: false,
  modelAvailable: null,
  booksLoaded: false,
  lastRequestData: null,
};

let insightRotatorTimer = null;
let loadingRotatorTimer = null;
let activeAbortController = null;
const coverStyleCache = new Map();
const savedRecommendations = new Set(); // titles marked "saved" this session
const readRecommendations = new Set();  // titles marked "read" this session

let els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindStaticEvents();
  initTheme();
  rotateInsight();
  document.getElementById("currentYear").textContent = new Date().getFullYear();
  renderHistory();
  checkApiHealth();
  loadBookTitles();
  restoreSession();
});

function cacheElements() {
  els = {
    headerStatusDot: document.getElementById("headerStatusDot"),
    headerStatusText: document.getElementById("headerStatusText"),
    panelStatusDot: document.getElementById("panelStatusDot"),
    panelStatusText: document.getElementById("panelStatusText"),
    datasetBadgeText: document.getElementById("datasetBadgeText"),

    themeToggle: document.getElementById("themeToggle"),
    themeToggleIcon: document.getElementById("themeToggleIcon"),
    themeToggleLabel: document.getElementById("themeToggleLabel"),

    errorPanel: document.getElementById("errorPanel"),
    errorPanelText: document.getElementById("errorPanelText"),
    retryBtn: document.getElementById("retryBtn"),

    searchInput: document.getElementById("searchInput"),
    searchLoadingIndicator: document.getElementById("searchLoadingIndicator"),
    searchClearBtn: document.getElementById("searchClearBtn"),
    suggestionsListbox: document.getElementById("suggestionsListbox"),

    selectedBookCard: document.getElementById("selectedBookCard"),
    selectedBookCover: document.getElementById("selectedBookCover"),
    selectedBookTitle: document.getElementById("selectedBookTitle"),
    changeBookBtn: document.getElementById("changeBookBtn"),
    removeSelectionBtn: document.getElementById("removeSelectionBtn"),
    noSelectionState: document.getElementById("noSelectionState"),

    predictBtn: document.getElementById("predictBtn"),

    loadingPanel: document.getElementById("loadingPanel"),
    loadingRotatorText: document.getElementById("loadingRotatorText"),

    resultsPanel: document.getElementById("resultsPanel"),
    resultsReferenceTitle: document.getElementById("resultsReferenceTitle"),
    recommendationGrid: document.getElementById("recommendationGrid"),
    resultsMeta: document.getElementById("resultsMeta"),

    recommendAgainBtn: document.getElementById("recommendAgainBtn"),
    chooseAnotherBtn: document.getElementById("chooseAnotherBtn"),
    copyListBtn: document.getElementById("copyListBtn"),
    downloadListBtn: document.getElementById("downloadListBtn"),
    printListBtn: document.getElementById("printListBtn"),
    saveSessionBtn: document.getElementById("saveSessionBtn"),
    clearResultsBtn: document.getElementById("clearResultsBtn"),

    historyList: document.getElementById("historyList"),
    historyEmptyState: document.getElementById("historyEmptyState"),

    toast: document.getElementById("toast"),
    rotatingInsight: document.getElementById("rotatingInsight"),
    backToTopLink: document.getElementById("backToTopLink"),
  };
}

function bindStaticEvents() {
  els.searchInput.addEventListener("input", handleSearchInput);
  els.searchInput.addEventListener("keydown", handleSuggestionKeyboard);
  els.searchInput.addEventListener("focus", () => {
    if (els.searchInput.value.trim()) filterBookTitles(els.searchInput.value);
  });
  document.addEventListener("click", (e) => {
    if (!document.querySelector(".search-combobox").contains(e.target)) closeSuggestions();
  });
  els.searchClearBtn.addEventListener("click", clearSearchInput);

  els.changeBookBtn.addEventListener("click", () => {
    els.searchInput.focus();
    els.searchInput.select();
  });
  els.removeSelectionBtn.addEventListener("click", clearSelectedBook);

  els.predictBtn.addEventListener("click", () => submitRecommendation(recommenderState.selectedBook));
  els.retryBtn.addEventListener("click", () => {
    clearError();
    submitRecommendation(recommenderState.selectedBook);
  });

  els.recommendAgainBtn.addEventListener("click", () => submitRecommendation(recommenderState.selectedBook));
  els.chooseAnotherBtn.addEventListener("click", () => {
    els.searchInput.focus();
    els.searchInput.select();
  });
  els.copyListBtn.addEventListener("click", copyReadingList);
  els.downloadListBtn.addEventListener("click", downloadReadingList);
  els.printListBtn.addEventListener("click", printReadingList);
  els.saveSessionBtn.addEventListener("click", () => {
    saveSession();
    showToast("Session saved for this browser tab.");
  });
  els.clearResultsBtn.addEventListener("click", clearResults);

  els.themeToggle.addEventListener("click", toggleTheme);
  els.backToTopLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ==========================================================================
// Health check
// ==========================================================================
async function checkApiHealth() {
  setStatus("connecting", "Connecting to Library");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) { setStatus("error", "Connection Failed"); recommenderState.modelAvailable = false; updatePredictButtonState(); return; }
    const data = await response.json();
    if (data && data.Status === "Ok" && data.Model_loaded === true) {
      setStatus("online", "Recommendation Engine Ready");
      recommenderState.modelAvailable = true;
    } else {
      setStatus("error", "Model Not Loaded");
      recommenderState.modelAvailable = false;
    }
  } catch (error) {
    console.error("Health check failed:", error);
    setStatus("error", "Connection Failed");
    recommenderState.modelAvailable = false;
  }
  updatePredictButtonState();
}

function setStatus(state, text) {
  [els.headerStatusDot, els.panelStatusDot].forEach((dot) => {
    dot.classList.remove("status-online", "status-error");
    if (state === "online") dot.classList.add("status-online");
    if (state === "error") dot.classList.add("status-error");
  });
  els.headerStatusText.textContent = text;
  els.panelStatusText.textContent = text;
}

// ==========================================================================
// Books catalogue
// ==========================================================================
async function loadBookTitles() {
  els.searchLoadingIndicator.hidden = false;
  els.datasetBadgeText.textContent = "Loading catalogue…";
  try {
    const response = await fetch(BOOKS_URL);
    if (!response.ok) throw new Error(`Books endpoint returned ${response.status}`);
    const data = await response.json();

    if (!data || !Array.isArray(data.books)) {
      throw new Error("Books response did not include a valid 'books' array.");
    }

    const cleaned = Array.from(
      new Set(
        data.books
          .filter((title) => typeof title === "string")
          .map((title) => title.trim())
          .filter((title) => title.length > 0)
      )
    );

    recommenderState.allBooks = cleaned;
    recommenderState.booksLoaded = true;
    els.datasetBadgeText.textContent = `${cleaned.length.toLocaleString()} titles in catalogue`;
  } catch (error) {
    console.error("Failed to load book titles:", error);
    recommenderState.booksLoaded = false;
    els.datasetBadgeText.textContent = "Catalogue unavailable";
    showError("The available book catalogue could not be loaded. You may still enter a title manually, but it must exactly match a title in the trained dataset.");
  } finally {
    els.searchLoadingIndicator.hidden = true;
  }
}

// ==========================================================================
// Autocomplete
// ==========================================================================
function handleSearchInput() {
  const query = els.searchInput.value;
  els.searchClearBtn.hidden = query.trim().length === 0;

  // Typing again invalidates any prior confirmed selection.
  if (recommenderState.selectedBook && query !== recommenderState.selectedBook) {
    recommenderState.selectedBook = "";
    els.selectedBookCard.hidden = true;
    els.noSelectionState.hidden = false;
    updatePredictButtonState();
  }

  if (query.trim().length === 0) { closeSuggestions(); return; }
  filterBookTitles(query);
}

function filterBookTitles(query) {
  const normalizedQuery = query.trim().toLowerCase();
  recommenderState.filteredBooks = recommenderState.allBooks
    .filter((title) => title.toLowerCase().includes(normalizedQuery))
    .slice(0, MAX_SUGGESTIONS);
  recommenderState.activeSuggestionIndex = -1;
  renderSuggestions(normalizedQuery);
}

function highlightMatch(title, query) {
  if (!query) return escapeHtml(title);
  const index = title.toLowerCase().indexOf(query);
  if (index === -1) return escapeHtml(title);
  const before = escapeHtml(title.slice(0, index));
  const match = escapeHtml(title.slice(index, index + query.length));
  const after = escapeHtml(title.slice(index + query.length));
  return `${before}<mark>${match}</mark>${after}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderSuggestions(query) {
  const listbox = els.suggestionsListbox;
  listbox.innerHTML = "";

  if (!recommenderState.booksLoaded) {
    closeSuggestions();
    return;
  }

  if (recommenderState.filteredBooks.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.className = "suggestion-empty";
    emptyLi.textContent = "No matching title was found in the available catalogue.";
    listbox.appendChild(emptyLi);
    openSuggestions();
    return;
  }

  recommenderState.filteredBooks.forEach((title, index) => {
    const li = document.createElement("li");
    li.id = `suggestion-${index}`;
    li.setAttribute("role", "option");
    li.innerHTML = highlightMatch(title, query);
    li.addEventListener("click", () => selectBook(title));
    li.addEventListener("mouseenter", () => setActiveSuggestion(index));
    listbox.appendChild(li);
  });

  openSuggestions();
}

function openSuggestions() {
  els.suggestionsListbox.hidden = false;
  els.searchInput.setAttribute("aria-expanded", "true");
}

function closeSuggestions() {
  els.suggestionsListbox.hidden = true;
  els.searchInput.setAttribute("aria-expanded", "false");
  els.searchInput.removeAttribute("aria-activedescendant");
  recommenderState.activeSuggestionIndex = -1;
}

function setActiveSuggestion(index) {
  const items = Array.from(els.suggestionsListbox.querySelectorAll('li[role="option"]'));
  items.forEach((li) => li.classList.remove("suggestion-active"));
  if (index >= 0 && index < items.length) {
    items[index].classList.add("suggestion-active");
    items[index].scrollIntoView({ block: "nearest" });
    els.searchInput.setAttribute("aria-activedescendant", items[index].id);
    recommenderState.activeSuggestionIndex = index;
  }
}

function handleSuggestionKeyboard(e) {
  const isOpen = !els.suggestionsListbox.hidden;
  const optionCount = recommenderState.filteredBooks.length;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!isOpen) { filterBookTitles(els.searchInput.value); return; }
    setActiveSuggestion(Math.min(recommenderState.activeSuggestionIndex + 1, optionCount - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveSuggestion(Math.max(recommenderState.activeSuggestionIndex - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (isOpen && recommenderState.activeSuggestionIndex >= 0) {
      selectBook(recommenderState.filteredBooks[recommenderState.activeSuggestionIndex]);
    } else {
      validateSelectedBook(els.searchInput.value);
    }
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
}

function clearSearchInput() {
  els.searchInput.value = "";
  els.searchClearBtn.hidden = true;
  closeSuggestions();
  clearSelectedBook();
  els.searchInput.focus();
}

// ==========================================================================
// Book selection
// ==========================================================================
function selectBook(title) {
  recommenderState.selectedBook = title;
  els.searchInput.value = title;
  els.searchClearBtn.hidden = false;
  closeSuggestions();
  clearError();

  els.selectedBookTitle.textContent = title;
  els.selectedBookCover.textContent = getInitials(title);
  applyCoverStyle(els.selectedBookCover, title, 0);
  els.selectedBookCard.hidden = false;
  els.noSelectionState.hidden = true;

  updatePredictButtonState();
}

function validateSelectedBook(enteredTitle) {
  const trimmed = enteredTitle.trim();
  if (!trimmed) return;

  if (recommenderState.booksLoaded) {
    const exactBookTitle = recommenderState.allBooks.find(
      (title) => title.toLowerCase() === trimmed.toLowerCase()
    );
    if (exactBookTitle) {
      selectBook(exactBookTitle);
    } else {
      showError("This title is not available in the trained recommendation dataset. Please select a title from the suggestions.");
    }
  } else {
    // Catalogue failed to load — permit manual exact-text entry as a fallback.
    selectBook(trimmed);
  }
}

function clearSelectedBook() {
  recommenderState.selectedBook = "";
  els.searchInput.value = "";
  els.searchClearBtn.hidden = true;
  els.selectedBookCard.hidden = true;
  els.noSelectionState.hidden = false;
  updatePredictButtonState();
  els.searchInput.focus();
}

function updatePredictButtonState() {
  const hasSelection = Boolean(recommenderState.selectedBook);
  const modelOk = recommenderState.modelAvailable !== false;
  els.predictBtn.disabled = !hasSelection || recommenderState.isSubmitting || !modelOk;
}

// ==========================================================================
// Deterministic abstract covers
// ==========================================================================
const COVER_STYLES = ["cover-stripes", "cover-blocks", "cover-botanical", "cover-constellation", "cover-stamp", "cover-typography", "cover-grid"];
const COVER_PALETTES = [
  ["#2f5233", "#c9a227"], ["#7a2331", "#e8dcc4"], ["#1f3b4d", "#b5622f"],
  ["#3d2b1f", "#8fae7d"], ["#4a2038", "#d8b25c"], ["#22342b", "#c98a4b"],
];

function charCodeSum(text) {
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum += text.charCodeAt(i);
  return sum;
}

function createBookCoverStyle(title, index) {
  const cacheKey = `${title}::${index}`;
  if (coverStyleCache.has(cacheKey)) return coverStyleCache.get(cacheKey);

  const sum = charCodeSum(title) + title.length + index;
  const styleClass = COVER_STYLES[sum % COVER_STYLES.length];
  const palette = COVER_PALETTES[sum % COVER_PALETTES.length];

  const result = { styleClass, palette };
  coverStyleCache.set(cacheKey, result);
  return result;
}

function applyCoverStyle(el, title, index) {
  const { styleClass, palette } = createBookCoverStyle(title, index);
  COVER_STYLES.forEach((cls) => el.classList.remove(cls));
  el.classList.add(styleClass);
  el.style.setProperty("--cv-1", palette[0]);
  el.style.setProperty("--cv-2", palette[1]);
}

function getInitials(title) {
  const words = title.trim().split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ==========================================================================
// Insight rotator
// ==========================================================================
function rotateInsight() {
  let index = 0;
  insightRotatorTimer = setInterval(() => {
    index = (index + 1) % INSIGHTS.length;
    els.rotatingInsight.textContent = INSIGHTS[index];
  }, 7000);
}

// ==========================================================================
// Submission
// ==========================================================================
async function submitRecommendation(bookName) {
  if (recommenderState.isSubmitting) return;
  const trimmed = (bookName || "").trim();
  if (!trimmed) return;

  clearError();
  setLoadingState(true);
  recommenderState.isSubmitting = true;

  const payload = { Book_name: trimmed };
  recommenderState.lastRequestData = payload;

  activeAbortController = new AbortController();
  const timeoutId = setTimeout(() => activeAbortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: activeAbortController.signal,
    });

    if (!response.ok) {
      let detail = null;
      try {
        const errorBody = await response.json();
        detail = errorBody && errorBody.detail;
      } catch (parseError) {
        console.error("Could not parse error response body:", parseError);
      }

      if (response.status === 404) {
        console.error(detail);
        handleNotFound();
        return;
      }
      if (response.status === 422) {
        throw new HttpError(422, "Please select a valid book title before requesting recommendations.");
      }
      if (response.status >= 500) {
        throw new HttpError(response.status, "The recommendation model could not process this title. Please try another book or verify the model files.");
      }
      throw new HttpError(response.status, `The server responded with an unexpected status (${response.status}).`);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error("Failed to parse prediction response:", parseError);
      throw new Error("INVALID_JSON");
    }

    if (!data || !Array.isArray(data.recommendations)) {
      console.error("Invalid recommendations response:", data);
      throw new Error("INVALID_RECOMMENDATIONS");
    }

    const cleanedRecommendations = Array.from(
      new Set(
        data.recommendations
          .filter((title) => typeof title === "string")
          .map((title) => title.trim())
          .filter((title) => title.length > 0)
      )
    );

    if (cleanedRecommendations.length === 0) {
      throw new Error("EMPTY_RECOMMENDATIONS");
    }

    recommenderState.recommendations = cleanedRecommendations;
    renderRecommendations(trimmed, cleanedRecommendations);
    addToHistory(trimmed);
  } catch (error) {
    console.error("Recommendation request failed:", error);
    showError(interpretError(error));
  } finally {
    clearTimeout(timeoutId);
    setLoadingState(false);
    recommenderState.isSubmitting = false;
    updatePredictButtonState();
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function handleNotFound() {
  setLoadingState(false);
  recommenderState.isSubmitting = false;
  updatePredictButtonState();
  showError("This book was not found in the trained recommendation dataset. Check the title or select one from the available suggestions.");
  els.searchInput.focus();
  if (els.searchInput.value.trim()) filterBookTitles(els.searchInput.value);
}

function interpretError(error) {
  if (error.name === "AbortError") return "The recommendation request took too long. Please try again.";
  if (error instanceof TypeError) return "The frontend could not reach the recommendation server. Confirm that FastAPI is running and CORS is enabled.";
  if (error instanceof HttpError) return error.message;
  switch (error.message) {
    case "INVALID_JSON": return "The recommendation server returned an unexpected response.";
    case "INVALID_RECOMMENDATIONS": return "The recommendation server returned an unexpected response.";
    case "EMPTY_RECOMMENDATIONS": return "The recommendation model did not return any matching books.";
    default: return "Something went wrong while getting recommendations.";
  }
}

// ==========================================================================
// Loading state
// ==========================================================================
function setLoadingState(isLoading) {
  els.predictBtn.disabled = isLoading || !recommenderState.selectedBook;
  els.searchInput.disabled = isLoading;
  document.body.setAttribute("aria-busy", String(isLoading));

  if (isLoading) {
    els.loadingPanel.hidden = false;
    els.resultsPanel.hidden = true;
    let index = 0;
    els.loadingRotatorText.textContent = LOADING_MESSAGES[0];
    loadingRotatorTimer = setInterval(() => {
      index = (index + 1) % LOADING_MESSAGES.length;
      els.loadingRotatorText.textContent = LOADING_MESSAGES[index];
    }, 1600);
  } else {
    els.loadingPanel.hidden = true;
    if (loadingRotatorTimer) clearInterval(loadingRotatorTimer);
  }
}

// ==========================================================================
// Results rendering
// ==========================================================================
function renderRecommendations(referenceBook, recommendations) {
  els.resultsReferenceTitle.textContent = referenceBook;
  els.recommendationGrid.innerHTML = "";

  recommendations.forEach((title, index) => {
    const card = document.createElement("article");
    card.className = "recommendation-card";
    card.style.animationDelay = `${index * 0.06}s`;

    const cover = document.createElement("div");
    cover.className = "card-cover";
    cover.setAttribute("aria-hidden", "true");
    cover.textContent = getInitials(title);
    applyCoverStyle(cover, title, index + 1);

    card.innerHTML = `<p class="rec-number">No. ${index + 1}</p>`;
    card.appendChild(cover);
    card.insertAdjacentHTML("beforeend", `
      <p class="rec-title">${escapeHtml(title)}</p>
      <span class="rec-match-label">Similarity Match</span>
    `);

    const actions = document.createElement("div");
    actions.className = "rec-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy title";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(title).then(() => showToast(`"${title}" copied.`)).catch((e) => console.error(e));
    });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = savedRecommendations.has(title) ? "Saved" : "Save";
    if (savedRecommendations.has(title)) saveBtn.classList.add("action-active");
    saveBtn.addEventListener("click", () => {
      if (savedRecommendations.has(title)) { savedRecommendations.delete(title); saveBtn.textContent = "Save"; saveBtn.classList.remove("action-active"); }
      else { savedRecommendations.add(title); saveBtn.textContent = "Saved"; saveBtn.classList.add("action-active"); }
    });

    const readBtn = document.createElement("button");
    readBtn.type = "button";
    readBtn.textContent = readRecommendations.has(title) ? "Read" : "Mark as read";
    if (readRecommendations.has(title)) readBtn.classList.add("action-active");
    readBtn.addEventListener("click", () => {
      if (readRecommendations.has(title)) { readRecommendations.delete(title); readBtn.textContent = "Mark as read"; readBtn.classList.remove("action-active"); }
      else { readRecommendations.add(title); readBtn.textContent = "Read"; readBtn.classList.add("action-active"); }
    });

    actions.append(copyBtn, saveBtn, readBtn);
    card.appendChild(actions);
    els.recommendationGrid.appendChild(card);
  });

  const now = new Date();
  els.resultsMeta.textContent = `Generated on ${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;

  els.resultsPanel.hidden = false;
  els.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearResults() {
  recommenderState.recommendations = [];
  els.resultsPanel.hidden = true;
  els.recommendationGrid.innerHTML = "";
  showToast("Your reading desk is ready for a new search.");
}

// ==========================================================================
// Error panel
// ==========================================================================
function showError(message) {
  els.errorPanelText.textContent = message;
  els.errorPanel.hidden = false;
  els.retryBtn.hidden = !recommenderState.selectedBook;
  els.errorPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearError() {
  els.errorPanel.hidden = true;
  els.errorPanelText.textContent = "";
}

// ==========================================================================
// Results actions — copy / download / print
// ==========================================================================
function buildReadingListText() {
  if (!recommenderState.selectedBook || recommenderState.recommendations.length === 0) return "";
  const lines = [
    "ShelfSense — AI Book Recommendations",
    "",
    `Based on: ${recommenderState.selectedBook}`,
    "",
    ...recommenderState.recommendations.map((title, i) => `${i + 1}. ${title}`),
    "",
    "Generated using a machine-learning book similarity model.",
  ];
  return lines.join("\n");
}

function copyReadingList() {
  const text = buildReadingListText();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => showToast("Reading list copied to clipboard.")).catch((e) => console.error(e));
}

function downloadReadingList() {
  const text = buildReadingListText();
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "shelfsense-reading-list.txt";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  showToast("Reading list downloaded.");
}

function printReadingList() {
  window.print();
}

// ==========================================================================
// Session persistence
// ==========================================================================
function saveSession() {
  try {
    const session = {
      selectedBook: recommenderState.selectedBook,
      recommendations: recommenderState.recommendations,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.error("Could not save session:", error);
  }
}

function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    if (session.selectedBook) {
      selectBook(session.selectedBook);
    }
    if (Array.isArray(session.recommendations) && session.recommendations.length > 0) {
      recommenderState.recommendations = session.recommendations;
      renderRecommendations(session.selectedBook, session.recommendations);
    }
  } catch (error) {
    console.error("Could not restore session:", error);
  }
}

// ==========================================================================
// Search history
// ==========================================================================
function addToHistory(title) {
  try {
    let history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
    history = history.filter((item) => item.toLowerCase() !== title.toLowerCase());
    history.unshift(title);
    history = history.slice(0, MAX_HISTORY);
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  } catch (error) {
    console.error("Could not update history:", error);
  }
}

function removeHistoryItem(title) {
  try {
    let history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
    history = history.filter((item) => item !== title);
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  } catch (error) {
    console.error("Could not remove history item:", error);
  }
}

function renderHistory() {
  let history = [];
  try {
    history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
  } catch (error) {
    console.error("Could not read history:", error);
  }

  els.historyList.innerHTML = "";
  els.historyEmptyState.hidden = history.length > 0;

  history.forEach((title) => {
    const li = document.createElement("li");

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "history-select-btn";
    selectBtn.textContent = title;
    selectBtn.addEventListener("click", () => {
      selectBook(title);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "history-remove-btn";
    removeBtn.setAttribute("aria-label", `Remove ${title} from history`);
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    removeBtn.addEventListener("click", () => removeHistoryItem(title));

    li.append(selectBtn, removeBtn);
    els.historyList.appendChild(li);
  });
}

// ==========================================================================
// Theme
// ==========================================================================
function initTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem(THEME_KEY);
  } catch (error) {
    console.error("Could not read theme preference:", error);
  }
  if (!theme) {
    theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  setTheme(theme);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  els.themeToggle.setAttribute("aria-pressed", String(theme === "light"));
  if (theme === "light") {
    els.themeToggleIcon.className = "fa-solid fa-sun";
    els.themeToggleLabel.textContent = "Light parchment";
  } else {
    els.themeToggleIcon.className = "fa-solid fa-moon";
    els.themeToggleLabel.textContent = "Dark reading room";
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.error("Could not save theme preference:", error);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  setTheme(current === "dark" ? "light" : "dark");
}

// ==========================================================================
// Toast
// ==========================================================================
function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  setTimeout(() => { els.toast.hidden = true; }, 3000);
}
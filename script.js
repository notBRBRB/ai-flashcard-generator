/**
 * AI Flashcard Generator - Core Application Script
 */
console.log("AI Flashcard Generator Script Loading...");

// ================================
//  APP STATE (Single Source of Truth)
// ================================
const AppState = {
    categories: [],
    selectedCategoryId: null,
    flashcards: [], // Cards for selected category
    preferences: {
        provider: localStorage.getItem("flashcards_ai_provider") || "gemini",
        openaiKey: localStorage.getItem("flashcards_openai_api_key") || "",
        geminiKey: localStorage.getItem("flashcards_gemini_api_key") || "",
        groqKey: localStorage.getItem("flashcards_groq_api_key") || "",
        ollamaModel: localStorage.getItem("flashcards_ollama_model") || "llama3",
        theme: localStorage.getItem("flashcards_theme") || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
        ttsAutoPlay: false
    },
    stats: {
        streak: parseInt(localStorage.getItem("flashcards_streak")) || 0,
        lastStudyDate: localStorage.getItem("flashcards_last_date"),
        dailySessionCount: parseInt(localStorage.getItem("flashcards_session_count")) || 0,
        ratingCounts: { easy: 0, medium: 0, hard: 0 }, // Loaded per category
        sessionTotal: 0,
        sessionCurrent: 0
    },
    ui: {
        generating: false,
        currentCardId: null,
        filterText: ""
    }
};

// Storage Keys
const CATEGORY_KEY = "flashcards_categories";
const SELECTED_CATEGORY_KEY = "flashcards_selected_category";

// ================================
//  PERSISTENCE ENGINE
// ================================

function saveAll() {
    console.log("Saving App State...");
    localStorage.setItem(CATEGORY_KEY, JSON.stringify(AppState.categories));
    localStorage.setItem(SELECTED_CATEGORY_KEY, AppState.selectedCategoryId);

    if (AppState.selectedCategoryId) {
        localStorage.setItem(`flashcards_${AppState.selectedCategoryId}`, JSON.stringify(AppState.flashcards));
        localStorage.setItem(`flashcards_ratings_${AppState.selectedCategoryId}`, JSON.stringify(AppState.stats.ratingCounts));
    }

    localStorage.setItem("flashcards_ai_provider", AppState.preferences.provider);
    localStorage.setItem("flashcards_openai_api_key", AppState.preferences.openaiKey);
    localStorage.setItem("flashcards_gemini_api_key", AppState.preferences.geminiKey);
    localStorage.setItem("flashcards_groq_api_key", AppState.preferences.groqKey);
    localStorage.setItem("flashcards_ollama_model", AppState.preferences.ollamaModel);
    localStorage.setItem("flashcards_theme", AppState.preferences.theme);

    localStorage.setItem("flashcards_streak", AppState.stats.streak);
    localStorage.setItem("flashcards_last_date", AppState.stats.lastStudyDate);
    localStorage.setItem("flashcards_session_count", AppState.stats.dailySessionCount);
}

function loadAll() {
    console.log("Loading App State...");
    const rawCats = localStorage.getItem(CATEGORY_KEY);
    AppState.categories = rawCats ? JSON.parse(rawCats) : [];
    AppState.selectedCategoryId = localStorage.getItem(SELECTED_CATEGORY_KEY);

    if (AppState.categories.length === 0) {
        const id = genId();
        AppState.categories = [{ id, name: "General" }];
        AppState.selectedCategoryId = id;
    }

    if (!AppState.categories.find(c => c.id === AppState.selectedCategoryId)) {
        AppState.selectedCategoryId = AppState.categories[0].id;
    }

    loadDeck(AppState.selectedCategoryId);
}

function loadDeck(id) {
    if (!id) return;
    const rawCards = localStorage.getItem(`flashcards_${id}`);
    AppState.flashcards = rawCards ? normalizeFlashcards(JSON.parse(rawCards)) : [];

    const rawRatings = localStorage.getItem(`flashcards_ratings_${id}`);
    AppState.stats.ratingCounts = rawRatings ? JSON.parse(rawRatings) : { easy: 0, medium: 0, hard: 0 };
}

// ================================
//  THEME ENGINE
// ================================

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "dark") {
        root.setAttribute("data-theme", "dark");
    } else {
        root.removeAttribute("data-theme");
    }
    AppState.preferences.theme = theme;
    const themeSwitch = document.getElementById("themeSwitch");
    if (themeSwitch) themeSwitch.checked = (theme === "dark");
}

function toggleTheme() {
    const newTheme = AppState.preferences.theme === "dark" ? "light" : "dark";
    applyTheme(newTheme);
    saveAll();
}

// ================================
//  UI NOTIFICATIONS
// ================================

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "✅" : (type === "error" ? "❌" : "ℹ️");
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-10px)";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ================================
//  NAVIGATION
// ================================

function navigateTo(pageId, subMode = null) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
        page.classList.remove('active');
    });
    const targetPage = document.getElementById(pageId + 'Page');
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active');
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        const label = item.querySelector('.nav-label');
        if (label && label.innerText.toLowerCase() === pageId) {
            item.classList.add('active');
        } else if (!label && pageId === 'create') {
            item.classList.add('active');
        } else if (label && pageId === 'dashboard' && label.innerText === 'Home') {
            item.classList.add('active');
        }
    });

    const titles = {
        'dashboard': 'Dashboard',
        'library': 'My Library',
        'create': 'Create Cards',
        'study': 'Study Mode',
        'settings': 'Settings'
    };
    document.getElementById('pageTitle').innerText = titles[pageId] || 'AI Flashcards';

    if (pageId === 'study') startStudyMode(subMode);
    if (pageId === 'library') renderLibrary();
    if (pageId === 'dashboard') updateDashboardStats();
}

// ================================
//  LIBRARY & CATEGORY SYNC
// ================================

function renderLibrary() {
    renderCategoryOptions();
    renderFlashcards();
    updateDeckInfo();
}

function renderCategoryOptions() {
    const selectors = ["categorySelect", "studyCategorySelect"];
    selectors.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = "";
        AppState.categories.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = c.name;
            if (c.id === AppState.selectedCategoryId) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

function renderFlashcards() {
    const container = document.getElementById("flashcardContainer");
    if (!container) return;
    container.innerHTML = "";

    const list = AppState.flashcards.filter(fc => {
        if (!AppState.ui.filterText) return true;
        const q = String(fc.question || "").toLowerCase();
        const a = String(fc.answer || "").toLowerCase();
        return q.includes(AppState.ui.filterText) || a.includes(AppState.ui.filterText);
    });

    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = AppState.flashcards.length === 0 ? "No flashcards yet. Generate or import a deck." : "No matches. Try a different search.";
        container.appendChild(empty);
        return;
    }

    list.forEach((fc) => {
        const card = document.createElement("div");
        card.className = "flashcard";
        card.innerHTML = `
            <div class="flashcard-inner">
                <div class="flashcard-front">${escapeHtml(fc.question)}</div>
                <div class="flashcard-back">${escapeHtml(fc.answer)}</div>
            </div>
            <div class="card-actions">
              <button class="action-btn edit-card" data-id="${fc.id}">✎</button>
              <button class="action-btn delete-card" data-id="${fc.id}">🗑</button>
            </div>
        `;
        card.addEventListener("click", () => card.classList.toggle("flipped"));
        container.appendChild(card);
    });
}

function updateDeckInfo() {
    const el = document.getElementById("deckInfo");
    if (!el) return;
    const cat = AppState.categories.find(c => c.id === AppState.selectedCategoryId);
    const catName = cat ? cat.name : "Unknown";
    const dueCount = AppState.flashcards.filter(c => (c.due || 0) <= Date.now()).length;
    el.textContent = `${AppState.flashcards.length} cards (${dueCount} due) in ${catName}`;
}

// ================================
//  AI GENERATION CORE
// ================================

async function generateFlashcardsFromText(text) {
    const forceAI = document.getElementById("forceAI")?.checked || false;
    const heuristic = parseSmartFlashcards(text);
    const provider = AppState.preferences.provider;
    const key = provider === "openai" ? AppState.preferences.openaiKey :
        provider === "gemini" ? AppState.preferences.geminiKey :
            provider === "groq" ? AppState.preferences.groqKey : "local";

    if (provider !== "ollama" && (!key || key.trim() === "")) {
        if (forceAI) throw new Error(`${provider.toUpperCase()} API Key missing! Check Settings.`);
        return { cards: heuristic };
    }

    if (!forceAI && text.length < 300 && heuristic.length >= 2) return { cards: heuristic };

    const count = document.getElementById("cardCountRange")?.value || 10;
    const promptText = `You are an expert educator. Extract exactly ${count} important Q/A pairs from the notes into JSON. Format: {"categories":[{"name":"Topic","cards":[{"question":"...","answer":"..."}]}]} NOTES: ${text}`;

    try {
        let jsonText = "";
        if (provider === "openai") {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: promptText }] })
            });
            const data = await res.json();
            jsonText = data.choices[0].message.content;
        } else if (provider === "groq") {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptText }], response_format: { type: "json_object" } })
            });
            const data = await res.json();
            jsonText = data.choices[0].message.content;
        } else if (provider === "ollama") {
            const res = await fetch("http://localhost:11434/api/generate", {
                method: "POST",
                body: JSON.stringify({ model: AppState.preferences.ollamaModel, prompt: promptText, format: "json", stream: false })
            });
            const data = await res.json();
            jsonText = data.response;
        } else {
            const configs = [
                { ver: "v1beta", model: "gemini-1.5-flash-latest", json: true },
                { ver: "v1", model: "gemini-1.5-flash", json: false }
            ];
            for (const config of configs) {
                try {
                    const res = await fetch(`https://generativelanguage.googleapis.com/${config.ver}/models/${config.model}:generateContent?key=${key}`, {
                        method: "POST",
                        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }], generationConfig: config.json ? { responseMimeType: "application/json" } : {} })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        jsonText = data.candidates[0].content.parts[0].text;
                        break;
                    }
                } catch (e) { continue; }
            }
        }
        if (!jsonText) throw new Error("AI failed to return content.");
        const cleaned = jsonText.replace(/```json|```/g, "").trim();
        return JSON.parse(cleaned);
    } catch (e) {
        console.error(e);
        throw e;
    }
}

// ================================
//  STUDY ENGINE
// ================================

function startStudyMode(mode) {
    const studyMode = mode || 'due';
    const allCards = AppState.flashcards;
    const dueCards = allCards.filter(c => (c.due || 0) <= Date.now());
    const cardsToStudy = studyMode === 'all' ? allCards : dueCards;

    const studySection = document.getElementById("studySection");
    const emptyStudy = document.getElementById("emptyStudy");

    if (allCards.length === 0) {
        showToast("No cards in this category!", "info");
        navigateTo('library');
        return;
    }

    if (cardsToStudy.length === 0) {
        studySection?.classList.remove("hidden");
        emptyStudy?.classList.remove("hidden");
        document.getElementById("studyCard").classList.add("hidden");
        document.querySelector(".study-controls")?.classList.add("hidden");
        return;
    }

    studySection?.classList.remove("hidden");
    emptyStudy?.classList.add("hidden");
    document.getElementById("studyCard")?.classList.remove("hidden");
    document.querySelector(".study-controls")?.classList.remove("hidden");

    AppState.stats.sessionTotal = cardsToStudy.length;
    AppState.stats.sessionCurrent = 0;
    AppState.ui.studyList = cardsToStudy; // Track session cards
    updateStudyProgress();

    const first = cardsToStudy[0];
    AppState.ui.currentCardId = first.id;
    showStudyCard();
}

function updateStudyProgress() {
    const bar = document.getElementById("studyProgressBar");
    const text = document.getElementById("studyProgressText");
    if (!bar || !text) return;
    const total = AppState.stats.sessionTotal || 0;
    const current = AppState.stats.sessionCurrent || 0;
    const percent = total > 0 ? (current / total) * 100 : 0;
    bar.style.width = `${percent}%`;
    text.innerText = `${current}/${total}`;
}

function showStudyCard() {
    const card = AppState.flashcards.find(c => c.id === AppState.ui.currentCardId);
    if (!card) return navigateTo('dashboard');
    const studyCard = document.getElementById("studyCard");
    studyCard.innerHTML = `<div><strong>Q:</strong> ${escapeHtml(card.question)}<br><br><em>(Click to flip)</em></div>`;
    studyCard.classList.remove("flipped");
    studyCard.onclick = () => {
        studyCard.innerHTML = `<div><strong>A:</strong> ${escapeHtml(card.answer)}</div>`;
        if (AppState.preferences.ttsAutoPlay) speakText(card.answer);
    };
}

function rateCard(diff) {
    const card = AppState.flashcards.find(c => c.id === AppState.ui.currentCardId);
    if (!card) return;
    const now = Date.now();
    const s = card.stats || { ease: 2.5, interval: 0, reps: 0 };
    if (diff === "easy") {
        s.ease = Math.min(3.0, s.ease + 0.15);
        s.interval = s.interval > 0 ? Math.round(s.interval * s.ease) : 1;
    } else if (diff === "hard") {
        s.ease = Math.max(1.3, s.ease - 0.2);
        s.interval = 1;
    } else {
        s.interval = Math.max(1, Math.round(s.interval || 1));
    }
    s.reps++;
    card.stats = s;
    card.due = now + s.interval * 24 * 60 * 60 * 1000;
    AppState.stats.ratingCounts[diff]++;
    AppState.stats.sessionCurrent++;
    updateStudyProgress();
    updateStreak();
    saveAll();

    // Get next card from our session list
    const nextIndex = AppState.ui.studyList.findIndex(c => c.id === AppState.ui.currentCardId) + 1;
    const next = AppState.ui.studyList[nextIndex];

    if (!next) {
        showToast("Study session complete!", "success");
        navigateTo('dashboard');
    } else {
        AppState.ui.currentCardId = next.id;
        showStudyCard();
    }
}

function updateStreak() {
    const today = new Date().toDateString();
    if (AppState.stats.lastStudyDate !== today) {
        AppState.stats.dailySessionCount = 0;
        AppState.stats.lastStudyDate = today;
    }
    AppState.stats.dailySessionCount++;
    if (AppState.stats.dailySessionCount === 5) AppState.stats.streak++;
}

// ================================
//  DASHBOARD & MISC
// ================================

function updateDashboardStats() {
    document.getElementById("statStreak").textContent = AppState.stats.streak;
    document.getElementById("progressCount").textContent = Math.min(5, AppState.stats.dailySessionCount);
    document.getElementById("progressBar").style.width = (Math.min(5, AppState.stats.dailySessionCount) / 5 * 100) + "%";
    const total = AppState.flashcards.length;
    const due = AppState.flashcards.filter(c => (c.due || 0) <= Date.now()).length;
    document.getElementById("statTotal").textContent = total;
    document.getElementById("statDue").textContent = due;
}

// ================================
//  HANDLERS & INIT
// ================================

function initApp() {
    loadAll();
    applyTheme(AppState.preferences.theme);

    // Theme Toggle Handler
    document.getElementById("themeSwitch")?.addEventListener("change", toggleTheme);

    // AI Provider Setup
    const pSel = document.getElementById("aiProviderSelect");
    if (pSel) {
        pSel.value = AppState.preferences.provider;
        pSel.onchange = (e) => {
            AppState.preferences.provider = e.target.value;
            syncSettingsUI();
            saveAll();
        };
    }

    // Key Inputs
    ["openaiKey", "geminiKey", "groqKey"].forEach(key => {
        const input = document.getElementById(key === "openaiKey" ? "apiKeyInput" : key + "Input");
        if (input) {
            input.value = AppState.preferences[key];
            const btnKey = "save" + key.charAt(0).toUpperCase() + key.slice(1) + "Btn";
            document.getElementById(btnKey)?.addEventListener("click", () => {
                AppState.preferences[key] = input.value.trim();
                saveAll();
                showToast("Key saved!", "success");
            });
        }
    });

    // Category Handlers
    const syncCategories = (id) => {
        saveAll();
        AppState.selectedCategoryId = id;
        loadDeck(AppState.selectedCategoryId);
        renderCategoryOptions(); // Sync all dropdowns
        renderLibrary();
    };

    document.getElementById("categorySelect")?.addEventListener("change", (e) => syncCategories(e.target.value));

    document.getElementById("studyCategorySelect")?.addEventListener("change", (e) => {
        syncCategories(e.target.value);
        startStudyMode(); // Restart study session for the new category
    });

    document.getElementById("addCategoryBtn")?.addEventListener("click", () => {
        const name = prompt("New category name:");
        if (name) {
            const id = genId();
            AppState.categories.push({ id, name: name.trim() });
            AppState.selectedCategoryId = id;
            AppState.flashcards = [];
            saveAll();
            renderLibrary();
        }
    });

    document.getElementById("renameCategoryBtn")?.addEventListener("click", () => {
        const cat = AppState.categories.find(c => c.id === AppState.selectedCategoryId);
        if (!cat) return;
        const name = prompt("Rename to:", cat.name);
        if (name) {
            cat.name = name.trim();
            saveAll();
            renderLibrary();
        }
    });

    document.getElementById("deleteCategoryBtn")?.addEventListener("click", () => {
        if (AppState.categories.length <= 1) return showToast("Cannot delete last category.", "error");
        if (confirm("Delete this category and its cards?")) {
            AppState.categories = AppState.categories.filter(c => c.id !== AppState.selectedCategoryId);
            AppState.selectedCategoryId = AppState.categories[0].id;
            loadDeck(AppState.selectedCategoryId);
            saveAll();
            renderLibrary();
        }
    });

    // Library Actions
    document.getElementById("saveDeckBtnLib")?.addEventListener("click", () => {
        saveAll();
        showToast("All changes saved!", "success");
    });

    document.getElementById("saveDeckBtn")?.addEventListener("click", () => {
        saveAll();
        showToast("Local backup created!", "success");
    });

    document.getElementById("loadDeckBtn")?.addEventListener("click", () => {
        loadAll();
        renderLibrary();
        showToast("Data reloaded from storage.", "info");
    });

    document.getElementById("saveAllBtnDash")?.addEventListener("click", () => {
        saveAll();
        showToast("Progress saved!", "success");
    });

    document.getElementById("shuffleDeckBtn")?.addEventListener("click", () => {
        AppState.flashcards.sort(() => Math.random() - 0.5);
        saveAll();
        renderFlashcards();
    });

    document.getElementById("clearDeckBtn")?.addEventListener("click", () => {
        if (confirm("Clear all cards in this category?")) {
            AppState.flashcards = [];
            saveAll();
            renderFlashcards();
        }
    });

    // Generate Button
    document.getElementById("generateBtn")?.addEventListener("click", async () => {
        const text = document.getElementById("notesInput").value;
        if (!text.trim()) return;
        AppState.ui.generating = true;
        document.getElementById("genSpinner").classList.remove("hidden");
        try {
            const res = await generateFlashcardsFromText(text);
            if (res.categories) {
                res.categories.forEach(cat => {
                    let existing = AppState.categories.find(c => c.name.toLowerCase() === cat.name.toLowerCase());
                    if (!existing) {
                        existing = { id: genId(), name: cat.name };
                        AppState.categories.push(existing);
                    }
                    if (existing.id === AppState.selectedCategoryId) {
                        AppState.flashcards = [...AppState.flashcards, ...normalizeFlashcards(cat.cards)];
                    } else {
                        const key = `flashcards_${existing.id}`;
                        const old = JSON.parse(localStorage.getItem(key) || "[]");
                        localStorage.setItem(key, JSON.stringify([...old, ...normalizeFlashcards(cat.cards)]));
                    }
                });
            } else if (res.cards) {
                AppState.flashcards = [...AppState.flashcards, ...normalizeFlashcards(res.cards)];
            }
            saveAll();
            navigateTo('library');
        } catch (e) { showToast(e.message, "error"); }
        finally {
            AppState.ui.generating = false;
            document.getElementById("genSpinner").classList.add("hidden");
        }
    });

    document.querySelectorAll(".diff-btn").forEach(btn => btn.addEventListener("click", () => rateCard(btn.dataset.diff)));
    document.getElementById("searchInput")?.addEventListener("input", (e) => {
        AppState.ui.filterText = e.target.value.toLowerCase();
        renderFlashcards();
    });

    syncSettingsUI();
    renderLibrary();
}

function syncSettingsUI() {
    const p = AppState.preferences.provider;
    ["openai", "gemini", "groq", "ollama"].forEach(v => {
        const el = document.getElementById(v + (v === "ollama" ? "Group" : "KeyGroup"));
        if (el) el.classList.toggle("hidden", p !== v);
    });
}

function genId() { return Date.now() + "-" + Math.random().toString(16).slice(2); }
function normalizeFlashcards(cards = []) {
    return cards.map(c => ({
        id: c.id || genId(),
        question: c.question || "Empty?",
        answer: c.answer || "Empty.",
        due: c.due || Date.now(),
        stats: c.stats || { ease: 2.5, interval: 0, reps: 0 }
    }));
}
function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function getNextDueCard() {
    const now = Date.now();
    const due = AppState.flashcards.filter(c => (c.due || 0) <= now).sort((a, b) => a.due - b.due);
    return due[0] || null;
}
function speakText(t) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
function quickAddCard() {
    const q = prompt("Q:");
    const a = prompt("A:");
    if (q && a) {
        AppState.flashcards.push(normalizeFlashcards([{ question: q, answer: a }])[0]);
        saveAll();
        renderLibrary();
    }
}
function parseSmartFlashcards(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const cards = [];
    lines.forEach(l => {
        const m = l.match(/(.+?)\s*[:=-]\s*(.+)/);
        if (m) cards.push({ question: m[1].trim(), answer: m[2].trim() });
    });
    return cards;
}

// Event Delegates
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-card")) {
        const fc = AppState.flashcards.find(c => c.id === e.target.dataset.id);
        if (fc) {
            const q = prompt("Q:", fc.question);
            const a = prompt("A:", fc.answer);
            if (q && a) { fc.question = q; fc.answer = a; saveAll(); renderLibrary(); }
        }
    }
    if (e.target.classList.contains("delete-card")) {
        AppState.flashcards = AppState.flashcards.filter(c => c.id !== e.target.dataset.id);
        saveAll();
        renderLibrary();
    }
});

document.addEventListener("DOMContentLoaded", initApp);
window.saveCurrentDeck = saveAll;
window.quickAddCard = quickAddCard;

// ================================
//  INSERT YOUR OPENAI API KEY HERE
//  (if using the AI features)
// ================================
const OPENAI_API_KEY = "YOUR_API_KEY_HERE";

/* ========== THEME (DARK MODE) ========== */
const THEME_KEY = "flashcards_theme"; // "dark" or "light"
const root = document.documentElement;

/**
 * Apply theme to :root by setting data-theme attribute
 * Accepts "dark" or "light"
 */
function applyTheme(theme) {
    if (theme === "dark") {
        root.setAttribute("data-theme", "dark");
        document.getElementById("themeSwitch").checked = true;
    } else {
        root.removeAttribute("data-theme");
        document.getElementById("themeSwitch").checked = false;
    }
}

/**
 * Load theme preference from localStorage (or system)
 */
function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
        applyTheme(saved);
        return;
    }
    // If no saved preference, use system preference
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? "dark" : "light");
}

/**
 * Toggle theme and persist
 */
function toggleTheme() {
    const isDark = root.getAttribute("data-theme") === "dark";
    const newTheme = isDark ? "light" : "dark";
    applyTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
}

document.addEventListener("DOMContentLoaded", () => {
    // wire up toggle and load saved theme
    const themeSwitch = document.getElementById("themeSwitch");
    loadTheme();
    themeSwitch.addEventListener("change", toggleTheme);

    // initialize app after theme is loaded
    initApp();
});

/* ========== APP: FLASHCARDS (existing starter code) ========== */

// Deck data
let flashcards = [];
let studyIndex = 0;
let generating = false;
let currentCardId = null;
let filterText = "";
let studyGesturesSetup = false;
let categories = [];
let selectedCategoryId = null;
let ratingCounts = { easy: 0, medium: 0, hard: 0 };
let currentStreak = 0;
let lastStudyDate = null;
let dailySessionCount = 0;

const CATEGORY_KEY = "flashcards_categories";
const SELECTED_CATEGORY_KEY = "flashcards_selected_category";
const STREAK_KEY = "flashcards_streak";
const LAST_DATE_KEY = "flashcards_last_date";
const SESSION_COUNT_KEY = "flashcards_session_count";

// ---------------------------
// AI: Generate Flashcards
// ---------------------------
async function generateFlashcardsFromText(text) {
    const heuristic = parseSmartFlashcards(text);
    if (heuristic.length >= 3 || (!OPENAI_API_KEY || OPENAI_API_KEY === "YOUR_API_KEY_HERE")) {
        return heuristic;
    }

    const prompt = `Extract concise Q/A flashcards from the free-form notes below.
Return ONLY a JSON array like:
[
  {"question":"...", "answer":"..."},
  {"question":"...", "answer":"..."}
]
Guidelines:
- Identify terms, definitions, and key facts even without explicit formatting
- Keep questions short; answers clear and under ~200 chars
- Avoid duplicates and overly broad items
- Skip filler or meta text

NOTES:
${text}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                { role: "user", content: prompt }
            ],
            temperature: 0.3
        })
    });

    const data = await response.json();
    let jsonText = data.choices?.[0]?.message?.content ?? "";

    try {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        return heuristic;
    } catch (e) {
        return heuristic;
    }
}

function parseManualFlashcards(text) {
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const cards = [];
    let pendingQ = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qMatch = line.match(/^((Q|Question)\s*:)\s*(.+)$/i);
        if (qMatch) {
            pendingQ = qMatch[3].trim();
            for (let j = i + 1; j < lines.length; j++) {
                const aMatch = lines[j].match(/^((A|Answer)\s*:)\s*(.+)$/i);
                if (aMatch) {
                    cards.push({ question: pendingQ, answer: aMatch[3].trim() });
                    pendingQ = null;
                    i = j;
                    break;
                }
            }
            continue;
        }
        const pairMatch = line.match(/^(.+?)\s*[-–—:=]\s+(.+)$/);
        if (pairMatch) {
            cards.push({ question: pairMatch[1].trim(), answer: pairMatch[2].trim() });
            continue;
        }
        if (line.includes("\t")) {
            const idx = line.indexOf("\t");
            if (idx > 0) {
                const q = line.slice(0, idx).trim();
                const a = line.slice(idx + 1).trim();
                if (q && a) cards.push({ question: q, answer: a });
                continue;
            }
        }
    }
    if (cards.length === 0 && lines.length > 0) {
        for (const l of lines) {
            const m = l.match(/^(.+?)\?\s*(.+)$/);
            if (m) {
                cards.push({ question: m[1].trim() + '?', answer: m[2].trim() });
            }
        }
    }
    return cards;
}

function parseSmartFlashcards(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/).map(l => l.trim());
    const cards = [];
    const used = new Set();
    const push = (q, a) => {
        const qq = String(q || "").trim();
        const aa = String(a || "").trim();
        if (!qq || !aa) return;
        const key = qq.toLowerCase();
        if (used.has(key)) return;
        used.add(key);
        const ans = aa.length > 500 ? aa.slice(0, 500) : aa;
        cards.push({ question: qq, answer: ans });
    };
    const isHeading = (l) => /^#{1,6}\s+.+$/.test(l);
    const isPairLine = (l) => /^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?.{1,120}?\s*(?:—|–|-|:|=|>)\s+.+$/.test(l);
    const isQLine = (l) => /^((Q|Question)\s*:)\s*/i.test(l);
    const isALine = (l) => /^((A|Answer)\s*:)\s*/i.test(l);
    const isQuestionSentence = (l) => /[?]\s*$/.test(l) && l.length > 3;
    const collectAnswer = (start) => {
        let buf = [];
        let end = start - 1;
        for (let k = start; k < lines.length; k++) {
            const t = lines[k];
            if (!t) { if (buf.length) { end = k; break; } else { continue; } }
            if (isHeading(t) || isPairLine(t) || isQLine(t) || isALine(t) || isQuestionSentence(t)) { end = k - 1; break; }
            buf.push(t);
            end = k;
        }
        return { text: buf.join(" "), end };
    };
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l) continue;
        const qm = l.match(/^((Q|Question)\s*:\s*)(.+)$/i);
        if (qm) {
            let ans = "";
            let stop = i;
            let found = false;
            for (let j = i + 1; j < lines.length; j++) {
                const am = lines[j].match(/^((A|Answer)\s*:\s*)(.+)$/i);
                if (am) { ans = am[3].trim(); stop = j; found = true; break; }
            }
            if (!found) {
                const c = collectAnswer(i + 1);
                ans = c.text;
                stop = c.end;
            }
            push(qm[3].trim(), ans);
            i = Math.max(i, stop);
            continue;
        }
    }
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l) continue;
        const pm = l.match(/^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?(.+?)\s*(?:—|–|-|:|=|>)\s+(.+)$/);
        if (pm) {
            let ans = pm[2].trim();
            let end = i;
            const c = collectAnswer(i + 1);
            if (c.text) { ans = ans + " " + c.text; end = c.end; }
            push(pm[1].trim(), ans);
            i = Math.max(i, end);
            continue;
        }
        const paren = l.match(/^\s*(?:[-*•]\s*)?(.+?)\s*\((.+?)\)\s*$/);
        if (paren && paren[1] && paren[2] && paren[2].length > 4) {
            push(paren[1].trim(), paren[2].trim());
            continue;
        }
    }
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l) continue;
        if (isQuestionSentence(l)) {
            const q = l;
            const c = collectAnswer(i + 1);
            if (c.text) push(q, c.text);
            i = Math.max(i, c.end);
        }
    }
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l) continue;
        const m = l.match(/^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?([A-Z][A-Za-z0-9 '()\/\-]{1,80})\s+(?:is|are|refers to|means|consists of)\s+(.{5,300})$/i);
        if (m) {
            const term = m[1].trim();
            let ans = m[2].trim().replace(/\s*[\.\!]?\s*$/, "");
            push(`What is ${term}?`, ans);
        }
    }
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l) continue;
        if (isHeading(l)) {
            const title = l.replace(/^#{1,6}\s+/, "").trim();
            const c = collectAnswer(i + 1);
            if (c.text) {
                push(title, c.text);
                i = Math.max(i, c.end);
            }
        }
    }
    if (cards.length === 0) {
        return parseManualFlashcards(text);
    }
    return cards;
}
// ---------------------------
// Render Flashcards
// ---------------------------
function renderFlashcards() {
    const container = document.getElementById("flashcardContainer");
    container.innerHTML = "";

    const list = flashcards.filter(fc => {
        if (!filterText) return true;
        const q = String(fc.question || "").toLowerCase();
        const a = String(fc.answer || "").toLowerCase();
        return q.includes(filterText) || a.includes(filterText);
    });

    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = flashcards.length === 0 ? "No flashcards yet. Generate or import a deck." : "No matches. Try a different search.";
        container.appendChild(empty);
        updateDeckInfo();
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
    updateDeckInfo();
    updateStats();
}

// helper to escape HTML inserted into DOM
function escapeHtml(str = "") {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

// ---------------------------
// Study Mode
// ---------------------------
function startStudyMode() {
    if (flashcards.length === 0) return alert("No flashcards!");
    document.getElementById("studySection").classList.remove("hidden");
    const next = getNextDueCard();
    if (!next) {
        alert("No cards due. Shuffle or adjust deck to study.");
        document.getElementById("studySection").classList.add("hidden");
        return;
    }
    currentCardId = next.id;
    showStudyCard();
    setupStudyGestures();
}

function showStudyCard() {
    const card = flashcards.find(c => c.id === currentCardId) || getNextDueCard();
    if (!card) {
        alert("Study session complete!");
        document.getElementById("studySection").classList.add("hidden");
        return;
    }
    document.getElementById("studyCard").innerHTML = `
        <div><strong>Q:</strong> ${escapeHtml(card.question)}<br><br>
        <em>(Click to reveal answer)</em></div>
    `;

    document.getElementById("studyCard").onclick = () => {
        const text = card.answer;
        document.getElementById("studyCard").innerHTML = `
            <div><strong>A:</strong> ${escapeHtml(text)}</div>
        `;
        if (document.getElementById("ttsAutoPlay").checked) {
            speakText(text);
        }
    };
}

function speakText(text) {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
}

function updateStreakAndProgress() {
    const today = new Date().toDateString();

    if (lastStudyDate !== today) {
        if (lastStudyDate) {
            const last = new Date(lastStudyDate);
            const yest = new Date();
            yest.setDate(yest.getDate() - 1);
            if (last.toDateString() !== yest.toDateString()) {
                currentStreak = 0;
            }
        }
        lastStudyDate = today;
        dailySessionCount = 0;
    }

    dailySessionCount++;
    if (dailySessionCount === 5) {
        currentStreak++;
    }

    saveStreakData();
    updateStats();
}

function saveStreakData() {
    localStorage.setItem(STREAK_KEY, currentStreak);
    localStorage.setItem(LAST_DATE_KEY, lastStudyDate);
    localStorage.setItem(SESSION_COUNT_KEY, dailySessionCount);
}

function loadStreakData() {
    currentStreak = parseInt(localStorage.getItem(STREAK_KEY)) || 0;
    lastStudyDate = localStorage.getItem(LAST_DATE_KEY);
    const savedCount = parseInt(localStorage.getItem(SESSION_COUNT_KEY)) || 0;
    const today = new Date().toDateString();
    dailySessionCount = (lastStudyDate === today) ? savedCount : 0;
}

document.addEventListener("click", (e) => {
    if (!e.target || !e.target.classList) return;
    if (e.target.classList.contains("diff-btn")) {
        const diff = e.target.getAttribute("data-diff");
        rateCurrentCard(diff);
    }
    if (e.target.classList.contains("edit-card")) {
        e.stopPropagation();
        const id = e.target.getAttribute("data-id");
        editCard(id);
    }
    if (e.target.classList.contains("delete-card")) {
        e.stopPropagation();
        const id = e.target.getAttribute("data-id");
        deleteCard(id);
    }
});

// ---------------------------
// Save / Load / Export / Import
// ---------------------------
document.addEventListener("DOMContentLoaded", () => {
    // these elements may be wired again after DOM ready in initApp
});

function initApp() {
    // wire buttons (ensure DOM ready)
    document.getElementById("generateBtn").addEventListener("click", async () => {
        const text = document.getElementById("notesInput").value;
        if (!text.trim()) return alert("Enter some notes!");

        if (generating) return;
        generating = true;
        const btn = document.getElementById("generateBtn");
        const spinner = document.getElementById("genSpinner");
        btn.disabled = true;
        spinner.classList.remove("hidden");
        try {
            flashcards = normalizeFlashcards(await generateFlashcardsFromText(text));
            if (!Array.isArray(flashcards) || flashcards.length === 0) {
                alert("No flashcards generated. Try formats like 'Term - Definition' or 'Q:' followed by 'A:'.");
                return;
            }
            renderFlashcards();
        } finally {
            generating = false;
            btn.disabled = false;
            spinner.classList.add("hidden");
        }
    });

    document.getElementById("studyModeBtn").addEventListener("click", startStudyMode);

    document.getElementById("saveDeckBtn").addEventListener("click", () => {
        saveCurrentDeck();
        alert("Deck saved!");
    });

    document.getElementById("loadDeckBtn").addEventListener("click", () => {
        if (!selectedCategoryId) return;
        const data = localStorage.getItem(getCategoryStorageKey(selectedCategoryId));
        if (!data) return alert("No deck saved for this category!");
        try {
            flashcards = normalizeFlashcards(JSON.parse(data));
            renderFlashcards();
            alert("Deck loaded!");
        } catch (e) {
            alert("Failed to load deck (invalid JSON).");
        }
    });

    document.getElementById("exportDeckBtn").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(flashcards, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `flashcards-${getCategoryName(selectedCategoryId)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById("importJSON").addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            flashcards = normalizeFlashcards(JSON.parse(text));
            saveCurrentDeck();
            renderFlashcards();
            alert("Deck imported!");
        } catch (e) {
            alert("Invalid JSON file.");
        }
    });

    document.getElementById("clearDeckBtn").addEventListener("click", () => {
        if (flashcards.length === 0) return;
        flashcards = [];
        saveCurrentDeck();
        renderFlashcards();
    });

    document.getElementById("shuffleDeckBtn").addEventListener("click", () => {
        if (flashcards.length < 2) return;
        for (let i = flashcards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [flashcards[i], flashcards[j]] = [flashcards[j], flashcards[i]];
        }
        saveCurrentDeck();
        renderFlashcards();
    });

    const search = document.getElementById("searchInput");
    search.addEventListener("input", (e) => {
        filterText = e.target.value.toLowerCase();
        renderFlashcards();
    });
    const mobileStudy = document.getElementById("mobileStudyBtn");
    const mobileShuffle = document.getElementById("mobileShuffleBtn");
    const mobileAdd = document.getElementById("mobileAddBtn");
    if (mobileStudy) mobileStudy.addEventListener("click", startStudyMode);
    if (mobileShuffle) mobileShuffle.addEventListener("click", () => {
        if (flashcards.length < 2) return;
        for (let i = flashcards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [flashcards[i], flashcards[j]] = [flashcards[j], flashcards[i]];
        }
        saveCurrentDeck();
        renderFlashcards();
    });
    if (mobileAdd) mobileAdd.addEventListener("click", quickAddCard);

    document.getElementById("speakBtn").addEventListener("click", () => {
        const card = flashcards.find(c => c.id === currentCardId);
        if (card) {
            const isFlipped = document.getElementById("studyCard").innerText.includes("A:");
            speakText(isFlipped ? card.answer : card.question);
        }
    });

    loadStreakData();
    setupStudyGestures();
    initCategories();
}

function updateDeckInfo() {
    const el = document.getElementById("deckInfo");
    if (el) {
        const due = getDueCount();
        const name = getCategoryName(selectedCategoryId);
        el.textContent = `${flashcards.length} ${flashcards.length === 1 ? 'card' : 'cards'} (${due} due) in ${name}`;
    }
}

function normalizeFlashcards(cards = []) {
    return cards.map((c) => {
        const id = c.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const stats = c.stats || { ease: 2.5, interval: 0, reps: 0 };
        const due = c.due || Date.now();
        return { id, question: c.question || "", answer: c.answer || "", stats, due };
    });
}

function getNextDueCard() {
    const now = Date.now();
    const dueCards = flashcards.filter(c => (c.due || 0) <= now);
    if (dueCards.length === 0) return null;
    dueCards.sort((a, b) => (a.due || 0) - (b.due || 0));
    return dueCards[0];
}

function getDueCount() {
    const now = Date.now();
    return flashcards.filter(c => (c.due || 0) <= now).length;
}

function rateCurrentCard(diff = "medium") {
    const card = flashcards.find(c => c.id === currentCardId);
    if (!card) return;
    const now = Date.now();
    const s = card.stats || { ease: 2.5, interval: 0, reps: 0 };
    if (diff === "easy") {
        s.ease = Math.min(3.0, (s.ease || 2.5) + 0.15);
        s.interval = s.interval > 0 ? Math.round(s.interval * s.ease) : 1;
        s.reps = (s.reps || 0) + 1;
    } else if (diff === "hard") {
        s.ease = Math.max(1.3, (s.ease || 2.5) - 0.2);
        s.interval = 1;
        s.reps = 0;
    } else {
        s.ease = s.ease || 2.5;
        s.interval = s.interval > 0 ? Math.max(1, Math.round(s.interval)) : 1;
        s.reps = (s.reps || 0) + 1;
    }
    card.stats = s;
    card.due = now + s.interval * 24 * 60 * 60 * 1000;
    saveCurrentDeck();
    updateStreakAndProgress();
    if (diff === "easy") ratingCounts.easy = (ratingCounts.easy || 0) + 1;
    else if (diff === "hard") ratingCounts.hard = (ratingCounts.hard || 0) + 1;
    else ratingCounts.medium = (ratingCounts.medium || 0) + 1;
    saveRatingCounts();
    updateStats();
    const next = getNextDueCard();
    if (!next) {
        alert("Study session complete!");
        document.getElementById("studySection").classList.add("hidden");
        return;
    }
    currentCardId = next.id;
    showStudyCard();
}

function editCard(id) {
    const idx = flashcards.findIndex(c => c.id === id);
    if (idx < 0) return;
    const q = prompt("Edit question", flashcards[idx].question || "");
    if (q == null) return;
    const a = prompt("Edit answer", flashcards[idx].answer || "");
    if (a == null) return;
    flashcards[idx].question = q;
    flashcards[idx].answer = a;
    renderFlashcards();
}

function deleteCard(id) {
    const idx = flashcards.findIndex(c => c.id === id);
    if (idx < 0) return;
    flashcards.splice(idx, 1);
    renderFlashcards();
}

function quickAddCard() {
    const q = prompt("New question");
    if (!q) return;
    const a = prompt("New answer");
    if (!a) return;
    const card = normalizeFlashcards([{ question: q, answer: a }])[0];
    flashcards.push(card);
    saveCurrentDeck();
    renderFlashcards();
}

function setupStudyGestures() {
    if (studyGesturesSetup) return;
    const el = document.getElementById("studyCard");
    if (!el) return;
    let sx = 0, sy = 0, ex = 0, ey = 0;
    el.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; ex = sx; ey = sy;
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
        const t = e.touches[0];
        ex = t.clientX; ey = t.clientY;
    }, { passive: true });
    el.addEventListener("touchend", () => {
        const dx = ex - sx, dy = ey - sy;
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > 50 && ax > ay) {
            rateCurrentCard(dx > 0 ? "easy" : "hard");
        } else if (ay > 50) {
            rateCurrentCard("medium");
        }
    });
    studyGesturesSetup = true;
}

function initCategories() {
    loadCategories();
    if (!categories || categories.length === 0) {
        const id = genId();
        categories = [{ id, name: "General" }];
        selectedCategoryId = id;
        saveCategories();
        localStorage.setItem(SELECTED_CATEGORY_KEY, selectedCategoryId);
    }
    const savedSel = localStorage.getItem(SELECTED_CATEGORY_KEY);
    if (savedSel && categories.find(c => c.id === savedSel)) {
        selectedCategoryId = savedSel;
    } else {
        selectedCategoryId = categories[0].id;
        localStorage.setItem(SELECTED_CATEGORY_KEY, selectedCategoryId);
    }
    renderCategoryOptions();
    loadRatingCounts();
    loadDeckForCategory(selectedCategoryId);
    const sel = document.getElementById("categorySelect");
    const addBtn = document.getElementById("addCategoryBtn");
    const renBtn = document.getElementById("renameCategoryBtn");
    const delBtn = document.getElementById("deleteCategoryBtn");
    sel.addEventListener("change", (e) => {
        selectedCategoryId = e.target.value;
        localStorage.setItem(SELECTED_CATEGORY_KEY, selectedCategoryId);
        loadRatingCounts();
        loadDeckForCategory(selectedCategoryId);
    });
    addBtn.addEventListener("click", () => {
        const name = prompt("New category name");
        if (!name) return;
        const id = genId();
        categories.push({ id, name: name.trim() });
        saveCategories();
        selectedCategoryId = id;
        localStorage.setItem(SELECTED_CATEGORY_KEY, selectedCategoryId);
        renderCategoryOptions();
        loadRatingCounts();
        loadDeckForCategory(selectedCategoryId);
    });
    renBtn.addEventListener("click", () => {
        const cat = categories.find(c => c.id === selectedCategoryId);
        if (!cat) return;
        const name = prompt("Rename category", cat.name);
        if (name == null) return;
        cat.name = name.trim();
        saveCategories();
        renderCategoryOptions();
        updateDeckInfo();
    });
    delBtn.addEventListener("click", () => {
        if (categories.length <= 1) return alert("Cannot delete the last category.");
        const cat = categories.find(c => c.id === selectedCategoryId);
        if (!cat) return;
        const ok = confirm(`Delete category "${cat.name}" and its deck?`);
        if (!ok) return;
        localStorage.removeItem(getCategoryStorageKey(cat.id));
        categories = categories.filter(c => c.id !== cat.id);
        saveCategories();
        selectedCategoryId = categories[0].id;
        localStorage.setItem(SELECTED_CATEGORY_KEY, selectedCategoryId);
        renderCategoryOptions();
        loadRatingCounts();
        loadDeckForCategory(selectedCategoryId);
    });
}

function renderCategoryOptions() {
    const sel = document.getElementById("categorySelect");
    if (!sel) return;
    sel.innerHTML = "";
    categories.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === selectedCategoryId) opt.selected = true;
        sel.appendChild(opt);
    });
}

function loadCategories() {
    try {
        const raw = localStorage.getItem(CATEGORY_KEY);
        categories = raw ? JSON.parse(raw) : [];
    } catch { categories = []; }
}

function saveCategories() {
    localStorage.setItem(CATEGORY_KEY, JSON.stringify(categories));
}

function getCategoryStorageKey(id) {
    return `flashcards_${id}`;
}

function getCategoryName(id) {
    const c = categories.find(x => x.id === id);
    return c ? c.name : "General";
}

function loadDeckForCategory(id) {
    const raw = localStorage.getItem(getCategoryStorageKey(id));
    if (!raw) {
        flashcards = [];
        renderFlashcards();
        return;
    }
    try {
        flashcards = normalizeFlashcards(JSON.parse(raw));
    } catch { flashcards = []; }
    renderFlashcards();
}

function saveCurrentDeck() {
    if (!selectedCategoryId) return;
    localStorage.setItem(getCategoryStorageKey(selectedCategoryId), JSON.stringify(flashcards));
}

function genId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getRatingsStorageKey(id) {
    return `flashcards_ratings_${id}`;
}

function loadRatingCounts() {
    try {
        const raw = localStorage.getItem(getRatingsStorageKey(selectedCategoryId));
        ratingCounts = raw ? JSON.parse(raw) : { easy: 0, medium: 0, hard: 0 };
    } catch {
        ratingCounts = { easy: 0, medium: 0, hard: 0 };
    }
    updateStats();
}

function saveRatingCounts() {
    if (!selectedCategoryId) return;
    localStorage.setItem(getRatingsStorageKey(selectedCategoryId), JSON.stringify(ratingCounts));
}

function updateStats() {
    const total = flashcards.length;
    const now = Date.now();
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const startToday = d.getTime();
    const d2 = new Date();
    d2.setHours(23, 59, 59, 999);
    const endToday = d2.getTime();
    const weekEnd = endToday + 7 * 24 * 60 * 60 * 1000;
    let newCount = 0, dueCount = 0, overdueCount = 0;
    let sumEase = 0, sumInterval = 0;
    let nextDue = null;
    let distOver = 0, distToday = 0, distWeek = 0, distLater = 0;
    for (const c of flashcards) {
        const reps = (c.stats && c.stats.reps) || 0;
        const ease = (c.stats && c.stats.ease) || 2.5;
        const interval = (c.stats && c.stats.interval) || 0;
        const due = c.due || 0;
        if (reps === 0) newCount++;
        if (due <= now) dueCount++;
        if (due < startToday) overdueCount++;
        sumEase += ease;
        sumInterval += interval;
        if (nextDue == null || due < nextDue) nextDue = due;
        if (due < startToday) distOver++;
        else if (due <= endToday) distToday++;
        else if (due <= weekEnd) distWeek++;
        else distLater++;
    }
    const avgEase = total > 0 ? (sumEase / total) : 0;
    const avgInterval = total > 0 ? (sumInterval / total) : 0;
    const elTotal = document.getElementById("statTotal");
    const elNew = document.getElementById("statNew");
    const elDue = document.getElementById("statDue");
    const elOver = document.getElementById("statOverdue");
    const elAvgE = document.getElementById("statAvgEase");
    const elAvgI = document.getElementById("statAvgInterval");
    const elNext = document.getElementById("statNextDue");
    if (elTotal) elTotal.textContent = String(total);
    if (elNew) elNew.textContent = String(newCount);
    if (elDue) elDue.textContent = String(dueCount);
    if (elOver) elOver.textContent = String(overdueCount);
    if (elAvgE) elAvgE.textContent = total > 0 ? avgEase.toFixed(2) : "0";
    if (elAvgI) elAvgI.textContent = total > 0 ? Math.round(avgInterval) : "0";
    if (elNext) elNext.textContent = nextDue ? new Date(nextDue).toLocaleDateString() : "—";
    const elRE = document.getElementById("statRatingsEasy");
    const elRM = document.getElementById("statRatingsMedium");
    const elRH = document.getElementById("statRatingsHard");
    if (elRE) elRE.textContent = String((ratingCounts && ratingCounts.easy) || 0);
    if (elRM) elRM.textContent = String((ratingCounts && ratingCounts.medium) || 0);
    if (elRH) elRH.textContent = String((ratingCounts && ratingCounts.hard) || 0);
    const totalForBars = total > 0 ? total : 1;
    const bOver = document.getElementById("distOverdue");
    const bToday = document.getElementById("distToday");
    const bWeek = document.getElementById("distWeek");
    const bLater = document.getElementById("distLater");
    if (bOver) bOver.style.width = ((distOver / totalForBars) * 100).toFixed(2) + "%";
    if (bToday) bToday.style.width = ((distToday / totalForBars) * 100).toFixed(2) + "%";
    if (bWeek) bWeek.style.width = ((distWeek / totalForBars) * 100).toFixed(2) + "%";
    if (bLater) bLater.style.width = ((distLater / totalForBars) * 100).toFixed(2) + "%";

    // Streak & Progress UI
    const elStreak = document.getElementById("statStreak");
    if (elStreak) elStreak.textContent = String(currentStreak);

    const elProgCount = document.getElementById("progressCount");
    if (elProgCount) elProgCount.textContent = String(Math.min(5, dailySessionCount));

    const elProgBar = document.getElementById("progressBar");
    if (elProgBar) {
        const pct = (Math.min(5, dailySessionCount) / 5) * 100;
        elProgBar.style.width = pct + "%";
    }
}

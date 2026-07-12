(() => {
    const dataUrl = "/static/roots-knowledge.json?v=pdf-rag-v23";
    const rootsPanel = document.getElementById("rootsPanel");
    const rootsStats = document.getElementById("rootsStats");
    const rootsTopics = document.getElementById("rootsTopics");
    const rootsParts = document.getElementById("rootsParts");
    const rootsAssets = document.getElementById("rootsAssets");

    if (!rootsPanel || !rootsParts) {
        return;
    }

    // Chunks per table-of-contents entry. Smaller = more, shorter entries.
    const CHUNKS_PER_PART = 6;

    // Topic anchors used to tag each part of the book and to build the
    // "بابەتەکان" (topics) quick-jump index. Add more terms/topics here as
    // the underlying book content grows — nothing else needs to change.
    const TOPICS = [
        { id: "main-family", label: "بنەماڵەی سەرەکی", terms: ["مامۆستا مه لا ئه مین", "مامۆستا مەلا ئەمین", "مه لا سالح", "مەلا ساڵح", "مه لا هه مین"] },
        { id: "dukala", label: "گوندی دوکەڵە", terms: ["دوكهڵ", "دوکەڵە"] },
        { id: "memundi", label: "هۆزی مەموندی", terms: ["مه موندی", "مەموندی", "مەحمودی"] },
        { id: "marwani", label: "میرنشینی مەروانی", terms: ["مه روانی", "مەروانی"] },
        { id: "dizayee", label: "بنەماڵەی دزەیی", terms: ["دزەیی", "دزه یی"] },
        { id: "sadat", label: "بنەماڵەی سادات", terms: ["سادات"] },
        { id: "naqshbandi", label: "تەریقەتی نەقشبەندی", terms: ["نەقشبەندی", "نه قشبه ندی"] },
        { id: "education", label: "خوێندن و بەکالۆریۆس", terms: ["خوێندن", "بەکالۆریۆس", "زانکۆ", "دیپلۆم"] },
        { id: "career", label: "پەروەردە و خزمەت", terms: ["به رێوهبهر", "بەڕێوەبەر", "سەرپەرشتیار", "مانگی سوور", "پەروەردە"] },
        { id: "places", label: "شوێن و ناوچەکان", terms: ["هەولێر", "بەغدا", "شێخان", "زاخۆ", "سلێمانی", "دیاربەکر", "مووسڵ", "موکریان"] },
        { id: "lineage", label: "شەجەرە و ڕەچەڵەک", terms: ["تیرەی", "شەجەرە", "نەسەب", "باپیر", "هۆز", "عەشیرەت"] },
    ];

    function escapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function normalize(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[يى]/g, "ی")
            .replace(/[ك]/g, "ک")
            .replace(/[ة]/g, "ە")
            .replace(/[ؤ]/g, "و")
            .replace(/[إأٱآ]/g, "ا")
            .replace(/[ئ]/g, "")
            .replace(/[ڕ]/g, "ر")
            .replace(/[ڵ]/g, "ل")
            .replace(/[ێ]/g, "ی")
            .replace(/[ۆ]/g, "و")
            .replace(/[ًٌٍَُِّْـ]/g, "")
            .replace(/[‌\u200c]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Basic OCR clean-up: collapses accidental repeated runs of text and
    // fixes the most common Kurdish character variants, without inventing
    // or altering any actual words/facts.
    function cleanText(value, maxLength = 4000) {
        let text = String(value || "")
            .replace(/[ك]/g, "ک")
            .replace(/[يى]/g, "ی")
            .replace(/\s+([،.؛؟!])/g, "$1")
            .replace(/([،؛؟!])(?=\S)/g, "$1 ")
            .replace(/\s+/g, " ")
            .trim();
        for (let pass = 0; pass < 4; pass += 1) {
            let changed = false;
            for (let length = 35; length <= Math.min(180, Math.floor(text.length / 2)); length += 5) {
                const prefix = text.slice(0, length);
                const repeatAt = text.indexOf(prefix, Math.max(1, length - 8));
                if (repeatAt > 0 && repeatAt < length + 50) {
                    text = `${text.slice(0, repeatAt)} ${text.slice(repeatAt + prefix.length)}`.replace(/\s+/g, " ").trim();
                    changed = true;
                    break;
                }
            }
            if (!changed) break;
        }
        return text.slice(0, maxLength);
    }

    function paragraphs(text) {
        const sentences = String(text || "")
            .split(/(?<=[.؟!؛])\s+|\n+/u)
            .map((item) => item.trim())
            .filter(Boolean);
        const groups = [];
        for (let i = 0; i < sentences.length; i += 3) {
            groups.push(sentences.slice(i, i + 3).join(" "));
        }
        return groups.length ? groups : [text];
    }

    function buildParts(chunks) {
        const parts = [];
        for (let i = 0; i < chunks.length; i += CHUNKS_PER_PART) {
            const group = chunks.slice(i, i + CHUNKS_PER_PART);
            const pages = group.flatMap((chunk) => chunk.pages || []);
            const startPage = pages.length ? Math.min(...pages) : "";
            const endPage = pages.length ? Math.max(...pages) : "";
            const text = cleanText(group.map((chunk) => chunk.text || "").join(" "));
            const normalizedText = normalize(text);
            const tags = TOPICS.filter((topic) =>
                topic.terms.some((term) => normalizedText.includes(normalize(term)))
            );
            parts.push({
                index: parts.length,
                startPage,
                endPage,
                text,
                tags,
            });
        }
        return parts;
    }

    function buildTopicIndex(parts) {
        return TOPICS.map((topic) => {
            const matchingParts = parts
                .filter((part) => part.tags.some((tag) => tag.id === topic.id))
                .map((part) => part.index);
            return { ...topic, matchingParts };
        }).filter((topic) => topic.matchingParts.length > 0);
    }

    function assetIcon(url) {
        return /\.pdf($|\?)/i.test(url) ? "📄" : "🖼️";
    }

    function renderStats(knowledge) {
        if (!rootsStats) return;
        rootsStats.innerHTML = `
            <span>${knowledge.documents.length} بەڵگەنامە</span>
            <span>${knowledge.chunks.length} پارچەی سەرچاوە</span>
            <span>${knowledge.assets.length} شەجەرە و پاشکۆ</span>
        `;
    }

    function renderAssets(knowledge) {
        if (!rootsAssets) return;
        rootsAssets.innerHTML = knowledge.assets.map((asset) => `
            <a class="roots-asset-card" href="${escapeHtml(asset.url)}" target="_blank" rel="noopener">
                <span class="roots-asset-icon">${assetIcon(asset.url)}</span>
                <span>${escapeHtml(asset.title)}</span>
            </a>
        `).join("");
    }

    function renderTopics(topics) {
        if (!rootsTopics) return;
        if (!topics.length) {
            rootsTopics.innerHTML = `<p>هیچ بابەتێک نەدۆزرایەوە.</p>`;
            return;
        }
        rootsTopics.innerHTML = topics.map((topic) => `
            <button type="button" class="roots-topic-chip" data-jump-part="${topic.matchingParts[0]}">
                ${escapeHtml(topic.label)}
            </button>
        `).join("");
        rootsTopics.querySelectorAll("[data-jump-part]").forEach((button) => {
            button.addEventListener("click", () => {
                const partIndex = Number(button.getAttribute("data-jump-part"));
                jumpToPart(partIndex);
            });
        });
    }

    function renderParts(parts) {
        rootsParts.innerHTML = parts.map((part) => {
            const pageLabel = part.startPage
                ? (part.startPage === part.endPage ? `لاپەڕە ${part.startPage}` : `لاپەڕە ${part.startPage}-${part.endPage}`)
                : "";
            return `
                <details class="roots-part" id="roots-part-${part.index}">
                    <summary>
                        <div class="roots-part-heading">
                            <span class="roots-part-title">بەشی ${part.index + 1}</span>
                            <span class="roots-part-pages">${escapeHtml(pageLabel)}</span>
                        </div>
                        <div class="roots-part-tags">
                            ${part.tags.slice(0, 3).map((tag) => `<span class="roots-part-tag">${escapeHtml(tag.label)}</span>`).join("")}
                        </div>
                    </summary>
                    <div class="roots-part-body">
                        ${paragraphs(part.text).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
                    </div>
                </details>
            `;
        }).join("");
    }

    function jumpToPart(partIndex) {
        const element = document.getElementById(`roots-part-${partIndex}`);
        if (!element) return;
        element.setAttribute("open", "true");
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("roots-part-highlight");
        setTimeout(() => element.classList.remove("roots-part-highlight"), 1600);
    }

    async function init() {
        if (rootsParts) {
            rootsParts.innerHTML = `<p>ناوەڕۆک بارکراوە...</p>`;
        }
        try {
            const response = await fetch(dataUrl, { cache: "no-store" });
            if (!response.ok) {
                throw new Error("کۆرپەی زانیارییەکان نەخوێندرایەوە.");
            }
            const knowledge = await response.json();
            const parts = buildParts(knowledge.chunks || []);
            const topics = buildTopicIndex(parts);
            renderStats(knowledge);
            renderAssets(knowledge);
            renderTopics(topics);
            renderParts(parts);
        } catch (error) {
            if (rootsParts) {
                rootsParts.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
            }
        }
    }

    let loaded = false;
    window.loadRootsKnowledge = () => {
        if (loaded) return;
        loaded = true;
        init();
    };
    if (location.hash.replace("#", "") === "roots") {
        window.loadRootsKnowledge();
    }
})();

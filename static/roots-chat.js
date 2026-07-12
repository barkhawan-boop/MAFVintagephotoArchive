(() => {
    const dataUrl = "/static/roots-knowledge.json?v=pdf-rag-v23";
    const rootsPanel = document.getElementById("rootsPanel");
    const rootsForm = document.getElementById("rootsChatForm");
    const rootsQuestion = document.getElementById("rootsQuestion");
    const rootsMessages = document.getElementById("rootsMessages");
    const rootsStatus = document.getElementById("rootsStatus");
    const rootsStats = document.getElementById("rootsStats");
    const rootsAssets = document.getElementById("rootsAssets");
    const rootsSuggestions = document.querySelectorAll("[data-roots-question]");

    if (!rootsPanel || !rootsForm || !rootsQuestion || !rootsMessages) {
        return;
    }

    const stopWords = new Set([
        "من", "تۆ", "ئەم", "ئەو", "لە", "بە", "بۆ", "و", "یا", "یان", "کە", "چی", "چییە", "کێ", "کێیە", "کییە",
        "چۆن", "لەکوێ", "کوێ", "ساڵ", "ناو", "ناوی", "دەربارەی", "زانیاری", "هەیە", "دەربارە", "پێناسە",
        "the", "and", "of", "for", "who", "what", "where", "family", "tree",
    ]);
    const personTitleWords = new Set([
        "مامۆستا", "ماموستا", "مەلا", "مهلا", "ملا", "کاک", "خاتوو", "حاجی", "حاجى",
        "شێخ", "سەید", "سید", "دکتۆر", "پروفیسۆر", "پ", "د",
    ]);
    const placeNames = [
        "هەولێر", "ئاکرێ", "ڕانیە", "هەکاری", "میافارقین", "باکووری کوردستان", "باشووری کوردستان",
        "کوردستان", "بەغدا", "شێخان", "بیارە", "داربەسەر", "دوکەڵە", "زاخۆ", "سلێمانی",
        "زاگرۆس", "هەمەدان", "دەیلەم", "مەروان", "ئامەد", "دیاربەکر", "حەکاری", "مووسڵ",
    ];
    const relationWords = [
        "کوڕی", "کچی", "نەوەی", "باوکی", "دایکی", "برا", "خوشک", "مام", "خاڵ", "باپیر",
        "بنەماڵەی", "تیرەی", "ڕەگی", "سەرجەلە", "شەجەرە", "نەسەب", "هۆز", "عەشیرەت",
    ];
    const trustedReferences = [
        {
            title: "Kurdish Tribes",
            url: "https://www.iranicaonline.org/articles/kurdish-tribes/",
            harvard: "Oberling, P. (2004) 'Kurdish Tribes', Encyclopaedia Iranica. Available at: https://www.iranicaonline.org/articles/kurdish-tribes/ (Accessed: 29 May 2026).",
        },
        {
            title: "The Cambridge History of the Kurds",
            url: "https://www.cambridge.org/core/books/cambridge-history-of-the-kurds/cambridge-history-of-the-kurds/DF90AEDC6BEF3EFC589CCAD8AAC520D8",
            harvard: "Bozarslan, H., Gunes, C. and Yadirgi, V. (eds.) (2021) The Cambridge History of the Kurds. Cambridge: Cambridge University Press. Available at: https://www.cambridge.org/core/books/cambridge-history-of-the-kurds/cambridge-history-of-the-kurds/DF90AEDC6BEF3EFC589CCAD8AAC520D8 (Accessed: 29 May 2026).",
        },
        {
            title: "Notes on the Tribes of Southern Kurdistan",
            url: "https://unglue.it/work/1240452/",
            harvard: "Government Press (1919) Notes on the Tribes of Southern Kurdistan. Baghdad: Government Press. Available at: https://unglue.it/work/1240452/ (Accessed: 29 May 2026).",
        },
    ];

    let knowledgePromise = null;
    let knowledge = null;
    let normalizedStopWords = null;
    let normalizedPersonTitleWords = null;

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

    function isStopWord(token) {
        if (!normalizedStopWords) {
            normalizedStopWords = new Set([...stopWords].map((word) => normalize(word)));
        }
        return stopWords.has(token) || normalizedStopWords.has(token);
    }

    function isPersonTitle(token) {
        if (!normalizedPersonTitleWords) {
            normalizedPersonTitleWords = new Set([...personTitleWords].map((word) => normalize(word)));
        }
        return personTitleWords.has(token) || normalizedPersonTitleWords.has(token);
    }

    function compactName(value) {
        const skipCodes = new Set([
            0x0621, 0x0622, 0x0623, 0x0625, 0x0626, 0x0627, 0x0649, 0x064A, 0x0648,
            0x0647, 0x0671, 0x06CC, 0x06CE, 0x06D5, 0x06C6, 0x06C7, 0x06C8, 0x06CB,
        ]);
        const foldCodes = new Map([
            [0x0635, 0x0633],
            [0x06A9, 0x06A9],
            [0x0643, 0x06A9],
            [0x0695, 0x0631],
            [0x06B5, 0x0644],
        ]);
        let compact = "";
        for (const char of normalize(value)) {
            const code = char.codePointAt(0);
            if (skipCodes.has(code) || (code >= 0x064B && code <= 0x065F) || code === 0x0670) {
                continue;
            }
            if (!/[\p{L}\p{N}]/u.test(char)) {
                continue;
            }
            compact += foldCodes.has(code) ? String.fromCodePoint(foldCodes.get(code)) : char;
        }
        return compact;
    }

    function tokenize(value) {
        return normalize(value)
            .split(/[^\p{L}\p{N}]+/u)
            .map((token) => token.trim())
            .filter((token) => token.length > 1 && !isStopWord(token));
    }

    function unique(items) {
        return [...new Set(items.filter(Boolean))];
    }

    function wantsSources(question) {
        const text = normalize(question);
        return [
            "source", "sources", "cite", "citation", "citations", "reference", "references", "harvard",
            "سەرچاوە", "سەرچاوەکان", "هارفارد", "ژێدەر", "ژێدەرەکان", "بەڵگەکان", "بەڵگەنامەکان",
        ].some((term) => text.includes(normalize(term)));
    }

    function wantsSourceAssets(question) {
        const text = normalize(question);
        return [
            "شەجەرە", "سەرجەلە", "دار", "نەخشە", "map", "tree", "pdf", "پاشکۆ",
        ].some((term) => text.includes(normalize(term)));
    }

    function cleanEvidence(value, maxLength = 520) {
        let text = String(value || "").replace(/\s+/g, " ").trim();
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

    function polishKurdishText(value, maxLength = 520) {
        let text = cleanEvidence(value, maxLength)
            .replace(/[ك]/g, "ک")
            .replace(/[يى]/g, "ی")
            .replace(/[ەة]/g, "ە")
            .replace(/م[ەه]\s*لا/g, "مەلا")
            .replace(/مهلا/g, "مەلا")
            .replace(/ئ[ەه]\s*مین/g, "ئەمین")
            .replace(/امین/g, "ئەمین")
            .replace(/عبدالرحمن/g, "عەبدولڕەحمان")
            .replace(/م[ەه]\s*موندی/g, "مەموندی")
            .replace(/مهموندی/g, "مەموندی")
            .replace(/م[ەه]\s*روانی/g, "مەروانی")
            .replace(/بن[ەه]\s*ما\s*ڵ[ەه]/g, "بنەماڵە")
            .replace(/بن[ەه]\s*ماڵ[ەه]/g, "بنەماڵە")
            .replace(/دوكهڵ\s*ه/g, "دوکەڵە")
            .replace(/دوکەڵ\s*ە/g, "دوکەڵە")
            .replace(/دوكهڵ/g, "دوکەڵە")
            .replace(/س\s*الح/g, "ساڵح")
            .replace(/سال\s*ح/g, "ساڵح")
            .replace(/سالح/g, "ساڵح")
            .replace(/صالح/g, "ساڵح")
            .replace(/د[ەه]\s*ربار[ەه][ىی]/g, "دەربارەی")
            .replace(/پ[ەه]\s*یو[ەه]\s*ند[ىی]/g, "پەیوەندی")
            .replace(/ش[ەه]\s*ج[ەه]\s*ر[ەه]/g, "شەجەرە");
        text = text
            .replace(/\s+([،.؛؟!])/g, "$1")
            .replace(/([،؛؟!])(?=\S)/g, "$1 ")
            .replace(/\s+/g, " ")
            .trim();
        return text;
    }

    function hasConcept(value, terms) {
        const text = normalize(value);
        return terms.some((term) => text.includes(normalize(term)));
    }

    function evidenceCorpus(results) {
        return results.map((chunk) => `${chunk.title || ""} ${chunk.text || ""}`).join(" ");
    }

    function isEnglishQuestion(question) {
        const latin = (question.match(/[A-Za-z]/g) || []).length;
        const kurdish = (question.match(/[\u0600-\u06ff]/g) || []).length;
        return latin > kurdish;
    }

    function sourceLabel(result) {
        const pages = Array.isArray(result.pages) && result.pages.length ? `، لاپەڕە ${result.pages.join("-")}` : "";
        return `PDF: ${result.path || result.title || "گولزاری مێژوو"}${pages}، پارچە ${result.id}`;
    }

    function wantsOrigin(question) {
        return hasConcept(question, [
            "لەکوێوە", "کوێوە", "کوێ", "هاتوون", "هاتنی", "بڵاوبوونەوە", "ڕەگ", "ڕیشە",
            "پەیدابوون", "چیەوە", "سەریهەڵداوە", "origin", "come from",
        ]);
    }

    function wantsGenealogyContext(question) {
        return hasConcept(question, [
            "ڕەچەڵەک", "رەچەڵەک", "نەسەب", "باپیر", "باوک", "بنەماڵە", "شەجەرە",
            "هۆز", "عەشیرەت", "root", "ancestor", "family tree",
        ]);
    }

    function wantsPlaces(question) {
        return hasConcept(question, [
            "شوێن", "لەکوێ", "کوێ", "گوند", "شار", "ناوچە", "نەخشە", "map", "place",
        ]);
    }

    function wantsPersonIdentity(question) {
        return hasConcept(question, [
            "کێیە", "کییە", "کێیه", "who is", "ژیاننامە", "ژیاننامه", "ناسراو", "پێناسە",
        ]);
    }

    function personNameParts(question) {
        const rawTerms = tokenize(question)
            .filter((term) => !isPersonTitle(term))
            .filter((term) => !relationWords.some((word) => normalize(word) === term));
        const compactTerms = rawTerms.map(compactName).filter(Boolean);
        return {
            isPersonQuestion: wantsPersonIdentity(question) && compactTerms.length > 0,
            rawTerms,
            compactTerms,
            strongTerms: unique(compactTerms.filter((term) => term.length >= 3)),
            compactPhrase: compactTerms.join(""),
        };
    }

    function nameMatchDetails(parts, compactText) {
        if (!parts?.compactTerms?.length || !compactText) {
            return { score: 0, exactPhrase: false, strongMatches: [], totalMatches: [] };
        }
        const exactPhrase = parts.compactPhrase.length >= 5 && compactText.includes(parts.compactPhrase);
        const strongMatches = parts.strongTerms.filter((term) => compactText.includes(term));
        const totalMatches = unique(parts.compactTerms.filter((term) => term.length >= 2 && compactText.includes(term)));
        let score = 0;
        if (exactPhrase) score += 120;
        score += strongMatches.length * 24;
        score += totalMatches.length * 6;
        if (parts.strongTerms.length && strongMatches.length === parts.strongTerms.length) {
            score += 35;
        }
        if (!exactPhrase && parts.strongTerms.length > 1 && strongMatches.length < 2) {
            score = 0;
        }
        return { score, exactPhrase, strongMatches, totalMatches };
    }

    function personNameLabel(question) {
        const cleaned = String(question || "")
            .replace(/[؟?]/g, " ")
            .replace(/کێیە|کییە|کێيه|کێیه|چییە|چیيه|who is/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
        return polishKurdishText(cleaned, 140);
    }

    function rankedSentences(question, results, maxSentences = 4, exclude = []) {
        const terms = tokenize(question);
        const normalizedTerms = terms.map(normalize);
        const genealogy = wantsGenealogyContext(question);
        const excludeKeys = new Set(exclude.filter(Boolean).map((line) => normalize(line).slice(0, 60)));
        const seen = new Set(excludeKeys);
        const scored = [];
        results.slice(0, 6).forEach((result, resultIndex) => {
            for (const sentence of sentences(result.text)) {
                const key = normalize(sentence).slice(0, 60);
                if (seen.has(key)) continue;
                const normalizedSentence = normalize(sentence);
                let score = 0;
                for (const term of normalizedTerms) {
                    if (normalizedSentence.includes(term)) {
                        score += term.length > 4 ? 6 : 3;
                    }
                }
                if (genealogy && relationWords.some((word) => normalizedSentence.includes(normalize(word)))) {
                    score += 8;
                }
                if (/[0-9\u0660-\u0669]{4}/.test(sentence)) {
                    score += 4;
                }
                score += Math.max(0, 6 - resultIndex);
                if (score <= 0) continue;
                seen.add(key);
                scored.push({ sentence: cleanEvidence(sentence, 420), score });
            }
        });
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSentences)
            .map((item) => item.sentence);
    }

    function humanFallbackSummary(question, results, lineage, places) {
        const direct = lineage[0] || "";
        const extra = rankedSentences(question, results, 3, [direct]);
        const combined = unique([direct, ...extra].filter(Boolean))
            .map((line) => polishKurdishText(line, 340))
            .slice(0, 3);

        let answer = "";
        if (combined.length) {
            answer = `بەپێی کتێبی «گولزاری مێژوو»، ${combined.join(" ")}`;
        } else {
            answer = "لە داتاکانی ئەرشیفدا زانیارییەکی تەواو و ڕاستەوخۆ بۆ ئەم پرسیارە نەدۆزرایەوە. ئەگەر ناوی باوک، باپیر، گوند یان ساڵێک زیاد بکەیت، وەڵامەکە وردتر دەبێت.";
        }

        const tree = lineage.length > 1 ? lineage.slice(1, 3).join("، ") : "";
        const context = combined.length > 1
            ? "ئەم وەڵامە کورتکراوەیەکی چەند پارچەیەکی PDF ـە؛ بۆ وردی زیاتر بەشی سەرچاوەکان ببینە."
            : "";

        return { answer, tree, context, places };
    }

    function prepareKnowledge(data) {
        const sourceMap = new Map((data.documents || []).map((source) => [source.id, source]));
        const vectorMap = new Map((data.vectorIndex?.chunkVectors || []).map((item) => [item.id, item.values || []]));
        data.sourceMap = sourceMap;
        data.vectorVocabulary = data.vectorIndex?.vocabulary || [];
        data.vectorIdf = data.vectorIndex?.idf || [];
        data.vectorTermToIndex = new Map(data.vectorVocabulary.map((term, index) => [term, index]));
        data.chunks = (data.chunks || []).map((chunk) => {
            const combined = `${chunk.title || ""} ${chunk.path || ""} ${chunk.text || ""}`;
            return {
                ...chunk,
                normalized: normalize(combined),
                nameCompact: compactName(combined),
                vector: vectorMap.get(chunk.id) || [],
            };
        });
        return data;
    }

    async function loadRootsKnowledge() {
        if (knowledge) {
            return knowledge;
        }
        if (!knowledgePromise) {
            if (rootsStatus) {
                rootsStatus.textContent = "ئەرشیفی ڕەچەڵەک دەکرێتەوە...";
            }
            knowledgePromise = fetch(dataUrl, { cache: "no-store" })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error("کۆرپەی زانیارییەکان نەخوێندرایەوە.");
                    }
                    return response.json();
                })
                .then((data) => {
                    knowledge = prepareKnowledge(data);
                    renderKnowledgeSummary();
                    if (rootsStatus) {
                        rootsStatus.textContent = "ئامادەیە.";
                    }
                    return knowledge;
                })
                .catch((error) => {
                    if (rootsStatus) {
                        rootsStatus.textContent = error.message;
                    }
                    throw error;
                });
        }
        return knowledgePromise;
    }

    function renderKnowledgeSummary() {
        if (!knowledge) return;
        if (rootsStats) {
            rootsStats.innerHTML = `
                <span>${knowledge.documents.length} بەڵگەنامە</span>
                <span>${knowledge.chunks.length} پارچەی گەڕان</span>
                <span>${knowledge.assets.length} شەجەرە و پاشکۆ</span>
            `;
        }
        if (rootsAssets) {
            rootsAssets.innerHTML = knowledge.assets.map((asset) => `
                <a class="roots-asset-link" href="${escapeHtml(asset.url)}" target="_blank" rel="noopener">
                    <span>${escapeHtml(asset.title)}</span>
                </a>
            `).join("");
        }
    }

    function queryVector(question) {
        if (!knowledge?.vectorTermToIndex?.size) {
            return [];
        }
        const counts = new Map();
        for (const token of tokenize(question)) {
            const index = knowledge.vectorTermToIndex.get(token);
            if (index === undefined) continue;
            counts.set(index, (counts.get(index) || 0) + 1);
        }
        const weighted = [];
        for (const [index, count] of counts) {
            const idf = knowledge.vectorIdf[index] || 1;
            weighted.push([index, (1 + Math.log(count)) * idf]);
        }
        const norm = Math.sqrt(weighted.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
        return weighted.map(([index, value]) => [index, value / norm]);
    }

    function cosineSparse(query, chunkVector) {
        if (!query.length || !chunkVector?.length) {
            return 0;
        }
        const values = new Map(chunkVector.map(([index, value]) => [index, value]));
        return query.reduce((sum, [index, value]) => sum + value * (values.get(index) || 0), 0);
    }

    function lexicalScore(question, chunk) {
        const normalizedQuestion = normalize(question);
        const terms = tokenize(question);
        const asksLineage = ["رەچەڵەک", "نەسەب", "شەجەرە", "باپیر", "بنەماڵە", "باوک"].some((term) => normalizedQuestion.includes(normalize(term)));
        const personParts = personNameParts(question);
        let score = 0;
        if (normalizedQuestion.length > 2 && chunk.normalized.includes(normalizedQuestion)) {
            score += 40 + Math.min(normalizedQuestion.length, 80) / 4;
        }
        for (const term of terms) {
            const count = chunk.normalized.split(term).length - 1;
            if (count) {
                score += Math.min(count, 5) * (term.length > 4 ? 7 : 4);
            }
            if (normalize(chunk.title).includes(term)) score += 8;
            if (normalize(chunk.path).includes(term)) score += 4;
        }
        if (relationWords.some((word) => normalizedQuestion.includes(normalize(word))) && relationWords.some((word) => chunk.normalized.includes(normalize(word)))) {
            score += 10;
        }
        if (asksLineage && ["تیرەی", "مەلازادە", "مەموندی", "مەحمودی", "مەروانی"].some((term) => chunk.normalized.includes(normalize(term)))) {
            score += 26;
        }
        if (asksLineage && chunk.normalized.includes(normalize("بنەماڵەی مامۆستا مەلا ئەمین"))) {
            score += 35;
        }
        if (personParts.isPersonQuestion) {
            score += nameMatchDetails(personParts, chunk.nameCompact).score;
        }
        return score;
    }

    function searchChunks(question) {
        const qVector = queryVector(question);
        const terms = tokenize(question);
        return knowledge.chunks
            .map((chunk) => {
                const matchedTerms = terms.filter((term) => chunk.normalized.includes(term)).length;
                const semanticScore = cosineSparse(qVector, chunk.vector);
                const score = lexicalScore(question, chunk) + semanticScore * 85;
                return { ...chunk, score, semanticScore, matchedTerms };
            })
            .filter((chunk) => chunk.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
    }

    function pdfContextEnough(question, results) {
        if (!results.length) {
            return false;
        }
        const terms = tokenize(question);
        const top = results[0];
        const personParts = personNameParts(question);
        if (personParts.isPersonQuestion) {
            const bestNameMatch = results
                .map((result) => nameMatchDetails(personParts, result.nameCompact))
                .sort((a, b) => b.score - a.score)[0];
            return Boolean(
                bestNameMatch?.exactPhrase ||
                (personParts.strongTerms.length > 0 && bestNameMatch?.strongMatches?.length >= Math.min(2, personParts.strongTerms.length))
            );
        }
        if (!terms.length) {
            return top.score >= 20;
        }
        const neededTerms = Math.min(2, terms.length);
        return top.score >= 30 || top.semanticScore >= 0.12 || top.matchedTerms >= neededTerms;
    }

    function snippetFor(text, question, before = 180, after = 520) {
        const terms = tokenize(question);
        const normalizedText = normalize(text);
        let index = -1;
        for (const term of terms) {
            index = normalizedText.indexOf(term);
            if (index >= 0) break;
        }
        if (index < 0) index = 0;
        const start = Math.max(0, index - before);
        const end = Math.min(text.length, index + after);
        return `${start > 0 ? "..." : ""}${cleanEvidence(text.slice(start, end), before + after)}${end < text.length ? "..." : ""}`;
    }

    function sentences(text) {
        return String(text || "")
            .split(/(?<=[.؟!؛])\s+|\n+/u)
            .map((item) => item.trim())
            .filter((item) => item.length > 30);
    }

    function lineageScore(line) {
        const normalized = normalize(line);
        let score = 0;
        if (line.includes("-") || line.includes("–") || line.includes("←")) score += 12;
        for (const term of ["تیرەی", "مەلازادە", "مەموندی", "مەحمودی", "مەروانی", "بنەماڵەی"]) {
            if (normalized.includes(normalize(term))) score += 10;
        }
        if (normalized.includes(normalize("رێبەری تەواو"))) score -= 18;
        if (normalized.includes(normalize("گوڵزاری مێژوو"))) score -= 10;
        return score;
    }

    function relationLines(results, question) {
        const terms = tokenize(question);
        const normalizedTerms = terms.map(normalize);
        const lines = [];
        for (const result of results) {
            for (const sentence of sentences(result.text)) {
                const normalizedSentence = normalize(sentence);
                const hasTerm = normalizedTerms.length === 0 || normalizedTerms.some((term) => normalizedSentence.includes(term));
                const hasRelation = relationWords.some((word) => normalizedSentence.includes(normalize(word)));
                if (hasTerm && hasRelation) {
                    lines.push(cleanEvidence(sentence, 520));
                }
            }
        }
        return unique(lines)
            .sort((a, b) => lineageScore(b) - lineageScore(a))
            .slice(0, 6);
    }

    function directLineageLine(question, results) {
        const normalizedQuestion = normalize(question);
        const wantsMainFamily = ["مەلا ئەمین", "مەلا ساڵح", "مامۆستا", "دوکەڵە"].some((term) => normalizedQuestion.includes(normalize(term)));
        if (!wantsMainFamily) {
            return "";
        }
        const seen = new Set();
        const candidates = results.filter((chunk) => {
            if (seen.has(chunk.id)) return false;
            seen.add(chunk.id);
            return true;
        });
        for (const result of candidates) {
            for (const sentence of sentences(result.text)) {
                const normalized = normalize(sentence);
                const hasMainFamily = normalized.includes(normalize("بنەماڵەی مامۆستا مەلا ئەمین"));
                const hasLineageChain = normalized.includes(normalize("تیرەی")) && normalized.includes(normalize("مەموندی"));
                if (hasMainFamily && hasLineageChain) {
                    return cleanEvidence(sentence.replace(/\s*[-–]\s*/g, " ← "), 620);
                }
            }
        }
        return "";
    }

    function treeLines(results, question) {
        const terms = tokenize(question);
        const lines = [];
        const direct = directLineageLine(question, results);
        if (direct) {
            lines.push(direct);
        }
        const relationCandidates = relationLines(results, question);
        for (const line of relationCandidates) {
            if (line.includes("-") || line.includes("–") || relationWords.some((word) => normalize(line).includes(normalize(word)))) {
                lines.push(cleanEvidence(line.replace(/\s*[-–]\s*/g, " ← "), 420));
            }
        }
        if (!lines.length && results[0]) {
            lines.push(snippetFor(results[0].text, question, 60, 300));
        }
        return unique(lines).slice(0, 4);
    }

    function matchedPlaces(results) {
        const text = normalize(results.map((result) => result.text).join(" "));
        return placeNames.filter((place) => text.includes(normalize(place))).slice(0, 8);
    }

    function matchedAssets(question, results) {
        const query = normalize(question);
        const hitText = normalize(results.map((result) => `${result.title} ${result.text}`).join(" "));
        const wantsTrees = ["شەجەرە", "سەرجەلە", "دار", "نەسەب", "tree", "map", "نەخشە"].some((term) => query.includes(normalize(term)));
        return (knowledge.assets || []).filter((asset) => {
            const title = normalize(asset.title);
            if (wantsTrees) return true;
            return tokenize(`${question} ${hitText}`).some((term) => title.includes(term));
        }).slice(0, wantsTrees ? 7 : 3);
    }

    function onlineLinks(question) {
        const q = encodeURIComponent(question);
        return [
            { label: "Google Scholar", url: `https://scholar.google.com/scholar?q=${q}` },
            { label: "Internet Archive", url: `https://archive.org/search?query=${q}` },
            { label: "WorldCat", url: `https://search.worldcat.org/search?q=${q}` },
            { label: "OpenStreetMap", url: `https://www.openstreetmap.org/search?query=${q}` },
        ];
    }

    function sourceList(results) {
        const sources = [];
        const seen = new Set();
        for (const result of results) {
            const source = knowledge.sourceMap.get(result.source);
            if (source && !seen.has(source.id)) {
                seen.add(source.id);
                const pages = Array.isArray(result.pages) && result.pages.length ? ` لاپەڕە ${result.pages.join("-")}.` : "";
                sources.push(`${source.harvard}${pages}`);
            }
        }
        return sources.slice(0, 5);
    }

    function evidencePayload(question, results) {
        return results.slice(0, 7).map((result, index) => {
            const source = knowledge.sourceMap.get(result.source) || {};
            return {
                rank: index + 1,
                title: result.title,
                path: result.path,
                pages: result.pages || [],
                chunkId: result.id,
                sourceLabel: sourceLabel(result),
                score: Math.round(result.score),
                excerpt: snippetFor(result.text, question, 220, 720),
                harvard: source.harvard || "",
            };
        });
    }

    async function aiAnswer(question, results, pdfEnough) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), pdfEnough ? 12000 : 18000);
        const payload = {
            question,
            includeSources: wantsSources(question),
            pdfContextEnough: pdfEnough,
            needsWeb: !pdfEnough,
            language: isEnglishQuestion(question) ? "en" : "ckb",
            matches: evidencePayload(question, results),
            places: matchedPlaces(results),
            assets: matchedAssets(question, results),
            trustedReferences,
        };
        try {
            const response = await fetch("/api/roots-chat", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.answer) {
                const error = new Error(data.error || "AI answer is unavailable.");
                error.code = data.code || "ai_unavailable";
                throw error;
            }
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }

    function noConfirmedAnswerHtml(question, includeSources) {
        if (isEnglishQuestion(question)) {
            return `
                <p>I could not confirm this from the family PDF.</p>
                <p>I am not fully sure from the available sources. Reliable online verification is not available in this local fallback, so I will not guess.</p>
            `;
        }
        return `
            <p>لە PDF ـی بنەماڵەدا وەڵامی دڵنیام بۆ ئەم پرسیارە نەدۆزییەوە.</p>
            <p>لە سەرچاوە بەردەستەکانەوە بە تەواوی دڵنیا نیم. گەڕانی دەرەکیی باوەڕپێکراو لەم وەشانی ناوخۆییەدا بەردەست نییە، بۆیە خەیاڵ ناکەم.</p>
            ${includeSources ? `<p>سەرچاوە: PDF ـی گولزاری مێژوو، هیچ پارچەیەکی دڵنیا نەدۆزرایەوە.</p>` : ""}
        `;
    }

    function bestPersonEvidence(question) {
        const parts = personNameParts(question);
        if (!parts.isPersonQuestion || !knowledge?.chunks?.length) {
            return null;
        }
        const ranked = knowledge.chunks
            .map((chunk, index) => {
                const details = nameMatchDetails(parts, chunk.nameCompact);
                if (!details.score) return null;
                const hasProfileFacts = hasConcept(chunk.text, [
                    "لەدایکبووی", "خوێندنی", "خوێندنى", "بەکالۆریۆس", "زانکۆ",
                    "بەڕێوەبەری", "به رێوهبهر", "سەرپەرشتیاری", "مانگی سوور", "مانگى سوور",
                ]);
                const hasNameTitle = hasConcept(chunk.text, ["مامۆستا", "خاتوو", "کاک", "پ. د."]);
                return {
                    chunk,
                    index,
                    details,
                    score: details.score + (hasProfileFacts ? 40 : 0) + (hasNameTitle ? 8 : 0),
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);
        const primary = ranked[0];
        if (!primary) {
            return null;
        }
        const confident = primary.details.exactPhrase ||
            (parts.strongTerms.length > 0 && primary.details.strongMatches.length >= Math.min(2, parts.strongTerms.length));
        if (!confident) {
            return null;
        }
        const chunks = [primary.chunk];
        const next = knowledge.chunks[primary.index + 1];
        const lastPage = Array.isArray(primary.chunk.pages) && primary.chunk.pages.length
            ? primary.chunk.pages[primary.chunk.pages.length - 1]
            : 0;
        const nextFirstPage = Array.isArray(next?.pages) && next.pages.length ? next.pages[0] : 0;
        if (next && nextFirstPage && (!lastPage || nextFirstPage <= lastPage + 1)) {
            chunks.push(next);
        }
        return { parts, primary, chunks };
    }

    function profileBirthText(text) {
        const birthMatch = /لەدایکبووی\s*([0-9٠-٩]{4})/.exec(text);
        const year = birthMatch?.[1];
        const birthWindow = birthMatch ? text.slice(birthMatch.index, birthMatch.index + 180) : "";
        const knownPlace = placeNames.find((place) => hasConcept(birthWindow, [place])) ||
            (hasConcept(birthWindow, ["دوكهڵ", "دوكهڵ ه"]) ? "دوکەڵە" : "");
        const afterYear = birthMatch ? birthWindow.slice(birthMatch[0].length) : "";
        const rawPlace = afterYear.match(/ل[ەه]\s*([^،.؟!؛\s]+)/)?.[1] || "";
        const place = knownPlace || rawPlace;
        if (year && place) {
            return `لە ${year} لە ${polishKurdishText(place, 80)} لەدایکبووە`;
        }
        if (year) {
            return `لە ${year} لەدایکبووە`;
        }
        return "";
    }

    function personProfileAnswerHtml(question, includeSources) {
        const evidence = bestPersonEvidence(question);
        if (!evidence) {
            return "";
        }
        const text = evidence.chunks.map((item) => item.text || "").join(" ");
        const name = personNameLabel(question) || "ئەم کەسە";
        const displayName = hasConcept(text, ["مامۆستا"]) && !hasConcept(name, ["مامۆستا"])
            ? `مامۆستا ${name}`
            : name;
        const birth = profileBirthText(text);
        const education = hasConcept(text, ["بەکالۆریۆس", "بهكالۆریۆس", "زانکۆی بەغدا", "زانكۆى بهغدا", "بەشی کوردی", "بهشى كوردى"]);
        const educationText = education
            ? "خوێندنی بەکالۆریۆسی لە زانکۆی بەغدا، بەشی کوردی تەواو کردووە."
            : "";
        const service = hasConcept(text, ["دواناوەندی زۆزان", "دواناوه ندى زۆزان", "سەرپەرشتیاری پسپۆری کوردی", "پسپۆرى كوردى", "بەڕێوەبەری گشتی پەروەردەی هەولێر", "مانگی سووری عێراقی"]);
        const serviceText = service
            ? "لە پەروەردەدا خزمەتی کردووە؛ بەڕێوەبەری دواناوەندی زۆزان، سەرپەرشتیاری پسپۆڕی کوردی، بەڕێوەبەری گشتی پەروەردەی هەولێر، و لە 1997 تا 2003 سەرۆکی دەزگای مانگی سووری عێراقی بووە."
            : "";
        const children = hasConcept(text, ["سێ کوڕو سێ کچ", "سێ كوڕو سێ كچ"]);
        const wife = hasConcept(text, ["خاتوو سەمیعه", "خاتوو سەمیعە", "خێزانی مامۆستا"]);
        const familyText = children || wife
            ? `${wife ? "خاتوو سەمیعە خێزانی بووە" : ""}${wife && children ? " و " : ""}${children ? "سێ کوڕ و سێ کچی هەیە" : ""}.`
            : "";
        const firstLine = `بەپێی PDF ـی بنەماڵە، ${displayName} لە بەشی ژیاننامەی بنەماڵەدا باسکراوە${birth ? ` و ${birth}` : ""}.`;
        const detailLines = [educationText, serviceText, familyText].filter(Boolean);
        if (!birth && !detailLines.length) {
            return "";
        }
        return `
            <p>${escapeHtml(firstLine)}</p>
            ${detailLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
            ${includeSources ? `
                <h4>سەرچاوە</h4>
                <ol class="roots-sources">
                    ${unique(evidence.chunks.map(sourceLabel)).slice(0, 2).map((source) => `<li>${escapeHtml(source)}</li>`).join("")}
                </ol>
            ` : ""}
        `;
    }

    function fallbackAnswerHtml(question, results, pdfEnough, note = "") {
        const includeSources = wantsSources(question);
        const includeAssets = includeSources || wantsSourceAssets(question);
        const sourceCitations = sourceList(results);
        const direct = directLineageLine(question, results);
        const lineage = unique([direct, ...relationLines(results, question)])
            .filter((line) => line && (line === direct || lineageScore(line) > 0))
            .slice(0, 5);
        const places = matchedPlaces(results);
        const assets = matchedAssets(question, results);
        const external = trustedReferences.slice(0, 3);
        const researchLinks = onlineLinks(question);
        const trees = treeLines(results, question);
        const summary = humanFallbackSummary(question, results, lineage, places);
        const personProfile = personProfileAnswerHtml(question, includeSources);

        if (!pdfEnough) {
            return `
                ${note ? `<p class="roots-ai-note">${escapeHtml(note)}</p>` : ""}
                ${noConfirmedAnswerHtml(question, includeSources)}
                ${includeSources ? `
                    ${renderOnlineLinks(researchLinks)}
                ` : ""}
            `;
        }

        if (personProfile) {
            return `
                ${note ? `<p class="roots-ai-note">${escapeHtml(note)}</p>` : ""}
                ${personProfile}
            `;
        }

        return `
            ${note ? `<p class="roots-ai-note">${escapeHtml(note)}</p>` : ""}
            <p>${escapeHtml(summary.answer)}</p>
            ${summary.tree ? `
                <p>${escapeHtml(summary.tree)}</p>
            ` : ""}
            ${summary.context ? `<p>${escapeHtml(summary.context)}</p>` : ""}
            ${includeSources && trees.length ? `
                <h4>ڕیزبەندیی بەڵگەکان</h4>
                <ol>${trees.map((line) => `<li>${escapeHtml(polishKurdishText(line, 420))}</li>`).join("")}</ol>
            ` : ""}
            ${places.length && wantsPlaces(question) && !wantsOrigin(question) ? `
                <h4>شوێنە پەیوەندیدارەکان</h4>
                <p>${places.map(escapeHtml).join("، ")}</p>
            ` : ""}
            ${includeSources ? `
                <h4>بەڵگەی سەرەکی</h4>
                <ol>
                    ${results.slice(0, 3).map((result) => `
                        <li>
                            <strong>${escapeHtml(polishKurdishText(result.title, 180))}</strong>
                            <p>${escapeHtml(polishKurdishText(snippetFor(result.text, question, 120, 360), 360))}</p>
                        </li>
                    `).join("")}
                </ol>
            ` : ""}
            ${includeAssets && assets.length ? `
                <h4>شەجەرە و پاشکۆ</h4>
                <div class="roots-answer-links">
                    ${assets.map((asset) => `<a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener">${escapeHtml(asset.title)}</a>`).join("")}
                </div>
            ` : ""}
            ${includeSources ? `
                <h4>سەرچاوەکان بە شێوازی Harvard</h4>
                <ol class="roots-sources">
                    ${sourceCitations.map((source) => `<li>${escapeHtml(source)}</li>`).join("")}
                    ${assets.slice(0, 2).map((asset) => `<li>${escapeHtml(asset.harvard)}</li>`).join("")}
                    ${external.map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.harvard)}</a></li>`).join("")}
                </ol>
                ${renderOnlineLinks(researchLinks)}
            ` : ""}
        `;
    }

    function renderOnlineLinks(links) {
        return `
            <h4>گەڕانی دەرەکی</h4>
            <div class="roots-answer-links">
                ${links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`).join("")}
            </div>
        `;
    }

    function renderWebSources(sources) {
        if (!Array.isArray(sources) || !sources.length) {
            return "";
        }
        return `
            <h4>Sources</h4>
            <ol class="roots-sources">
                ${sources.slice(0, 5).map((source) => `
                    <li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title || source.url)}</a></li>
                `).join("")}
            </ol>
        `;
    }

    function renderAiAnswer(data, question, results) {
        const includeSources = wantsSources(question);
        const includeAssets = includeSources || wantsSourceAssets(question);
        const assets = matchedAssets(question, results);
        const researchLinks = onlineLinks(question);
        return `
            <div class="roots-generated">${escapeHtml(data.answer || "")}</div>
            ${includeAssets && assets.length ? `
                <h4>شەجەرە و پاشکۆ</h4>
                <div class="roots-answer-links">
                    ${assets.map((asset) => `<a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener">${escapeHtml(asset.title)}</a>`).join("")}
                </div>
            ` : ""}
            ${data.usedWeb ? renderWebSources(data.webSources) : ""}
            ${includeSources ? renderOnlineLinks(researchLinks) : ""}
        `;
    }

    function appendMessage(kind, html) {
        const message = document.createElement("article");
        message.className = `roots-message roots-message-${kind}`;
        message.innerHTML = html;
        rootsMessages.appendChild(message);
        rootsMessages.scrollTop = rootsMessages.scrollHeight;
        return message;
    }

    async function answerQuestion(question) {
        await loadRootsKnowledge();
        const results = searchChunks(question);
        const pdfEnough = pdfContextEnough(question, results);
        appendMessage("user", `<p>${escapeHtml(question)}</p>`);
        const botMessage = appendMessage("bot", `<p class="roots-thinking">زانیارییەکان کۆدەکرێنەوە و دەرئەنجام دەردەهێنرێت...</p>`);
        try {
            const data = await aiAnswer(question, results, pdfEnough);
            botMessage.innerHTML = renderAiAnswer(data, question, results);
        } catch (error) {
            botMessage.innerHTML = fallbackAnswerHtml(question, results, pdfEnough);
        }
        rootsMessages.scrollTop = rootsMessages.scrollHeight;
    }

    rootsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const question = rootsQuestion.value.trim();
        if (!question) return;
        rootsQuestion.value = "";
        rootsQuestion.disabled = true;
        try {
            await answerQuestion(question);
        } catch (error) {
            appendMessage("bot", `<p>${escapeHtml(error.message)}</p>`);
        } finally {
            rootsQuestion.disabled = false;
            rootsQuestion.focus();
        }
    });

    rootsQuestion.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
            return;
        }
        event.preventDefault();
        if (!rootsQuestion.disabled && rootsQuestion.value.trim()) {
            rootsForm.requestSubmit();
        }
    });

    rootsSuggestions.forEach((button) => {
        button.addEventListener("click", () => {
            rootsQuestion.value = button.getAttribute("data-roots-question") || "";
            rootsQuestion.focus();
        });
    });

    window.loadRootsKnowledge = loadRootsKnowledge;
    if (location.hash.replace("#", "") === "roots") {
        loadRootsKnowledge();
    }
})();

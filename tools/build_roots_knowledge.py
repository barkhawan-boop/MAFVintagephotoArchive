from __future__ import annotations

import io
import json
import os
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from math import log, sqrt


BASE_DIR = Path(__file__).resolve().parents[1]
ZIP_CANDIDATES = [
    BASE_DIR / ".tmp_roots_source.zip",
    Path.home() / "Desktop" / "گولزاری مێژوو.zip",
]
OUTPUT_PATH = BASE_DIR / "static" / "roots-knowledge.json"
ASSET_DIR = BASE_DIR / "static" / "roots-assets"
WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
CONTENT_PDF_CANDIDATES = [
    Path(os.environ["ROOTS_CONTENT_PDF"]) if os.environ.get("ROOTS_CONTENT_PDF") else None,
    Path("D:/book/pdf sample.pdf"),
    BASE_DIR / "pdf sample.pdf",
]

ASSET_EXPORTS = {
    "electronic/شجره‌ی بنه‌ماله‌/100    70    indor.jpg": {
        "file": "family-tree-indor.jpg",
        "title": "شەجەرەی بنەماڵە",
    },
    "electronic/شجرەی دزەییەکان/Family Tree Dizayee .pdf-15.pdf": {
        "file": "family-tree-dizayee.pdf",
        "title": "شەجەرەی دزەییەکان",
    },
    "electronic/شجرەی مەموندەکان/مەلا قادر -١.pdf": {
        "file": "mamund-mala-qadir-1.pdf",
        "title": "شەجەرەی مەموندەکان، مەلا قادر ١",
    },
    "electronic/شجرەی مەموندەکان/مەلا قادر -٢.pdf": {
        "file": "mamund-mala-qadir-2.pdf",
        "title": "شەجەرەی مەموندەکان، مەلا قادر ٢",
    },
    "electronic/شجرەی مەموندەکان/مەلا قادر-٣.pdf": {
        "file": "mamund-mala-qadir-3.pdf",
        "title": "شەجەرەی مەموندەکان، مەلا قادر ٣",
    },
    "electronic/شەجەرەی سادات/c53.pdf": {
        "file": "sadat-c53.pdf",
        "title": "شەجەرەی سادات",
    },
    "electronic/سەنەدەکانی تەریقەت/سند الطریقە النقشبندیە/سند الطریقە النقشبندیە.pdf": {
        "file": "naqshbandi-lineage.pdf",
        "title": "سەنەدی تەریقەتی نەقشبەندی",
    },
}

STOP_WORDS = {
    "من",
    "تۆ",
    "ئەم",
    "ئەو",
    "لە",
    "بە",
    "بۆ",
    "و",
    "یا",
    "یان",
    "کە",
    "چی",
    "کێ",
    "کێیە",
    "چۆن",
    "لەکوێ",
    "کوێ",
    "ساڵ",
    "ناو",
    "ناوی",
    "دەربارەی",
    "زانیاری",
    "هەیە",
    "دەربارە",
    "the",
    "and",
    "of",
    "for",
    "who",
    "what",
    "where",
    "family",
    "tree",
}

CONTENT_TITLES = {
    "content/0.docx": "رێبەری تەواو بۆ ناسینی بنەماڵەی مامۆستا مەلا ئەمین مەلا ساڵح",
    "content/1.docx": "دەستپێک",
    "content/2.docx": "ڕەگی مەموندی بنەماڵە",
    "content/3.docx": "مەموندییە نوێیەکان",
    "content/4.docx": "بیروباوەری بنەماڵە",
    "content/5.docx": "سەرجەلەکانی باوکی مامۆستا",
    "content/6.docx": "تێبینی لەسەر وێنەکان",
    "content/7.docx": "بەشێک لە نەوە نوێیەکان",
    "content/8.docx": "تێبینی و سەرنج",
    "content/9.docx": "پاشکۆی ئامارەکانی کتێب",
    "content/10.docx": "سەرچاوەکانی کتێب",
    "content/11.docx": "لیستی وێنەکان",
    "content/12.docx": "پاشکۆی ئەلیکترۆنی",
}

BOOK_META = {
    "title": "گولزاری مێژوو",
    "author": "بەرخەوان عوسمان ئەمین",
    "reviewer": "ڕێکار ئەحمەد",
    "source": "pdf sample.pdf",
}

BOOK_TOPICS = [
    {"title": "دەستپێک", "page": 15},
    {"title": "مەموندیەکان کێن؟", "page": 18},
    {"title": "مەموندی لە چیەوە هاتووە؟", "page": 21},
    {"title": "پیشەسازی دەوڵەتی دۆستەکی", "page": 22},
    {"title": "بڵاوبوونەوەی مەموندییەکان", "page": 24},
    {"title": "هاتنی مەموندییەکان بۆ هەولێر", "page": 28},
    {"title": "ڕەگی مەموندی و بنەماڵە", "page": 30},
    {"title": "ڕەمزی نافیع ئاغا", "page": 34},
    {"title": "داربەسەری گەورە", "page": 39},
    {"title": "زاری مەموندییەکان", "page": 41},
    {"title": "تەریقەتی مەموندییەکان", "page": 42},
    {"title": "نەوەکانی بەغدا", "page": 44},
    {"title": "عەلی ساڵح ئەلسەعدی", "page": 47},
    {"title": "میرنشینی ئەردەڵان و ئەییوبیەکان", "page": 54},
    {"title": "خەتی سەیداتی", "page": 61},
    {"title": "هاتنی سەید محەمەد ئەلزاهد بۆ کوردستان", "page": 62},
    {"title": "سەرجەلەی ساداتی پیرخدری", "page": 64},
    {"title": "خزماتی لەگەڵ ئەییوبیەکان", "page": 65},
    {"title": "بنەماڵەی پیرخدریەکان لە کوردستان", "page": 66},
    {"title": "ساداتی گوندی خاڵدار", "page": 67},
    {"title": "شێخ کەمال سەید شامە", "page": 75},
    {"title": "هاتنە قوشتەپە", "page": 78},
    {"title": "پەیوەندی بنەماڵە بە تەریقەت", "page": 81},
    {"title": "تەریقەتی بنەماڵە", "page": 82},
    {"title": "پوختەیەک لە ژیاننامەی بنەماڵە", "page": 87},
    {"title": "مامۆستا مەلا ئەمین مەلا ساڵح مەلا عەزیز", "page": 88},
    {"title": "فاتیمە کێخوا ساڵح خزر عەبدوڵڵا", "page": 95},
    {"title": "مامۆستا مەلا عەزیز ئەمین ساڵح", "page": 102},
    {"title": "مامۆستا محەمەد ئەمین ساڵح", "page": 106},
    {"title": "مامۆستا عەبدولڕەحمان ئەمین ساڵح", "page": 108},
    {"title": "پ. د. عوسمان ئەمین ساڵح", "page": 111},
    {"title": "مەلا حوسێنی قوشتەپە", "page": 119},
    {"title": "کچ و نەوەکانی مامۆستا", "page": 122},
    {"title": "خاتوو سەبیحە ئەمین ساڵح", "page": 122},
    {"title": "خاتوو عائیشە ئەمین ساڵح", "page": 124},
    {"title": "خاتوو حەلیمە ئەمین ساڵح", "page": 125},
    {"title": "خاتوو هەمین ئەمین ساڵح", "page": 126},
    {"title": "خاتوو ئامینە ئەمین ساڵح", "page": 127},
    {"title": "بنەماڵەی حاجی عەبدوڵڵا", "page": 128},
    {"title": "ئیتنیکی گەلانی ناوچەکە", "page": 130},
    {"title": "پوختە", "page": 132},
    {"title": "پاشکۆی سەرجەلەکان", "page": 135},
    {"title": "تێبینی و سەرنج", "page": 209},
    {"title": "سوپاس و پێزانین", "page": 213},
    {"title": "دوا وتە", "page": 216},
    {"title": "پاشکۆی ئامارەکانی کتێب", "page": 217},
    {"title": "سەرچاوەکانی کتێب", "page": 218},
    {"title": "لیستی وێنەکان", "page": 226},
    {"title": "ئاماری بەشەکان", "page": 229},
    {"title": "پاشکۆی ئەلیکترۆنی", "page": 230},
]


@dataclass
class Source:
    id: str
    title: str
    path: str
    kind: str
    harvard: str


@dataclass
class Paragraph:
    text: str
    page: int | None = None


def find_zip() -> Path:
    for candidate in ZIP_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("Could not find گولزاری مێژوو.zip or .tmp_roots_source.zip")


def existing_knowledge() -> dict[str, object]:
    if not OUTPUT_PATH.exists():
        return {}
    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def find_content_pdf() -> Path:
    for candidate in CONTENT_PDF_CANDIDATES:
        if candidate and candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Could not find replacement PDF. Set ROOTS_CONTENT_PDF or place the file at D:/book/pdf sample.pdf."
    )


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_for_search(value: str) -> str:
    return (
        (value or "")
        .lower()
        .replace("ي", "ی")
        .replace("ى", "ی")
        .replace("ك", "ک")
        .replace("ة", "ە")
        .replace("ؤ", "و")
        .replace("إ", "ا")
        .replace("أ", "ا")
        .replace("ٱ", "ا")
        .replace("آ", "ا")
        .replace("ئ", "")
        .replace("ڕ", "ر")
        .replace("ڵ", "ل")
        .replace("ێ", "ی")
        .replace("ۆ", "و")
    )


def tokenize_for_search(value: str) -> list[str]:
    normalized = re.sub(r"[ًٌٍَُِّْـ]", "", normalize_for_search(value))
    tokens = re.split(r"[^\w\u0600-\u06ff]+", normalized)
    return [token for token in tokens if len(token) > 1 and token not in STOP_WORDS]


def paragraph_text(item: str | Paragraph) -> str:
    return item.text if isinstance(item, Paragraph) else str(item)


def paragraph_page(item: str | Paragraph) -> int | None:
    return item.page if isinstance(item, Paragraph) else None


def title_from_path(path: str, fallback: str) -> str:
    if path in CONTENT_TITLES:
        return CONTENT_TITLES[path]
    stem = Path(path).stem
    if stem.isdigit():
        return fallback
    return stem.replace("_", " ").strip() or fallback


def harvard(title: str, path: str, kind: str = "document") -> str:
    medium = "Unpublished family archive document" if kind == "docx" else "Digital family archive source"
    return f"گولزاری مێژوو. (n.d.) {title}. {medium}, {path}."


def docx_paragraphs(blob: bytes) -> list[str]:
    paragraphs: list[str] = []
    with zipfile.ZipFile(io.BytesIO(blob)) as docx:
        names = [
            name
            for name in docx.namelist()
            if name.startswith("word/")
            and name.endswith(".xml")
            and ("document.xml" in name or "header" in name or "footer" in name)
        ]
        for name in names:
            try:
                root = ET.fromstring(docx.read(name))
            except ET.ParseError:
                continue
            for para in root.findall(".//w:p", WORD_NS):
                parts = [node.text or "" for node in para.findall(".//w:t", WORD_NS)]
                text = clean_text("".join(parts))
                if text:
                    paragraphs.append(text)
    return paragraphs


def pdf_paragraphs(path: Path) -> list[Paragraph]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF extraction needs pypdf. Install requirements.txt or run with the bundled workspace Python.") from exc

    paragraphs: list[Paragraph] = []
    reader = PdfReader(str(path))
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        lines = [clean_text(line) for line in text.splitlines()]
        current: list[str] = []

        def flush() -> None:
            if not current:
                return
            paragraph = clean_text(" ".join(current))
            current.clear()
            if len(paragraph) > 2:
                paragraphs.append(Paragraph(paragraph, page_number))

        for line in lines:
            if not line:
                flush()
                continue
            if line.isdigit() and int(line) in {page_number, page_number + 1}:
                continue
            current.append(line)
            joined = " ".join(current)
            if len(joined) >= 620 or line.endswith((".", "؟", "!", "؛", ":")):
                flush()
        flush()
    return paragraphs


def chunk_paragraphs(paragraphs: list[str | Paragraph], limit: int = 1200) -> list[dict[str, object]]:
    chunks: list[dict[str, object]] = []
    current: list[str] = []
    pages: set[int] = set()
    current_len = 0
    for item in paragraphs:
        paragraph = paragraph_text(item)
        if current and current_len + len(paragraph) > limit:
            chunks.append({"text": clean_text(" ".join(current)), "pages": sorted(pages)})
            current = []
            pages = set()
            current_len = 0
        current.append(paragraph)
        page = paragraph_page(item)
        if page:
            pages.add(page)
        current_len += len(paragraph) + 1
    if current:
        chunks.append({"text": clean_text(" ".join(current)), "pages": sorted(pages)})
    return [chunk for chunk in chunks if len(str(chunk["text"])) > 80]


def list_reference_files(zip_file: zipfile.ZipFile) -> list[dict[str, str | int]]:
    references: list[dict[str, str | int]] = []
    for info in zip_file.infolist():
        if info.is_dir():
            continue
        extension = Path(info.filename).suffix.lower()
        if extension not in {".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".pptx"}:
            continue
        title = title_from_path(info.filename, Path(info.filename).name)
        references.append(
            {
                "title": title,
                "path": info.filename,
                "kind": extension.lstrip("."),
                "bytes": info.file_size,
                "harvard": harvard(title, info.filename, extension.lstrip(".")),
            }
        )
    return references


def export_assets(zip_file: zipfile.ZipFile) -> list[dict[str, str]]:
    if ASSET_DIR.exists():
        shutil.rmtree(ASSET_DIR)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    assets: list[dict[str, str]] = []
    for source_path, details in ASSET_EXPORTS.items():
        try:
            payload = zip_file.read(source_path)
        except KeyError:
            continue
        output_file = ASSET_DIR / details["file"]
        output_file.write_bytes(payload)
        title = details["title"]
        assets.append(
            {
                "title": title,
                "path": source_path,
                "url": f"/static/roots-assets/{details['file']}",
                "harvard": harvard(title, source_path, "asset"),
            }
        )
    return assets


def add_text_document(
    documents: list[dict[str, str | int]],
    chunks: list[dict[str, str | int]],
    *,
    title: str,
    path: str,
    kind: str,
    paragraphs: list[str | Paragraph],
) -> None:
    if not paragraphs:
        return
    source_id = f"d{len(documents) + 1}"
    source = Source(
        id=source_id,
        title=title,
        path=path,
        kind=kind,
        harvard=harvard(title, path, kind),
    )
    documents.append(
        {
            "id": source.id,
            "title": source.title,
            "path": source.path,
            "kind": source.kind,
            "harvard": source.harvard,
            "chars": sum(len(paragraph_text(item)) for item in paragraphs),
        }
    )
    for index, chunk in enumerate(chunk_paragraphs(paragraphs), start=1):
        pages = chunk.get("pages") or []
        chunks.append(
            {
                "id": f"{source_id}-{index}",
                "source": source.id,
                "title": source.title,
                "path": source.path,
                "pages": pages,
                "text": str(chunk["text"]),
            }
        )


def build_sparse_vector_index(chunks: list[dict[str, str | int]]) -> dict[str, object]:
    token_counts: list[dict[str, int]] = []
    document_frequency: dict[str, int] = {}
    for chunk in chunks:
        counts: dict[str, int] = {}
        for token in tokenize_for_search(str(chunk.get("text", ""))):
            counts[token] = counts.get(token, 0) + 1
        token_counts.append(counts)
        for token in counts:
            document_frequency[token] = document_frequency.get(token, 0) + 1

    total_chunks = max(len(chunks), 1)
    vocabulary = sorted(
        document_frequency,
        key=lambda token: (document_frequency[token], len(token), token),
        reverse=True,
    )[:900]
    term_to_index = {term: index for index, term in enumerate(vocabulary)}
    idf = [round(log((1 + total_chunks) / (1 + document_frequency[term])) + 1, 6) for term in vocabulary]

    chunk_vectors = []
    for chunk, counts in zip(chunks, token_counts, strict=False):
        weighted: list[tuple[int, float]] = []
        for token, count in counts.items():
            index = term_to_index.get(token)
            if index is None:
                continue
            weighted.append((index, (1 + log(count)) * idf[index]))
        weighted.sort(key=lambda item: item[1], reverse=True)
        weighted = weighted[:80]
        norm = sqrt(sum(weight * weight for _, weight in weighted)) or 1
        values = [[index, round(weight / norm, 6)] for index, weight in weighted if weight > 0]
        chunk_vectors.append({"id": chunk["id"], "values": values})

    return {
        "kind": "sparse-tfidf-v1",
        "description": "Build-time sparse embedding index used as the local vector database for PDF-first RAG retrieval.",
        "vocabulary": vocabulary,
        "idf": idf,
        "chunkVectors": chunk_vectors,
    }


def main() -> None:
    previous = existing_knowledge()
    try:
        zip_path: Path | None = find_zip()
    except FileNotFoundError:
        zip_path = None
    content_pdf_path = find_content_pdf()
    documents: list[dict[str, str | int]] = []
    chunks: list[dict[str, str | int]] = []

    pdf_text = pdf_paragraphs(content_pdf_path)
    pdf_title = title_from_path(content_pdf_path.name, "pdf sample")
    if pdf_text:
        pdf_title = clean_text(" ".join(paragraph_text(item) for item in pdf_text[:2]))[:110] or pdf_title
    add_text_document(
        documents,
        chunks,
        title=pdf_title,
        path=content_pdf_path.name,
        kind="pdf",
        paragraphs=pdf_text,
    )

    if zip_path:
        with zipfile.ZipFile(zip_path) as archive:
            references = list_reference_files(archive)
            assets = export_assets(archive)
    else:
        references = list(previous.get("references") or [])
        assets = list(previous.get("assets") or [])

    data = {
        "version": "roots-knowledge-v3",
        "title": "گولزاری مێژوو",
        "generatedFrom": f"{zip_path.name if zip_path else 'existing roots assets'}; content replaced by {content_pdf_path.name}",
        "language": "ckb",
        "book": BOOK_META,
        "topics": BOOK_TOPICS,
        "documents": documents,
        "chunks": chunks,
        "vectorIndex": build_sparse_vector_index(chunks),
        "references": references,
        "assets": assets,
    }
    OUTPUT_PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(OUTPUT_PATH),
                "documents": len(documents),
                "chunks": len(chunks),
                "references": len(references),
                "assets": len(assets),
                "bytes": OUTPUT_PATH.stat().st_size,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

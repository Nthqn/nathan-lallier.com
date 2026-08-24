#!/usr/bin/env python3
"""Build a JSON manifest from PDF files under assets/docs."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


CODE_PREFIX_RE = re.compile(r"^(?:AZR|CIS|LNX)-[A-Z]{2,5}-[A-Z]{2,5}[- ]+")
HYPHENS_RE = re.compile(r"[-_]+")
SPACES_RE = re.compile(r"\s+")
DUNE_RE = re.compile(r"\bdune\b")
DUN_RE = re.compile(r"\bdun\b")
ELIDED_D_RE = re.compile(r"\bd([A-Z][A-Za-z0-9]+)\b")
ELIDED_L_RE = re.compile(r"\bl([A-Z][A-Za-z0-9]+)\b")


def restore_french_apostrophes(value: str) -> str:
    """Restore common French elisions in display titles."""
    text = DUNE_RE.sub("d'une", value)
    text = DUN_RE.sub("d'un", text)
    text = ELIDED_D_RE.sub(r"d'\1", text)
    text = ELIDED_L_RE.sub(r"l'\1", text)
    return text


def humanize_title(filename_stem: str) -> str:
    """Convert a file stem into a cleaner display title."""
    raw = unicodedata.normalize("NFC", filename_stem).strip()
    cleaned = CODE_PREFIX_RE.sub("", raw)
    cleaned = HYPHENS_RE.sub(" ", cleaned)
    cleaned = SPACES_RE.sub(" ", cleaned).strip()
    cleaned = restore_french_apostrophes(cleaned)
    return cleaned if cleaned else raw


def format_bytes(size_bytes: int) -> str:
    """Format bytes with binary units for display."""
    if size_bytes < 1024:
        return f"{size_bytes} B"

    units = ("KB", "MB", "GB", "TB")
    value = float(size_bytes)
    for unit in units:
        value /= 1024.0
        if value < 1024.0 or unit == units[-1]:
            return f"{value:.1f} {unit}"
    return f"{size_bytes} B"


def to_web_url(parts: list[str]) -> str:
    """Build a web-safe URL by encoding each path segment."""
    return "/".join(quote(part) for part in parts)


def detect_category(docs_root: Path, pdf_path: Path) -> str:
    """Use first subfolder as category, fallback to 'general'."""
    rel_parts = pdf_path.relative_to(docs_root).parts
    return rel_parts[0] if len(rel_parts) > 1 else "general"


def build_manifest(docs_root: Path, url_root: str) -> dict:
    """Collect PDFs and return a deterministic manifest payload."""
    pdf_files = sorted(docs_root.rglob("*.pdf"), key=lambda path: path.as_posix().lower())
    category_counts: dict[str, int] = {}
    documents: list[dict] = []

    for pdf_path in pdf_files:
        category = detect_category(docs_root, pdf_path)
        relative_path = pdf_path.relative_to(docs_root).as_posix()
        path_parts = [part for part in Path(url_root).parts if part]
        stat = pdf_path.stat()

        documents.append(
            {
                "id": relative_path.replace("/", "__"),
                "category": category,
                "title": humanize_title(pdf_path.stem),
                "file_name": pdf_path.name,
                "relative_path": relative_path,
                "url": to_web_url(path_parts + relative_path.split("/")),
                "size_bytes": stat.st_size,
                "size_human": format_bytes(stat.st_size),
                "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            }
        )
        category_counts[category] = category_counts.get(category, 0) + 1

    categories = [
        {"id": category, "count": category_counts[category]}
        for category in sorted(category_counts.keys())
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "total_documents": len(documents),
        "categories": categories,
        "documents": documents,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate docs manifest JSON from assets/docs PDFs."
    )
    parser.add_argument(
        "--docs-dir",
        default="assets/docs",
        help="Directory to scan recursively for PDF files.",
    )
    parser.add_argument(
        "--output",
        default="assets/data/docs.json",
        help="Path to the generated JSON manifest file.",
    )
    parser.add_argument(
        "--url-root",
        default="assets/docs",
        help="Base URL prefix prepended to each document relative path.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indentation level. Use 0 for compact output.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    docs_root = (repo_root / args.docs_dir).resolve()
    output_path = (repo_root / args.output).resolve()

    if not docs_root.exists():
        raise SystemExit(f"Docs directory not found: {docs_root}")

    manifest = build_manifest(docs_root, args.url_root)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    indent = None if args.indent <= 0 else args.indent
    output_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=indent) + "\n",
        encoding="utf-8",
    )

    print(
        f"Manifest generated: {output_path} "
        f"({manifest['total_documents']} documents, {len(manifest['categories'])} categories)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

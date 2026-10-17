#!/usr/bin/env python3
"""Sync procedure PDFs into assets/docs, then build a JSON manifest from them.

Source layout (procedures library):
    <source>/<Plateforme>/<PLT-PIL>/<Titre>.pdf
    <source>/<Plateforme>/<PLT-PIL>/markdown/<Titre>.md   (frontmatter: titre)

Each PDF is copied to assets/docs/<plateforme>/<Titre-slugifie>.pdf.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


DEFAULT_SOURCE_DIR = Path.home() / "Proton Drive" / "Ciaiuu" / "My files" / "Procèdures"
TITLES_FILE_NAME = ".titles.json"

CODE_PREFIX_RE = re.compile(r"^[A-Z0-9]{2,5}-[A-Z]{2,5}-[A-Z]{2,5}[- ]+")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---", re.DOTALL)
FRONTMATTER_FIELD_RE = re.compile(r'^(\w+):\s*"?(.*?)"?\s*$', re.MULTILINE)
SLUG_INVALID_RE = re.compile(r"[^A-Za-z0-9]+")
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


def slugify_title(title: str) -> str:
    """Turn a French title into an ASCII file-name slug (accents and punctuation removed)."""
    ascii_text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.replace("'", "").replace("’", "").replace("&", " ")
    return SLUG_INVALID_RE.sub("-", ascii_text).strip("-")


def read_frontmatter(markdown_path: Path) -> dict[str, str]:
    """Return the simple key/value pairs of a markdown YAML frontmatter."""
    match = FRONTMATTER_RE.match(markdown_path.read_text(encoding="utf-8-sig"))
    if not match:
        return {}
    return {key: value for key, value in FRONTMATTER_FIELD_RE.findall(match.group(1))}


def sync_procedures(source_root: Path, docs_root: Path, prune: bool) -> dict[str, str]:
    """Copy and rename procedure PDFs into docs_root; return {relative_path: title}."""
    titles: dict[str, str] = {}
    managed_categories: set[str] = set()
    copied = skipped = 0

    pdf_files = sorted(
        (path for path in source_root.rglob("*.pdf") if path.parent.name not in ("markdown", "word")),
        key=lambda path: path.as_posix().lower(),
    )

    for pdf_path in pdf_files:
        rel_parts = pdf_path.relative_to(source_root).parts
        if len(rel_parts) < 2:
            print(f"  [ignoré] hors dossier plateforme : {pdf_path.name}")
            continue

        category = rel_parts[0].lower()
        markdown_path = pdf_path.parent / "markdown" / f"{pdf_path.stem}.md"
        meta = read_frontmatter(markdown_path) if markdown_path.exists() else {}
        title = unicodedata.normalize("NFC", meta.get("titre", "").strip() or pdf_path.stem)

        target_name = f"{slugify_title(title)}.pdf"
        relative_path = f"{category}/{target_name}"
        if relative_path in titles:
            print(f"  [ignoré] doublon de nom cible {relative_path} : {pdf_path}")
            continue

        target_path = docs_root / category / target_name
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if target_path.exists() and target_path.read_bytes() == pdf_path.read_bytes():
            skipped += 1
        else:
            shutil.copy2(pdf_path, target_path)
            copied += 1
            print(f"  [copié] {relative_path}")

        titles[relative_path] = title
        managed_categories.add(category)

    removed = 0
    if prune:
        for category in sorted(managed_categories):
            for existing in sorted((docs_root / category).glob("*.pdf")):
                if f"{category}/{existing.name}" not in titles:
                    existing.unlink()
                    removed += 1
                    print(f"  [supprimé] {category}/{existing.name}")

    print(f"Synchronisation : {copied} copiés, {skipped} inchangés, {removed} supprimés.")
    return titles


def load_titles(docs_root: Path) -> dict[str, str]:
    titles_path = docs_root / TITLES_FILE_NAME
    if titles_path.exists():
        return json.loads(titles_path.read_text(encoding="utf-8"))
    return {}


def save_titles(docs_root: Path, titles: dict[str, str]) -> None:
    (docs_root / TITLES_FILE_NAME).write_text(
        json.dumps(dict(sorted(titles.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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


def build_manifest(docs_root: Path, url_root: str, titles: dict[str, str] | None = None) -> dict:
    """Collect PDFs and return a deterministic manifest payload."""
    titles = titles or {}
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
                "title": titles.get(relative_path) or humanize_title(pdf_path.stem),
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
        description="Sync procedure PDFs into assets/docs and generate the docs manifest JSON."
    )
    parser.add_argument(
        "--source-dir",
        default=str(DEFAULT_SOURCE_DIR),
        help="Procedures library to copy PDFs from (only *.pdf are taken).",
    )
    parser.add_argument(
        "--no-sync",
        action="store_true",
        help="Skip copying from the source directory, only rebuild the manifest.",
    )
    parser.add_argument(
        "--no-prune",
        action="store_true",
        help="Keep PDFs in synced category folders that no longer exist in the source.",
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

    titles = load_titles(docs_root)
    source_root = Path(args.source_dir).expanduser().resolve()
    if not args.no_sync and source_root.exists():
        print(f"Synchronisation depuis {source_root}")
        titles = sync_procedures(source_root, docs_root, prune=not args.no_prune)
        save_titles(docs_root, titles)
    elif not args.no_sync:
        print(f"Dossier source introuvable, synchronisation ignorée : {source_root}")

    manifest = build_manifest(docs_root, args.url_root, titles)
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

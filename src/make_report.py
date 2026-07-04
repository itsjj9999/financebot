from __future__ import annotations

import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output" / "pdf"


def escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def inline_markup(text: str) -> str:
    text = escape(text.strip())
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        r'<link href="\2" color="#2563EB">\1</link>',
        text,
    )
    return text


def parse_markdown(text: str):
    blocks = []
    paragraph = []

    def flush():
        if paragraph:
            blocks.append(("paragraph", " ".join(paragraph)))
            paragraph.clear()

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            flush()
            continue
        if line.startswith("# "):
            flush()
            blocks.append(("title", line[2:]))
        elif line.startswith("## "):
            flush()
            blocks.append(("heading", line[3:]))
        elif re.match(r"^[-*]\s+", line):
            flush()
            blocks.append(("bullet", re.sub(r"^[-*]\s+", "", line)))
        elif re.match(r"^\d+\.\s+", line):
            flush()
            blocks.append(("bullet", re.sub(r"^\d+\.\s+", "", line)))
        elif line.startswith("> "):
            flush()
            blocks.append(("note", line[2:]))
        else:
            paragraph.append(line)
    flush()
    return blocks


def build_pdf(source: Path, destination: Path):
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=27,
        textColor=colors.HexColor("#102A43"),
        alignment=TA_CENTER,
        spaceAfter=8 * mm,
    )
    heading = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#0F766E"),
        spaceBefore=5 * mm,
        spaceAfter=2.5 * mm,
        keepWithNext=True,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.3,
        leading=15,
        textColor=colors.HexColor("#243B53"),
        spaceAfter=3 * mm,
    )
    bullet = ParagraphStyle(
        "Bullet",
        parent=body,
        leftIndent=5 * mm,
        firstLineIndent=-3.5 * mm,
        bulletIndent=0,
        spaceAfter=2.2 * mm,
    )
    note = ParagraphStyle(
        "Note",
        parent=body,
        leftIndent=5 * mm,
        rightIndent=5 * mm,
        borderColor=colors.HexColor("#CBD5E1"),
        borderWidth=0.7,
        borderPadding=7,
        backColor=colors.HexColor("#F8FAFC"),
        textColor=colors.HexColor("#475569"),
    )
    footer = ParagraphStyle(
        "Footer",
        parent=body,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#64748B"),
        alignment=TA_CENTER,
    )

    def page_decor(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#D9E2EC"))
        canvas.line(18 * mm, 15 * mm, A4[0] - 18 * mm, 15 * mm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawCentredString(A4[0] / 2, 9 * mm, f"Finance Video Brief  |  Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(destination),
        pagesize=A4,
        rightMargin=19 * mm,
        leftMargin=19 * mm,
        topMargin=18 * mm,
        bottomMargin=21 * mm,
        title=source.stem,
        author="Finance Video",
    )

    story = []
    for kind, value in parse_markdown(source.read_text(encoding="utf-8")):
        marked = inline_markup(value)
        if kind == "title":
            story.append(Paragraph(marked, title))
        elif kind == "heading":
            story.append(Paragraph(marked, heading))
        elif kind == "bullet":
            story.append(Paragraph(marked, bullet, bulletText="-"))
        elif kind == "note":
            story.append(Paragraph(marked, note))
            story.append(Spacer(1, 2 * mm))
        else:
            story.append(Paragraph(marked, body))

    story.append(Spacer(1, 5 * mm))
    story.append(
        Paragraph(
            "Educational summary based on the supplied video transcript. "
            "Not personalized financial advice.",
            footer,
        )
    )
    doc.build(story, onFirstPage=page_decor, onLaterPages=page_decor)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: make_report.py <analysis.md>")
    source = Path(sys.argv[1]).resolve()
    if not source.exists():
        raise SystemExit(f"File not found: {source}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / f"{source.stem}.pdf"
    build_pdf(source, destination)
    print(destination)


if __name__ == "__main__":
    main()

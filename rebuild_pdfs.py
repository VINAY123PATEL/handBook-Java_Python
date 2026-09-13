# -*- coding: utf-8 -*-
"""Rebuild the semester placement-note PDFs with a professional
black & white theme, terminal-style code blocks and a compact layout.

Reads the original PDFs (for exact content + layout metadata), classifies
the content into structured HTML, then re-renders each PDF via MuPDF's
HTML->PDF engine (Story + DocumentWriter). Adds clean footers and PDF
outlines (units/sections) as a post-processing step.
"""

import os
import re
import copy
import tempfile
import shutil

import fitz  # PyMuPDF

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
PDF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfs")
OUT_BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfs")

PAGE_W, PAGE_H = fitz.paper_rect("a4")[2], fitz.paper_rect("a4")[3]  # 595 x 842
MARGIN = 24
FOOTER_BAND = 26      # space kept free at the bottom so the footer never
                      # overlaps the last line of content

# dark-mode palette (echoes the site's #0b0e13 background + amber/blue accents)
BG       = "#0b0e13"
PANEL    = "#12161d"
PANEL_2  = "#0f1319"
LINE     = "#232935"
TEXT     = "#e7ecf3"
MUTED_T  = "#9aa7b4"
ACCENT   = "#e07b31"         # warm amber (readable on dark bg)
ACCENT_DARK = "#b4591f"
BLUE_T   = "#7aa2d1"         # soft blue (readable on dark bg)
INK = TEXT                   # body text alias
MUTED = MUTED_T
LINECOL = LINE

# --- sizes observed in the source PDFs --------------------------------------
S_H1 = 11.0    # unit / top heading
S_H2 = 9.6     # sub heading (adjusted for classification below)
S_PROSE = 8.7  # body text lower bound
S_SMALL = 8.0  # labels / table cells / captions up to here
S_CODE = 7.8   # code / ascii lines are below this
S_TAB = 8.0    # table cells fall in [S_TAB, S_H1)


def flat_upper(s):
    return s


def is_ascii_box(s):
    """detect ASCII diagrams (box drawing / arrows / tree structures)."""
    boxy = sum(c in "|-+~=>▲▼→←│┌┐└┘┬┴├┤─┼·*" for c in s)
    return boxy / max(1, len(s)) > 0.25


# ----------------------------------------------------------------------------
# Extraction
# ----------------------------------------------------------------------------
class Tok:
    __slots__ = ("x0", "x1", "size", "text", "flags", "font")

    def __init__(self, x0, x1, size, text, flags=0, font=""):
        self.x0, self.x1, self.size, self.text = x0, x1, size, text
        self.flags, self.font = flags, font

    def __repr__(self):
        return f"Tok({self.x0:.0f},{self.size:.1f},{self.text!r})"


def extract_pdf(path):
    """Return ((cover_title, cover_subtitle), pages).
    pages = list of pages; each page = list of rows (in reading order).
    row = (x0, size, [Tok, ...]) with tokens sorted by x."""
    doc = fitz.open(path)
    pages = []
    cover_title = []
    cover_sub = []
    for pi in range(len(doc)):
        page = doc[pi]
        d = page.get_text("dict")
        buckets = {}
        for block in d["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                yc = round(line["bbox"][1])
                toks = []
                for sp in line["spans"]:
                    t = sp["text"]
                    if not t.strip():
                        continue
                    toks.append(Tok(
                        sp["bbox"][0], sp["bbox"][2], sp["size"], t,
                        sp.get("flags", 0), (sp.get("font") or " ").split("+")[-1]))
                if toks:
                    toks.sort(key=lambda t: t.x0)
                    buckets.setdefault(yc, []).extend(toks)
        rows = []
        for yc in sorted(buckets):
            toks = buckets[yc]
            x0 = min(t.x0 for t in toks)
            sz = max(t.size for t in toks)
            rows.append((yc, x0, sz, toks))
        pages.append(rows)

        if pi == 0:
            tsize = 0
            for (y, x0, sz, toks) in rows:
                tsize = max(tsize, sz)
            title_sz = 14.0 if tsize < 16 else 15.0
            for (y, x0, sz, toks) in rows:
                if sz >= title_sz:
                    for t in toks:
                        b = t.text.strip()
                        if b and b not in cover_title:
                            cover_title.append(b)
            if not cover_title:
                for (y, x0, sz, toks) in rows:
                    if sz >= 12:
                        for t in toks:
                            b = t.text.strip()
                            if b:
                                cover_title.append(b)
            for (y, x0, sz, toks) in rows:
                if 8.5 <= sz < title_sz:
                    t = "".join(tk.text for tk in toks).strip()
                    if t and t not in cover_sub and not re.match(r"^[A-Z0-9 ]+$", t):
                        cover_sub.append(t)
                if len(cover_sub) > 2:
                    break
    doc.close()
    return (cover_title, cover_sub), pages


def clean_rows(row_list):
    """Remove header/footer rows from a content page's row list."""
    body = []
    for row in row_list:
        x0, sz, toks = row
        text = "".join(t.text for t in toks)
        if re.search(r"\bNotes\s*\|", text):
            continue
        if re.match(r"^\s*Page\s*\d+", text):
            continue
        body.append(row)
    return body


def clean_rows(row_list):
    """Remove header/footer rows from a content page's row list."""
    body = []
    for row in row_list:
        toks = row[2]
        y0 = toks[0].x0 * 0 + row[1]  # placeholder; real filtering by text rules below
        text = "".join(t.text for t in toks)
        # footer tag line e.g. "CN Notes | Definitions ..."
        if re.search(r"\bNotes\s*\|", text):
            continue
        if re.match(r"^\s*Page\s*\d+", text):
            continue
        # page header line (big title repeated) - keep only unique-ish; we filter by y later too
        body.append(row)
    return body


# ----------------------------------------------------------------------------
# Document model
# ----------------------------------------------------------------------------
class DocBuilder:
    def __init__(self, subject):
        self.subject = subject
        self.items = []           # list of dict items
        self.cur_table = None     # pending table item
        self.cur_code = None      # pending code item
        self.cur_pre = None
        self.cur_para = []        # list of paragraph lines (joined tokens)
        self.tables_seen = set()

    # -- generic appends -----------------------------------------------------
    def flush_para(self):
        if self.cur_para:
            lines = [ln for ln in self.cur_para if ln.strip()]
            if lines:
                self.items.append({"k": "para", "text": "<br>".join(lines)})
            self.cur_para = []

    def close_code(self):
        if self.cur_code:
            self.cur_code["lines"] = [l for l in self.cur_code["lines"]]
            if self.cur_code["lines"]:
                self.items.append(self.cur_code)
            self.cur_code = None

    def close_table(self):
        if self.cur_table:
            if len(self.cur_table["rows"]) >= 1:
                self.items.append(self.cur_table)
            self.cur_table = None

    def close_pre(self):
        if self.cur_pre:
            if any(l.strip() for l in self.cur_pre["lines"]):
                self.items.append(self.cur_pre)
            self.cur_pre = None

    def add_heading(self, text, level):
        self.flush_para()
        self.close_code()
        self.close_table()
        self.close_pre()
        self.items.append({"k": f"h{level}", "text": text})

    def add_unit(self, text):
        self.flush_para()
        self.close_code()
        self.close_table()
        self.close_pre()
        self.items.append({"k": "unit", "text": text})

    def add_label(self, text):
        self.flush_para()
        self.close_code()
        self.close_table()
        self.close_pre()
        self.items.append({"k": "label", "text": text})

    def add_para_line(self, toks):
        html = self._tokens_html(toks)
        self.cur_para.append(html)

    @staticmethod
    def _tokens_html(toks):
        out = []
        for t in toks:
            s = t.text
            bold = bool(t.flags & 16)
            ital = bool(t.flags & 2)
            mono = bool(t.flags & 8)
            s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            if mono:
                s2 = s
            if bold or ital or mono:
                if mono:
                    s = f'<code>{s}</code>'
                if bold:
                    s = f"<b>{s}</b>"
                if ital:
                    s = f"<i>{s}</i>"
            out.append(s)
        return "".join(out)


# ----------------------------------------------------------------------------
# Classification
# ----------------------------------------------------------------------------
UNITS = re.compile(r"^(UNIT|PART)\s*[-–:.]*\s*(\d+(?:\.\d+)*|[IVXL]+)\b[.:\s-]*(.*)$", re.I)
SUB = re.compile(r"^\d+(\.\d+)*\s*[-–.:]\s*.+$")
ALL_CAPS = re.compile(r"^[A-Z0-9 ()&/\-,.'’%+*:~=<>]+[:]?$")
CODE_FILE = re.compile(r"^\S+\.(?:java|py|sh|txt|sql|c|h|cpp|ps1|md)\b", re.I)
EXERCISE = re.compile(r"^(Exercise|Study tip|Kernel insight|Trick fact|Practice numbers|Memory trick|How to use|Self-study|Read in order|Examiner|Quick recall)\b", re.I | re.U)


class Classifier:
    def __init__(self):
        pass

    def kind(self, row):
        """return (kind, payload) based on a single-row dict of toks."""
        x0, sz, toks = row[0], row[1], row[2]
        text = "".join(t.text for t in toks).strip()

        if sz >= 13 and len(text) < 90:
            return ("unit", text)
        m = UNITS.match(text)
        if m:
            return ("unit", text)
        if sz >= 11:
            return ("h2", text)
        if sz >= S_H2 and SUB.match(text):
            return ("h3", text)
        return None


# ----------------------------------------------------------------------------
# Main builder: iterate pages -> rows -> items
# ----------------------------------------------------------------------------
def build_doc(fname, subject):
    (cover, cover_sub), pages = extract_pdf(fname)
    db = DocBuilder(subject)

    # ---- skip cover & toc pages; build content stream ----------------------
    toc_pages = set()
    for pi in range(1, len(pages)):
        raw_text = " ".join("".join(t.text for t in toks) for (y, x0, sz, toks) in pages[pi])
        if re.search(r"\b(SYLLABUS\s+COVERED|TABLE OF CONTENTS|INDEX)\b", raw_text.upper()):
            toc_pages.add(pi)

    content_rows = []   # rows = (y, x0, size, toks) filtered
    for pi in range(1, len(pages)):
        if pi in toc_pages:
            continue
        rows = pages[pi]
        filtered = []
        for row in rows:
            y, x0, sz, toks = row
            text = "".join(t.text for t in toks)
            if re.search(r"\bNotes\s*\|", text):
                continue
            if re.match(r"^\s*Page\s*\d+", text):
                continue
            if re.match(r"^(TABLE OF CONTENTS|CONTENTS)\s*$", text):
                continue
            if y < 42 or y > 788:      # page header / footer band
                continue
            filtered.append((y, x0, sz, toks))
        if filtered:
            content_rows.append((pi, filtered))

    # TOC pages were dropped above by their explicit marker; keep everything else.

    # ---- classify -----------------------------------------------------------
    def row_text(y, x0, sz, toks):
        return "".join(t.text for t in toks).strip()

    def bold_ratio(toks):
        tot = sum(t.x1 - t.x0 for t in toks)
        if tot <= 0:
            return 0.0
        bl = sum(t.x1 - t.x0 for t in toks if t.flags & 16)
        return bl / tot

    def is_numeric_diagram(text, toks):
        t = text.strip()
        if not 1 <= len(t) <= 46:
            return False
        if re.fullmatch(r"[0-9\s.,\-]+", t):
            return True
        return False

    for pi, rows in content_rows:
        i = 0
        while i < len(rows):
            y, x0, sz, toks = rows[i]
            text = row_text(y, x0, sz, toks)
            width = max(t.x1 for t in toks) - min(t.x0 for t in toks)

            # --- unit headings ---
            if UNITS.match(text) and sz >= 8.2:
                db.flush_para()
                db.add_unit(text)
                i += 1
                continue

            # --- big headings ---
            if sz >= 12.0:
                db.flush_para()
                db.add_heading(text, 2)
                i += 1
                continue

            # --- numeric diagram (scattered node numbers) ---
            if is_numeric_diagram(text, toks) and len(toks) <= 2:
                if db.cur_pre is None or db.cur_pre.get("kind") != "numdiag":
                    db.flush_para()
                    db.close_code()
                    db.close_table()
                    db.cur_pre = {"k": "pre", "kind": "numdiag", "lines": []}
                col = max(0, min(100, int(round(((toks[0].x0) - 36) / 520 * 100))))
                line = (" " * col) + text
                if col + len(text) > 118:
                    line = line[:118]
                db.cur_pre["lines"].append(line)
                i += 1
                continue

            # --- sub heading "1.5  Linear DS — Arrays" ---
            if sz >= S_H2 and SUB.match(text) and (len(toks) <= 3 or width < 240) and len(text) < 90:
                db.flush_para()
                db.close_code()
                db.close_table()
                db.close_pre()
                db.add_heading(text, 3)
                i += 1
                continue

            # --- bold figure/sub-section titles ("TCP: 3-Way Handshake ...") ---
            if (8.4 <= sz < 12.0 and len(text) < 95 and width < 360
                    and not text.endswith((".", "!", ":"))
                    and bold_ratio(toks) >= 0.7):
                db.flush_para()
                db.close_code()
                db.close_table()
                db.close_pre()
                db.add_heading(text, 3)
                i += 1
                continue

            # --- label e.g. "DEFINITION: DATA", "OPERATING SYSTEM (OS)" ---
            if (2 <= len(text) <= 60 and sz < S_H2 and width < 260
                    and ALL_CAPS.match(text) and not text.endswith(".")
                    and len(toks) <= 6):
                if not (len(toks) >= 3 and width > 170):
                    db.flush_para()
                    db.close_code()
                    db.close_table()
                    db.close_pre()
                    db.add_label(text)
                    i += 1
                    continue

            # --- code caption e.g. "ArrayDemo.java - creation..." / "•••  layers.txt" ---
            if sz <= 9.0 and len(toks) <= 6 and width < 360:
                stripd = re.sub(r"^[\s•*]+", "", text)
                if CODE_FILE.match(stripd):
                    db.flush_para()
                    db.close_table()
                    db.close_pre()
                    db.close_code()
                    db.cur_code = {"k": "code", "title": stripd, "lines": []}
                    i += 1
                    continue

            # --- diagram / box drawing / ascii ---
            if is_ascii_box(text) and (sz < S_H2 or text.strip().startswith(("+", "|", "┌", "└", "│", "•", "▼", "▲"))):
                if db.cur_pre is None:
                    db.flush_para()
                    db.close_code()
                    db.close_table()
                    db.cur_pre = {"k": "pre", "lines": []}
                if db.cur_pre["lines"] or text.strip():
                    db.cur_pre["lines"].append(text)
                i += 1
                continue

            # --- plain code continuation ---
            if db.cur_code is not None and (sz < S_CODE or is_codey(text)):
                db.cur_code["lines"].append(text)
                i += 1
                continue

            # --- table handling ---
            if db.cur_table is not None:
                col_xs = sorted({round(t.x0) for t in toks})
                if len(toks) >= 2 and _compatible_cols(db.cur_table["cols"], col_xs):
                    db.cur_table["rows"].append((col_xs, toks))
                    i += 1
                    continue
                elif len(toks) == 1 and sz < S_H2:
                    # continuation of a wrapped cell in an interior column
                    ci = nearest_col(db.cur_table["cols"], toks[0].x0)
                    if ci > 0 and db.cur_table["rows"]:
                        prev = db.cur_table["rows"][-1]
                        db.cur_table["rows"][-1] = (prev[0], prev[1] + [Tok(toks[0].x0, toks[0].x1, toks[0].size, " " + toks[0].text, toks[0].flags)])
                        i += 1
                        continue
                db.close_table()

            if len(toks) >= 2 and (sz >= S_TAB or is_table_like(toks)) and width > 150:
                col_xs = sorted({round(t.x0) for t in toks})
                if _looks_like_table(rows, i):
                    db.flush_para()
                    db.close_code()
                    db.close_pre()
                    db.cur_table = {"k": "table", "cols": col_xs, "rows": [(col_xs, toks)]}
                    i += 1
                    continue
                db.close_table()

            # --- code block start (small mono line) ---
            if sz < S_CODE and not is_ascii_box(text):
                db.flush_para()
                db.close_table()
                db.close_pre()
                db.cur_code = {"k": "code", "title": None, "lines": [text]}
                i += 1
                continue

            # --- prose ---
            db.close_table()
            db.close_code()
            db.close_pre()
            db.add_para_line(toks)
            i += 1

    db.flush_para()
    db.close_code()
    db.close_table()
    db.close_pre()
    return (cover, cover_sub), db.items


def _col_positions(toks):
    return sorted({round(t.x0) for t in toks})


def _compatible_cols(a, b):
    if len(a) != len(b):
        return False
    return all(abs(x - y) <= 7 for x, y in zip(a, b))


def nearest_col(cols, x):
    return min(range(len(cols)), key=lambda k: abs(cols[k] - x))


def is_table_like(toks):
    return len(toks) >= 3


def is_codey(t):
    c = sum(1 for ch in "{};=#<>()[]'\"+*-/\\|" if ch in t)
    return c >= 2


# ----------------------------------------------------------------------------
# Cyber Security filler removal
# ----------------------------------------------------------------------------
_TAGS = re.compile(r"<[^>]+>")


def _plain(text):
    return _TAGS.sub("", text).strip()


_CYBER_NARR = re.compile(
    r"^(how to read this book|is chapter me|is topic me|aage ke|socho|zara socho|imagine|"
    r"chalo|yahan se|ab hum|pehle ye janna|ka asli syllabus|ka sabse important|"
    r"ki shuruaat|unit\s+\d+\s+ki\b|ko concisely|ko briefly|ko aaram se|"
    r"in sabhi ko|agar tumhe|agar aap|pichhle chapter|last chapter|is concept ko|"
    r"aaj har insaan|isme hum|humne abhi|ye sawal bahut)", re.I)


def is_cyber_filler(it):
    """True for Cyber-Security-specific filler: dot separators, narrator
    intros, syllabus-stub headings, and empty tag-only lines."""
    text = _plain(it.get("text", ""))
    if not text:
        return True
    if re.match(r"^(?:\.\s*){3,}$", text):
        return True
    low = text.lower()
    if "how to read this book" in low:
        return True
    if re.match(r"^unit\s+\d+\b.*syllabus", low) or "(as per examination)" in low:
        return True
    if _CYBER_NARR.match(text) and it["k"] in ("para", "unit", "h2", "h3"):
        return True
    return False


def _looks_like_table(rows, i):
    """True if starting at rows[i] there are >=3 multi-col rows with aligned x."""
    seen = 0
    anchor = None
    for r in rows[i:]:
        toks = r[3]
        if len(toks) < 2:
            continue
        xs = sorted({round(t.x0) for t in toks})
        if anchor is None:
            anchor = xs
            seen = 1
        elif len(xs) == len(anchor) and all(abs(a - b) <= 7 for a, b in zip(xs, anchor)):
            seen += 1
        else:
            # tolerate one odd row before giving up
            if seen >= 3:
                return True
            continue
        if seen >= 3:
            return True
    return False


# ----------------------------------------------------------------------------
# HTML rendering
# ----------------------------------------------------------------------------
CUR_SCALE = 1.0          # global text/scale multiplier, set per subject before render


def build_css(s=1.0):
    """Professional light theme (white pages, coloured accents). Only the code
    blocks use a dark terminal look. Scaled by factor s so each subject can be
    tuned to land near TARGET_PAGES pages."""
    return f"""
@page {{ size: A4; margin: 0; }}
* {{ box-sizing: border-box; }}
html, body {{ background: #ffffff; }}
body {{ font-family: Helvetica, Arial, sans-serif; color: #21262d; font-size: {8.4*s:.2f}pt;
       line-height: 1.3; margin: 0; }}
code, pre, .mono {{ font-family: "Courier", "Nimbus Mono PS", monospace; }}
b {{ font-weight: bold; }}

.kick {{ display: inline-block; font-family: Courier, monospace; font-size: {7*s:.2f}pt;
        letter-spacing: 1.4px; text-transform: uppercase; color: #ffffff;
        background: #23292f; border-radius: 3px; padding: {2*s:.1f}px {7*s:.1f}px;
        margin-bottom: {6*s:.1f}px;}}
h2.u {{ font-family: Helvetica, Arial, sans-serif; font-size: {12.5*s:.2f}pt; font-weight: bold;
       color: #171b20; margin: {9*s:.1f}px 0 {4*s:.1f}px 0; padding-bottom: {3*s:.1f}px;
       border-bottom: {1.6*s:.2f}px solid #23292f; letter-spacing: .2px; }}
h2.u .uNum {{ color: #c2570a; }}
h3 {{ font-family: Helvetica, Arial, sans-serif; font-size: {10.2*s:.2f}pt; font-weight: bold;
     color: #171b20; margin: {6*s:.1f}px 0 {2.5*s:.1f}px 0; }}
h3 .secno {{ color: #205081; margin-right: 5px; }}
h4 {{ font-family: Helvetica, Arial, sans-serif; font-size: {9*s:.2f}pt; font-weight: bold;
     color: #205081; margin: {4*s:.1f}px 0 {2*s:.1f}px 0; }}

p {{ margin: {2*s:.1f}px 0; text-align: justify; }}
p.tip {{ background: #fdf6ea; border-left: 3px solid #c2570a; padding: {4*s:.1f}px {7*s:.1f}px;
        margin: {3*s:.1f}px 0; color: #5a4526; }}
p b {{ color: #000000; }}

.lab {{ display: block; font-family: Courier, monospace; font-size: {7.6*s:.2f}pt;
       font-weight: bold; letter-spacing: 1.1px; text-transform: uppercase;
       color: #205081; background: #eef3f9; border-left: 3px solid #205081;
       padding: {2.5*s:.1f}px {7*s:.1f}px; margin: {6*s:.1f}px 0 {2.5*s:.1f}px 0; }}
.def {{ background: #f6f7f9; border: 1px solid #e4e8ee; border-left: 3px solid #6b7280;
       padding: {4*s:.1f}px {7*s:.1f}px; margin: {3*s:.1f}px 0; }}

/* terminal code - the ONLY dark part of the page */
.term {{ background: #10151b; border: 1px solid #1a2129; border-radius: {5*s:.1f}px;
        margin: {3*s:.1f}px 0; box-shadow: 0 1px 3px rgba(0,0,0,.25); }}
.term .tb {{ background: #1a2129; padding: {2*s:.1f}px {8*s:.1f}px; display: block;
             border-radius: {5*s:.1f}px {5*s:.1f}px 0 0; }}
.term .tb .dots span {{ display:inline-block; width: {6*s:.1f}px; height: {6*s:.1f}px; border-radius: 50%;
                        margin-right: 4px; vertical-align: middle;}}
.term .tb .dots .r{{ background:#ff5f56;}} .term .tb .dots .y{{ background:#ffbd2e;}}
.term .tb .dots .g{{ background:#27c93f;}}
.term .tb .fn {{ color: #9aa7b4; font-size: {6.8*s:.2f}pt; margin-left: {6*s:.1f}px; letter-spacing:.4px;}}
.term pre {{ margin: 0; padding: {5*s:.1f}px {8*s:.1f}px; font-size: {6.9*s:.2f}pt; line-height: {1.32*s:.2f};
            color: #e6edf3; white-space: pre; background: #10151b; }}
.prebox {{ background: #f4f5f7; border: 1px solid #e0e4ea; border-radius: 4px;
          padding: {5*s:.1f}px {8*s:.1f}px; margin: {3*s:.1f}px 0; page-break-inside: avoid; }}
.prebox pre {{ margin: 0; font-size: {6.9*s:.2f}pt; line-height: {1.3*s:.2f}; color: #333a41;
              white-space: pre; word-break: break-word;}}

/* tables (flex grid - MuPDF Story paginates divs safely) */
.tbl {{ width: 100%; margin: {4*s:.1f}px 0; font-size: {7.7*s:.2f}pt; border: 1px solid #dfe3ea;
       border-radius: 3px; overflow: hidden; }}
.tr {{ display: flex; border-bottom: 1px solid #e2e6ee; }}
.tr:last-child {{ border-bottom: none; }}
.tr.hd {{ background: #23292f; }}
.tr.hd .tc {{ color: #ffffff; font-weight: bold; }}
.tc {{ flex: 1 1 0; min-width: 0; padding: {2*s:.1f}px {6*s:.1f}px; vertical-align: top;
      word-break: break-word; }}
.tr:nth-child(even) .tc {{ background: #f7f8fa; }}
.tr.hd .tc {{ background: #23292f; }}
"""


CSS = build_css(1.0)   # current stylesheet (updated per subject before rendering)


def wrap_line(s, width=112):
    """Break long text lines safely (MuPDF pre-wrap is unreliable)."""
    out = []
    while len(s) > width:
        cut = s.rfind(" ", 0, width)
        if cut <= 0:
            cut = width
        head = s[:cut].rstrip()
        out.append(head)
        rest = s[cut:]
        rest = rest.lstrip(" ")
        s = rest
        if not s:
            break
    if s:
        out.append(s)
    return out


def code_html(item):
    title = item.get("title") or ""
    lines = item["lines"]
    if not lines:
        return ""
    body = "\n".join(w for ln in lines for w in wrap_line(ln))
    return (f'<div class="term"><div class="tb"><span class="dots">'
            f'<span class="r"></span><span class="y"></span><span class="g"></span></span>'
            f'<span class="fn">{h(title)}</span></div><pre>{h(body)}</pre></div>')


def h(s):
    """HTML-escape a string.  First decode any HTML entities that leaked
    from the source PDFs (they display as literal '&lt;' text otherwise)
    so the rendered glyph is the intended '<', '>' or '&'."""
    for _ in range(3):
        dec = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        if dec == s:
            break
        s = dec
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def pre_html(item):
    body = "\n".join(w for ln in item["lines"] for w in wrap_line(ln))
    return f'<div class="prebox"><pre>{h(body)}</pre></div>'


def table_html(item):
    n = len(item["cols"])
    grid = []
    for (xs, toks) in item["rows"]:
        grid.append(assign_cells(toks, item["cols"], n))

    # merge continuation rows (single cell in an interior column -> append)
    normalised = []
    for k, rc in enumerate(grid):
        filled = [i for i, c in enumerate(rc) if c]
        if len(filled) == 1 and k > 0 and filled[0] > 0 and normalised:
            col_index = filled[0]
            prev = normalised[-1][col_index]
            normalised[-1][col_index] = (prev + " " + rc[col_index]).strip()
            # mark empty placeholder that will be dropped
            normalised.append([""] * n)
            continue
        normalised.append(rc)

    while normalised and all(not c for c in normalised[-1]):
        normalised.pop()
    if not normalised or not any(c for c in normalised[0]):
        return ""

    hdr = normalised[0]
    body_rows = [r for r in normalised[1:] if any(c for c in r)]
    hrow = '<div class="tr hd">' + "".join(f'<div class="tc">{h(c or "")}</div>' for c in hdr) + "</div>"
    brows = "".join(
        '<div class="tr">' + "".join(f'<div class="tc">{h(c) if c else ""}</div>' for c in r) + "</div>"
        for r in body_rows)
    return f'<div class="tbl">{hrow}{brows}</div>'


def assign_cells(toks, cols, n):
    """Distribute tokens into n columns by nearest column anchor."""
    cells = [""] * n
    for t in toks:
        i = min(range(n), key=lambda k: abs(t.x0 - cols[k]))
        cells[i] = (cells[i] + " " + t.text).strip()
    return cells


def para_html(item):
    text = item["text"]
    # flash/y-diagram extraction glues adjacent bold labels (no whitespace):
    # restore separators so words are not fused in the rendered PDF.
    text = text.replace("</b><b>", "</b> <b>").replace("</b>I<b>", "</b> I <b>")
    text = text.replace("<br>", " ")
    if EXERCISE.search(text):
        return f'<p class="tip"><b>✎</b> {text}</p>'
    return f"<p>{text}</p>"


def item_html(it):
    """Render a single classified item to its HTML fragment."""
    k = it["k"]
    if k == "unit":
        m = UNITS.match(it["text"])
        if m:
            rest = re.sub(r"^\s*[|\-–—:]\s*", "", m.group(3)).strip()
            return f'<h2 class="u"><span class="uNum">{h(m.group(2))}</span> &nbsp;{h(rest)}</h2>'
        return f'<h2 class="u">{h(it["text"])}</h2>'
    if k == "h2":
        return f'<h3>{h(it["text"])}</h3>'
    if k == "h3":
        m = re.match(r"^(\d+(?:\.\d+)*)\s*[-–.:]\s*(.+)$", it["text"])
        if m:
            return f'<h4><span class="secno">{h(m.group(1))}</span>{h(m.group(2))}</h4>'
        return f'<h4>{h(it["text"])}</h4>'
    if k == "label":
        return f'<p class="lab">{h(it["text"])}</p>'
    if k == "para":
        return para_html(it)
    if k == "code":
        return code_html(it)
    if k == "pre":
        return pre_html(it)
    if k == "table":
        return table_html(it)
    return ""


def build_html(subject, items, cover, csub):
    # cover info
    ctitle = cover

    body_parts = []
    # ----- cover -----
    title = h(" ".join(ctitle[:3])) or subject
    subtitle = h(" ".join(csub[:3])) if csub else "Complete placement &amp; exam notes"
    units = []
    for it in items:
        if it["k"] == "unit":
            label = it["text"]
            units.append(h(label))
    body_parts.append(f'''
<section style="page-break-after: always;">
  <div style="height:150px;"></div>
  <div class="kick">PLACEMENT NOTES</div>
  <h1 style="font-size:30pt; line-height:1.12; margin:0 0 10px 0; color:#171b20;">{title}</h1>
  <div style="width:74px; height:5px; background:#c2570a; margin:14px 0 18px 0;"></div>
  <p style="font-size:12pt; color:#6b7280; margin:0 0 30px 0; max-width:80%;">{subtitle}</p>
  <div style="background:#f4f5f7; border:1px solid #e0e4ea; border-radius:8px; padding:16px 20px;">
    <div style="font-family:Courier,monospace; font-size:8pt; letter-spacing:2px; color:#205081;
                text-transform:uppercase; margin-bottom:12px;">Syllabus units</div>
    <div>
      {''.join(f'<span style="display:inline-block; background:#ffffff; border:1px solid #dfe3ea;'
               f'border-radius:4px; padding:5px 10px; margin:0 7px 7px 0; font-size:8.6pt; color:#205081;">{u}</span>'
               for u in units)}
    </div>
  </div>
</section>''')

    # ----- content -----
    for it in items:
        if it.get("pb"):
            body_parts.append('<div style="break-before: page;"></div>')
        body_parts.append(item_html(it))

    return f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(body_parts)}</body></html>"


# ----------------------------------------------------------------------------
# Render + post-process
# ----------------------------------------------------------------------------
def page_frame():
    return fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - FOOTER_BAND)


def fit_bottom(fit):
    """Bottom (y1) of the rect actually used by Story.place()."""
    b = fit[1]
    return b[3] if isinstance(b, (tuple, list)) else b.y1


def wrap_doc(inner_parts):
    return ("<!DOCTYPE html><html><head><meta charset='utf-8'>"
            f"<style>{CSS}</style></head><body>{''.join(inner_parts)}</body></html>")


def measure_height(inner):
    """Estimate the rendered height of one item fragment (points)."""
    html = wrap_doc([inner])
    story = fitz.Story(html=html)
    rect = fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - MARGIN + 2000)
    fit = story.place(rect)
    if fit[0]:
        return None  # taller than a single measure frame
    return fit_bottom(fit) - MARGIN


def _group_fits(inner):
    avail = PAGE_H - 2 * MARGIN
    rect = fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, MARGIN + avail)
    story = fitz.Story(html=wrap_doc([inner]))
    f = story.place(rect)
    return not f[0] and fit_bottom(f) <= avail + MARGIN + 1


def paginate(items):
    """Pack items into pages (lists of indices) without splitting an item.

    Uses exact per-group measurement: an item is only appended to the
    current page when the combined group html still fits a single frame.
    This avoids both overloaded pages (overflow at draw time) and pages
    that underestimate margin collapse between grouped items."""
    avail = PAGE_H - 2 * MARGIN
    single_rect = lambda: fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, MARGIN + avail)
    pages = []
    cur_list = []
    cur_inner = ""

    def fits(inner):
        story = fitz.Story(html=wrap_doc([inner]))
        f = story.place(single_rect())
        return not f[0] and fit_bottom(f) <= avail + MARGIN + 1

    for i, it in enumerate(items):
        frag = item_html(it)
        if not fits(frag):
            pages.append([i])
        elif cur_list and not fits(cur_inner + frag):
            pages.append(cur_list)
            cur_list = [i]
            cur_inner = frag
        else:
            cur_list.append(i)
            cur_inner = cur_inner + frag
    if cur_list:
        pages.append(cur_list)
    return pages


def cover_markup(subject, title_parts, sub_parts, units):
    title = h(" ".join(title_parts[:3])) or subject
    subtitle = h(" ".join(sub_parts[:3])) if sub_parts else "Complete placement &amp; exam notes"
    chips = _cover_chips(units)
    return f'''
    <div style="height:150px;"></div>
    <div class="kick">PLACEMENT NOTES</div>
    <h1 style="font-size:30pt; line-height:1.12; margin:0 0 10px 0; color:#171b20;">{title}</h1>
    <div style="width:74px; height:5px; background:#c2570a; margin:14px 0 18px 0;"></div>
    <p style="font-size:12pt; color:#6b7280; margin:0 0 30px 0; max-width:80%;">{subtitle}</p>
    <div style="background:#f4f5f7; border:1px solid #e0e4ea; border-radius:8px; padding:16px 20px;">
      <div style="font-family:Courier,monospace; font-size:8pt; letter-spacing:2px; color:#205081;
                  text-transform:uppercase; margin-bottom:12px;">Syllabus units</div>
      <div>
        {chips}
      </div>
    </div>'''


def _cover_chips(units):
    syllabus = [u for u in units if re.match(r"^\s*UNIT\b", u.upper())]
    if not syllabus:
        syllabus = units and list(units[:9])
    picks = syllabus[:9]
    if len(syllabus) > len(picks):
        picks.append(f"… +{len(syllabus) - len(picks)} more sections")
    if not picks:
        picks = units[:9]
    return "".join(
        f'<span style="display:inline-block; background:#ffffff; border:1px solid #dfe3ea;'
        f'border-radius:4px; padding:4px 9px; margin:0 6px 6px 0; font-size:8.4pt; color:#205081;">{h(t)}</span>'
        for t in picks)


def render_manual(subject, cover_parts, cover_sub_parts, items, out_path):
    """Deterministic lossless renderer: one fresh Story per page, so no
    item ever straddles a page boundary (MuPDF Story otherwise silently
    drops content that crosses a break).

    An item taller than one page is rendered as a continuous flow across
    as many pages as it needs (only ever fully-confirmed loss-free path).
    """
    units = [it["text"] for it in items if it["k"] == "unit"]
    pages = paginate(items)
    avail = PAGE_H - 2 * MARGIN

    def frame_ok(f):
        return not f[0] and fit_bottom(f) <= avail + MARGIN + 1

    dw = fitz.DocumentWriter(out_path)
    try:
        cover_inner = cover_markup(subject, cover_parts, cover_sub_parts, units)
        dev = dw.begin_page(fitz.paper_rect("a4"))
        story = fitz.Story(html=wrap_doc([cover_inner]))
        fit = story.place(page_frame())
        if not frame_ok(fit):
            raise RuntimeError("cover page overflowed during render")
        story.draw(dev)
        dw.end_page()

        for gi, g in enumerate(pages, start=1):
            if len(g) == 1 and not _group_fits(item_html(items[g[0]])):
                story = fitz.Story(html=wrap_doc([item_html(items[g[0]])]))
                while True:
                    dev = dw.begin_page(fitz.paper_rect("a4"))
                    fit = story.place(page_frame())
                    story.draw(dev)
                    dw.end_page()
                    if not fit[0]:
                        break
                continue
            dev = dw.begin_page(fitz.paper_rect("a4"))
            inner = "".join(item_html(items[i]) for i in g)
            story = fitz.Story(html=wrap_doc([inner]))
            fit = story.place(page_frame())
            if not frame_ok(fit):
                raise RuntimeError(f"page {gi} overflowed during render - pagination mismatch")
            story.draw(dev)
            dw.end_page()
    finally:
        dw.close()


def render_pdf(html, out_path):
    dw = fitz.DocumentWriter(out_path)
    story = fitz.Story(html=html)
    rect = page_frame()
    while True:
        dev = dw.begin_page(fitz.paper_rect("a4"))
        fit = story.place(rect)
        story.draw(dev)
        dw.end_page()
        if not fit[0]:
            break
    dw.close()


def add_footer_and_outline(pdf_path, subject):
    doc = fitz.open(pdf_path)
    n = len(doc)
    for i, page in enumerate(doc):
        w, h = page.rect.width, page.rect.height
        txt = f"{subject}"
        page.insert_text(fitz.Point(34, h - 14), txt,
                         fontsize=6.8, fontname="helv", color=(0.35, 0.37, 0.42))
        num = f"{i+1} / {n}"
        page.insert_text(fitz.Point(w - 34 - fitz.get_text_length(num, fontname="helv", fontsize=6.8), h - 14),
                         num, fontsize=6.8, fontname="helv", color=(0.35, 0.37, 0.42))
        page.draw_line(fitz.Point(34, h - 20), fitz.Point(w - 34, h - 20),
                       color=(0.85, 0.87, 0.9), width=0.5)

    # ---- outline from headings ----
    toc = []
    # cheap detection: walk pages, look for unit headings
    unit_re = re.compile(r"^(UNIT|PART)\s*\d+\b|^(UNIT|PART)\s*[IVXL]+\b", re.I)
    for i, page in enumerate(doc):
        d = page.get_text("dict")
        for block in d["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                text = "".join(sp["text"] for sp in line["spans"]).strip()
                if unit_re.match(text) and len(text) < 120:
                    toc.append([1, text, i + 1])
                    break
    if toc:
        doc.set_toc(toc)
    doc.saveIncr()
    doc.close()


TARGET_PAGES = 15
# per-file minimum text scale (smaller = more content per page).
# Cyber Security is dense, so it gets the tightest floor; everything else is
# tuned to land in ~15 pages at a comfortable size.
# Cyber Security keeps ALL its content (2063 items) with no filler dropped,
# so it needs an extreme floor to still land on the 15-page target.
SCALE_FLOOR = {
    "Cyber_Security_Complete_Notes.pdf": 0.155,
    "DSA_Complete_Notes.pdf": 0.65,
    "OOP_Complete_Notes.pdf": 0.63,
    "CN_Complete_Notes.pdf": 1.40,
    "SE_Complete_Notes.pdf": 0.66,
}
SCALE_MAX = 2.3


def _render_count(html, tmp):
    render_pdf(html, tmp)
    d = fitz.open(tmp)
    n = len(d)
    d.close()
    return n


def process_one(fname, subject):
    """Rebuild one PDF. Extracts content, then auto-scales its typography so
    the rebuilt PDF lands near TARGET_PAGES pages (cover page included)."""
    global CSS, CUR_SCALE
    src = os.path.join(PDF_DIR, fname)
    tmp = os.path.join(OUT_BASE, f".{fname}.tmp.pdf")
    (cover, csub), items = build_doc(src, subject)
    dropped = 0
    floor = SCALE_FLOOR.get(fname, 0.7)

    def make_html(s):
        global CSS, CUR_SCALE
        CSS = build_css(s)
        CUR_SCALE = s
        return build_html(subject, items, cover, csub)

    scale = 1.0
    best_scale, best_pages, best_html = 1.0, None, None
    seen = set()
    for _ in range(22):
        if scale in seen:
            break
        seen.add(scale)
        html = make_html(scale)
        n = _render_count(html, tmp)
        if best_pages is None or abs(n - TARGET_PAGES) < abs(best_pages - TARGET_PAGES) or (
                abs(n - TARGET_PAGES) == abs(best_pages - TARGET_PAGES) and n <= TARGET_PAGES):
            best_scale, best_pages, best_html = scale, n, html
        if n == TARGET_PAGES:
            break
        if n > TARGET_PAGES and scale > floor:
            scale = max(floor, scale * 0.92)
        elif n < TARGET_PAGES and scale < SCALE_MAX:
            scale = min(SCALE_MAX, scale * 1.08)
        else:
            break

    # fine scan around the best coarse estimate when we missed the target
    # (page counts are a step function of scale, so the adaptive loop alone
    # can jump straight past TARGET_PAGES).
    if best_pages != TARGET_PAGES:
        lo = max(floor, best_scale - 0.12)
        hi = min(SCALE_MAX, best_scale + 0.12)
        sc = lo
        while sc <= hi + 1e-9:
            s = round(sc, 4)
            if s not in seen:
                seen.add(s)
                html2 = make_html(s)
                m = _render_count(html2, tmp)
                if abs(m - TARGET_PAGES) < abs(best_pages - TARGET_PAGES):
                    best_scale, best_pages, best_html = s, m, html2
                if m == TARGET_PAGES:
                    break
            sc += 0.01

    CSS = build_css(best_scale)
    CUR_SCALE = best_scale
    render_pdf(best_html, tmp)
    add_footer_and_outline(tmp, subject)
    os.replace(tmp, os.path.join(OUT_BASE, fname))
    d = fitz.open(os.path.join(OUT_BASE, fname))
    n = len(d)
    d.close()
    return n, best_scale, dropped


JOBS = [
    ("CN_Complete_Notes.pdf", "Computer Networks"),
    ("COA_Complete_Notes.pdf", "Computer Organisation & Architecture"),
    ("Cyber_Security_Complete_Notes.pdf", "Cyber Security"),
    ("DBMS_Complete_Notes.pdf", "Database Management Systems"),
    ("DSA_Complete_Notes.pdf", "Data Structures & Algorithms"),
    ("OOP_Complete_Notes.pdf", "Object Oriented Programming"),
    ("OS_Complete_Notes.pdf", "Operating Systems"),
    ("SE_Complete_Notes.pdf", "Software Engineering"),
]


def check_overlap(fname):
    """True if any two WORD boxes on any page overlap meaningfully
    (line boxes include ascender/descender space, so words are the real
    glyph ink). Returns (file, page, ratio) for the worst pair, or None."""
    path = os.path.join(OUT_BASE, fname)
    doc = fitz.open(path)
    worst = None
    for pi in range(len(doc)):
        words = [w for w in doc[pi].get_text("words") if w[4].strip()]
        boxes = [fitz.Rect(w[:4]) for w in words]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                r = boxes[i] & boxes[j]
                if not r.is_empty:
                    min_a = min(boxes[i].get_area(), boxes[j].get_area())
                    if min_a > 0:
                        ratio = r.get_area() / min_a
                        if ratio > 0.5 and len(words[i][4]) > 1 and len(words[j][4]) > 1:
                            if worst is None or ratio > worst[2]:
                                worst = (fname, pi + 1, ratio)
    doc.close()
    return worst


def main():
    orig = {}
    for fname, subject in JOBS:
        src = os.path.join(PDF_DIR, fname)
        d = fitz.open(src)
        orig[fname] = len(d)
        d.close()
    print(f"{'File':38s} {'old':>5} {'new':>5} {'scale':>6} {'drop':>5}  overlap")
    for fname, subject in JOBS:
        try:
            n, s, dropped = process_one(fname, subject)
            ov = check_overlap(fname)
            print(f"{fname:38s} {orig[fname]:5d} {n:5d} {s:6.2f} {dropped:5d}  {ov or 'OK'}")
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"ERROR {fname}: {e}")


if __name__ == "__main__":
    main()
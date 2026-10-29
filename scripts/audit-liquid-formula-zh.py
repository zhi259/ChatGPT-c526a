#!/usr/bin/env python3
"""List untranslated English gettext labels in a checked-out Liquid Formula LuCI source tree."""
from pathlib import Path
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/audit-liquid-formula-zh.py PATH_TO_luci-app-liquid-formula")
root = Path(sys.argv[1]).resolve()
if not root.is_dir():
    raise SystemExit(f"Source directory does not exist: {root}")
patterns = [re.compile(r"_\(\s*'((?:\\.|[^'\\])*)'\s*\)"), re.compile(r'_\(\s*"((?:\\.|[^"\\])*)"\s*\)')]
# Acronyms / standards that should remain in English.
allow = {"TCP", "UDP", "IPv4", "IPv6", "TTL", "NFQUEUE", "SIP", "URI", "Logo", "Favicon", "User-Agent", "JSON", "URL", "HTTP", "HTTPS", "DNS", "IP", "NAT", "IRQ", "TCP Fast Open"}
results = []
files_scanned = 0
for p in sorted(root.rglob("*")):
    if not p.is_file() or p.suffix not in {".js", ".lua", ".json", ".html", ".htm"}:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    files_scanned += 1
    for line_no, line in enumerate(text.splitlines(), 1):
        candidates = []
        if p.suffix in {".js", ".lua"}:
            for pat in patterns:
                candidates.extend(m.group(1) for m in pat.finditer(line))
        elif p.suffix == ".json":
            candidates.extend(m.group(1) for m in re.finditer(r'"(?:title|label|name|description|placeholder)"\s*:\s*"([^"]+)"', line))
        else:
            # Review visible HTML text/attributes only; this is a heuristic list, not an HTML parser.
            plain = re.sub(r"<[^>]+>", " ", line)
            candidates.extend([plain.strip()] if plain.strip() else [])
        for label in candidates:
            if not re.search(r"[A-Za-z]", label):
                continue
            if re.search(r"[\u3400-\u9fff]", label):
                continue
            if label in allow or label.strip() in allow:
                continue
            # Template expressions / technical paths should be reviewed manually, not blindly translated.
            results.append((str(p.relative_to(root)), line_no, label))
report = root.parent / "liquid-formula-zh-untranslated.txt"
with report.open("w", encoding="utf-8") as f:
    for path, line_no, label in results:
        f.write(f"{path}:{line_no}: {label}\n")
print(f"Scanned {files_scanned} JS/Lua files; found {len(results)} untranslated/needs-review labels.")
print(f"Report: {report}")
if results:
    for row in results[:80]:
        print(f"{row[0]}:{row[1]}: {row[2]}")
    if len(results) > 80:
        print(f"... {len(results)-80} more; see report file.")

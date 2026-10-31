#!/usr/bin/env python3
"""Make C526A stage2 abort before firmware write if MT7615 unload fails."""
from pathlib import Path
import sys

MARKER = "# C526A MT7615 pre-upgrade failure guard"
OLD = '\tplatform_pre_upgrade "$IMAGE"\n'
NEW = (
    '    ' + MARKER + '\n'
    '    if ! platform_pre_upgrade "$IMAGE"; then\n'
    '        echo "<3>C526A: MT7615 safe unload failed; aborting firmware write" > /dev/kmsg\n'
    '        exit 1\n'
    '    fi\n'
)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: {Path(sys.argv[0]).name} IMMORTALWRT_SOURCE_DIR")
    root = Path(sys.argv[1]).resolve()
    target = root / "package/base-files/files/lib/upgrade/stage2"
    if not target.is_file():
        raise SystemExit(f"ERROR: ImmortalWrt stage2 file not found: {target}")
    source = target.read_text()
    if MARKER in source:
        expected = NEW
        if source.count(MARKER) != 1 or expected not in source:
            raise SystemExit("ERROR: C526A stage2 guard exists but is malformed")
        print("C526A stage2 failure guard already present")
        return
    count = source.count(OLD)
    if count != 1:
        raise SystemExit(f"ERROR: expected exactly one stage2 platform_pre_upgrade call, found {count}; refusing to patch")
    replacement = NEW
    source = source.replace(OLD, replacement, 1)
    target.write_text(source)
    check = target.read_text()
    if check.count(MARKER) != 1 or replacement not in check:
        raise SystemExit("ERROR: C526A stage2 guard failed post-write verification")
    print(f"Patched {target}: stage2 now aborts before ramfs/image write if MT7615 unload fails")


if __name__ == "__main__":
    main()

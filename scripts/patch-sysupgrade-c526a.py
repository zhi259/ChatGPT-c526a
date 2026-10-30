#!/usr/bin/env python3
"""Add a narrowly scoped C526A MT7615E pre-hook to ImmortalWrt 25.12 sysupgrade."""
from pathlib import Path
import sys

MARKER = "# C526A MT7615E sysupgrade pre-hook"
RESTORE_MARKER = "# Restore the C526A MT7615E radio if the sysupgrade handoff returned."
HOOK = '''# C526A MT7615E sysupgrade pre-hook
# Run only after image validation/config backup, but before procd hands PID 1
# to /sbin/upgraded. This hook is shared by LuCI and CLI sysupgrade paths.
if [ -x /lib/upgrade/c526a-mt7615-sysupgrade ]; then
\t/lib/upgrade/c526a-mt7615-sysupgrade || {
\t\techo "C526A MT7615E could not be safely unloaded; firmware upgrade aborted." >&2
\t\texit 1
\t}
fi

'''
RESTORE = '''	upgrade_rc=$?
	# Restore the C526A MT7615E radio if the sysupgrade handoff returned.
	if [ -x /lib/upgrade/c526a-mt7615-sysupgrade ] && [ -f /tmp/c526a-mt7615-sysupgrade-unloaded ]; then
		/lib/upgrade/c526a-mt7615-sysupgrade --restore || true
	fi
	exit "$upgrade_rc"
'''


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: {Path(sys.argv[0]).name} IMMORTALWRT_SOURCE_DIR")

    root = Path(sys.argv[1]).resolve()
    target = root / "package/base-files/files/sbin/sysupgrade"
    if not target.is_file():
        raise SystemExit(f"ERROR: ImmortalWrt sysupgrade script not found: {target}")

    text = target.read_text()
    marker_count = text.count(MARKER)
    if marker_count:
        expected_guard = "if [ -x /lib/upgrade/c526a-mt7615-sysupgrade ]; then"
        expected_call = "\t/lib/upgrade/c526a-mt7615-sysupgrade || {"
        if (marker_count != 1 or text.count(expected_guard) != 1 or
                text.count(expected_call) != 1 or text.count(RESTORE_MARKER) != 1):
            raise SystemExit("ERROR: C526A sysupgrade hook appears more than once or is malformed")
        print("C526A sysupgrade hook already present; leaving source unchanged")
        return

    anchor = "install_bin /sbin/upgraded\n"
    count = text.count(anchor)
    if count != 1:
        raise SystemExit(
            f"ERROR: expected exactly one '{anchor.strip()}' in {target}, found {count}; "
            "refusing to patch an unknown sysupgrade implementation"
        )

    ubus_anchor = '\tubus call system sysupgrade "$(json_dump)"\n'
    ubus_count = text.count(ubus_anchor)
    if ubus_count != 1:
        raise SystemExit(
            f"ERROR: expected exactly one normal sysupgrade ubus call in {target}, found {ubus_count}; "
            "refusing to patch an unknown handoff path"
        )

    # The first anchor is after image validation and backup creation, and before
    # upgraded/procd handoff. The second anchor adds recovery only if the ubus
    # handoff unexpectedly returns; successful handoff replaces PID 1.
    text = text.replace(anchor, HOOK + anchor, 1)
    text = text.replace(ubus_anchor, ubus_anchor + RESTORE, 1)
    target.write_text(text)

    check = target.read_text()
    if (check.count(MARKER) != 1 or check.count(RESTORE_MARKER) != 1 or
            check.index(MARKER) > check.index(anchor) or
            check.index(RESTORE_MARKER) < check.index(ubus_anchor)):
        raise SystemExit("ERROR: inserted C526A sysupgrade hooks failed post-write verification")

    print(f"Patched {target}: C526A MT7615E pre-unload and handoff-recovery hooks installed")


if __name__ == "__main__":
    main()

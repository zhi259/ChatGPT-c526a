#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${1:-$PWD}"
ROOT="$(cd -- "$ROOT" && pwd)"
cd "$ROOT"

need_file() {
	[[ -f "$1" ]] || { echo "ERROR: missing expected ImmortalWrt file: $1" >&2; exit 1; }
}

need_file target/linux/ipq40xx/image/generic.mk
need_file target/linux/ipq40xx/base-files/etc/board.d/02_network
need_file target/linux/ipq40xx/base-files/etc/hotplug.d/firmware/11-ath10k-caldata
need_file target/linux/ipq40xx/base-files/lib/upgrade/platform.sh
need_file package/firmware/ipq-wifi/Makefile
need_file package/base-files/files/lib/upgrade/stage2
need_file package/base-files/files/bin/config_generate

KIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Change only config_generate's LAN fallback. This makes the clean-install
# default 192.168.5.1 before any uci-defaults migration script runs.
python3 - <<'PYLANDEFAULT'
from pathlib import Path
import re
p = Path("package/base-files/files/bin/config_generate")
s = p.read_text()
pattern = re.compile(r'(?m)^([\t ]*lan\) ipad=\$\{ipaddr:-\")192\.168\.1\.1(\"\} ;;[\t ]*)$')
if 'lan) ipad=${ipaddr:-"192.168.5.1"} ;;' in s:
    print("config_generate LAN default already set to 192.168.5.1")
else:
    matches = list(pattern.finditer(s))
    if len(matches) != 1:
        raise SystemExit(f"ERROR: expected exactly one config_generate LAN fallback 192.168.1.1, found {len(matches)}")
    s = pattern.sub(lambda m: m.group(1) + '192.168.5.1' + m.group(2), s, count=1)
    p.write_text(s)
    print("Patched config_generate default LAN address to 192.168.5.1")
PYLANDEFAULT

grep -Fq 'lan) ipad=${ipaddr:-"192.168.5.1"} ;;' package/base-files/files/bin/config_generate || {
    echo "ERROR: config_generate LAN default is not 192.168.5.1" >&2
    exit 1
}

# Target DTS directory is under the qcom/ subdirectory for Linux 6.12.
install -D -m 0644 "$KIT_DIR/files/qcom-ipq4019-c526a.dts" \
	target/linux/ipq40xx/files/arch/arm/boot/dts/qcom/qcom-ipq4019-c526a.dts
install -D -m 0644 "$KIT_DIR/files/10_fix_wifi_mac" \
	target/linux/ipq40xx/base-files/etc/hotplug.d/ieee80211/10_fix_wifi_mac
install -D -m 0755 "$KIT_DIR/files/mt7615_reboot_service" \
	target/linux/ipq40xx/base-files/etc/init.d/mt7615_reboot
install -D -m 0644 "$KIT_DIR/patches/999-100-arm-add-c526a-dtb.patch" \
	target/linux/ipq40xx/patches-6.12/999-100-arm-add-c526a-dtb.patch

# Pin the board-2.bin override to the original LEDE device-support commit.
BDF_PATH="package/firmware/ipq-wifi/files/board-hiwifi_c526a.qca4019"
BDF_URL="https://raw.githubusercontent.com/coolsnowwolf/lede/2f74b3efffd5b1929d5a31d76e763b927aebf759/package/firmware/ipq-wifi/board-hiwifi_c526a.qca4019"
mkdir -p "$(dirname "$BDF_PATH")"
if [[ ! -s "$BDF_PATH" ]] || [[ "$(git hash-object "$BDF_PATH" 2>/dev/null || true)" != "ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a" ]]; then
	curl --fail --location --retry 3 --retry-delay 2 "$BDF_URL" -o "$BDF_PATH.tmp"
	BDF_HASH="$(git hash-object "$BDF_PATH.tmp")"
	if [[ "$BDF_HASH" != "ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a" ]]; then
		echo "ERROR: C526A BDF SHA mismatch: $BDF_HASH" >&2
		rm -f "$BDF_PATH.tmp"
		exit 1
	fi
	mv "$BDF_PATH.tmp" "$BDF_PATH"
fi

# Make sure the local BDF is staged into PKG_BUILD_DIR: the ipq-wifi package's
# install-overlay only searches that directory, not package/firmware/ipq-wifi/files.
python3 - "$ROOT/package/firmware/ipq-wifi/Makefile" <<'PYBDFPREP'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
marker = "# C526A local BDF staging (required by install-overlay)"
if marker not in s:
    needle = "define Build/Compile\n"
    if s.count(needle) != 1:
        raise SystemExit("ERROR: cannot uniquely locate ipq-wifi Build/Compile to stage C526A BDF")
    block = (
        marker + "\n"
        "define Build/Prepare\n"
        "\t$(call Build/Prepare/Default)\n"
        "\t$(CP) $(TOPDIR)/package/firmware/ipq-wifi/files/board-hiwifi_c526a.qca4019 $(PKG_BUILD_DIR)/\n"
        "endef\n\n"
    )
    s = s.replace(needle, block + needle, 1)
p.write_text(s)
PYBDFPREP

python3 - <<'PY'
from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def once(text, old, new, what):
    count = text.count(old)
    if count == 0:
        raise SystemExit(f"ERROR: could not find insertion anchor for {what}")
    if count > 1:
        raise SystemExit(f"ERROR: ambiguous insertion anchor for {what} ({count} matches)")
    return text.replace(old, new, 1)

# Add the Device block to the modern image/generic.mk (Device/UbiFit provides
# the factory.ubi and sysupgrade.bin image recipes).
p = "target/linux/ipq40xx/image/generic.mk"
s = read(p)
if "define Device/hiwifi_c526a" not in s:
    block = r'''

define Device/hiwifi_c526a
	$(call Device/FitzImage)
	$(call Device/UbiFit)
	DEVICE_VENDOR := HiWiFi
	DEVICE_MODEL := C526A
	SOC := qcom-ipq4019
	DEVICE_DTS := qcom-ipq4019-c526a
	BLOCKSIZE := 128k
	PAGESIZE := 2048
	DEVICE_PACKAGES := -ath10k-board-qca4019 ipq-wifi-hiwifi_c526a kmod-mt7615e kmod-mt7615-firmware kmod-ath10k ath10k-firmware-qca4019 -kmod-ath10k-ct -ath10k-firmware-qca4019-ct
endef
TARGET_DEVICES += hiwifi_c526a
'''
    s = s.rstrip() + "\n" + block.lstrip("\n") + "\n"

# Always exclude the generic QCA4019 board-data package for C526A. The generic
# package provides a large upstream board-2.bin and can shadow the dedicated
# 24,300-byte C526A board file even when ipq-wifi-hiwifi_c526a is selected.
start = s.find("define Device/hiwifi_c526a")
if start < 0:
    raise SystemExit("ERROR: C526A Device block missing after insertion")
end = s.find("\nendef", start)
if end < 0:
    raise SystemExit("ERROR: unterminated C526A Device block")
block = s[start:end]
match = re.search(r"(?m)^(\s*DEVICE_PACKAGES\s*:=)(.*)$", block)
if not match:
    raise SystemExit("ERROR: C526A Device block has no DEVICE_PACKAGES assignment")
packages = match.group(2).split()
packages = [item for item in packages if item not in ("ath10k-board-qca4019", "-ath10k-board-qca4019")]
packages.insert(0, "-ath10k-board-qca4019")
replacement = match.group(1) + " " + " ".join(packages)
block = block[:match.start()] + replacement + block[match.end():]
s = s[:start] + block + s[end:]
write(p, s)

# Register the custom QCA4019 board data with the current ipq-wifi package.
p = "package/firmware/ipq-wifi/Makefile"
s = read(p)
if "\thiwiFi_c526a \\" in s:
    raise SystemExit("ERROR: unexpected C526A board-name spelling already exists in ipq-wifi Makefile")
if "\thiwifi_c526a \\" not in s:
    s = once(s, "ALLWIFIBOARDS:= \\\n", "ALLWIFIBOARDS:= \\\n\thiwifi_c526a \\\n", "ipq-wifi ALLWIFIBOARDS")
if "generate-ipq-wifi-package,hiwifi_c526a" not in s:
    s = once(
        s,
        "$(foreach PACKAGE,$(ALLWIFIPACKAGES),$(eval $(call BuildPackage,$(PACKAGE))))",
        "$(eval $(call generate-ipq-wifi-package,hiwifi_c526a,HiWiFi C526A))\n$(foreach PACKAGE,$(ALLWIFIPACKAGES),$(eval $(call BuildPackage,$(PACKAGE))))",
        "ipq-wifi package generator",
    )
write(p, s)

# Device-specific switch topology and MAC addresses.
# Linux 6.12 uses DSA for the built-in IPQ4019 QCA8337 switch. Do not generate
# the legacy swconfig switch0/switch_vlan stanza from the 4.19/5.4-era port.
p = "target/linux/ipq40xx/base-files/etc/board.d/02_network"
s = read(p)


def replace_board_case(text, function_name, board, block):
    import re
    pos = text.find(function_name)
    if pos < 0:
        raise SystemExit(f"ERROR: {function_name} not found")
    next_fn = text.find("\nipq40xx_setup_", pos + len(function_name))
    end = next_fn if next_fn >= 0 else len(text)
    chunk = text[pos:end]
    case_idx = chunk.find('case "$board" in')
    if case_idx < 0:
        raise SystemExit(f"ERROR: case block not found in {function_name}")
    import re
    pattern = re.compile(r"(?m)^[ \t]*" + re.escape(board) + r"\)[ \t]*\n.*?^[ \t]*;;[ \t]*(?:\n|$)", re.S)
    matches = list(pattern.finditer(chunk))
    if len(matches) > 1:
        raise SystemExit(f"ERROR: multiple {board} cases in {function_name}")
    if matches:
        chunk = chunk[:matches[0].start()] + block + chunk[matches[0].end():]
    else:
        line_end = chunk.find("\n", case_idx)
        if line_end < 0:
            raise SystemExit(f"ERROR: malformed case statement in {function_name}")
        chunk = chunk[:line_end + 1] + block + chunk[line_end + 1:]
    return text[:pos] + chunk + text[end:]


interfaces_block = (
    '\thiwifi,c526a)\n'
    '\t\t# DSA port labels from the Linux 6.12 IPQ4019 switch node.\n'
    '\t\tucidef_set_interfaces_lan_wan "lan2 lan3 lan4" "wan"\n'
    '\t\t;;\n'
)
s = replace_board_case(s, "ipq40xx_setup_interfaces()", "hiwifi,c526a", interfaces_block)

macs_block = (
    '\thiwifi,c526a)\n'
    '\t\tlan_mac=$(mtd_get_mac_ascii bdinfo "Vfac_mac")\n'
    '\t\tif echo "$lan_mac" | grep -Eq "^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$"; then\n'
    '\t\t\tlabel_mac=$lan_mac\n'
    '\t\t\twan_mac=$(macaddr_add "$lan_mac" 1)\n'
    '\t\telse\n'
    '\t\t\t# Do not emit an invalid MAC address when factory lookup fails.\n'
    '\t\t\tlan_mac=""\n'
    '\t\t\twan_mac=""\n'
    '\t\tfi\n'
    '\t\t;;\n'
)
s = replace_board_case(s, "ipq40xx_setup_macs()", "hiwifi,c526a", macs_block)
write(p, s)

# C526A ath10k factory data comes from ART. Apply the board MAC only when the
# expected bdinfo key actually contains a syntactically valid MAC address.
p = "target/linux/ipq40xx/base-files/etc/hotplug.d/firmware/11-ath10k-caldata"
s = read(p)


def update_ath10k_case(text, firmware_marker, board_block):
    import re
    marker_pos = text.find(firmware_marker)
    if marker_pos < 0:
        raise SystemExit(f"ERROR: ath10k firmware section not found: {firmware_marker}")
    case_pos = text.find('case "$board" in', marker_pos)
    if case_pos < 0:
        raise SystemExit(f"ERROR: nested board case not found after {firmware_marker}")
    nested = text[case_pos:]
    esac_match = re.search(r"(?m)^[ \t]*esac[ \t]*$", nested)
    if not esac_match:
        raise SystemExit(f"ERROR: nested board case has no esac after {firmware_marker}")
    case_end = case_pos + esac_match.end()
    case_text = text[case_pos:case_end]
    pattern = re.compile(r"(?m)^[ \t]*hiwifi,c526a\)[ \t]*\n.*?^[ \t]*;;[ \t]*(?:\n|$)", re.S)
    matches = list(pattern.finditer(case_text))
    if len(matches) > 1:
        raise SystemExit(f"ERROR: multiple C526A cases after {firmware_marker}")
    if matches:
        case_text = case_text[:matches[0].start()] + board_block + case_text[matches[0].end():]
    else:
        line_end = case_text.find("\n", case_text.find('case "$board" in'))
        if line_end < 0:
            raise SystemExit(f"ERROR: malformed board case after {firmware_marker}")
        case_text = case_text[:line_end + 1] + board_block + case_text[line_end + 1:]
    return text[:case_pos] + case_text + text[case_end:]


low_band_block = (
    '\thiwifi,c526a)\n'
    '\t\tcaldata_extract "ART" 0x1000 0x2f20\n'
    '\t\tlan_mac=$(mtd_get_mac_ascii bdinfo "Vfac_mac")\n'
    '\t\tif echo "$lan_mac" | grep -Eq "^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$"; then\n'
    '\t\t\tath10k_patch_mac "$(macaddr_add "$lan_mac" +2)"\n'
    '\t\tfi\n'
    '\t\t;;\n'
)
s = update_ath10k_case(s, '"ath10k/pre-cal-ahb-a000000.wifi.bin")', low_band_block)

high_band_block = (
    '\thiwifi,c526a)\n'
    '\t\tcaldata_extract "ART" 0x5000 0x2f20\n'
    '\t\tlan_mac=$(mtd_get_mac_ascii bdinfo "Vfac_mac")\n'
    '\t\tif echo "$lan_mac" | grep -Eq "^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$"; then\n'
    '\t\t\tath10k_patch_mac "$(macaddr_add "$lan_mac" +3)"\n'
    '\t\tfi\n'
    '\t\t;;\n'
)
s = update_ath10k_case(s, '"ath10k/pre-cal-ahb-a800000.wifi.bin")', high_band_block)
write(p, s)

# NAND sysupgrade handler for the single UBI partition.
p = "target/linux/ipq40xx/base-files/lib/upgrade/platform.sh"
s = read(p)
if "hiwifi,c526a|\\" not in s:
    s = once(s, "\tmobipromo,cm520-79f|\\\n", "\thiwifi,c526a|\\\n\tmobipromo,cm520-79f|\\\n", "C526A NAND upgrade handler")
write(p, s)

print("C526A device definitions and board scripts installed.")
PY

# Sanity-check that all registration points made it into the source tree.
grep -q 'define Device/hiwifi_c526a' target/linux/ipq40xx/image/generic.mk
grep -q 'DEVICE_PACKAGES := -ath10k-board-qca4019' target/linux/ipq40xx/image/generic.mk
grep -q 'hiwifi_c526a' package/firmware/ipq-wifi/Makefile
grep -q 'hiwifi,c526a' target/linux/ipq40xx/base-files/etc/board.d/02_network
grep -q 'ucidef_set_interfaces_lan_wan "lan2 lan3 lan4" "wan"' target/linux/ipq40xx/base-files/etc/board.d/02_network
! grep -q 'ess-switch@c000000' target/linux/ipq40xx/files/arch/arm/boot/dts/qcom/qcom-ipq4019-c526a.dts
! grep -q 'edma@c080000' target/linux/ipq40xx/files/arch/arm/boot/dts/qcom/qcom-ipq4019-c526a.dts
grep -q 'qcom-ipq4019-c526a.dtb' target/linux/ipq40xx/patches-6.12/999-100-arm-add-c526a-dtb.patch
python3 "$KIT_DIR/scripts/patch-stage2-c526a.py" "$ROOT"

echo "C526A support patch applied."

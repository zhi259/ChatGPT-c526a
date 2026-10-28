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

KIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Target DTS directory is under the qcom/ subdirectory for Linux 6.12.
install -D -m 0644 "$KIT_DIR/files/qcom-ipq4019-c526a.dts" \
	target/linux/ipq40xx/files/arch/arm/boot/dts/qcom/qcom-ipq4019-c526a.dts
install -D -m 0644 "$KIT_DIR/files/10_fix_wifi_mac" \
	target/linux/ipq40xx/base-files/etc/hotplug.d/ieee80211/10_fix_wifi_mac
install -D -m 0755 "$KIT_DIR/files/mt7615_reboot" \
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

python3 - <<'PY'
from pathlib import Path


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
	DEVICE_PACKAGES := ipq-wifi-hiwifi_c526a kmod-mt7615e kmod-mt7615-firmware kmod-ath10k ath10k-firmware-qca4019 -kmod-ath10k-ct -ath10k-firmware-qca4019-ct
endef
TARGET_DEVICES += hiwifi_c526a
'''
    write(p, s.rstrip() + "\n" + block.lstrip("\n") + "\n")

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
p = "target/linux/ipq40xx/base-files/etc/board.d/02_network"
s = read(p)
fn = "ipq40xx_setup_interfaces()"
pos = s.find(fn)
if pos < 0:
    raise SystemExit("ERROR: ipq40xx_setup_interfaces() not found")
case = s.find('case "$board" in', pos)
endfn = s.find("ipq40xx_setup_", pos + len(fn))
if case < 0 or (endfn >= 0 and case > endfn):
    raise SystemExit("ERROR: interfaces case block not found")
line_end = s.find("\n", case)
if "hiwifi,c526a)" not in s[case:(endfn if endfn >= 0 else len(s))]:
    s = s[:line_end + 1] + (
        '\thiWiFi_PLACEHOLDER)\n'
    ).replace('\thiWiFi_PLACEHOLDER)', '\thiwifi,c526a)') + (
        '\t\tucidef_set_interfaces_lan_wan "eth0" "eth1"\n'
        '\t\tucidef_add_switch "switch0" \\\n'
        '\t\t\t"0u@eth0" "2:lan" "3:lan" "4:lan"\n'
        '\t\t;;\n'
    ) + s[line_end + 1:]

fn = "ipq40xx_setup_macs()"
pos = s.find(fn)
if pos < 0:
    raise SystemExit("ERROR: ipq40xx_setup_macs() not found")
case = s.find('case "$board" in', pos)
endfn = s.find("}\n", pos)
if case < 0:
    raise SystemExit("ERROR: MAC case block not found")
line_end = s.find("\n", case)
if "hiwifi,c526a)" not in s[case:(endfn if endfn >= 0 else len(s))]:
    s = s[:line_end + 1] + (
        '\thiwifi,c526a)\n'
        '\t\tlan_mac=$(mtd_get_mac_ascii bdinfo "Vfac_mac ")\n'
        '\t\tlabel_mac=$lan_mac\n'
        '\t\twan_mac=$(macaddr_add "$lan_mac" 1)\n'
        '\t\t;;\n'
    ) + s[line_end + 1:]
write(p, s)

# Use ART caldata, while deriving unique ath10k MACs from bdinfo/Vfac_mac.
p = "target/linux/ipq40xx/base-files/etc/hotplug.d/firmware/11-ath10k-caldata"
s = read(p)
old = '"ath10k/pre-cal-ahb-a000000.wifi.bin")\n\tcase "$board" in\n'
new = old + (
    '\thiwifi,c526a)\n'
    '\t\tcaldata_extract "ART" 0x1000 0x2f20\n'
    '\t\tath10k_patch_mac $(macaddr_add $(mtd_get_mac_ascii bdinfo "Vfac_mac ") +2)\n'
    '\t\t;;\n'
)
if "hiwifi,c526a)" not in s[s.find('"ath10k/pre-cal-ahb-a000000.wifi.bin")'):s.find('"ath10k/pre-cal-ahb-a800000.wifi.bin")')]:
    s = once(s, old, new, "C526A 5 GHz low-band caldata")
old = '"ath10k/pre-cal-ahb-a800000.wifi.bin")\n\tcase "$board" in\n'
new = old + (
    '\thiwifi,c526a)\n'
    '\t\tcaldata_extract "ART" 0x5000 0x2f20\n'
    '\t\tath10k_patch_mac $(macaddr_add $(mtd_get_mac_ascii bdinfo "Vfac_mac ") +3)\n'
    '\t\t;;\n'
)
idx = s.find('"ath10k/pre-cal-ahb-a800000.wifi.bin")')
if idx < 0:
    raise SystemExit("ERROR: second ath10k AHB pre-cal section not found")
if "hiwifi,c526a)" not in s[idx:]:
    s = once(s, old, new, "C526A 5 GHz high-band caldata")
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
grep -q 'hiwifi_c526a' package/firmware/ipq-wifi/Makefile
grep -q 'hiwifi,c526a' target/linux/ipq40xx/base-files/etc/board.d/02_network
grep -q 'qcom-ipq4019-c526a.dtb' target/linux/ipq40xx/patches-6.12/999-100-arm-add-c526a-dtb.patch
echo "C526A support patch applied."

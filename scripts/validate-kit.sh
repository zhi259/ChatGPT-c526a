#!/usr/bin/env bash
set -Eeuo pipefail
KIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="$KIT_DIR/rootfs-overlay"
need_file() {
    [[ -s "$1" ]] || { echo "ERROR: required file missing or empty: $1" >&2; exit 1; }
}
need_exec() {
    [[ -x "$1" ]] || { echo "ERROR: required executable missing or not executable: $1" >&2; exit 1; }
}
need_file "$KIT_DIR/.config"
need_file "$KIT_DIR/files/qcom-ipq4019-c526a.dts"
need_file "$KIT_DIR/scripts/apply-c526a.sh"
grep -Fq 'package/base-files/files/bin/config_generate' "$KIT_DIR/scripts/apply-c526a.sh" || {
    echo 'ERROR: apply-c526a.sh does not patch config_generate for the clean-install LAN default' >&2; exit 1;
}
grep -Fq '192.168.5.1' "$KIT_DIR/scripts/apply-c526a.sh" || {
    echo 'ERROR: config_generate default LAN address patch is missing' >&2; exit 1;
}
for symbol in \
    CONFIG_PACKAGE_luci-app-passwall \
    CONFIG_PACKAGE_luci-app-passwall_INCLUDE_SingBox \
    CONFIG_PACKAGE_luci-app-ddns \
    CONFIG_PACKAGE_luci-proto-ipv6 \
    CONFIG_PACKAGE_zerotier \
    CONFIG_PACKAGE_luci-theme-argon \
    CONFIG_PACKAGE_luci-app-liquid-formula; do
    grep -qx "${symbol}=y" "$KIT_DIR/.config" || {
        echo "ERROR: required package selection missing from .config: ${symbol}" >&2; exit 1;
    }
done
need_file "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js"
need_file "$OVERLAY/www/luci-static/resources/view/c526a/guestwifi.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/overview.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/fakehttp.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/fakesip.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/customlogo.js"
need_file "$OVERLAY/usr/share/luci/menu.d/luci-app-liquid-formula.json"
need_file "$OVERLAY/usr/share/rpcd/acl.d/luci-app-liquid-formula.json"
need_exec "$OVERLAY/usr/libexec/rpcd/liquid_formula"
need_exec "$OVERLAY/etc/uci-defaults/99-c526a-default-network"
need_exec "$OVERLAY/sbin/tempinfo"
need_file "$KIT_DIR/files/mt7615_reboot_service"
need_exec "$OVERLAY/etc/uci-defaults/95-c526a-enable-mt7615-reboot"
need_file "$OVERLAY/lib/upgrade/99-c526a-mt7615.sh"
need_file "$KIT_DIR/scripts/patch-stage2-c526a.py"
sh -n "$KIT_DIR/files/mt7615_reboot_service"
sh -n "$OVERLAY/etc/uci-defaults/95-c526a-enable-mt7615-reboot"
sh -n "$OVERLAY/lib/upgrade/99-c526a-mt7615.sh"
python3 -m py_compile "$KIT_DIR/scripts/patch-stage2-c526a.py"
# Exercise the stage2 patcher against the ImmortalWrt call shape, verify valid
# shell syntax, reject literal escaped tabs, and prove the patch is idempotent.
STAGE2_TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$STAGE2_TEST_ROOT"' EXIT
mkdir -p "$STAGE2_TEST_ROOT/package/base-files/files/lib/upgrade"
cat > "$STAGE2_TEST_ROOT/package/base-files/files/lib/upgrade/stage2" <<'STAGE2TEST'
#!/bin/sh
if [ -n "$IMAGE" ] && type 'platform_pre_upgrade' >/dev/null 2>/dev/null; then
	platform_pre_upgrade "$IMAGE"
fi
if [ -n "$(rootfs_type)" ]; then
	switch_to_ramfs
fi
exec /bin/busybox ash -c "$COMMAND"
STAGE2TEST
python3 "$KIT_DIR/scripts/patch-stage2-c526a.py" "$STAGE2_TEST_ROOT"
STAGE2_TEST_FILE="$STAGE2_TEST_ROOT/package/base-files/files/lib/upgrade/stage2"
sh -n "$STAGE2_TEST_FILE"
grep -Fq '        echo "<3>C526A: MT7615 safe unload failed; aborting firmware write" > /dev/kmsg' "$STAGE2_TEST_FILE" || {
    echo 'ERROR: generated stage2 guard does not contain a valid echo command' >&2; exit 1;
}
if grep -Fq '\techo' "$STAGE2_TEST_FILE" || grep -Fq '\texit' "$STAGE2_TEST_FILE"; then
    echo 'ERROR: generated stage2 guard contains literal backslash-t commands' >&2; exit 1
fi
python3 "$KIT_DIR/scripts/patch-stage2-c526a.py" "$STAGE2_TEST_ROOT"
! grep -Fq '/etc/init.d/mt7615_reboot disable' "$OVERLAY/etc/uci-defaults/99-c526a-default-network" || {
    echo 'ERROR: default-network uci-default still disables the MT7615 reboot service' >&2; exit 1;
}
! grep -Fq 'rm -f /etc/init.d/mt7615_reboot' "$OVERLAY/etc/uci-defaults/99-c526a-default-network" || {
    echo 'ERROR: default-network uci-default still deletes the MT7615 reboot service' >&2; exit 1;
}

grep -Fq "var currentLanIP = normalizeLanInput(uci.get('network', 'lan', 'ipaddr'));" "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js" || {
    echo 'ERROR: quick setup wizard does not read the current LAN address from UCI' >&2; exit 1;
}
grep -Fq "_('默认管理地址为 ') + currentLanIP + _('。请确认它与上级路由器的网段不冲突。')" "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js" || {
    echo 'ERROR: quick setup wizard LAN description is not dynamically bound to the current LAN address' >&2; exit 1;
}
grep -Fq "field('c526a_lan_ip', _('路由器 LAN 地址（仅填写 IP）'), currentLanIP" "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js" || {
    echo 'ERROR: wizard LAN input and description do not use the same normalized current address' >&2; exit 1;
}
grep -Fq 'lan_ip="${lan_ip%%/*}"' "$OVERLAY/etc/uci-defaults/99-c526a-default-network" || {
    echo 'ERROR: legacy LAN migration does not normalize CIDR suffixes such as /24' >&2; exit 1;
}
grep -Fq 'normalizeLanInput(uci.get' "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js" || {
    echo 'ERROR: wizard LAN input does not normalize legacy/list/CIDR values to a plain IPv4 address' >&2; exit 1;
}
if grep -Fq '192.168.5.1/24' "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js"; then
    echo 'ERROR: wizard still displays /24 in the LAN description/input' >&2; exit 1
fi
grep -Fq "|| 'HiWiFi-X'" "$OVERLAY/www/luci-static/resources/view/c526a/guestwifi.js" || {
    echo 'ERROR: guest Wi-Fi default SSID is not HiWiFi-X' >&2; exit 1;
}
if grep -Fq 'C526A-Guest' "$OVERLAY/www/luci-static/resources/view/c526a/guestwifi.js"; then
    echo 'ERROR: old guest Wi-Fi default SSID remains' >&2; exit 1
fi
grep -Fq 'liquid_formula' "$OVERLAY/usr/share/rpcd/acl.d/luci-app-liquid-formula.json"
grep -Fq 'status' "$OVERLAY/usr/libexec/rpcd/liquid_formula"
# APK repositories are intentionally left to the existing firmware/source configuration.
if [[ -e "$OVERLAY/etc/apk/repositories.d/distfeeds.list" ]]; then
    echo 'ERROR: an APK repository override was added even though feed changes are deferred' >&2; exit 1
fi

python3 -m json.tool "$OVERLAY/usr/share/luci/menu.d/luci-app-liquid-formula.json" >/dev/null
python3 -m json.tool "$OVERLAY/usr/share/rpcd/acl.d/luci-app-liquid-formula.json" >/dev/null
sh -n "$OVERLAY/usr/libexec/rpcd/liquid_formula"
if command -v node >/dev/null 2>&1; then
    for js in \
        "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js" \
        "$OVERLAY/www/luci-static/resources/view/c526a/guestwifi.js" \
        "$OVERLAY/www/luci-static/resources/view/liquid-formula/overview.js" \
        "$OVERLAY/www/luci-static/resources/view/liquid-formula/fakehttp.js" \
        "$OVERLAY/www/luci-static/resources/view/liquid-formula/fakesip.js" \
        "$OVERLAY/www/luci-static/resources/view/liquid-formula/customlogo.js"; do
        node --check "$js"
    done
fi
printf 'C526A v11 kit preflight passed. APK feed configuration left unchanged.\n'

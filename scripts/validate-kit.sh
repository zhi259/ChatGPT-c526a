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
need_file "$KIT_DIR/files/mt7615_reboot"
need_file "$KIT_DIR/scripts/apply-c526a.sh"
need_file "$KIT_DIR/scripts/patch-sysupgrade-c526a.py"
need_file "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js"
need_file "$OVERLAY/www/luci-static/resources/view/c526a/guestwifi.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/overview.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/fakehttp.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/fakesip.js"
need_file "$OVERLAY/www/luci-static/resources/view/liquid-formula/customlogo.js"
need_file "$OVERLAY/usr/share/luci/menu.d/luci-app-liquid-formula.json"
need_file "$OVERLAY/usr/share/rpcd/acl.d/luci-app-liquid-formula.json"
need_exec "$OVERLAY/usr/libexec/rpcd/liquid_formula"
need_exec "$OVERLAY/lib/upgrade/c526a-mt7615-sysupgrade"
need_exec "$OVERLAY/etc/uci-defaults/99-c526a-default-network"
need_exec "$OVERLAY/etc/uci-defaults/90-c526a-enable-mt7615-reboot"
need_exec "$OVERLAY/sbin/tempinfo"

grep -Fq '默认管理地址为 192.168.5.1。' "$OVERLAY/www/luci-static/resources/view/c526a/wizard.js" || {
    echo 'ERROR: quick setup wizard LAN description is not the requested 192.168.5.1 text' >&2; exit 1;
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
sh -n "$OVERLAY/lib/upgrade/c526a-mt7615-sysupgrade"
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

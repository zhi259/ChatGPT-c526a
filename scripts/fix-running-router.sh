#!/bin/sh
# Apply the C526A v9 temperature/menu fix to an already-flashed router.
# Run as root on the router. This does not flash or rebuild firmware.
set -eu
[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root" >&2; exit 1; }

BACKUP_DIR="/root/c526a-v9-hotfix-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
[ ! -e /sbin/tempinfo ] || cp -a /sbin/tempinfo "$BACKUP_DIR/tempinfo.before"
if [ -d /usr/share/luci/menu.d ]; then
    tar -czf "$BACKUP_DIR/menu.d.tgz" /usr/share/luci/menu.d 2>/dev/null || true
fi

cat > /sbin/tempinfo <<'TEMPINFO'
#!/bin/sh
# C526A overview temperature summary override
SYSFS_ROOT="${C526A_SYSFS_ROOT:-/sys}"
wifi24=""
wifi5a=""
wifi5b=""
format_temp() {
    value="$1"
    case "$value" in ''|*[!0-9]*) return 1 ;; esac
    [ "$value" -gt 0 ] 2>/dev/null || return 1
    [ "$value" -le 150000 ] 2>/dev/null || return 1
    whole=$((value / 1000))
    tenth=$(((value % 1000 + 50) / 100))
    if [ "$tenth" -ge 10 ]; then whole=$((whole + 1)); tenth=0; fi
    printf '%s.%s' "$whole" "$tenth"
}
for hwmon in "$SYSFS_ROOT"/class/hwmon/hwmon*; do
    [ -d "$hwmon" ] || continue
    name="$(cat "$hwmon/name" 2>/dev/null)"
    devpath="$(readlink -f "$hwmon/device" 2>/dev/null)"
    target=""
    case "$name:$devpath" in
        mt7615_phy0:*) target=wifi24 ;;
        ath10k_hwmon:*a000000.wifi*) target=wifi5a ;;
        ath10k_hwmon:*a800000.wifi*) target=wifi5b ;;
        *) continue ;;
    esac
    for input in "$hwmon"/temp*_input; do
        [ -r "$input" ] || continue
        raw="$(cat "$input" 2>/dev/null)"
        temp="$(format_temp "$raw")" || continue
        case "$target" in
            wifi24) wifi24="$temp" ;;
            wifi5a) wifi5a="$temp" ;;
            wifi5b) wifi5b="$temp" ;;
        esac
        break
    done
done
parts=""
[ -n "$wifi24" ] && parts="${parts}${parts:+, }2.4G ${wifi24}°C"
[ -n "$wifi5a" ] && parts="${parts}${parts:+, }5G-1 ${wifi5a}°C"
[ -n "$wifi5b" ] && parts="${parts}${parts:+, }5G-2 ${wifi5b}°C"
[ -n "$parts" ] && printf 'WiFi: %s\n' "$parts"
TEMPINFO
chmod 0755 /sbin/tempinfo

# The old default channel 100 is rejected for AP mode by this board's radio1.
radio1_channel="$(uci -q get wireless.radio1.channel 2>/dev/null || true)"
if [ "$radio1_channel" = "100" ]; then
    uci -q set wireless.radio1.channel='149'
    uci -q set wireless.radio1.htmode='VHT80'
    uci -q commit wireless
    echo "Changed radio1 channel 100 -> 149; reloading Wi-Fi"
    wifi reload || true
fi

# Remove the prefix from every LuCI menu definition that may have come from
# an older package, not just the expected overlay filename.
if [ -d /usr/share/luci/menu.d ]; then
    find /usr/share/luci/menu.d -type f -name '*.json' -print | while IFS= read -r file; do
        if grep -qE 'C526A 快速设置向导|C526A 访客 Wi-Fi' "$file" 2>/dev/null; then
            sed -i 's/C526A 快速设置向导/快速设置向导/g; s/C526A 访客 Wi-Fi/访客 Wi-Fi/g' "$file"
        fi
    done
fi
if [ -d /www/luci-static/resources/view ]; then
    find /www/luci-static/resources/view -type f -name '*.js' -print | while IFS= read -r file; do
        if grep -qE 'C526A 快速设置向导|C526A 访客 Wi-Fi|HiWiFi C526A 快速网络设置向导' "$file" 2>/dev/null; then
            sed -i 's/HiWiFi C526A 快速网络设置向导/快速网络设置向导/g; s/C526A 快速设置向导/快速设置向导/g; s/C526A 访客 Wi-Fi/访客 Wi-Fi/g' "$file"
        fi
    done
fi

rm -f /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-indexcache.* /tmp/luci-modulecache.* 2>/dev/null || true
/etc/init.d/rpcd restart
/etc/init.d/uhttpd reload 2>/dev/null || true
sleep 5
printf '\n===== Current /sbin/tempinfo output =====\n'
/sbin/tempinfo || true
printf '\n===== Remaining old menu titles (if any) =====\n'
if grep -R -nE 'C526A 快速设置向导|C526A 访客 Wi-Fi' /usr/share/luci/menu.d 2>/dev/null; then
    echo 'WARNING: old label exists in another menu file; inspect the path above.'
else
    echo 'No old C526A-prefixed menu labels remain in /usr/share/luci/menu.d.'
fi
cat <<'DONE'
C526A live hotfix applied.
- Replaced /sbin/tempinfo with a C526A-aware script that reads all three hwmon devices.
- Zero/invalid sensor values and empty trailing placeholders are omitted.
- The known unsupported radio1 channel 100 was changed to 149 when present.
- Menu and page titles were cleaned across LuCI menu JSON and view JS files.
If this command shows all three temperatures but the Overview row is stale, hard-refresh the browser (Ctrl+Shift+R).
DONE

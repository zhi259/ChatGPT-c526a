
#!/usr/bin/env python3
# Local C526A customizations for the upstream luci-app-temp widget.
from pathlib import Path
import re, sys

root = Path(sys.argv[1]).resolve()
js = root / "htdocs/luci-static/resources/view/status/include/28_temp.js"
rpc = root / "root/usr/libexec/rpcd/luci.temp"
if not js.is_file() or not rpc.is_file():
    raise SystemExit(f"ERROR: unexpected luci-app-temp source layout at {root}")

# Preserve upstream behavior but localize its overview strings by changing
# msgids to Chinese; LuCI's _() returns the msgid itself if no catalog exists.
translations = {
    "CPU": "CPU",
    "SoC": "SoC 芯片",
    "WiFi 2.4 GHz": "2.4 GHz 无线模块",
    "WiFi 5 GHz": "5 GHz 无线模块",
    "Fan": "风扇",
    "rpm": "转/分钟",
    "off": "关闭",
    "level %d/%d": "档位 %d/%d",
    "max": "最高档",
    "PWM": "PWM",
    "Temperature": "温度",
    "Session peak": "本次页面最高温度",
    "No temperature sensors found": "未发现可读取的温度传感器",
    "Refresh every %d s · warn %d °C · crit %d °C": "每 %d 秒刷新 · 预警 %d °C · 严重 %d °C",
    "Settings": "设置",
    "Temperature: settings": "温度显示设置",
    "Refresh interval, s": "刷新间隔（秒）",
    "Warning threshold, °C": "预警温度（°C）",
    "Critical threshold, °C": "严重温度（°C）",
    "Cancel": "取消",
    "Save": "保存",
    "Failed to save settings: %s": "保存设置失败：%s",
}

js_text = js.read_text(encoding="utf-8")
changes = 0
# Replace only literal strings passed into LuCI gettext calls.
for quote in ("'", '"'):
    pat = re.compile(r"_\(\s*" + re.escape(quote) + r"([^" + re.escape(quote) + r"\\]*)" + re.escape(quote) + r"\s*\)")
    def sub(m):
        nonlocal_dummy = None
        msg = m.group(1)
        if msg in translations:
            return "_(" + quote + translations[msg] + quote + ")"
        return m.group(0)
    js_text, count = pat.subn(sub, js_text)
    changes += count

# Friendly stable names are emitted by the backend, based on each device path,
# not on hwmon0/1/2 numbering (which can change across boots).
old_name = 'name=$(cat "$hwmon/name" 2>/dev/null)\n\t\tfor t in "$hwmon"/temp*_input; do'
new_name = '''name=$(cat "$hwmon/name" 2>/dev/null)
\t\tdevpath=$(readlink -f "$hwmon/device" 2>/dev/null)
\t\tdisplay_name="$name"
\t\tcase "$name:$devpath" in
\t\t\tmt7615_phy0:*) display_name="2.4 GHz 无线模块（MT7615E）" ;;
\t\t\tath10k_hwmon:*a000000.wifi*) display_name="5 GHz 无线模块 1（QCA4019）" ;;
\t\t\tath10k_hwmon:*a800000.wifi*) display_name="5 GHz 无线模块 2（QCA4019）" ;;
\t\t\tath10k_hwmon:*) display_name="5 GHz 无线模块（QCA4019）" ;;
\t\tesac
\t\tfor t in "$hwmon"/temp*_input; do'''
if old_name not in rpc.read_text(encoding="utf-8"):
    raise SystemExit("ERROR: unexpected luci.temp hwmon loop; refusing to patch unknown upstream code")
rpc_text = rpc.read_text(encoding="utf-8").replace(old_name, new_name, 1)

# On this C526A port, ath10k hwmon can expose a stale zero when the AP cannot
# be brought up (observed with an unsupported channel). Do not show that as a
# measured 0 °C; omit the sensor until the driver returns a valid reading.
old_temp_check = 'temp=$(cat "$t" 2>/dev/null)\n\t\t\t[ -n "$temp" ] || continue\n\t\t\ttbase="${t%_input}"'
new_temp_check = '''temp=$(cat "$t" 2>/dev/null)
\t\t\t[ -n "$temp" ] || continue
\t\t\t[ "$name" = "ath10k_hwmon" ] && [ "$temp" = "0" ] && continue
\t\t\ttbase="${t%_input}"'''
if old_temp_check not in rpc_text:
    raise SystemExit("ERROR: unexpected luci.temp temperature-read block; refusing to patch unknown upstream code")
rpc_text = rpc_text.replace(old_temp_check, new_temp_check, 1)

old_json_name = 'json_add_string name "${name:-${hwmon##*/}}${label:+ ($label)}"'
new_json_name = 'json_add_string name "${display_name:-${name:-${hwmon##*/}}}${label:+ ($label)}"'
if old_json_name not in rpc_text:
    raise SystemExit("ERROR: unexpected luci.temp sensor-name expression; refusing to patch unknown upstream code")
rpc_text = rpc_text.replace(old_json_name, new_json_name, 1)

js.write_text(js_text, encoding="utf-8")
rpc.write_text(rpc_text, encoding="utf-8")
print(f"C526A temp widget: translated {changes} UI strings; added stable MT7615E/QCA4019 sensor labels")

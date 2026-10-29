
#!/usr/bin/env python3
# Apply conservative Simplified-Chinese labels to Liquid Formula LuCI strings.
from pathlib import Path
import re, sys

root = Path(sys.argv[1]).resolve()
if not root.is_dir():
    raise SystemExit(f"ERROR: Liquid Formula LuCI source directory not found: {root}")

# UI labels are translated at the source msgid level so the strings remain
# Chinese even if a separate gettext catalog is absent. Logic identifiers and
# UCI option values are not rewritten.
T = {
    "Singbox Formula": "订阅转换（Sing-box）",
    "Tuning Utility": "网络调优工具",
    "FakeHTTP": "FakeHTTP（TCP 混淆）",
    "FakeSIP": "FakeSIP（UDP 混淆）",
    "Subscription URL": "订阅地址",
    "Subscription url": "订阅地址",
    "User-Agent": "用户标识（User-Agent）",
    "Password": "访问密码",
    "Access password": "访问密码",
    "Subscription timeout": "订阅请求超时",
    "Refresh interval": "自动刷新间隔",
    "Boot delay": "启动延迟",
    "Default template": "默认模板",
    "Output config": "输出配置文件",
    "Output configuration": "输出配置文件",
    "Output file": "输出文件",
    "Save & Apply": "保存并应用",
    "Save and Apply": "保存并应用",
    "Save": "保存",
    "Apply": "应用",
    "Cancel": "取消",
    "Close": "关闭",
    "Restart converter": "重启转换器",
    "Generate config.yaml": "重新生成 config.yaml",
    "Refresh subscription": "刷新订阅",
    "Check generated config": "检查生成的配置",
    "Update output file": "更新输出文件",
    "Refresh": "刷新",
    "Check": "检查",
    "Update": "更新",
    "Start": "启动",
    "Stop": "停止",
    "Restart": "重启",
    "Enabled": "已启用",
    "Disabled": "已停用",
    "Enable": "启用",
    "Disable": "停用",
    "Status": "状态",
    "Running": "运行中",
    "Running (not ready)": "运行中（尚未就绪）",
    "Not ready": "尚未就绪",
    "Not running": "未运行",
    "Ready": "已就绪",
    "Template": "模板",
    "Templates": "模板管理",
    "Upload": "上传",
    "Delete": "删除",
    "Edit": "编辑",
    "Add": "添加",
    "Remove": "移除",
    "Clear": "清空",
    "Interface": "网络接口",
    "Interfaces": "网络接口",
    "Direction": "流量方向",
    "Outbound": "出站",
    "Inbound": "入站",
    "Automatic": "自动",
    "IPv4": "IPv4",
    "IPv6": "IPv6",
    "TCP": "TCP",
    "UDP": "UDP",
    "TTL": "TTL",
    "NFQUEUE": "NFQUEUE 队列号",
    "Mark": "数据包标记（mark）",
    "Mask": "掩码（mask）",
    "Payload": "数据载荷",
    "Payloads": "数据载荷列表",
    "SIP URI": "SIP 地址",
    "Include ports": "包含端口",
    "Exclude ports": "排除端口",
    "All ports": "所有端口",
    "Logo": "Logo 标识",
    "Favicon": "Favicon 图标",
    "Upload logo": "上传 Logo",
    "Upload favicon": "上传 Favicon",
    "Kernel tuning": "内核调优",
    "Congestion control": "拥塞控制算法",
    "Queue discipline": "队列调度规则",
    "SYN backlog": "SYN 队列长度",
    "irqbalance": "IRQ 中断均衡",
    "TCP Fast Open": "TCP Fast Open",
    "Settings": "设置",
    "Network": "网络",
    "Warning": "警告",
    "Critical": "严重",
    "Loopback URL": "本机访问地址",
    "LAN URL": "局域网访问地址",
    "Conversion URL": "转换地址",
    "Save settings": "保存设置",
    "Apply settings": "应用设置",
    "Configuration": "配置",
    "Log": "日志",
    "Update log": "更新日志",
    "Refresh interval, s": "刷新间隔（秒）",
    "Enabled by default": "默认启用",
    "Disabled by default": "默认关闭",
}

translated = 0
scanned = 0
# Patch only gettext source strings in JS/Lua, not arbitrary program literals.
patterns = [re.compile(r"_\(\s*'([^']*)'\s*\)"), re.compile(r'_\(\s*"([^"]*)"\s*\)')]
for path in root.rglob('*'):
    if not path.is_file() or path.suffix not in {'.js', '.lua'}:
        continue
    try:
        src = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        continue
    before = src
    scanned += 1
    for pat in patterns:
        def sub(m):
            nonlocal_dummy = None
            global translated
            msg = m.group(1)
            if msg in T:
                translated += 1
                quote = "'" if m.group(0).lstrip().startswith("_( '") else None
                # Keep the exact call style and quote type by replacing group 1 only.
                return m.group(0)[:m.start(1)-m.start(0)] + T[msg] + m.group(0)[m.end(1)-m.start(0):]
            return m.group(0)
        src = pat.sub(sub, src)
    if src != before:
        path.write_text(src, encoding='utf-8')

# Menu files use literal title fields rather than gettext calls in some revisions.
menu_count = 0
for path in root.rglob('*.json'):
    try: src = path.read_text(encoding='utf-8')
    except UnicodeDecodeError: continue
    before = src
    direct = {"Singbox Formula": "订阅转换（Sing-box）", "Tuning Utility": "网络调优工具"}
    for old, new in direct.items():
        src, n = re.subn(r'("(?:title|label|name)"\s*:\s*)"' + re.escape(old) + r'"', lambda m, v=new: m.group(1) + '"' + v + '"', src)
        menu_count += n
    if src != before: path.write_text(src, encoding='utf-8')

print(f"Liquid Formula Chinese patch: scanned {scanned} JS/Lua files, changed {translated} gettext labels, updated {menu_count} menu labels")
if scanned == 0:
    raise SystemExit("ERROR: no JavaScript/Lua view files found in Liquid Formula package")

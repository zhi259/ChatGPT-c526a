# ImmortalWrt 25.12.2 — HiWiFi C526A v11 MT7615 修复保留版在线编译包

本工具包用于 GitHub Actions 在线编译 HiWiFi C526A（极路由 X，Qualcomm IPQ4019，`ipq40xx/generic`）的 ImmortalWrt 25.12.2 固件。本次保持 **v11 版本号**。

> 这是源码与构建工具包，不是已经编译完成的固件。本地仅完成了脚本、文件结构、JSON、Shell 和 JavaScript 静态检查；完整交叉编译必须由 GitHub Actions 执行，实机刷写和无线升级流程仍需在 C526A 上验收。

## 本次 v11 修订内容

### 网络默认值与向导

- 全新默认 LAN 管理地址：`192.168.5.1`，子网掩码 `255.255.255.0`。
- 通过 `config_generate` 将全新默认 LAN 地址设为 `192.168.5.1`；首次初始化/升级迁移脚本会先去掉 CIDR 后缀，再仅将空地址或旧默认 `192.168.1.1`（包括 `192.168.1.1/24`）迁移到 `192.168.5.1`，用户自定义的其他地址不覆盖。
- 快速网络设置向导第二步说明实时读取当前 UCI LAN 地址，动态显示为 `默认管理地址为【当前管理地址】。请确认它与上级路由器的网段不冲突。`；输入框与说明使用同一个规范化地址，只显示纯 IPv4，不显示 `/24`；后台继续写入 `255.255.255.0`。
- 访客 Wi-Fi 新默认 SSID：`HiWiFi-X`。页面读取到已有访客 SSID 时继续显示并保留原名称；只把空配置的默认值和示例改为 `HiWiFi-X`。
- 访客网络仍使用独立 `192.168.6.1/24` 网段、DHCP 和隔离防火墙。默认地址如与上级网络或 LAN 冲突，应在页面中调整。

### Liquid Formula 中文界面与 RPC

- 覆盖用户从当前路由器导出的四个 LuCI 页面：订阅转换主页面、FakeHTTP、FakeSIP、外观与网络调优。
- 同步对应 LuCI 菜单和 rpcd ACL；保留必要技术名称，例如 Liquid Formula、FakeHTTP、FakeSIP、sing-box、TCP Fast Open、NFQUEUE、JSON、URL。
- 固定安装当前导出的 `/usr/libexec/rpcd/liquid_formula` RPC 后端，并显式设置为 `0755`，以免 rpcd 无法执行脚本、未注册 `liquid_formula` ubus 对象。
- 保留 Logo 页面所需的 `customlogo-runtime.js`。
- 页面源文件执行 Node.js 语法检查；构建后再次确认四个页面、菜单、ACL 与可执行 RPC 后端确实进入 rootfs。
- 上游动态返回的运行时错误信息可能含英文；本次重点翻译页面自身的标题、说明、字段、按钮、提示和已纳入页面源码的错误文案。

### C526A 无线与升级保护

- 保留专用 C526A DTS、`board-hiwifi_c526a.qca4019` BDF 以及 `Vfac_mac` MAC 读取修复。
- **恢复此前 v11 曾通过一次正常软重启验证的 `/etc/init.d/mt7615_reboot` 服务**：`STOP=60` 关机阶段尝试卸载 `mt7615e`；`START=99` 启动阶段仅在 PCI 功能缺失时进行最多三次 rescan，并要求 `of_node` 存在才尝试加载驱动。
- 服务日志同时写入 syslog 和 `/overlay/c526a-mt7615-reboot.log`，方便在重启后核对关机卸载和启动检查是否执行。
- **增加 Web/CLI sysupgrade 的 stage2 钩子**：`stage2` 在结束普通用户进程、切换 RAMFS 之前调用 `platform_pre_upgrade`，该钩子只卸载 `mt7615e`。如果模块卸载失败，stage2 会退出，不执行后续 RAMFS/固件写入命令，避免在卸载失败时继续刷写。
- 普通 reboot 与 sysupgrade 是两条不同的关机路径，故分别保留 STOP=60 服务和 stage2 钩子；不依赖普通 init.d STOP 脚本来处理 sysupgrade。
- 今天的手动 `rmmod` 测试是在 MT7615 已经处于 `Firmware is not ready for download` 故障状态后执行；卸载成功再软重启仍失败，不能证明“正常射频运行时关机阶段卸载”无效。两种场景不同，恢复曾经通过一次测试的 STOP=60 服务是有依据的，但仍需多轮实机验证。
- 本版不移植 PandoraBox 专有 MT7615 驱动，不修改 U-Boot/MIBIB，不直接写 `MT_TOP_MISC2`，不切换 GPIO38/39/50，不写 Factory/ART/EEPROM，不强制设置发射功率，也不加入无限 PCIe rescan 或循环重载。

### MT7615E 重启与 sysupgrade 修复路径

普通 reboot 会走 init.d 关机服务；Web sysupgrade 则由 `upgraded` 执行 `/lib/upgrade/stage2`，终止进程后才切换 RAMFS。当前 v11 修订版分别覆盖这两条路径：普通关机执行 `STOP=60` 卸载服务，sysupgrade 在 stage2 的 `platform_pre_upgrade` 位置卸载驱动，并检查返回值。stage2 钩子不调用 `wifi`/ubus，因为此时用户态服务可能已经退出。若卸载失败，stage2 在进入 RAMFS 和固件写入命令前退出。

这两个处理都是针对 MT7615 旧固件状态的规避措施，不是硬件断电复位的等价替代。历史版本曾有一次普通软重启通过记录；本次重新纳入后必须再验证普通 reboot 和 LuCI Web sysupgrade（含不保留配置）两条路径。若冷启动恢复而软重启仍失败，再考虑 PandoraBox 的 MCU restart-handshake 或 U-Boot/PCIe reset 差异，不在本版直接做未经验证的寄存器或 GPIO 操作。

### 内置网络功能与软件包

- PassWall（nftables 透明代理）和 Sing-box 核心集成按 `.config` 内置；Hysteria2 作为 Sing-box 支持的协议使用，不单独宣称已完成设备端连接验证。
- DDNS、IPv6 协议支持、ZeroTier 和 Argon 主题按 `.config` 保留。
- FakeHTTP/FakeSIP 页面与功能由 Liquid Formula 提供；两项辅助功能默认关闭。
- 本包不默认加入 OpenClash；此前 LuCI 菜单显示问题尚未完成单独排查。

### 首页和状态页

- 删除重复的独立无线温度概况卡片及其专用 RPC 后端。
- 保留顶部温度栏和 `/sbin/tempinfo`，只显示实际能从 hwmon 读取到的温度。
- 继续移除 WAN 实时速率重复组件和温度预警/阈值设置插件。

### 软件源

**本次不修改 APK 软件包源。** 保留基础工具包/固件源配置，不加入之前 UI 补丁包中的 `distfeeds.list`，也不对 `argon`、`liquid_formula`、`passwall_luci`、`passwall_packages` 等索引作变更。

## GitHub Actions 在线编译步骤

1. 下载本工具包 ZIP。
2. 打开 GitHub 仓库 `zhi259/ChatGPT-c526a`，将 ZIP 上传到仓库根目录，文件名固定为 `c526a-immortalwrt-kit.zip`。先删除仓库根目录中旧的同名 ZIP，确保根目录只有这一个工具包 ZIP；现有自动解压 workflow 会拒绝多个 ZIP。
3. 推送后，`Unpack C526A kit` 工作流自动解压并提交构建文件。需要仓库已配置 `UNPACK_TOKEN` Secret，且该 Token 有向当前分支写入权限。
4. 解压提交完成后，打开 **Actions**，运行 `ImmortalWrt 25.12.2 - HiWiFi C526A v11 Revision MT7615 Preserve (Chinese UI)`。构建也会在解压文件提交触发后按 workflow 路径规则自动启动。
5. 成功后下载 Artifact：`immortalwrt-v25.12.2-hiwifi-c526a-v11-mt7615-preserve-zhcn`。预期包含 `factory.ubi`、`sysupgrade.bin`、`sha256sums` 和 `source-info.txt`。

如果自动解压没有运行，先检查 `UNPACK_TOKEN`、分支保护规则以及 ZIP 是否在仓库根目录且名称正确。也可以从 Actions 手动运行 `Unpack C526A kit`。

## 刷写与验收注意事项

- 首次安装前备份原厂分区、ART 校准数据和配置；确认设备确实是 HiWiFi C526A。
- 需要验证全新默认 LAN 时，首次安装不要保留旧配置。若保留配置升级，迁移脚本只应把旧默认 `192.168.1.1` 或 `192.168.1.1/24` 改成 `192.168.5.1`，不应覆盖自定义网段；快速设置向导的说明文字应实时显示当前 LAN 地址。
- 本版重新启用 MT7615E 普通重启 STOP=60 服务，并加入 stage2 sysupgrade 卸载钩子。必须分别测试普通 reboot 与 LuCI Web sysupgrade；两者走不同路径。
- 升级后检查：

```sh
ls -l /usr/libexec/rpcd/liquid_formula
ubus list | grep liquid_formula
ubus -v list liquid_formula
ubus call liquid_formula status '{}'

dmesg | grep -iE 'C526A:|mt7615|N9 Firmware|CR4 Firmware|Firmware is not ready' | tail -n 100
ls -l /etc/init.d/mt7615_reboot /etc/rc.d/K60mt7615_reboot /etc/rc.d/S99mt7615_reboot
cat /overlay/c526a-mt7615-reboot.log 2>/dev/null
iwinfo phy0-ap0 info
```

- 正常情况下 RPC 文件权限为 `-rwxr-xr-x`，`ubus list` 可见 `liquid_formula`，状态调用返回 JSON。无线测试需记录普通 reboot 和 Web sysupgrade 两种路径的区别。
- 编译成功不等于硬件验证完成。必须分别检查 2.4 GHz、5 GHz-A、5 GHz-B 无线连接、访客网络隔离、LAN/WAN、温度显示、LuCI 页面和软件包清单。

## 目录说明

- `.config`：固件目标与内置软件包配置。
- `files/`：C526A DTS、无线 MAC 修复和 MT7615 关机服务源码。
- `patches/`：设备树注册补丁。
- `rootfs-overlay/`：向导、访客网络、Liquid Formula 页面与 RPC 后端、温度工具、MT7615 stage2 钩子及默认配置。
- `scripts/build.sh`：在线源码获取、feeds 配置、设备移植、编译和镜像检查。
- `scripts/validate-kit.sh`：编译前静态检查。
- `.github/workflows/`：自动解压与在线编译工作流。

## 上游来源

- ImmortalWrt：`https://github.com/immortalwrt/immortalwrt/tree/v25.12.2`
- C526A 设备支持参考：`https://github.com/coolsnowwolf/lede/commit/2f74b3efffd5b1929d5a31d76e763b927aebf759`
- Liquid Formula：`https://github.com/crackerfly/SingBox-Formula`
- PassWall：`https://github.com/Openwrt-Passwall/openwrt-passwall` 与 `https://github.com/Openwrt-Passwall/openwrt-passwall-packages`
- Argon：`https://github.com/jerrykuku/luci-theme-argon`，tag `v3.1.0`

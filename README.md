# ImmortalWrt 25.12.2 — HiWiFi C526A v11 修订版在线编译包

本工具包用于 GitHub Actions 在线编译 HiWiFi C526A（极路由 X，Qualcomm IPQ4019，`ipq40xx/generic`）的 ImmortalWrt 25.12.2 固件。本次保持 **v11 版本号**，不是 v12。

> 这是源码与构建工具包，不是已经编译完成的固件。本地仅完成了脚本、文件结构、JSON、Shell 和 JavaScript 静态检查；完整交叉编译必须由 GitHub Actions 执行，实机刷写和无线升级流程仍需在 C526A 上验收。

## 本次 v11 修订内容

### 网络默认值与向导

- 全新默认 LAN 管理地址：`192.168.5.1`，子网掩码 `255.255.255.0`。
- 首次初始化/升级迁移脚本只在 LAN 地址为空或仍为旧默认 `192.168.1.1` 时迁移到 `192.168.5.1`；用户已经自定义的其他 LAN 地址不覆盖。
- 快速网络设置向导说明使用简洁文案：`默认管理地址为 192.168.5.1。请确认它与上级路由器的网段不冲突。` 输入框只填写 IPv4 地址，`/24` 不需要用户填写；后台继续写入 `255.255.255.0`。
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
- BDF 必须为 24,300 字节，Git blob SHA-1 必须为 `ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a`，否则构建失败。
- 保留 `/etc/init.d/mt7615_reboot` 普通软重启处理：关机阶段尝试卸载 MT7615E，启动阶段只进行有限次数 PCI 检查/恢复，不进行校准数据写入。
- 保留 Web/CLI sysupgrade 前的 MT7615E 预卸载钩子。只处理 `radio0`/`mt7615e`，不关闭两个 5 GHz radio；卸载失败时中止升级，不继续刷写。
- 不写 Factory、ART、EEPROM，不强制设置发射功率，不加入无限 PCIe rescan 或循环重载。

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
4. 解压提交完成后，打开 **Actions**，运行 `ImmortalWrt 25.12.2 - HiWiFi C526A v11 Revision (Chinese UI)`。构建也会在解压文件提交触发后按 workflow 路径规则自动启动。
5. 成功后下载 Artifact：`immortalwrt-v25.12.2-hiwifi-c526a-v11-revision-zhcn`。预期包含 `factory.ubi`、`sysupgrade.bin`、`sha256sums` 和 `source-info.txt`。

如果自动解压没有运行，先检查 `UNPACK_TOKEN`、分支保护规则以及 ZIP 是否在仓库根目录且名称正确。也可以从 Actions 手动运行 `Unpack C526A kit`。

## 刷写与验收注意事项

- 首次安装前备份原厂分区、ART 校准数据和配置；确认设备确实是 HiWiFi C526A。
- 需要验证全新默认 LAN 时，首次安装不要保留旧配置。若保留配置升级，迁移脚本只应把旧默认 `192.168.1.1` 改成 `192.168.5.1`，不应覆盖自定义网段。
- Web/CLI sysupgrade 的 MT7615E 预卸载钩子来自 ImmortalWrt 25.12.2 `/sbin/sysupgrade` 的精确锚点补丁，但仍需下一次 C526A Web 升级实测；升级前保留有线管理连接。
- 升级后检查：

```sh
ls -l /usr/libexec/rpcd/liquid_formula
ubus list | grep liquid_formula
ubus -v list liquid_formula
ubus call liquid_formula status '{}'

logread | grep -i c526a-sysupgrade
dmesg | grep -iE 'mt7615|N9 Firmware|CR4 Firmware|Firmware is not ready' | tail -n 60
iwinfo phy0-ap0 info
```

- 正常情况下 RPC 文件权限为 `-rwxr-xr-x`，`ubus list` 可见 `liquid_formula`，状态调用返回 JSON；MT7615E 在 sysupgrade 后应正常初始化并有实际信道。
- 编译成功不等于硬件验证完成。必须分别检查 2.4 GHz、5 GHz-A、5 GHz-B 无线连接、访客网络隔离、LAN/WAN、温度显示、LuCI 页面和软件包清单。

## 目录说明

- `.config`：固件目标与内置软件包配置。
- `files/`：C526A DTS、无线 MAC 与关机处理源码。
- `patches/`：设备树注册补丁。
- `rootfs-overlay/`：向导、访客网络、Liquid Formula 页面与 RPC 后端、温度工具、升级辅助脚本。
- `scripts/build.sh`：在线源码获取、feeds 配置、设备移植、编译和镜像检查。
- `scripts/validate-kit.sh`：编译前静态检查。
- `.github/workflows/`：自动解压与在线编译工作流。

## 上游来源

- ImmortalWrt：`https://github.com/immortalwrt/immortalwrt/tree/v25.12.2`
- C526A 设备支持参考：`https://github.com/coolsnowwolf/lede/commit/2f74b3efffd5b1929d5a31d76e763b927aebf759`
- Liquid Formula：`https://github.com/crackerfly/SingBox-Formula`
- PassWall：`https://github.com/Openwrt-Passwall/openwrt-passwall` 与 `https://github.com/Openwrt-Passwall/openwrt-passwall-packages`
- Argon：`https://github.com/jerrykuku/luci-theme-argon`，tag `v3.1.0`

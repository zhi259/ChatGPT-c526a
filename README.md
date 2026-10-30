# ImmortalWrt 25.12.2 — HiWiFi C526A v11 Wireless Validation build kit

本工具包面向极路由 X C526A（Qualcomm IPQ4019，`ipq40xx/generic`），基于 ImmortalWrt `v25.12.2` / Linux 6.12。它是用于 GitHub Actions 编译最终镜像的源码工具包；本地没有完成完整交叉编译，因此不能把它当成已编译固件。

## v10 基础与 v11 改动记录

GitHub Actions 曾连续报告向导的 Makefile 虽然存在，但 `luci-app-c526a-wizard` 未进入 `tmp/.packageinfo`，导致 `make defconfig` 删除对应配置项。C526A 快速设置向导和访客 Wi-Fi 仅包含 LuCI JavaScript 页面、菜单和 ACL JSON，不需要单独编译成软件包。本版通过 OpenWrt 标准 `files/` rootfs overlay 安装这些文件；无线温度继续由顶部温度栏读取 `/sbin/tempinfo`，不再安装重复的独立概况温度卡片或专用温度 RPC 后端。

## 原有功能与本次界面调整

- 移除概览页重复的独立「无线温度」板块；保留现有顶部温度栏使用的 `/sbin/tempinfo`，继续显示能够从 hwmon 正常读取的 MT7615E 2.4 GHz 与两颗 QCA4019 5 GHz 温度。温度预警/阈值设置插件与 WAN 实时速率组件继续移除。
- 默认首次启动 LAN 地址改为 `192.168.5.1/24`，DHCP 默认池沿用 ImmortalWrt 默认值；用户已经自定义的非默认 LAN 地址不会被覆盖。
- 首次启动安全补齐 LAN→WAN 转发和 WAN masquerading 设置，以避免路由器本机能上网、LAN 客户端却不能上网的常见配置问题。
- 保留 Linux 6.12 DSA 的 `lan2`、`lan3`、`lan4` 与 `wan` 接口映射、MAC/校准数据处理、专用 QCA4019 BDF 校验和 NAND sysupgrade 支持。

- 保留 `/sbin/tempinfo` 只读诊断命令，按设备路径输出可读取的无线温度；它只读取 hwmon，不重启驱动、不修改校准数据。
- 增加启动期 MT7615E 检查：仅在 PCI 设备缺失时有限次数 rescan；仅在 `of_node` 存在时尝试加载驱动，不执行无条件 `rmmod`。
- 首次初始化时，若 radio1 仍使用会导致 AP 启动失败的默认信道 100，则自动改为实机验证可用的 149（VHT80）；已有其他信道设置不会被覆盖。
- 菜单和页面标题改为「快速设置向导」与「访客 Wi-Fi」，移除前缀 `C526A`。
- Liquid Formula LuCI 界面增加常用标签的简体中文替换，并附带《Liquid Formula 使用说明》安装到 `/usr/share/doc/c526a/`。上游未覆盖到的新增提示文字仍可能保留英文。
- 新增中文「网络 → 快速设置向导」：可一次配置 WAN（DHCP/PPPoE/静态 IPv4）、LAN 管理地址和 2.4/5 GHz Wi-Fi；应用前校验输入并提示 LAN 地址变化会断开当前会话。
- 新增中文「网络 → 访客 Wi-Fi」：可分别在 2.4 GHz 与两颗 5 GHz 无线模块启用访客 SSID，自动配置独立的 `guest` IPv4 子网、DHCP、访客防火墙区与仅 `guest → wan` 转发；默认拒绝访客访问路由器管理服务及主 LAN，并开启无线客户端隔离。
- 维持 PassWall（nftables）配置、Go 1.26 可构建的 Xray-core 版本固定、Argon 主题及简体中文语言包，并增加构建后关键软件包清单检查。

## 使用方式

1. 解压 ZIP，检查里面的顶层目录 `c526a-immortalwrt-kit/`。
2. 将 ZIP 上传到现有 GitHub 仓库根目录并命名为 `c526a-immortalwrt-kit.zip`（替换原同名 ZIP）；当前仓库的 `unpack-c526a-kit.yml` 会把目录内容解压/提交。
3. 等解压工作流完成后，打开 Actions，手动运行 **ImmortalWrt 25.12.2 - HiWiFi C526A v11 Wireless Validation**。如果解压后的 `.config`、`files/`、`scripts/` 已提交，路径触发也会自动启动构建。
4. 等 Actions 完成后下载 Artifact `immortalwrt-v25.12.2-hiwifi-c526a-v11-wireless-validation`。成功的 Artifact 应包含 `factory.ubi`、`sysupgrade.bin`、`sha256sums` 和 `source-info.txt`。
5. 首次刷机前备份原厂分区、ART 校准数据和配置；首次安装与系统内升级请使用正确的镜像格式。若要验证全新 LAN 默认配置，升级时不要保留旧设置。


## 已刷机设备的即时修复（不必重新编译）

若已刷入旧版 v9，可将 `scripts/fix-running-router.sh` 复制到路由器后以 root 执行；它会修正 `/sbin/tempinfo`、移除菜单标题前缀，并且仅在 radio1 仍为已知失败的信道 100 时切换到 149。执行后请硬刷新浏览器。脚本不改变 LAN 地址，也不会刷写固件。

```sh
scp scripts/fix-running-router.sh root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'sh /tmp/fix-running-router.sh'
```

如果路由器管理地址不同，请把命令中的 `192.168.1.1` 换成当前地址。

## 顶部温度栏

保留固件现有顶部温度栏的数据来源 `/sbin/tempinfo`。该脚本按设备路径读取 hwmon 中实际可用的无线温度：MT7615E 2.4 GHz 与两颗 QCA4019 5 GHz 模块。v11 删除 v10 额外增加的独立「无线温度」概况板块、对应 LuCI JavaScript 和 rpcd 后端，避免同一组温度重复显示。若 2.4 GHz 温度缺失，应先检查 `mt7615_phy0` 与 MT7615E 初始化状态，而不是新增另一个界面组件。
## 快速网络设置向导

首次登录后，打开「网络 → 快速设置向导」即可完成基础设置：

1. 选择上网方式：DHCP 自动获取、PPPoE 宽带拨号或静态 IPv4。PPPoE 需填写运营商提供的账号/密码；静态地址需填写 WAN IP、掩码、网关和至少一个 DNS（默认建议值为 `1.1.1.1 8.8.8.8`，可自行修改）。
2. 设置 LAN 管理地址，默认 `192.168.5.1`。应用后当前浏览器会话可能断开，请切换到新地址。
3. 设置 2.4 GHz 与 5 GHz Wi-Fi 名称，并设置至少 8 位的 WPA2-PSK 密码。两个 5 GHz 模块采用相同的名称与密码；信道、带宽和功率不由向导修改。
4. 点击「保存并应用全部设置」，按 LuCI 提示确认应用。若静态 WAN 或 PPPoE 信息错误，可能导致无法上网，需要通过 LAN 重新进入向导修正。

向导是手动进入的配置页面，不会在每次启动时强制弹出；它仅配置 C526A 固件现有的 `wan`、`lan` 与三组无线 UCI 配置，不提供 Asus 原厂固件的所有诊断与自动探测功能。

## 访客 Wi-Fi

进入 LuCI「网络 → 访客 Wi-Fi」，启用访客无线网络后，设置 SSID、WPA2 密码并选择要广播的无线模块。首次启用时必须输入 8–63 位可打印 ASCII 密码；后续如果不修改密码，密码框可以留空。

默认访客网关是 `192.168.6.1/24`，DHCP 地址池为 `192.168.6.100–192.168.6.249`。如果主 LAN 或上级网络也使用 `192.168.6.0/24`，请先改访客网关为其他不冲突网段。应用时会创建或更新空桥 `br-guest`、DHCP 与防火墙配置：访客侧默认 `input=REJECT`、`forward=REJECT`，只放行 IPv4 DNS/DHCP 到路由器，并允许访客转发到 WAN；不会创建访客到 LAN 的转发。无线客户端隔离同时开启。

关闭「启用访客 Wi-Fi」会关闭三个访客 SSID 的广播并停用访客 DHCP 服务；访客接口和防火墙规则会保留，方便以后重新启用。该功能的安全性依赖实际生成的防火墙规则，构建成功后仍建议用访客设备验证其无法访问 `192.168.5.1` 与其他 LAN 设备，但能正常获取地址、解析 DNS 和访问互联网。

## 网络与默认地址

- LAN：`lan2`、`lan3`、`lan4`；WAN：`wan`。请实机逐一插拔网线确认机壳端口对应关系。
- 全新默认管理地址：`http://192.168.5.1/`，LAN 网段 `192.168.5.0/24`。
- 首次启动脚本会在仅存在默认地址 `192.168.1.1`（或未设置）时改为 `192.168.5.1`，并确保标准 LAN→WAN 转发与 WAN NAT。已有非默认 LAN 地址会保留。
- 若 WAN 与上游网络都使用 `192.168.5.0/24`，请先更换其中一个网段，避免子网冲突。
- 内核里没有暴露 IPQ4019 CPU/SoC 温度传感器接口时，温度组件不会虚构 CPU 温度，只显示实际可读的无线模块温度。

## Liquid Formula 中文快速指南

完整说明随固件安装于 `/usr/share/doc/c526a/Liquid-Formula-zh-CN.md`，工具包内也可直接查看 `docs/Liquid-Formula-zh-CN.md`。简单流程：进入 **服务 → Liquid Formula → 订阅转换（Sing-box）**，填写订阅地址、设置访问密码、选择模板、启用并保存；刷新订阅并检查生成的 JSON；确认后更新输出文件。此程序不运行 sing-box 本身，需由兼容的 sing-box 运行时使用生成文件。FakeHTTP / FakeSIP 默认关闭，错误的 NFQUEUE 或 mark/mask 规则可能影响网络，请不要未经测试就启用。

## 版本与构建检查

- C526A 专用 QCA4019 BDF 必须为 24,300 字节，且 Git blob SHA-1 为 `ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a`；不一致即让构建失败。
- v25.12.2 的 PassWall Xray-core 固定为 `26.7.28`，SHA-256 为 `a9afe86349c7bd3e6cae60125e62a5ada09d102e1a2760623e77c24a84dbfb46`，以兼容当期 Go 1.26.x 工具链。
- 最终构建会检查关键包出现在固件 manifest，并要求同时生成 `factory.ubi` 和 `sysupgrade.bin`；编译完成后还会检查顶部温度摘要 `/sbin/tempinfo` 与访客 Wi-Fi 页面确实存在于镜像 rootfs，并确认重复的独立无线温度板块及其 RPC 后端未被打入固件。构建 Artifact 还包含 Liquid Formula 的启发式未翻译字符串审计报告。

## 上游依据

- Device-support commit: <https://github.com/coolsnowwolf/lede/commit/2f74b3efffd5b1929d5a31d76e763b927aebf759>
- Target source tag: <https://github.com/immortalwrt/immortalwrt/tree/v25.12.2>


## v5 功能包扩展（ImmortalWrt 25.12.2 / APK）

本版 `.config` 增加：

- PassWall（nftables 透明代理后端），从 Openwrt-Passwall 的 `openwrt-passwall` 与 `openwrt-passwall-packages` feeds 获取；预选 Sing-Box、Xray、Geoview、V2ray geodata、ShadowsocksR client、Simple Obfs 和 V2ray Plugin。
- FakeHTTP 与 FakeSIP：通过 `crackerfly/SingBox-Formula` 的 `openwrt-feed` 编译 `liquid-formula` 与 `luci-app-liquid-formula`，二者均默认关闭，需要进入 LuCI 的 Services → Liquid Formula 分别启用。
- Argon 3.1.0 主题：`luci-theme-argon`，设置页已集成在主题中，不再选择旧版单独的 `luci-app-argon-config`。同时选择简体中文翻译。
- ZeroTier、常用 LuCI 插件，以及 NFQUEUE / nftables 依赖。

`build.sh` 会在 `scripts/feeds update -a` 之前把以上 feeds 加到 `feeds.conf.default`。PassWall 与外部包源随远端 main 更新，首次构建会验证包目录确实存在；仍需在 GitHub Actions 实际构建中验证所有依赖能否编译通过。FakeHTTP/FakeSIP 是 NFQUEUE 流量混淆辅助工具，不是 VPN、代理或加密层。

## GitHub Actions 触发范围

`build-c526a.yml` 使用 `push.branches: [main]` 和 `push.paths` 白名单：仅 `.config`、`files/**`、`rootfs-overlay/**`、`patches/**`、`scripts/**`、`package/**`、`packages/**`，以及它自己的工作流文件变化会触发固件编译。只修改 `README.md`、`SOURCE.md` 或 ZIP 不会直接触发编译；由 `unpack-c526a-kit.yml` 解压后提交 `.config` / `scripts` 等构建文件时，才会触发编译。

自动解压工作流只监听仓库根目录的固定名称 `c526a-immortalwrt-kit.zip`。这样别的 ZIP 文件上传不会触发解压。固件工作流还可以在 Actions 页面用 `workflow_dispatch` 手动运行。

## PassWall kernel-module dependencies

The image config explicitly enables `kmod-nft-socket`, `kmod-nft-tproxy`, their `kmod-nf-socket` / `kmod-nf-tproxy` dependencies, plus `kmod-tun`, `kmod-inet-diag`, and `kmod-netlink-diag` for the selected PassWall cores. `scripts/build.sh` checks after `make defconfig` that these selections survive. Keep these kernel modules in the same image as the custom kernel; do not install kmods from a different build's feed, even if the displayed kernel version number looks identical, because kernel ABI hashes can differ.
### 向导的安装方式（overlay）

为避免重复触发 OpenWrt 包索引问题，C526A 快速设置向导、访客 Wi-Fi 页面、概览无线温度页面、rpcd 后端、LuCI 菜单和 ACL 统一放入 `rootfs-overlay/`，由标准 rootfs `files/` 机制安装，不再定义或选择 `luci-app-c526a-wizard` 这个独立 APK 包。温度概况页面也是 overlay 文件，不依赖独立温度预警 APK。


## v10 实机验证与 v11 变更

- MAC 读取已在 v10 实机确认正常，统一使用 `mtd_get_mac_ascii bdinfo "Vfac_mac"`，不带尾随空格。
- v10 实机 `/sys/bus/pci/devices/0000:01:00.0/of_node` 指向 `.../pcie@40000000/pcie@0/wifi@0,0`；DTS `reg` 对应 PCI BDF `0000:01:00.0`。`mediatek,mtd-eeprom` phandle `0x14` 已确认指向 Factory 分区 `partition@1c0000`，偏移为 0，Factory 开头为 `15 76 ...`。这确认设备树引用关系，但尚未直接读取驱动最终使用的 EEPROM 缓冲区。
- v10 的 MT7615 重启服务已通过一次正常软重启测试：持久日志记录关机阶段成功卸载 `mt7615e`，启动阶段重新绑定成功，内核出现 N9/CR4 firmware version，2.4 GHz 恢复在信道 1；未再次出现 `Firmware is not ready for download`。一次通过不等于长期稳定性保证，建议按无线测试指南继续重复验证。
- 断电恢复后，`mt7615_phy0` hwmon 读数为 31°C；软重启失败时该温度输入为空。当前保留顶部温度栏的 `/sbin/tempinfo`，不再额外安装 v10 重复增加的独立「无线温度」概况板块及其 RPC 后端。
- MT7615 关机阶段尝试卸载 `mt7615e`，不写 Factory/ART/EEPROM，也不设置发射功率。启动阶段只对缺失的 PCI 设备做有限次数 rescan，并要求 `of_node` 存在才尝试加载驱动。
- Liquid Formula 翻译脚本覆盖词典中的 UI 字符串，并生成启发式待翻译报告；由于上游 `main` 分支可更新，尚不能保证所有新增字符串均已汉化。
- v11 未在本环境完成完整交叉编译；GitHub Actions 成功与固件刷机测试后，才能确认 v11 镜像和新增 UI 清理正常。
- WAN DHCP 曾因网线两端接触问题未获地址；重新插接后恢复，现阶段不改 WAN、DSA/VLAN 或防火墙配置。


## v11 无线稳定性与速率测试

正式刷写前/后建议按 `docs/C526A-wireless-test.md` 分别隔离并测试 MT7615E 2.4 GHz（`phy0`）、QCA4019 5 GHz（`phy1`，默认信道 149）和 QCA4019 5 GHz（`phy2`，默认信道 36）。测试时用有线 LAN 设备运行 `iperf3 -s`，无线客户端连接后运行 TCP 正向/反向吞吐与本地网关 ping；路由器端用 `iw dev <无线接口> station dump` 确认客户端实际关联到目标 PHY。

> **v4 紧急修复：** 修复专用 QCA4019 BDF 没有进入最终根文件系统的问题。构建会验证 `board-2.bin` 的存在、大小和 SHA-1，不符合时直接失败。

> **以太网修正版（v2）：** 本工具包针对 ImmortalWrt 25.12.2 / Linux 6.12 的 DSA 网络栈。旧 DTS 使用的 `ess-switch@c000000` / `edma@c080000` 不再对应当前内核中的真实节点；修正版改用 `&switch` / `&gmac`，并显式启用交换机端口。默认将原版定义中的端口 2–4 用作 LAN，并将端口 5 暴露为 WAN。端口映射仍需在实际设备上插拔网线验证。

# ImmortalWrt v25.12.2 — HiWiFi C526A build kit

本模板把 LEDE `2f74b3efffd5b1929d5a31d76e763b927aebf759` 中的极路由 X C526A（Qualcomm IPQ4019 / ipq40xx）支持移植到 ImmortalWrt `v25.12.2`，并由 GitHub Actions 编译 `factory.ubi` 与 `sysupgrade.bin`。

## 包含内容

- Linux 6.12 路径的 C526A DTS 和 DTB 构建补丁。
- `image/generic.mk` 中的 `Device/hiwifi_c526a`，由 `Device/UbiFit` 生成 `factory.ubi`。
- ipq-wifi board package 注册；从原始 LEDE commit 下载 BDF，并校验 Git blob SHA-1 `ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a`。
- LAN/WAN 交换机映射、MAC 地址、ath10k 校准、Wi-Fi MAC 热插拔、MT7615 关机卸载和 NAND sysupgrade 处理。
- `.config` 中的 `CONFIG_TARGET_ipq40xx_generic_DEVICE_hiwifi_c526a=y` 设备选择。
- `.github/workflows/build-c526a.yml` GitHub Actions 构建模板。

## 使用方式

1. 将本目录的内容放进一个新的 GitHub 仓库根目录；保留 `.github/` 隐藏目录。
2. 在仓库 `Actions` 页面启用工作流。
3. 选择 `ImmortalWrt 25.12.2 - HiWiFi C526A`，点击 `Run workflow`。
4. 成功后从 Actions 的 Artifacts 下载 `immortalwrt-v25.12.2-hiwifi-c526a`，其中应包含 `*hiwifi_c526a*factory.ubi` 和 `*hiwifi_c526a*sysupgrade.bin`。

脚本会克隆固定 tag `v25.12.2`，应用设备定义，下载并验证 BDF，随后运行 `make defconfig`、`make download` 和 `make`。脚本可重复执行，不会重复添加设备定义。

## 针对无线上网正常、所有网口均无链路的修正

如果刷入旧版模板后，`eth0`、`eth1` 均显示未连接，且日志没有 MDIO/PHY/IPQESS 初始化信息，说明只调整 `/etc/config/network` 并不够。Linux 6.12 的 IPQ4019 DSA 需要启用内核 `707-arm-dts-ipq4019-add-switch-node.patch` 定义的 `&switch` 与 `&gmac` 节点；本工具包已移除旧的 `ess-switch@c000000` / `edma@c080000` 节点，改为启用 DSA 交换机及外部端口。板级网络默认使用 `lan2 lan3 lan4` 和 `wan`，不再产生旧 `switch0` / `switch_vlan` 配置。

若设备已有旧配置，sysupgrade 可能保留 `/etc/config/network`，造成旧 `eth0` / `eth1` 配置仍在。刷入修正版时请先备份配置，并在 LuCI 中取消“保留设置”（或使用全新配置）进行验证。刷机后先运行 `ip link show`（BusyBox 的 `ip -br link` 不一定受支持），确认是否出现 `lan2`、`lan3`、`lan4`、`wan`。物理端口映射尚需根据实际设备插拔网线确认。

工具包也会在 `Vfac_mac` 读取结果不是合法 MAC 地址时跳过覆盖，避免生成 `option macaddr ':'`；这不能替代对设备 `bdinfo` 分区中实际 MAC 存储格式的核查。

## 无线校准数据修正（v4）

C526A DTS 为两组 QCA4019 射频声明 `qcom,ath10k-calibration-variant = "C526A"`。原始 LEDE 支持提交里的 `board-hiwifi_c526a.qca4019` 专用 BDF 为 24,300 字节。用户刷入 v3 后，两个 ath10k 都报 `failed to fetch board-2.bin or board.bin`，而 `/lib/firmware/ath10k/QCA4019/hw1.0/` 仅有 `firmware-5.bin`。这证明 v3 的构建脚本把本地 BDF 放进 `package/firmware/ipq-wifi/files/`，却没有复制到该包的 `PKG_BUILD_DIR`，导致专用包虽然存在，最终镜像却没有 `board-2.bin`。

v4 修复 `package/firmware/ipq-wifi/Makefile` 的 `Build/Prepare`，在默认解包/打补丁后将本地 `board-hiwifi_c526a.qca4019` 复制到 `$(PKG_BUILD_DIR)`，供 `install-overlay` 的 `wildcard board-hiwifi_c526a.*` 匹配。设备仍排除通用 `ath10k-board-qca4019`，并保留专用 `ipq-wifi-hiwifi_c526a` 和标准（非 CT）ath10k 固件。构建结束时新增检查：若根文件系统缺少 `board-2.bin`、大小不是 24,300 字节或 Git blob SHA-1 与原始文件不符，构建将失败，而不是再次产出两组 QCA4019 都无法启动的固件。

## 重要风险提醒

- 原始支持说明明确指出此布局不支持 pbboot，且 UBI 占用 NAND 全部 128 MiB。刷写前应确认设备有可用的串口/救砖方式，并备份原厂分区与校准数据；选错设备镜像可能导致变砖。
- 本模板请求的是 `factory.ubi`。不要把它误当作原厂升级包；`sysupgrade.bin` 才是 OpenWrt 系统内升级使用的格式。
- 本地环境没有执行完整 ImmortalWrt 交叉编译，因此交付的是移植与 CI 构建模板，而不是已经编译、实机测试过的固件。首次 Actions 运行是必要的构建验证。

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

`build-c526a.yml` 使用 `push.branches: [main]` 和 `push.paths` 白名单：仅 `.config`、`files/**`、`patches/**`、`scripts/**`、`packages/**`（如将来添加本地包）、以及它自己的工作流文件变化会触发固件编译。只修改 `README.md`、`SOURCE.md` 或 ZIP 不会直接触发编译；由 `unpack-c526a-kit.yml` 解压后提交 `.config` / `scripts` 等构建文件时，才会触发编译。

自动解压工作流只监听仓库根目录的固定名称 `c526a-immortalwrt-kit.zip`。这样别的 ZIP 文件上传不会触发解压。固件工作流还可以在 Actions 页面用 `workflow_dispatch` 手动运行。

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

## 重要风险提醒

- 原始支持说明明确指出此布局不支持 pbboot，且 UBI 占用 NAND 全部 128 MiB。刷写前应确认设备有可用的串口/救砖方式，并备份原厂分区与校准数据；选错设备镜像可能导致变砖。
- 本模板请求的是 `factory.ubi`。不要把它误当作原厂升级包；`sysupgrade.bin` 才是 OpenWrt 系统内升级使用的格式。
- 本地环境没有执行完整 ImmortalWrt 交叉编译，因此交付的是移植与 CI 构建模板，而不是已经编译、实机测试过的固件。首次 Actions 运行是必要的构建验证。

## 上游依据

- Device-support commit: <https://github.com/coolsnowwolf/lede/commit/2f74b3efffd5b1929d5a31d76e763b927aebf759>
- Target source tag: <https://github.com/immortalwrt/immortalwrt/tree/v25.12.2>

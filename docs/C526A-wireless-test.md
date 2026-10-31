# C526A 三组无线的稳定性与吞吐测试

本指南对应 C526A 三个独立 PHY：

- `phy0-ap0`：MT7615E 2.4 GHz，当前配置预期信道 1 / HT20。
- `phy1-ap0`：QCA4019 5 GHz 无线模块 1，当前配置预期信道 149 / VHT80。
- `phy2-ap0`：QCA4019 5 GHz 无线模块 2，当前配置预期信道 36 / VHT80。

当前 v10 管理地址是 `192.168.1.1`；v11 默认目标地址为 `192.168.5.1`。测试时请以路由器实际 LAN 地址为准。

## 1. 准备有线 iperf3 服务端

准备一台电脑通过网线连接 C526A 的 LAN 口，关闭这台电脑的 Wi-Fi，确保它通过有线 LAN 与无线测试客户端处于同一个 LAN。在 macOS 上可用 `brew install iperf3` 安装；Linux 按发行版包管理器安装。安装 iperf3 后运行：

```sh
iperf3 -s
```

记录这台有线电脑的 LAN IPv4 地址，例如 `192.168.1.100`。允许本机防火墙接收 TCP/UDP 5201 端口。

再准备另一台支持 iperf3 的电脑或手机作为无线客户端。无线客户端必须连接到 C526A，不能同时走蜂窝网络或其他 Wi-Fi。管理用 SSH 请始终通过有线 LAN 电脑进行；切换关闭 radio 时，连在 Wi-Fi 上的管理会话会断开。

## 2. 临时给三个 PHY 设置不同的测试 SSID

三个模块当前可能使用相同 SSID，客户端可能自动漫游到其他频段。为了不关闭任何 radio，建议只临时修改三个主 Wi-Fi 接口的 SSID，保留原有加密方式和密码。先通过有线 LAN 的 SSH 会话备份配置：

```sh
cp -p /etc/config/wireless /root/wireless.before-c526a-test
uci show wireless | grep -E '=wifi-iface|\.device=|\.ssid='
```

确认主无线接口 section 名称是 `default_radio0`、`default_radio1`、`default_radio2`，分别对应 radio0/phy0、radio1/phy1、radio2/phy2。若名称不同，先停止并把 `uci show wireless` 输出发回，不要猜 section 名称。

确认无误后运行：

```sh
uci set wireless.default_radio0.ssid='C526A-test-24G'
uci set wireless.default_radio1.ssid='C526A-test-5G-A'
uci set wireless.default_radio2.ssid='C526A-test-5G-B'
uci commit wireless
wifi reload
sleep 30
```

三个 radio 都保持启用，只是 SSID 临时区分。使用原有 Wi-Fi 密码连接对应测试 SSID。若无线客户端连不上，先用有线 SSH 确认加密配置没有改变，不要恢复出厂设置。

## 3. 验证客户端确实连在目标 PHY

客户端连接测试 SSID 后，在路由器上执行对应命令：

```sh
# 2.4 GHz
iw dev phy0-ap0 station dump

# 5 GHz 模块 1
iw dev phy1-ap0 station dump

# 5 GHz 模块 2
iw dev phy2-ap0 station dump
```

输出中应看到无线客户端的 MAC、`signal`、`tx bitrate`、`rx bitrate`。如果没有客户端记录，说明客户端没有关联到这个 PHY，先不要记录该组测试成绩。

RSSI 可作粗略参考：约 -50 至 -60 dBm 通常信号较强；-60 至 -67 dBm 通常较好；-67 至 -72 dBm 开始受环境影响；低于 -75 dBm 往往较弱。实际体验还取决于干扰、客户端天线和信道占用，不要只按单个 RSSI 数字判断。

## 4. 稳定性测试：本地网关 ping

无线客户端先 ping 路由器 LAN 地址，当前 v10 通常是 `192.168.1.1`；若已升级且地址已迁移，则使用 `192.168.5.1`。

macOS / Linux：

```sh
ping -c 300 192.168.1.1
```

Windows：

```bat
ping -n 300 192.168.1.1
```

每个 PHY 至少测试 5 分钟；建议在近距离（约 2–3 米、无遮挡）和日常使用位置各测一次。近距离本地 LAN ping 应尽量做到 0% 丢包，不应频繁出现数百毫秒的延迟尖峰。互联网 ping 受 WAN 与运营商影响，不能替代本地网关 ping。

## 5. 吞吐测试：iperf3 TCP 正向和反向

无线客户端连接到目标 PHY 并确认 station dump 后，运行：

```sh
iperf3 -c 192.168.1.100 -t 60 -P 4
iperf3 -c 192.168.1.100 -t 60 -P 4 -R
```

将 `192.168.1.100` 替换为有线 iperf3 服务端实际地址。第一条测无线客户端向有线服务端发送；第二条 `-R` 测有线服务端向无线客户端发送。每个 PHY 各运行两次，记录第二次结果，避免刚连接时的速率波动影响结论。

对比三组结果时，保持客户端、位置、距离和服务端不变。2.4 GHz HT20 与 5 GHz VHT80 的预期吞吐不同；客户端是 1x1 还是 2x2、支持的 Wi-Fi 代际和信道拥挤程度也会明显影响结果，因此不要用一个固定 Mbps 数值作为所有设备的硬性通过线。

## 6. 负载下稳定性（可选）

TCP 吞吐运行期间，同时持续 ping 路由器 LAN 地址。如果空闲时无丢包，而满负载时延迟大幅上升，可进一步检查无线信道占用、客户端性能和队列管理。不要把互联网测速站结果当作纯无线吞吐；WAN 带宽会形成额外瓶颈。

可选 UDP 测试应从较低码率开始，避免人为把链路打满：

```sh
iperf3 -c 192.168.1.100 -u -b 10M -t 60
```

观察 `Lost/Total Datagrams`、丢包率和 jitter；确认稳定后再逐步提高目标码率。UDP 设定码率不是设备真实吞吐上限。

## 7. 恢复原有 SSID 和无线配置

完成三个 PHY 测试后，必须恢复原配置：

```sh
cp -p /root/wireless.before-c526a-test /etc/config/wireless
wifi reload
sleep 30
iw dev
iwinfo
```

确认三个 PHY 都重新出现、原 SSID 与密码设置恢复原样。不要忘记这一步。

## 8. 普通软重启与 Web 固件升级对照

本版同时启用两条 C526A 专用保护：

- 普通软重启：`/etc/init.d/mt7615_reboot` 的 `STOP=60` 在关机时卸载 `mt7615e`；`START=99` 启动时只做有限 PCI 存在性检查。
- Web/CLI sysupgrade：`/lib/upgrade/99-c526a-mt7615.sh` 定义 `platform_pre_upgrade`，由 stage2 在杀停用户态进程后、切换 RAMFS 前调用。卸载失败会使 stage2 退出，不继续固件写入。

这不是硬件复位，也不保证在芯片已处于异常 MCU 状态时恢复。每次操作前记录时间与操作类型：

- 普通软重启：LuCI 系统重启或 SSH `reboot`。最好用有线 SSH 或串口观察 `STOP=60` 的执行。
- 固件升级：LuCI 固件升级页执行 sysupgrade，分别测试保留配置和不保留配置。
- 冷启动：断电至少 20 秒后重新上电，作为恢复对照。特别记录“冷启动恢复后，再执行一次普通软重启”的结果。
- Web sysupgrade：分别测试保留配置和不保留配置；本版不保留配置测试用于验证 stage2 钩子确实来自新固件，并能在升级前执行。
- 每次启动检查 `K60mt7615_reboot`、`S99mt7615_reboot` 是否存在；如果没有启用，检查 `/etc/uci-defaults/95-c526a-enable-mt7615-reboot` 是否运行成功。
- 本版保留的 STOP=60 服务来自此前 v11 工具包；原记录只有一次普通软重启通过，不能据此承诺长期稳定。今天在射频已故障状态下手动 `rmmod` 后重启仍失败，是不同测试条件，不能代替正常关机阶段测试。

每次启动后执行：

```sh
ls -l /sys/bus/pci/devices/0000:01:00.0/driver 2>&1
readlink -f /sys/bus/pci/devices/0000:01:00.0/of_node 2>&1
iwinfo phy0-ap0 info 2>&1
dmesg | grep -iE 'mt7615|mt76|firmware|eeprom|otp|Firmware is not ready' | tail -n 100
logread | grep -iE 'mt7615|mt76|hostapd|netifd' | tail -n 100
logread | grep -i mt7615_reboot | tail -n 50
ls -l /etc/init.d/mt7615_reboot /etc/rc.d/K60mt7615_reboot /etc/rc.d/S99mt7615_reboot 2>&1
cat /overlay/c526a-mt7615-reboot.log 2>/dev/null
```

若 PCI function、driver symlink 和 `of_node` 均存在，但 PHY 为 channel 0 / txpower 0 且日志含 `Firmware is not ready for download`，应记录为“PCI/驱动已绑定但射频固件初始化失败”，不要误判成 PCI 设备完全消失。sysupgrade 如果卸载失败，stage2 应在日志中报告 `MT7615 safe unload failed; aborting firmware write`，本次升级不应进入固件写入阶段。

## 9. 建议回报的数据

每个 PHY 回报：客户端 MAC（可遮挡中间两组）、RSSI、TX/RX bitrate、300 次 ping 丢包率/平均延迟、iperf3 正向/反向结果。另附每次软重启后的 MT7615 持久日志和 `iwinfo` 输出。

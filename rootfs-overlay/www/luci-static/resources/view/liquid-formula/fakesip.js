'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require rpc';
'require poll';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function serviceState(name) {
	return L.resolveDefault(callServiceList(name), {}).then(function(res) {
		var instances = res[name] && res[name].instances || {};
		var running = false, netdevs = [];
		for (var key in instances) {
			if (!instances[key] || !instances[key].running)
				continue;
			running = true;
			normalizeList(instances[key].netdev).forEach(function(device) {
				if (validInterface(device) && netdevs.indexOf(device) === -1)
					netdevs.push(device);
			});
		}
		return { running: running, netdevs: netdevs };
	});
}

function serviceRunning(name) {
	return serviceState(name).then(function(state) { return state.running; });
}

function validInterface(value) {
	return /^[A-Za-z0-9_.-]{1,15}$/.test(String(value || ''));
}

function listInterfaces() {
	return L.resolveDefault(fs.list('/sys/class/net'), []).then(function(entries) {
		return (entries || []).map(function(entry) { return entry && entry.name; })
			.filter(function(name) { return name && name !== 'lo' && validInterface(name); })
			.sort();
	});
}

function validInteger(value, minimum, maximum) {
	return /^(?:0|[1-9]\d*)$/.test(String(value || '')) && Number(value) >= minimum && Number(value) <= maximum;
}

function validPortSpec(value) {
	value = String(value || '');
	if (!value || !/^[0-9,-]+$/.test(value) || value[0] === ',' || value[value.length - 1] === ',' || value.indexOf(',,') !== -1)
		return false;
	var items = value.split(',');
	for (var i = 0; i < items.length; i++) {
		var range = items[i].split('-');
		if (range.length === 1) {
			if (!validInteger(range[0], 1, 65535)) return false;
		} else if (range.length === 2) {
			if (!validInteger(range[0], 1, 65535) || !validInteger(range[1], 1, 65535) || Number(range[0]) > Number(range[1]))
				return false;
		} else {
			return false;
		}
	}
	return true;
}

function validHostname(value) {
	value = String(value || '');
	if (!value || value.length > 253 || value[0] === '.' || value[value.length - 1] === '.' || value.indexOf('..') !== -1)
		return false;
	var labels = value.split('.');
	for (var i = 0; i < labels.length; i++)
		if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(labels[i]))
			return false;
	return true;
}

function validSipUri(value) {
	value = String(value || '');
	if (!/^sip:[A-Za-z0-9_.!~*+&=%-]+@[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(value) || value.length > 255)
		return false;
	var authority = value.substring(value.indexOf('@') + 1);
	var parts = authority.split(':');
	return parts.length <= 2 && validHostname(parts[0]) && (parts.length === 1 || validInteger(parts[1], 1, 65535));
}

function validU32(value) {
	value = String(value || '');
	if (!/^(?:0[xX][0-9A-Fa-f]{1,8}|[1-9]\d{0,9})$/.test(value))
		return false;
	var number = Number(value);
	return Number.isInteger(number) && number > 0 && number <= 4294967295;
}

function markFitsMask(mark, mask) {
	if (!validU32(mark) || !validU32(mask)) return false;
	var m = Number(mark) >>> 0, x = Number(mask) >>> 0;
	return (((m & x) >>> 0) === m);
}

function normalizeList(value) {
	if (Array.isArray(value))
		return value.filter(function(item) { return item != null && String(item) !== ''; }).map(String);
	if (value == null || String(value) === '') return [];
	return [ String(value) ];
}

function optionValue(map, name, sectionId, fallback) {
	var option = map.lookupOption(name, sectionId);
	return option && option[0] ? option[0].formvalue(sectionId) : fallback;
}

function serviceEnabled(map) {
	return optionValue(map, 'enabled', 'main', '0') === '1';
}

function refreshLog() {
	return L.resolveDefault(fs.exec_direct('/sbin/logread', [ '-e', 'fakesip' ]), '').then(function(text) {
		var lines = String(text || '').replace(/\s+$/, '').split(/\n/).filter(Boolean).slice(-200);
		var node = document.getElementById('fakesip-logview');
		if (node) {
			node.value = lines.join('\n') || _('logd 中暂无 FakeSIP 记录。');
			node.scrollTop = node.scrollHeight;
		}
	});
}

function refreshStatus() {
	return serviceRunning('fakesip').then(function(running) {
		var node = document.getElementById('fakesip-status');
		if (node) {
			node.textContent = running ? _('运行中') : _('已停止');
			node.style.color = running ? '#2d8a34' : '#a33';
		}
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('fakesip'),
			uci.load('fakehttp'),
			listInterfaces(),
			serviceState('fakesip')
		]);
	},

	render: function(data) {
		var interfaces = data[2] || [];
		var state = data[3] || { running: false, netdevs: [] };
		var running = state.running || false;
		var resolvedWan = state.netdevs || [];
		var m = new form.Map('fakesip', _('FakeSIP（UDP 混淆）'),
			_('使用 TaoistFuchen 维护的 FakeSIP 0.9.5 对路由器流量进行 UDP DPI 混淆。它会在早期 UDP 数据包中加入类似 SIP 的诱饵；它不是 VPN、代理或加密层。'));
		var s = m.section(form.NamedSection, 'main', 'fakesip', _('服务设置'));
		s.addremove = false;
		s.anonymous = true;
		s.tab('basic', _('基础设置'));
		s.tab('advanced', _('高级设置'));

		var o = s.taboption('basic', form.DummyValue, '_status', _('服务状态'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="fakesip-status" style="font-weight:bold;color:' + (running ? '#2d8a34' : '#a33') + '">' +
				(running ? _('运行中') : _('已停止')) + '</span>';
		};

		o = s.taboption('basic', form.Flag, 'enabled', _('启用 FakeSIP'));
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'boot_delay',
			_('开机自动启动延迟（秒）'),
			_('此设置仅延迟路由器开机时的自动启动。通过本页面启用、禁用或应用设置时，操作会立即生效。'));
		o.default = '40';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			return validInteger(value, 0, 600) ||
				_('请输入 0 到 600 之间的整数，不要添加前导零。填写 0 表示不延迟。');
		};

		o = s.taboption('basic', form.ListValue, 'interface_mode', _('网卡范围'));
		o.value('auto', _('使用 OpenWrt 默认 WAN（推荐）'));
		o.value('selected', _('指定面向互联网的网卡'));
		o.default = 'auto';
		o.rmempty = false;

		o = s.taboption('basic', form.DummyValue, '_resolved_wan',
			_('当前识别的 WAN 设备'));
		o.cfgvalue = function() {
			return resolvedWan.length ? resolvedWan.join(', ') : _('不可用');
		};

		o = s.taboption('basic', form.MultiValue, 'interface', _('面向互联网的设备'),
			_('仅在手动模式下使用。请选择实际的 Linux 网卡设备名称，而不是 LuCI 网络接口名称。PPPoE 通常使用 pppoe-wan。FakeSIP 不会启用不受限制的“所有设备”模式。'));
		interfaces.forEach(function(name) { o.value(name); });
		o.depends('interface_mode', 'selected');
		o.retain = true;
		o.rmempty = true;
		o.validate = function(sectionId, value) {
			var values = normalizeList(value);
			if (optionValue(this.map, 'enabled', sectionId, '0') !== '1' ||
			    optionValue(this.map, 'interface_mode', sectionId, 'auto') !== 'selected')
				return true;
			if (values.length === 0)
				return _('请至少选择一个面向互联网的网卡设备。');
			for (var i = 0; i < values.length; i++)
				if (!validInterface(values[i]) || interfaces.indexOf(values[i]) === -1)
					return _('只能选择此路由器当前存在的网卡设备。');
			return true;
		};

		o = s.taboption('basic', form.ListValue, 'direction', _('流量方向'));
		o.value('outbound', _('仅出站（推荐）'));
		o.value('both', _('入站和出站'));
		o.value('inbound', _('仅入站'));
		o.default = 'outbound';
		o.rmempty = false;

		o = s.taboption('basic', form.ListValue, 'family', _('IP 地址类型'),
			_('默认使用 IPv4/IPv6 双栈。要处理 IPv6 流量，所选 WAN 设备必须具备正常的 IPv6 连接。不解析 IPv6 扩展首部；仅处理 IPv6 基本首部之后紧跟的 UDP 数据包。'));
		o.value('dual', _('IPv4 和 IPv6（推荐）'));
		o.value('ipv4', _('仅 IPv4'));
		o.value('ipv6', _('仅 IPv6'));
		o.default = 'dual';
		o.rmempty = false;

		o = s.taboption('basic', form.ListValue, 'port_mode', _('UDP 端口过滤'),
			_('排除 DNS 端口可避免 FakeSIP 修改普通 DNS 流量。'));
		o.value('exclude', _('除列出的端口外，处理所有端口（推荐）'));
		o.value('include', _('仅处理列出的端口'));
		o.value('all', _('所有 UDP 端口'));
		o.default = 'exclude';
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'ports', _('端口及范围'));
		o.placeholder = '53,443,6000-7000';
		o.depends('port_mode', 'exclude');
		o.depends('port_mode', 'include');
		o.rmempty = false;
		o.validate = function(sectionId, value) { return !serviceEnabled(this.map) || validPortSpec(value) || _('使用逗号分隔端口或递增端口范围，中间不要加空格，例如 53,443,6000-7000。'); };

		o = s.taboption('basic', form.ListValue, 'payload_mode', _('SIP 身份'));
		o.value('auto', _('自动生成（推荐）'));
		o.value('custom_uri', _('使用自定义 SIP URI'));
		o.default = 'auto';
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'sip_uri', _('自定义 SIP URI'));
		o.placeholder = 'sip:user@example.com';
		o.depends('payload_mode', 'custom_uri');
		o.rmempty = false;
		o.validate = function(sectionId, value) { return !serviceEnabled(this.map) || validSipUri(value) || _('使用 sip:user@host 格式，可附带端口；不接受空白字符、请求头或 IPv6 字面地址。'); };

		o = s.taboption('advanced', form.Value, 'repeat', _('生成数据包副本数'));
		o.default = '2';
		o.rmempty = false;
		o.validate = function(sectionId, value) { return !serviceEnabled(this.map) || validInteger(value, 1, 10) || _('请输入 1 到 10 之间的整数。'); };

		o = s.taboption('advanced', form.Value, 'ttl', _('生成数据包 TTL'));
		o.default = '3';
		o.rmempty = false;
		o.validate = function(sectionId, value) { return !serviceEnabled(this.map) || validInteger(value, 1, 255) || _('请输入 1 到 255 之间的整数。'); };

		o = s.taboption('advanced', form.Flag, 'hop_estimation', _('估算路由跳数'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'dynamic_ttl_pct', _('动态 TTL 增幅（%）'),
			_('填写 0 表示禁用动态调整。填写 1–99 时必须启用路由跳数估算。'));
		o.default = '0';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!serviceEnabled(this.map)) return true;
			if (!validInteger(value, 0, 99)) return _('请输入 0 到 99 之间的整数。');
			if (Number(value) > 0 && optionValue(this.map, 'hop_estimation', sectionId, '1') !== '1')
				return _('动态 TTL 调整需要启用路由跳数估算。');
			return true;
		};

		o = s.taboption('advanced', form.Flag, 'log_connections', _('详细连接日志'),
			_('将连接详情写入 OpenWrt logd。除非需要排查问题，否则建议保持关闭。'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'queue_num', _('NFQUEUE 队列编号'),
			_('此编号不得被其他 NFQUEUE 应用占用。本软件包也会防止与已启用的 FakeHTTP 发生编号冲突。'));
		o.default = '8971';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!serviceEnabled(this.map)) return true;
			if (!validInteger(value, 1, 65535)) return _('请输入 1 到 65535 之间的整数。');
			if (optionValue(this.map, 'enabled', sectionId, '0') === '1' &&
				uci.get('fakehttp', 'main', 'enabled') === '1' && Number(value) === Number(uci.get('fakehttp', 'main', 'queue_num')))
				return _('此队列编号已分配给已启用的 FakeHTTP。');
			return true;
		};

		o = s.taboption('advanced', form.Value, 'fwmark', _('绕过 fwmark'),
			_('专家设置。修改前请确认此标记不会与 mwan3、策略路由、VPN、QoS 或其他数据包标记使用者冲突。'));
		o.default = '0x10000';
		o.rmempty = false;
		o.validate = function(sectionId, value) { return !serviceEnabled(this.map) || validU32(value) || _('请输入非零的 32 位十进制或十六进制数值。'); };

		o = s.taboption('advanced', form.Value, 'fwmask', _('Fwmark 掩码'));
		o.default = '0x10000';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!serviceEnabled(this.map)) return true;
			var mark = optionValue(this.map, 'fwmark', sectionId, '0x10000');
			return markFitsMask(mark, value) || _('标记和掩码必须是非零的 32 位数值，并且标记中的每一位都必须包含在掩码中。');
		};

		return m.render().then(function(mapNode) {
			var logNode = E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('服务日志')),
				E('div', { 'class': 'cbi-section-descr' }, _('OpenWrt logd 中最近的 FakeSIP 记录；不会创建单独的临时日志文件。')),
				E('textarea', { 'id': 'fakesip-logview', 'readonly': 'readonly', 'wrap': 'off',
					'style': 'width:100%;height:260px;font-family:monospace;font-size:12px;resize:vertical;' }, [ _('加载中…') ])
			]);
			poll.add(function() { return Promise.all([ refreshLog(), refreshStatus() ]); }, 5);
			refreshLog();
			return E('div', {}, [ mapNode, logNode ]);
		});
	}
});

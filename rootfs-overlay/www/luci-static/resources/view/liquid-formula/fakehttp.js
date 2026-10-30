'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require rpc';
'require poll';

var PAYLOAD_DIR = '/etc/liquid-formula/fakehttp-payloads';
var UPLOAD_STAGING = '/var/run/liquid-formula-upload/pending-fakehttp';

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

function listInterfaces() {
	return L.resolveDefault(fs.list('/sys/class/net'), []).then(function(entries) {
		return (entries || []).map(function(entry) { return entry && entry.name; })
			.filter(function(name) { return name && name !== 'lo' && validInterface(name); })
			.sort();
	});
}

function listPayloadFiles() {
	return L.resolveDefault(fs.list(PAYLOAD_DIR), []).then(function(entries) {
		return (entries || []).filter(function(entry) {
			return entry && entry.type === 'file' && /\.bin$/.test(entry.name) &&
				entry.size >= 1 && entry.size <= 1200;
		}).map(function(entry) {
			return { name: entry.name, path: PAYLOAD_DIR + '/' + entry.name, size: entry.size };
		}).sort(function(a, b) { return a.name.localeCompare(b.name); });
	});
}

function validInterface(value) {
	return /^[A-Za-z0-9_.-]{1,15}$/.test(String(value || ''));
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

function validInteger(value, minimum, maximum) {
	return /^(?:0|[1-9]\d*)$/.test(String(value || '')) && Number(value) >= minimum && Number(value) <= maximum;
}

function validU32(value) {
	value = String(value || '');
	if (!/^(?:0[xX][0-9A-Fa-f]{1,8}|[1-9]\d{0,9})$/.test(value))
		return false;
	var number = Number(value);
	return Number.isInteger(number) && number > 0 && number <= 4294967295;
}

function markFitsMask(mark, mask) {
	if (!validU32(mark) || !validU32(mask))
		return false;
	var m = Number(mark) >>> 0;
	var x = Number(mask) >>> 0;
	return (((m & x) >>> 0) === m);
}

function normalizeList(value) {
	if (Array.isArray(value))
		return value.filter(function(item) { return item != null && String(item) !== ''; }).map(String);
	if (value == null || String(value) === '')
		return [];
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
	return L.resolveDefault(fs.exec_direct('/sbin/logread', [ '-e', 'fakehttp' ]), '').then(function(text) {
		var lines = String(text || '').replace(/\s+$/, '').split(/\n/).filter(Boolean).slice(-200);
		var node = document.getElementById('fakehttp-logview');
		if (node) {
			node.value = lines.join('\n') || _('logd 中暂无 FakeHTTP 记录。');
			node.scrollTop = node.scrollHeight;
		}
	});
}

function refreshStatus() {
	return serviceRunning('fakehttp').then(function(running) {
		var node = document.getElementById('fakehttp-status');
		if (node) {
			node.textContent = running ? _('运行中') : _('已停止');
			node.style.color = running ? '#2d8a34' : '#a33';
		}
	});
}

function uploadPayload(file, output, button) {
	var name = file && file.name || '';
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,91}\.bin$/.test(name)) {
		output.textContent = _('文件名必须以 .bin 结尾，且只能包含字母、数字、点、下划线或连字符（最多 96 个字符）。');
		return Promise.resolve();
	}
	if (!file.size || file.size > 1200) {
		output.textContent = _('二进制负载大小必须在 1 至 1200 字节之间。');
		return Promise.resolve();
	}

	button.disabled = true;
	output.textContent = _('正在上传…');
	return new Promise(function(resolve) {
		var data = new FormData();
		data.append('sessionid', rpc.getSessionID());
		data.append('filename', UPLOAD_STAGING);
		data.append('filedata', file);

		var xhr = new XMLHttpRequest();
		xhr.open('POST', L.env.cgi_base + '/liquid-formula-upload?kind=fakehttp&name=' + encodeURIComponent(name), true);
		xhr.onload = function() {
			var response;
			try { response = JSON.parse(xhr.responseText || '{}'); }
			catch (e) { response = { ok: false, error: _('上传服务返回了无效响应。') }; }
			if (xhr.status >= 200 && xhr.status < 300 && response.ok) {
				output.textContent = _('已上传 %s。正在重新加载负载列表…').format(response.name || name);
				window.setTimeout(function() { window.location.reload(); }, 700);
			} else {
				output.textContent = response.error || _('上传失败。');
			}
			button.disabled = false;
			resolve();
		};
		xhr.onerror = function() {
			output.textContent = _('上传时发生网络错误。');
			button.disabled = false;
			resolve();
		};
		xhr.send(data);
	});
}

function renderUploader() {
	var input = E('input', { 'type': 'file', 'accept': '.bin,application/octet-stream' });
	var output = E('span', { 'style': 'margin-left:10px;' }, '');
	var button = E('button', {
		'type': 'button',
		'class': 'btn cbi-button cbi-button-action',
		'click': function(ev) {
			ev.preventDefault();
			if (!input.files || !input.files[0]) {
				output.textContent = _('请先选择一个 .bin 文件。');
				return;
			}
			return uploadPayload(input.files[0], output, button);
		}
	}, [ _('上传二进制负载') ]);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, _('二进制负载库')),
		E('div', { 'class': 'cbi-section-descr' },
			_('可选的高级功能。上传捕获到的 TCP 负载，然后在下方的“二进制负载”行中选择。路由器会限制文件大小为 1–1200 字节，并且只保存通过校验的 .bin 文件。上传成功后页面会重新加载，因此请先保存尚未提交的表单更改。')),
		E('div', {}, [ input, ' ', button, output ])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('fakehttp'),
			uci.load('fakesip'),
			listInterfaces(),
			listPayloadFiles(),
			serviceState('fakehttp')
		]);
	},

	render: function(data) {
		var interfaces = data[2] || [];
		var payloadFiles = data[3] || [];
		var state = data[4] || { running: false, netdevs: [] };
		var running = state.running || false;
		var resolvedWan = state.netdevs || [];
		var m = new form.Map('fakehttp', _('FakeHTTP（TCP 混淆）'),
			_('使用 FakeHTTP 0.9.18 对路由器流量进行 TCP DPI 混淆。它会向选定连接添加一段短诱饵负载；它不是 VPN、代理或加密层，也不能保证抵御人工数据包分析。建议先在实际 WAN 设备上启用出站流量。'));
		var s = m.section(form.NamedSection, 'main', 'fakehttp', _('服务设置'));
		s.addremove = false;
		s.anonymous = true;
		s.tab('basic', _('基础设置'));
		s.tab('advanced', _('高级设置'));

		var o = s.taboption('basic', form.DummyValue, '_status', _('服务状态'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="fakehttp-status" style="font-weight:bold;color:' + (running ? '#2d8a34' : '#a33') + '">' +
				(running ? _('运行中') : _('已停止')) + '</span>';
		};

		o = s.taboption('basic', form.Flag, 'enabled', _('启用 FakeHTTP'));
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'boot_delay',
			_('开机自动启动延迟（秒）'),
			_('此设置仅延迟路由器开机时的自动启动。通过本页面启用、禁用或应用设置时，操作会立即生效。'));
		o.default = '60';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			return validInteger(value, 0, 600) ||
				_('请输入 0 到 600 之间的整数，不要添加前导零。填写 0 表示不延迟。');
		};

		o = s.taboption('basic', form.ListValue, 'interface_mode', _('网卡范围'));
		o.value('auto', _('使用 OpenWrt 默认 WAN（推荐）'));
		o.value('selected', _('指定面向互联网的网卡'));
		o.value('all', _('所有网卡（专家模式）'));
		o.default = 'auto';
		o.rmempty = false;

		o = s.taboption('basic', form.DummyValue, '_resolved_wan',
			_('当前识别的 WAN 设备'));
		o.cfgvalue = function() {
			return resolvedWan.length ? resolvedWan.join(', ') : _('不可用');
		};

		o = s.taboption('basic', form.MultiValue, 'interface', _('面向互联网的设备'),
			_('仅在手动模式下使用。请选择实际的 Linux 网卡设备名称，而不是 LuCI 网络接口名称。PPPoE 通常使用 pppoe-wan。支持选择多个设备，重复选择会自动忽略。'));
		interfaces.forEach(function(name) { o.value(name); });
		o.depends('interface_mode', 'selected');
		o.retain = true;
		o.rmempty = true;
		o.validate = function(sectionId, value) {
			var enabled = optionValue(this.map, 'enabled', sectionId, '0');
			var mode = optionValue(this.map, 'interface_mode', sectionId, 'auto');
			var values = normalizeList(value);
			if (enabled !== '1' || mode !== 'selected')
				return true;
			if (enabled === '1' && mode === 'selected' && values.length === 0)
				return _('请至少选择一个面向互联网的网卡设备。');
			for (var i = 0; i < values.length; i++)
				if (!validInterface(values[i]) || interfaces.indexOf(values[i]) === -1)
					return _('只能选择此路由器当前存在的网卡设备。');
			return true;
		};

		o = s.taboption('basic', form.ListValue, 'direction', _('流量方向'));
		o.value('outbound', _('仅出站（推荐）'));
		o.value('inbound', _('仅入站'));
		o.value('both', _('入站和出站'));
		o.default = 'outbound';
		o.rmempty = false;

		o = s.taboption('basic', form.ListValue, 'family', _('IP 地址类型'));
		o.value('dual', _('IPv4 和 IPv6'));
		o.value('ipv4', _('仅 IPv4'));
		o.value('ipv6', _('仅 IPv6'));
		o.default = 'dual';
		o.rmempty = false;

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
			_('此编号不得被其他 NFQUEUE 应用占用。本软件包也会防止与已启用的 FakeSIP 使用相同编号。'));
		o.default = '8970';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!serviceEnabled(this.map)) return true;
			if (!validInteger(value, 1, 65535)) return _('请输入 1 到 65535 之间的整数。');
			if (optionValue(this.map, 'enabled', sectionId, '0') === '1' &&
				uci.get('fakesip', 'main', 'enabled') === '1' && Number(value) === Number(uci.get('fakesip', 'main', 'queue_num')))
				return _('此队列编号已分配给已启用的 FakeSIP。');
			return true;
		};

		o = s.taboption('advanced', form.Value, 'fwmark', _('绕过 fwmark'),
			_('专家设置。修改前请确认此标记不会与 mwan3、策略路由、VPN、QoS 或其他数据包标记使用者冲突。'));
		o.default = '0x8000';
		o.rmempty = false;
		o.validate = function(sectionId, value) { return !serviceEnabled(this.map) || validU32(value) || _('请输入非零的 32 位十进制或十六进制数值。'); };

		o = s.taboption('advanced', form.Value, 'fwmask', _('Fwmark 掩码'));
		o.default = '0x8000';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!serviceEnabled(this.map)) return true;
			var mark = optionValue(this.map, 'fwmark', sectionId, '0x8000');
			return markFitsMask(mark, value) || _('标记和掩码必须是非零的 32 位数值，并且标记中的每一位都必须包含在掩码中。');
		};

		var p = m.section(form.GridSection, 'payload', _('按顺序排列的诱饵负载'),
			_('启用的行会按当前顺序传递给 FakeHTTP，并在全局范围内轮换。重复行会被保留，因此重复添加同一行可以提高其被选中的概率。'));
		p.anonymous = true;
		p.addremove = true;
		p.sortable = true;

		o = p.option(form.Flag, 'enabled', _('已启用'));
		o.default = '1';
		o.rmempty = false;

		o = p.option(form.ListValue, 'type', _('类型'));
		o.value('http', _('HTTP Host（主机名）'));
		o.value('https', _('HTTPS SNI（TLS 服务器名称指示）'));
		o.value('binary', _('二进制负载'));
		o.default = 'http';
		o.rmempty = false;

		o = p.option(form.Value, 'host', _('主机名'));
		o.depends('type', 'http');
		o.depends('type', 'https');
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!serviceEnabled(this.map)) return true;
			if (optionValue(this.map, 'enabled', sectionId, '1') !== '1') return true;
			return validHostname(value) || _('请输入不带协议前缀的主机名，每个域名标签不得超过 63 个字符。');
		};

		o = p.option(form.ListValue, 'file', _('已上传文件'));
		o.depends('type', 'binary');
		o.value('', _('请先在上方上传 .bin 文件，然后重新加载此列表。'));
		payloadFiles.forEach(function(file) { o.value(file.path, '%s (%d bytes)'.format(file.name, file.size)); });
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!serviceEnabled(this.map)) return true;
			if (optionValue(this.map, 'enabled', sectionId, '1') !== '1') return true;
			for (var i = 0; i < payloadFiles.length; i++)
				if (payloadFiles[i].path === value) return true;
			return _('请从二进制负载库中选择已通过校验的文件。');
		};

		return m.render().then(function(mapNode) {
			var logNode = E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('服务日志')),
				E('div', { 'class': 'cbi-section-descr' }, _('OpenWrt logd 中最近的 FakeHTTP 记录；不会创建单独的临时日志文件。')),
				E('textarea', { 'id': 'fakehttp-logview', 'readonly': 'readonly', 'wrap': 'off',
					'style': 'width:100%;height:260px;font-family:monospace;font-size:12px;resize:vertical;' }, [ _('加载中…') ])
			]);
			poll.add(function() { return Promise.all([ refreshLog(), refreshStatus() ]); }, 5);
			refreshLog();
			return E('div', {}, [ renderUploader(), mapNode, logNode ]);
		});
	}
});

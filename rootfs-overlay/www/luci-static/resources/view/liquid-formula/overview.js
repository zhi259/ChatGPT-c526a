'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require poll';

var callStatus = rpc.declare({ object: 'liquid_formula', method: 'status', expect: { '': {} } });
var callServiceAction = rpc.declare({ object: 'liquid_formula', method: 'service_action', params: [ 'name' ], expect: { '': {} } });
var callGenerate = rpc.declare({ object: 'liquid_formula', method: 'generate', expect: { '': {} } });
var callRefresh = rpc.declare({ object: 'liquid_formula', method: 'refresh', expect: { '': {} } });
var callCheck = rpc.declare({ object: 'liquid_formula', method: 'check', expect: { '': {} } });
var callUpdate = rpc.declare({ object: 'liquid_formula', method: 'update', expect: { '': {} } });
var callListTemplates = rpc.declare({ object: 'liquid_formula', method: 'list_templates', expect: { '': {} } });
var callReadTemplate = rpc.declare({ object: 'liquid_formula', method: 'read_template', params: [ 'id', 'file' ], expect: { '': {} } });
var callWriteTemplate = rpc.declare({ object: 'liquid_formula', method: 'write_template', params: [ 'id', 'name', 'file', 'no_node', 'enabled', 'content' ], expect: { '': {} } });
var callDeleteTemplate = rpc.declare({ object: 'liquid_formula', method: 'delete_template', params: [ 'id' ], expect: { '': {} } });

// Actions that run detached in the backend (see _spawn_update in the rpcd
// script) because they may outlive the ~20s ubus timeout. The action call
// returns "queued" instantly; completion is read back from status polling.
var ASYNC = { refresh: true, check: true, update: true };
var ACTION_CALLS = { generate: callGenerate, refresh: callRefresh, check: callCheck, update: callUpdate };

function strictResult(res) {
	if (!res || typeof res.code !== 'number' || typeof res.output !== 'string')
		throw new Error(_('RPC 后端返回了无效响应。'));
	return res;
}

// The table and the default-template control must always consume one validated
// backend snapshot. Reject malformed or duplicate entries before building any
// DOM nodes so a failed refresh cannot partially replace the current view.
function templateSnapshot(res) {
	var ids = {};
	if (!res || !Array.isArray(res.templates))
		throw new Error(_('RPC 后端返回了无效响应。'));
	return res.templates.map(function(template) {
		if (!template || typeof template.id !== 'string' || !template.id ||
		    (typeof template.enabled !== 'boolean' && template.enabled !== 0 && template.enabled !== 1) ||
		    typeof template.name !== 'string' || typeof template.file !== 'string' ||
		    (template.no_node != null && typeof template.no_node !== 'string') ||
		    typeof template.size !== 'number' || typeof template.mtime !== 'string' ||
		    ids[template.id])
			throw new Error(_('RPC 后端返回了无效响应。'));
		ids[template.id] = true;
		return {
			id: template.id,
			enabled: template.enabled === true || template.enabled === 1,
			name: template.name,
			file: template.file,
			no_node: template.no_node || '',
			size: template.size,
			mtime: template.mtime
		};
	});
}

function templateChoice(template) {
	return template.name || template.id;
}

// Transient floating toast, replacing ui.addNotification: non-blocking,
// always visible regardless of scroll position, auto-dismisses (click to
// dismiss immediately). Errors stay longer and are tinted red.
function toast(msg, isError) {
	var wrap = document.getElementById('sbf_toast_wrap');
	if (!wrap) {
		wrap = E('div', { 'id': 'sbf_toast_wrap', 'style': 'position:fixed; top:3.5em; left:50%; transform:translateX(-50%); z-index:20000; display:flex; flex-direction:column; align-items:center; pointer-events:none; max-width:90vw' });
		document.body.appendChild(wrap);
	}
	var box = E('div', {
		'style': 'pointer-events:auto; margin-top:.5em; padding:.6em 1.4em; border-radius:4px; ' +
			'box-shadow:0 2px 14px rgba(0,0,0,.45); color:#fff; font-size:95%; cursor:pointer; ' +
			'white-space:pre-wrap; word-break:break-word; max-width:80vw; ' +
			'background:' + (isError ? 'rgba(150,30,30,.96)' : 'rgba(38,38,38,.94)'),
		'click': function() { if (box.parentNode) box.parentNode.removeChild(box); }
	}, [ String(msg) ]);
	wrap.appendChild(box);
	window.setTimeout(function() {
		box.style.transition = 'opacity .4s';
		box.style.opacity = '0';
		window.setTimeout(function() { if (box.parentNode) box.parentNode.removeChild(box); }, 450);
	}, isError ? 6000 : 2800);
}

function copyText(text) {
	if (!text)
		return toast(_('没有可复制的内容。'), true);
	if (navigator.clipboard && navigator.clipboard.writeText) {
		return navigator.clipboard.writeText(text).then(function() {
			toast(_('已复制到剪贴板。'));
		}).catch(function() {
			return fallbackCopy(text);
		});
	}
	return fallbackCopy(text);
}

function fallbackCopy(text) {
	var ta = E('textarea', { 'style': 'position:fixed; left:-9999px; top:-9999px' }, [ String(text) ]);
	document.body.appendChild(ta);
	ta.focus();
	ta.select();
	try {
		document.execCommand('copy');
		toast(_('已复制到剪贴板。'));
	} catch (e) {
		toast(_('复制失败，请手动复制 URL。'), true);
	}
	document.body.removeChild(ta);
}

// momo 的 nftables 会把本机产生的包一并劫持进 sing-box, 这其中包括 FakeHTTP /
// FakeSIP 通过 raw socket 注入的伪造包 —— 它们靠 SO_MARK 打标, 但仍然走
// LOCAL_OUT, 因此会被 momo 的 mangle_output 抓走, 永远到不了 WAN。把对应的
// mark 加进 momo 的 bypass_fwmark 才能放行。
//
// 掩码必须写: momo 解析 bypass_fwmark 时, 不带 "/" 则掩码默认 0xFFFFFFFF,
// 生成的规则是 "mark & 0xffffffff == 0x8000", 只有 mark 恰好等于该值才命中。
// 而包经过 momo 打标后会变成组合值(如 0x8080), 不带掩码就漏了。
var MOMO_BYPASS = [
	{ id: 'fakehttp', config: 'fakehttp', defaultMark: '0x8000',  defaultMask: '0x8000',  tool: 'FakeHTTP', proto: 'TCP' },
	{ id: 'fakesip',  config: 'fakesip',  defaultMark: '0x10000', defaultMask: '0x10000', tool: 'FakeSIP',  proto: 'UDP' }
];

function dpiBypassMark(entry) {
	var mark = uci.get(entry.config, 'main', 'fwmark') || entry.defaultMark;
	var mask = uci.get(entry.config, 'main', 'fwmask') || entry.defaultMask;
	return String(mark) + '/' + String(mask);
}

function momoBypassList() {
	var value = uci.get('momo', 'proxy', 'bypass_fwmark');
	if (value == null)
		return null;
	if (Array.isArray(value))
		return value.slice();
	return String(value).split(/\s+/).filter(function(item) { return item.length > 0; });
}

function momoBypassSet(mark, wanted) {
	var list = momoBypassList() || [];
	var at = list.indexOf(mark);
	if (wanted && at < 0)
		list.push(mark);
	else if (!wanted && at >= 0)
		list.splice(at, 1);
	else
		return;
	if (list.length)
		uci.set('momo', 'proxy', 'bypass_fwmark', list);
	else
		uci.unset('momo', 'proxy', 'bypass_fwmark');
}

// 前端校验必须和 generate-config.sh 同步。前端松、后端严的话, Save & Apply
// 会把 UCI 提交下去而生成器拒绝, 结果是 UCI 显示新值、config.yaml 还是旧的,
// 服务也照旧跑着 —— 界面和运行态就此分裂, 而且没有任何提示。
function noControlChars(value) {
	return !/[\x00-\x1f\x7f]/.test(String(value));
}

function validateScalar(value, label) {
	if (!noControlChars(value))
		return _('%s 不能包含控制字符。').format(label);
	return true;
}

function validIPv4Literal(value) {
	var octets = String(value).split('.');
	if (octets.length !== 4)
		return false;
	return octets.every(function(octet) {
		return /^(0|[1-9]\d*)$/.test(octet) && Number(octet) <= 255;
	});
}

function validIPv6Literal(value) {
	var text = String(value), zoneAt = text.indexOf('%25');
	var compression, left, right, groups, units = 0;
	if (zoneAt !== -1) {
		if (!text.slice(zoneAt + 3) || text.slice(zoneAt + 3).indexOf('%') !== -1)
			return false;
		text = text.slice(0, zoneAt);
	}
	if (text.indexOf('%') !== -1 || text.indexOf(':') === -1 || text.indexOf(':::') !== -1)
		return false;
	compression = text.indexOf('::');
	if (compression !== -1 && text.indexOf('::', compression + 2) !== -1)
		return false;
	if (compression === -1) {
		left = text;
		right = '';
	} else {
		left = text.slice(0, compression);
		right = text.slice(compression + 2);
	}
	groups = (left ? left.split(':') : []).concat(right ? right.split(':') : []);
	for (var i = 0; i < groups.length; i++) {
		if (groups[i].indexOf('.') !== -1) {
			if (i !== groups.length - 1 || !validIPv4Literal(groups[i]))
				return false;
			units += 2;
		} else {
			if (!/^[0-9A-Fa-f]{1,4}$/.test(groups[i]))
				return false;
			units++;
		}
	}
	return compression !== -1 ? units < 8 : units === 8;
}

function validateSubscriptionURL(value) {
	var text = String(value == null ? '' : value);
	var rest, authority, userinfo, hostport, hostname, suffix, colon, beforeQuery, fragment;
	var lastAt, hostEscapes, escapeMatch, escapedByte;
	if (!text)
		return _('订阅链接不能为空。');
	if (/[\x00-\x20\x7f]/.test(text))
		return _('订阅链接不能包含 ASCII 空白字符或控制字符。');
	if (!/^https?:\/\//i.test(text))
		return _('订阅链接必须以 http:// 或 https:// 开头。');
	beforeQuery = text.split('?', 1)[0];
	fragment = text.indexOf('#') === -1 ? '' : text.slice(text.indexOf('#') + 1);
	if (/%(?![0-9A-Fa-f]{2})/.test(beforeQuery) || /%(?![0-9A-Fa-f]{2})/.test(fragment))
		return _('订阅链接只能包含有效的百分号编码。');
	rest = text.replace(/^https?:\/\//i, '');
	authority = rest.split(/[\/?#]/, 1)[0];
	if (!authority)
		return _('订阅链接必须包含主机名。');
	lastAt = authority.lastIndexOf('@');
	userinfo = lastAt === -1 ? '' : authority.slice(0, lastAt);
	if (userinfo && (/^[^@]*@/.test(userinfo) || /["<>\\^`{|}\[\]]/.test(userinfo)))
		return _('订阅链接包含无效的用户信息。');
	hostport = authority.slice(lastAt + 1);
	if (!hostport)
		return _('订阅链接必须包含主机名。');
	if (hostport.charAt(0) === '[') {
		colon = hostport.indexOf(']');
		if (colon <= 1)
			return _('订阅链接中的主机名必须使用有效的方括号格式。');
		hostname = hostport.slice(1, colon);
		if (!validIPv6Literal(hostname))
			return _('使用方括号括起的订阅主机名必须是 IPv6 地址。');
		suffix = hostport.slice(colon + 1);
		if (suffix && !/^:\d*$/.test(suffix))
			return _('订阅链接必须包含有效的数字端口。');
	} else {
		if (/[\[\]]/.test(hostport))
			return _('订阅链接必须包含有效的主机名。');
		colon = hostport.indexOf(':');
		if (colon === -1) {
			hostname = hostport;
		} else {
			hostname = hostport.slice(0, colon);
			suffix = hostport.slice(colon + 1);
			if (!/^\d*$/.test(suffix))
				return _('订阅链接必须包含有效的数字端口。');
		}
		if (!hostname)
			return _('订阅链接必须包含主机名。');
	}
	if (/["<>\\^`{|}\[\]]/.test(hostname))
		return _('订阅链接必须包含有效的主机名。');
	hostEscapes = /%([0-9A-Fa-f]{2})/g;
	while ((escapeMatch = hostEscapes.exec(hostname)) !== null) {
		escapedByte = parseInt(escapeMatch[1], 16);
		if (escapedByte < 0x80 && escapedByte !== 0x25)
			return _('ASCII 主机名字符不能使用百分号编码。');
	}
	return true;
}

function validateOutputPath(value, label) {
	var text = String(value || '');
	var scalar = validateScalar(text, label);
	if (scalar !== true)
		return scalar;
	if (/\/\//.test(text) || /\/(?:\.|\.\.)(?:\/|$)/.test(text))
		return _('%s 不能包含空路径段、. 或 .. 路径段。').format(label);
	if (!/^\/(?:etc\/momo\/profiles|etc\/sing-box|var\/lib\/liquid-formula\/output)\/.*\.json$/.test(text))
		return _('%s 必须是位于 /etc/momo/profiles、/etc/sing-box 或 /var/lib/liquid-formula/output 目录下的 JSON 文件。').format(label);
	return true;
}

function validateTemplateBaseUrl(value) {
	var text = String(value || '');
	var scalar = validateScalar(text, _('模板基础 URL'));
	var match;
	if (scalar !== true)
		return scalar;
	match = text.match(/^http:\/\/(?:127\.0\.0\.1|localhost)(?::([^/]+))?(?:\/.*)?$/);
	if (!match)
		return _('模板基础 URL 必须指向 http://127.0.0.1 或 http://localhost。');
	if (match[1] != null &&
	    (!/^[1-9][0-9]{0,4}$/.test(match[1]) || Number(match[1]) > 65535))
		return _('模板基础 URL 的端口必须是 1 到 65535 之间的整数。');
	return true;
}

return view.extend({
	load: function() {
		function safe(promise, fallback) {
			return promise.catch(function(err) {
				fallback = fallback || {};
				fallback._error = err && (err.message || err.toString()) || String(err);
				return fallback;
			});
		}
		var self = this;
		return Promise.all([
			uci.load('liquid_formula'),
			safe(callStatus(), {}),
			safe(callListTemplates(), { templates: [] }),
			// momo 是可选运行时。没装就不显示这一节, 而不是抛错。
			uci.load('momo').then(function() { self._momo = true; },
			                      function() { self._momo = false; }),
			// mark/mask 可在两个 DPI 页面修改，Overview 必须读取同一份 UCI，
			// 不能继续把默认值当成实际运行值。
			safe(uci.load('fakehttp'), {}),
			safe(uci.load('fakesip'), {})
		]);
	},

	render: function(data) {
		var status = data[1] || {};
		var templates = [];
		var m, s, o;

		if (data[2] && !data[2]._error) {
			try {
				templates = templateSnapshot(data[2]);
			} catch (err) {
				templates = [];
			}
		}

		this._lastStatus = status;
		if (data[2] && Array.isArray(data[2].templates) && !data[2]._error) {
			this._enabledTemplateCount = templates.filter(function(template) {
				return !!template.enabled;
			}).length;
		} else {
			this._enabledTemplateCount = undefined;
		}

		m = new form.Map('liquid_formula', _('Liquid Formula'),
			_('将订阅源转换为 sing-box JSON 配置文件，并更新指定的输出文件。本应用不负责管理 sing-box 运行环境；请使用 OpenWrt-momo 等运行时来运行 sing-box、管理防火墙规则、访问控制和配置文件计划任务。'));

		s = m.section(form.NamedSection, 'main', 'global', _('基础设置'));
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('启用订阅转换服务'),
			_('主开关。点击“保存并应用”后，服务会与此开关保持一致：启用时启动转换器，禁用时停止转换器；设置发生变化时会重启服务以使更改生效。启用后，路由器开机时也会自动启动（遵循下方的启动延迟设置）。'));
		o.default = '0';

		o = s.option(form.Value, 'boot_delay', _('启动延迟'),
			_('路由器开机后自动启动前等待的秒数，范围为 0–600。此延迟仅用于开机自动启动；通过“保存并应用”或页面按钮手动启动时会立即生效。'));
		o.datatype = 'range(0,600)';
		o.default = '90';

		o = s.option(form.Value, 'subscription_url', _('订阅源 URL'),
			_('请按服务提供商给出的原样粘贴链接，包括服务商控制面板要求的额外查询参数。'));
		o.rmempty = false;
		o.placeholder = 'https://example.com/your/subscription';
		o.validate = function(section_id, value) {
			var enabled = uci.get('liquid_formula', section_id, 'enabled');
			var match;
			if (this.map && typeof this.map.lookupOption === 'function') {
				match = this.map.lookupOption('enabled', section_id);
				if (match && match[0] && typeof match[1] === 'string')
					enabled = match[0].formvalue(match[1]);
			}
			if (!value && String(enabled || '0') !== '1')
				return true;
			return validateSubscriptionURL(value);
		};

		o = s.option(form.Value, 'user_agent', _('订阅 User-Agent'),
			_('多数服务商会根据此请求头决定返回 sing-box JSON、Clash YAML 还是 Base64 节点列表，并可能拒绝未知或过旧的客户端（例如提示“client version too low”）。请选择预设值或自行输入。转换器现已自动解码 Base64 和 URI 节点列表；如果服务商不支持 sing-box，使用 v2rayN 风格的 UA 是一种稳妥的备用方案。'));
		o.default = 'v2rayN/7.24.4';
		o.rmempty = false;
		o.placeholder = 'v2rayN/7.24.4';
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			if (value.length > 200)
				return _('User-Agent 最多只能包含 200 个字符。');
			if (!/^[\x20-\x7e]*$/.test(value))
				return _('User-Agent 必须全部由可打印的 ASCII 字符组成。');
			return true;
		};
		[
			['v2rayN/7.24.4',                    'v2rayN ' + _('（推荐：节点列表）')],
			['v2rayNG/2.2.6',                    'v2rayNG ' + _('（节点列表）')],
			['sing-box 1.13.15',                 'sing-box core'],
			['SFI/1.13.15 (sing-box 1.13.15)',   'sing-box iOS (SFI)'],
			['SFA/1.13.15 (sing-box 1.13.15)',   'sing-box Android (SFA)'],
			['SFM/1.13.15 (sing-box 1.13.15)',   'sing-box macOS (SFM)'],
			['Karing/1.2.23.2605',               'Karing']
		].forEach(function(preset) { o.value(preset[0], preset[1] + ' - ' + preset[0]); });

		o = s.option(form.Value, 'password', _('转换器访问密码'));
		o.password = true;
		o.rmempty = false;
		o.validate = function(section_id, value) {
			if (!value)
				return _('密码不能为空。');
			return validateScalar(value, _('密码'));
		};

		o = s.option(form.Value, 'port', _('转换器服务端口'));
		o.datatype = 'port';
		o.default = '9716';
		o.rmempty = false;

		o = s.option(form.Value, 'refresh_interval', _('订阅刷新间隔'), _('单位为分钟，范围为 1–10080（一周）。此值对应 config.yaml 中的 subscription.refresh_interval。'));
		o.datatype = 'range(1,10080)';
		o.default = '360';

		o = s.option(form.ListValue, 'default_template', _('默认模板'),
			_('当请求未指定模板时使用此模板。所选模板必须已在“模板管理”标签页中启用。'));
		o.rmempty = false;
		this._defaultTemplateOption = o;
		this._enabledTemplateIds = {};
		this._templateSnapshot = templates;
		// Rendering a new form invalidates any refresh still targeting the prior DOM.
		this._templateRefreshGeneration = (this._templateRefreshGeneration || 0) + 1;
		var seenTpl = {};
		for (var i = 0; i < templates.length; i++) {
			if (!templates[i].enabled)
				continue;
			o.value(templates[i].id, templateChoice(templates[i]));
			seenTpl[templates[i].id] = true;
			this._enabledTemplateIds[templates[i].id] = true;
		}
		o.validate = L.bind(function(section_id, value) {
			if (this._enabledTemplateIds && this._enabledTemplateIds[value])
				return true;
			return _('默认模板必须处于启用状态。');
		}, this);
		if (!Object.keys(seenTpl).length)
			o.placeholder = _('请先至少启用一个模板。');

		o = s.option(form.Value, 'output_config', _('输出配置文件路径'), _('生成的配置文件通过校验后会写入此路径。OpenWrt-momo 等 sing-box 运行时可以使用此配置文件路径。'));
		o.default = '/etc/momo/profiles/config.json';
		o.validate = function(section_id, value) {
			return validateOutputPath(value, _('输出配置文件路径'));
		};

		o = s.option(form.Value, 'template_base_url', _('模板基础 URL'), _('转换器获取 JSON 模板时使用的本地 HTTP URL 前缀。此地址必须始终指向本机回环接口。'));
		o.default = 'http://127.0.0.1/liquid-formula/templates';
		o.validate = function(section_id, value) {
			return validateTemplateBaseUrl(value);
		};

		if (this._momo) {
			s = m.section(form.NamedSection, 'main', 'global', _('momo 防火墙绕过'),
				_('momo 也会将本机生成的数据包重定向到 sing-box。FakeHTTP 和 FakeSIP 等抗 DPI 辅助工具会通过原始套接字注入伪造数据包，因此这些数据包可能被 momo 拦截，无法到达 WAN。下方每个开关都会将对应的防火墙标记加入 momo 的绕过列表，使这些数据包不经过 momo。') + ' ' +
				_('点击“保存并应用”时，这些开关会写入 momo 自身配置（momo.proxy.bypass_fwmark）。其他绕过规则（例如其他标记、DSCP、IP 地址范围）请前往 momo 自己的“代理 → 绕过”页面设置。'));
			s.anonymous = true;

			MOMO_BYPASS.forEach(function(entry) {
				var mark = dpiBypassMark(entry);
				var bare = mark.split('/')[0];
				o = s.option(form.Flag, 'momo_bypass_' + entry.id,
					_('绕过 %s（%s）').format(entry.tool, mark),
					_('对标记为 %s 的 %s 数据包跳过 momo。如果运行 %s 时使用了“-m %s”参数，请启用此项。保持启用没有危害：如果没有程序设置该标记，此规则就不会匹配任何数据包。')
						.format(entry.proto, bare, entry.tool, bare));
				o.default = '1';
				o.rmempty = false;
				// 每次 Save & Apply 都把状态推进 momo, 否则用户没动过开关时
				// LuCI 会跳过 write, 推荐配置就永远落不了盘。
				o.forcewrite = true;
				o.write = function(section_id, value) {
					uci.set('liquid_formula', section_id, this.option, value);
					momoBypassSet(dpiBypassMark(entry), value == '1');
				};
				o.remove = function(section_id) {
					uci.set('liquid_formula', section_id, this.option, '0');
					momoBypassSet(dpiBypassMark(entry), false);
				};
			});
		}

		return m.render().then(L.bind(function(formEl) {
			this._defaultTemplateSelect = this.findDefaultTemplateSelect(formEl);
			// Keep the status card current without a manual page reload; paused
			// while a button action is mid-flight so it cannot fight the spinner.
			poll.add(L.bind(function() {
				if (this._busy)
					return Promise.resolve();
				return this.reloadStatus();
			}, this), 5);
			return E('div', {}, [
				formEl,
				this.renderIntegration(status),
				this.renderStatus(status),
				// 模板管理原本是独立页面, 现在收进本页, 排在更新日志之后。
				this.renderTemplateManager(templates)
			]);
		}, this));
	},

	renderIntegration: function(status) {
		var url = status.converted_url || '';
		var lanUrl = status.lan_url || '';

		function urlRow(id, label, value, hint) {
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ label ]),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'id': id, 'class': 'cbi-input-text', 'style': 'width:70%', 'readonly': 'readonly', 'value': value }),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': function(ev) { ev.preventDefault(); copyText(value); }
					}, _('复制 URL')),
					E('div', { 'class': 'cbi-value-description' }, [ hint ])
				])
			]);
		}

		var children = [
			E('h3', {}, _('sing-box 集成')),
			E('p', {}, _('此转换器会在输出路径生成 sing-box JSON 配置文件，并通过下方 URL 提供访问。请将 sing-box 运行时（例如 OpenWrt-momo）指向其中一个 URL，或让它直接读取输出文件，以便从本路由器获取生成的配置。')),
			E('p', {}, [
				E('a', {
					'class': 'btn cbi-button',
					'href': 'https://github.com/nikkinikki-org/OpenWrt-momo',
					'target': '_blank',
					'rel': 'noreferrer'
				}, _('GitHub 上的 OpenWrt-momo'))
			]),
			urlRow('sbsc_converted_url', _('转换器 URL（本机）'), url,
				_('供运行在本 OpenWrt 设备上的 sing-box 使用。'))
		];

		if (lanUrl)
			children.push(urlRow('sbsc_lan_url', _('转换器 URL（LAN）'), lanUrl,
				_('供本地网络中的手机、电脑和其他路由器访问。')));
		else
			children.push(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('转换器 URL（LAN）')),
				E('div', { 'class': 'cbi-value-field' },
					E('em', {}, _('LAN 地址不可用：无法从 lan 接口读取 IPv4 地址。')))
			]));

		children.push(E('p', { 'class': 'cbi-value-description' },
			_('这两个 URL 根据已保存的设置自动生成。如果修改了端口、密码或默认模板，请先点击“保存并应用”。LAN URL 中包含明文密码，请妥善保管，仅在可信任的网络中使用。')));

		return E('div', { 'class': 'cbi-section' }, children);
	},

	// Save & Apply flow. Mirrors the core implementation (handleSave, then
	// ui.changes.apply — which is fire-and-forget), and afterwards reconciles
	// the running state with the switch. Because apply is asynchronous, we
	// detect the committed generated configuration by content digest. This also
	// distinguishes first creation and equal-size changes within one second.
	handleSaveApply: function(ev, mode) {
		var self = this;
		return callStatus().catch(function() { return self._lastStatus || {}; }).then(function(pre) {
			var preDigest = (pre && pre.config_digest) || '';
			return self.handleSave(ev).then(function() {
				ui.changes.apply(mode == '0');
				return self.reconcileAfterApply(preDigest);
			});
		});
	},

	reconcileAfterApply: function(preDigest) {
		var self = this, tries = 0, lastSt = null;
		var step = function() {
			return callStatus().then(function(st) {
				lastSt = st || {};
				self._applyStatus(lastSt);
				var changed = !!(lastSt.config_digest && lastSt.config_digest !== preDigest);
				if (!changed && tries++ < 15)
					return new Promise(function(r) { window.setTimeout(r, 1000); }).then(step);
				// 摘要没变说明生成器没有产出新的 config.yaml。UCI 已经提交,
				// 但运行的还是旧配置 —— 不说出来的话界面显示新值、服务跑旧值,
				// 用户完全看不出。
				if (!changed)
					ui.addNotification(null, E('p', {}, [
						_('设置已保存，但转换器配置文件未重新生成，因此运行中的服务仍在使用旧设置。'),
						lastSt.config_error
							? E('code', {}, [ String(lastSt.config_error) ])
							: _('请查看下方更新日志了解原因。')
					]), 'warning');
				else if (lastSt.config_error)
					ui.addNotification(null, E('p', {}, [
						_('转换器报告配置问题：'),
						E('code', {}, [ String(lastSt.config_error) ])
					]), 'warning');
				return self._reconcile(lastSt, changed);
			}).catch(function() {
				if (tries++ < 15)
					return new Promise(function(r) { window.setTimeout(r, 1000); }).then(step);
			});
		};
		return step();
	},

	_reconcile: function(st, changed) {
		var desired = !!(st && st.enabled);
		var running = !!(st && st.running);
		if (desired && (!running || changed))
			return this.doAction('restart', changed ? _('设置已应用，转换器已重启。') : _('转换器已启动。'));
		if (!desired && running)
			return this.doAction('stop', _('转换器已停止。'));
		return Promise.resolve();
	},

	// Run an action with a spinner on the clicked button; results appear as a
	// floating toast. Background actions (refresh/check/update) are polled via
	// status until the backend marks them done; the status card (including the
	// update log) live-refreshes while they run.
	doAction: function(name, successMsg, btn) {
		var self = this;
		if (self._busy)
			return Promise.resolve();
		self._busy = true;
		if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
		var finish = function() {
			self._busy = false;
			if (btn && btn.isConnected) { btn.classList.remove('spinning'); btn.disabled = false; }
		};
		var request = ACTION_CALLS[name] ? ACTION_CALLS[name]() : callServiceAction(name);
		return request.then(strictResult).then(function(res) {
			var code = res.code;
			var out = res.output.replace(/\s+$/, '');
			if (ASYNC[name] && code === 0 && out === 'queued') {
				return self.waitAction(name).then(function(st) {
					finish();
					if (st && st.action === name && st.action_state === 'done' && st.action_code === 0)
						toast(successMsg || _('完成。'));
					else if (st && st.action === name && st.action_state === 'running')
						toast(_('任务仍在后台运行，请查看下方更新日志。'), true);
					else if (st && st.action === name && st.action_state === 'stale')
						toast(_('操作已中断，请查看下方更新日志。'), true);
					else if (st && st.action_code === 75)
						toast(_('另一个更新任务正在运行，或 /var/run/liquid-formula/ 中遗留了过期锁文件。请查看下方更新日志。'), true);
					else
						toast(_('操作失败（退出码 %d），请查看下方更新日志了解详情。').format(
							(st && typeof st.action_code === 'number') ? st.action_code : -1), true);
					return self.reloadStatus();
				});
			}
			if (ASYNC[name] && code === 0)
				throw new Error(_('RPC 后端返回了无效的异步响应。'));
			finish();
			if (code !== 0)
				toast(out || _('命令执行失败，退出码 %d。').format(code), true);
			else
				toast(out || successMsg || _('完成。'));
			return self.reloadStatus();
		}).catch(function(err) {
			finish();
			toast((err && err.message) || String(err), true);
		});
	},

	// 与 rpcd 的 worker watchdog 使用同一预算。refresh 只发一次请求；check /
	// update 还可能依次等待临时服务启动、刷新和拉取成品，因此是三段预算。
	// 两边不一致会让界面在合法后台动作尚未结束时提前报告“仍在运行”。
	actionWaitSeconds: function(name) {
		var rawTimeout = String(uci.get('liquid_formula', 'main', 'subscription_timeout') || '60');
		if (!/^(?:0|[1-9][0-9]*)$/.test(rawTimeout) ||
		    Number(rawTimeout) < 5 || Number(rawTimeout) > 600)
			return 11160;
		var timeout = Number(rawTimeout);
		var enabled = this._enabledTemplateCount;
		if (typeof enabled !== 'number') {
			enabled = 0;
			(uci.sections('liquid_formula', 'template') || []).forEach(function(section) {
				if (section.enabled === undefined || section.enabled === '1')
					enabled++;
			});
		}
		var requestTimeout = Math.min(timeout * (enabled + 1) + 60, 3660);
		if (name === 'refresh')
			return requestTimeout + 30;
		if (name === 'check' || name === 'update')
			return requestTimeout * 3 + 180;
		return 11160;
	},

	waitAction: function(name) {
		var self = this, waited = 0, last = null;
		var limit = this.actionWaitSeconds(name);
		var step = function() {
			return callStatus().then(function(st) {
				last = st || {};
				self._applyStatus(last);
				if (last.action === name && last.action_state === 'running' && waited < limit) {
					waited += 2;
					return new Promise(function(r) { window.setTimeout(r, 2000); }).then(step);
				}
				return last;
			}).catch(function() {
				if (waited < limit) {
					waited += 2;
					return new Promise(function(r) { window.setTimeout(r, 2000); }).then(step);
				}
				return last;
			});
		};
		return step();
	},

	reloadStatus: function() {
		var self = this;
		return callStatus().then(function(status) {
			self._applyStatus(status || {});
		}).catch(function(err) {
			var stale = Object.assign({}, self._lastStatus || {});
			stale._error = (err && err.message) || String(err);
			stale._stale = true;
			self._applyStatus(stale);
		});
	},

	// Rebuild the status card in place from a status object.
	_applyStatus: function(status) {
		this._lastStatus = status;
		var el = document.getElementById('sbf_status_section');
		if (!el)
			return;
		while (el.firstChild)
			el.removeChild(el.firstChild);
		var kids = this.statusChildren(status);
		for (var i = 0; i < kids.length; i++) {
			var k = kids[i];
			if (k === '' || k == null)
				continue;
			if (typeof k === 'string')
				k = document.createTextNode(k);
			el.appendChild(k);
		}
	},

	renderStatus: function(status) {
		return E('div', { 'id': 'sbf_status_section', 'class': 'cbi-section' }, this.statusChildren(status));
	},

	statusChildren: function(status) {
		var self = this;
		var running = !!status.running;
		var healthy = !!status.healthy;
		var enabled = !!status.enabled;
		var bg = (status.action_state === 'running');
		var rpcError = status._error ? E('div', { 'class': 'alert-message warning' }, [
			E('strong', {}, _('RPC 后端不可用。')), ' ',
			_('当前显示的数据可能已过期。请重启 rpcd，然后刷新此页面。错误信息：'), String(status._error)
		]) : '';

		// Three-state: procd instance present + /health answering = Running;
		// instance present but health failing = starting up / crashed-waiting-
		// respawn; no instance = Stopped. This is what makes the status line and
		// the health check agree with each other.
		var stateEl = running
			? (healthy
				? E('strong', { 'style': 'color:green' }, _('运行中'))
				: E('strong', { 'style': 'color:#c60' }, _('运行中（尚未就绪）')))
			: E('strong', { 'style': 'color:#b00' }, _('已停止'));

		var health;
		if (!running)
			health = _('转换器未运行。');
		else if (!healthy)
			health = _('转换器进程已启动，但健康检查接口暂时尚未响应。');
		else
			health = status.health ? ((typeof status.health == 'string') ? status.health : JSON.stringify(status.health, null, 2)) : '';

		var mkBtn = function(label, name, msg, extraClass) {
			return E('button', {
				'class': 'btn cbi-button' + (extraClass ? ' ' + extraClass : ''),
				'disabled': bg ? 'disabled' : null,
				'title': bg ? _('后台操作正在进行') : null,
				'click': function(ev) { ev.preventDefault(); return self.doAction(name, msg, ev.currentTarget); }
			}, [ label ]);
		};

		return [
			rpcError,
			E('h3', {}, _('转换器服务')),
			E('p', {}, [
				_('状态：'), stateEl,
				' / ', _('开机自启动：'), enabled ? E('strong', { 'style': 'color:green' }, _('已开启')) : E('strong', {}, _('已关闭')),
				' / ', _('转换器版本：'), String(status.converter_version || 'unknown'),
				' / ', _('端口：'), String(status.port || ''),
				' / ', _('默认模板：'), String(status.default_template || ''),
				' / ', _('输出文件：'), String(status.output_config || '')
			]),
			bg ? E('p', { 'style': 'color:#c60' }, [
				E('em', {}, [
					_('后台任务正在进行：') + String(status.action || '') +
						_(' — 进度显示在下方的更新日志中。')
				])
			]) : '',
			E('div', { 'class': 'cbi-page-actions', 'style': 'text-align:left; margin-top:.5em' }, [
				mkBtn(_('重启转换器'), 'restart', _('转换器已重启。'), 'cbi-button-apply'), ' ',
				mkBtn(_('重新生成 config.yaml'), 'generate', _('config.yaml 已生成。')), ' ',
				mkBtn(_('刷新订阅'), 'refresh', _('订阅已刷新。')), ' ',
				mkBtn(_('检查生成的配置'), 'check', _('生成的配置有效。')), ' ',
				mkBtn(_('更新输出文件'), 'update', _('输出文件已更新。'))
			]),
			E('p', { 'class': 'cbi-value-description' }, [
				_('转换器由上方的“启用订阅转换服务”开关控制（点击“保存并应用”即可启动或停止）。设置发生变化时会自动重启，以使更改生效。'),
				_('刷新、检查和更新操作会在后台运行：进度显示在下方更新日志中，完成时会弹出提示。刷新操作要求转换器已经运行。如果转换器当前已关闭，检查和更新操作会临时启动它，并在完成后再次停止，因此不会改变主开关的设置。“更新输出文件”只会写入生成的 JSON，不会重启 sing-box。此区域会自动刷新。')
			]),
			E('h4', {}, _('健康检查')),
			E('pre', { 'style': 'white-space:pre-wrap; max-height: 180px; overflow:auto' }, [ health ]),
			E('h4', {}, _('最近更新日志')),
			E('pre', { 'style': 'white-space:pre-wrap; max-height: 220px; overflow:auto' },
				[ String(status.update_log || '') ])
		];
	},

	buildTemplateRow: function(t) {
		var self = this;
		return E('tr', { 'class': 'tr cbi-section-table-row' }, [
			E('td', { 'class': 'td cbi-section-table-cell', 'data-title': 'ID' }, [ String(t.id || '') ]),
			E('td', { 'class': 'td cbi-section-table-cell', 'data-title': _('已启用') },
				[ t.enabled ? _('是') : _('否') ]),
			E('td', { 'class': 'td cbi-section-table-cell', 'data-title': _('名称') }, [ String(t.name || '') ]),
			E('td', { 'class': 'td cbi-section-table-cell', 'data-title': _('文件') }, [ String(t.file || '') ]),
			E('td', { 'class': 'td cbi-section-table-cell', 'data-title': _('大小') }, [ String(t.size || 0) ]),
			E('td', { 'class': 'td cbi-section-table-cell', 'data-title': _('修改时间') }, [ String(t.mtime || '') ]),
			E('td', {
				'class': 'td cbi-section-table-cell nowrap cbi-section-actions',
				'data-title': _('操作')
			}, E('div', {}, [
				E('button', { 'class': 'btn cbi-button', 'click': function(ev) { ev.preventDefault(); self.loadTemplate(t); } }, [ _('编辑') ]),
				' ',
				E('button', { 'class': 'btn cbi-button-negative', 'click': function(ev) { ev.preventDefault(); self.deleteTemplate(t.id); } }, [ _('删除') ])
			]))
		]);
	},

	findDefaultTemplateSelect: function(root) {
		var ids = [
			'widget.cbid.liquid_formula.main.default_template',
			'cbid.liquid_formula.main.default_template'
		];
		var find = function(node) {
			var id, i, found;
			if (!node)
				return null;
			id = node.id || (node.getAttribute && node.getAttribute('id')) ||
				(node.attributes && node.attributes.id);
			if (ids.indexOf(id) >= 0)
				return node;
			for (i = 0; node.childNodes && i < node.childNodes.length; i++) {
				found = find(node.childNodes[i]);
				if (found)
					return found;
			}
			return null;
		};

		if (this._defaultTemplateSelect &&
		    (typeof this._defaultTemplateSelect.isConnected === 'undefined' ||
		     this._defaultTemplateSelect.isConnected))
			return this._defaultTemplateSelect;
		this._defaultTemplateSelect = null;
		var select = find(root);
		if (!select && document.getElementById) {
			for (var i = 0; i < ids.length && !select; i++)
				select = document.getElementById(ids[i]);
		}
		return select;
	},

	stageTemplateRefresh: function(templates) {
		var enabled = {};
		var choices = [];
		var displayChoices;
		var rows = [];
		var select = this.findDefaultTemplateSelect();
		var tbody = document.getElementById('sbsc_tpl_tbody');
		var currentValue;
		var i, optionNodes;

		// A refresh is all-or-nothing. If either live target disappeared while the
		// request was in flight, keep the existing table and control unchanged.
		if (!tbody || !select)
			throw new Error(_('模板列表当前不可用。'));
		currentValue = String(select.value || '');

		for (i = 0; i < templates.length; i++) {
			rows.push(this.buildTemplateRow(templates[i]));
			if (templates[i].enabled) {
				enabled[templates[i].id] = true;
				choices.push({ value: templates[i].id, label: templateChoice(templates[i]) });
			}
		}
		displayChoices = choices.slice();
		if (currentValue && !enabled[currentValue])
			displayChoices.push({
				value: currentValue,
				label: '%s (%s)'.format(_('不可用的模板'), currentValue),
				disabled: true,
				hidden: true
			});

		// Build every row and native option before changing either rendered target.
		// ui.Select has no public setChoices API in supported LuCI versions.
		optionNodes = displayChoices.map(function(choice) {
			var node = document.createElement('option');
			node.value = choice.value;
			node.disabled = !!choice.disabled;
			node.hidden = !!choice.hidden;
			node.textContent = choice.label;
			return node;
		});

		return {
			templates: templates,
			enabled: enabled,
			keylist: choices.map(function(choice) { return choice.value; }),
			vallist: choices.map(function(choice) { return choice.label; }),
			rows: rows,
			tbody: tbody,
			select: select,
			optionNodes: optionNodes,
			currentValue: currentValue
		};
	},

	commitTemplateRefresh: function(staged) {
		var i, option = this._defaultTemplateOption;

		// Synchronize LuCI's model and both native structures without writing UCI
		// or emitting a change event, so unrelated unsaved form values survive.
		if (option) {
			option.keylist = staged.keylist;
			option.vallist = staged.vallist;
		}
		this._enabledTemplateIds = staged.enabled;
		this._enabledTemplateCount = Object.keys(staged.enabled).length;
		this._templateSnapshot = staged.templates;

		while (staged.tbody.firstChild)
			staged.tbody.removeChild(staged.tbody.firstChild);
		for (i = 0; i < staged.rows.length; i++)
			staged.tbody.appendChild(staged.rows[i]);
		while (staged.select.firstChild)
			staged.select.removeChild(staged.select.firstChild);
		for (i = 0; i < staged.optionNodes.length; i++)
			staged.select.appendChild(staged.optionNodes[i]);
		// Native browsers maintain HTMLSelectElement.options themselves; the
		// lightweight render fixture exposes it as a plain array instead.
		if (Array.isArray(staged.select.options))
			staged.select.options = staged.optionNodes;
		staged.select.value = staged.currentValue;
		this._defaultTemplateSelect = staged.select;
		if (option && typeof option.triggerValidation === 'function')
			option.triggerValidation('main');
	},

	// Only the newest request may commit. Rejections from the active request
	// propagate to the mutation caller so a successful write and failed UI
	// refresh are reported as distinct outcomes.
	reloadTemplateList: function() {
		var self = this;
		var generation = (this._templateRefreshGeneration || 0) + 1;
		this._templateRefreshGeneration = generation;
		return callListTemplates().then(function(res) {
			if (generation !== self._templateRefreshGeneration)
				return self._templateSnapshot || [];
			var templates = templateSnapshot(res);
			var staged = self.stageTemplateRefresh(templates);
			self.commitTemplateRefresh(staged);
			return templates;
		}, function(err) {
			if (generation !== self._templateRefreshGeneration)
				return self._templateSnapshot || [];
			throw err;
		});
	},

	renderTemplateManager: function(templates) {
		var tbody = E('tbody', {
			'id': 'sbsc_tpl_tbody',
			'class': 'tbody cbi-section-tbody'
		});
		var self = this;
		for (var i = 0; i < templates.length; i++)
			tbody.appendChild(this.buildTemplateRow(templates[i]));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('模板管理')),
			E('p', {}, _('上传本地 JSON 模板、编辑现有模板、新建模板或删除不再使用的模板。当前默认模板（在“概览”标签页中设置）不能删除。')),
			E('table', { 'class': 'table cbi-section-table' }, [
				E('thead', { 'class': 'thead cbi-section-thead' }, E('tr', {
					'class': 'tr cbi-section-table-titles anonymous'
				}, [
					E('th', { 'class': 'th cbi-section-table-cell' }, 'ID'),
					E('th', { 'class': 'th cbi-section-table-cell' }, _('已启用')),
					E('th', { 'class': 'th cbi-section-table-cell' }, _('名称')),
					E('th', { 'class': 'th cbi-section-table-cell' }, _('文件')),
					E('th', { 'class': 'th cbi-section-table-cell' }, _('大小')),
					E('th', { 'class': 'th cbi-section-table-cell' }, _('修改时间')),
					E('th', {
						'class': 'th cbi-section-table-cell cbi-section-actions'
					}, _('操作'))
				])),
				tbody
			]),
			E('hr'),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('模板 ID')), E('div', { 'class': 'cbi-value-field' }, E('input', { 'id': 'sbsc_tpl_id', 'class': 'cbi-input-text', 'placeholder': 'openwrt_custom' })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('模板名称')), E('div', { 'class': 'cbi-value-field' }, E('input', { 'id': 'sbsc_tpl_name', 'class': 'cbi-input-text', 'placeholder': 'OpenWrt Custom' })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('文件名')), E('div', { 'class': 'cbi-value-field' }, E('input', { 'id': 'sbsc_tpl_file', 'class': 'cbi-input-text', 'placeholder': 'openwrt-custom.json' })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('备用出站')), E('div', { 'class': 'cbi-value-field' }, E('input', { 'id': 'sbsc_tpl_no_node', 'class': 'cbi-input-text', 'value': '➜ Direct' })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('启用模板')), E('div', { 'class': 'cbi-value-field' }, E('input', { 'id': 'sbsc_tpl_enabled', 'type': 'checkbox', 'checked': 'checked' })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('上传 JSON 模板')), E('div', { 'class': 'cbi-value-field' }, E('input', { 'id': 'sbsc_tpl_upload', 'type': 'file', 'accept': '.json,application/json', 'change': function(ev) { self.uploadTemplate(ev); } })) ]),
			E('textarea', { 'id': 'sbsc_tpl_content', 'style': 'width:100%; min-height:420px; font-family:monospace', 'placeholder': '{\n  "outbounds": [\n    {{ Nodes }}\n  ]\n}' }),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-apply', 'click': function(ev) { ev.preventDefault(); self.saveTemplate(ev.currentTarget); } }, _('保存模板')),
				' ',
				E('button', { 'class': 'btn cbi-button', 'click': function(ev) { ev.preventDefault(); self.newTemplate(); } }, _('清空编辑器')),
				E('span', { 'id': 'sbsc_tpl_save_status', 'style': 'margin-left:1em; vertical-align:middle' })
			])
		]);
	},

	loadTemplate: function(t) {
		var self = this;
		return callReadTemplate(t.id, t.file).then(function(res) {
			if (!res || res.ok !== true)
				return toast((res && res.error) || _('RPC 后端返回了无效响应。'), true);
			document.getElementById('sbsc_tpl_id').value = t.id || '';
			document.getElementById('sbsc_tpl_name').value = t.name || '';
			document.getElementById('sbsc_tpl_file').value = t.file || res.file || '';
			document.getElementById('sbsc_tpl_no_node').value = t.no_node || '➜ Direct';
			document.getElementById('sbsc_tpl_enabled').checked = !!t.enabled;
			document.getElementById('sbsc_tpl_content').value = res.content || '';
			document.getElementById('sbsc_tpl_id').readOnly = true;
			document.getElementById('sbsc_tpl_file').readOnly = true;
			self._editingTemplate = t.id || '';
		}).catch(function(err) { toast((err && err.message) || String(err), true); });
	},

	uploadTemplate: function(ev) {
		var file = ev.target.files[0];
		if (!file)
			return;
		var reader = new FileReader();
		reader.onload = function(e) {
			document.getElementById('sbsc_tpl_content').value = e.target.result;
			if (!document.getElementById('sbsc_tpl_file').value)
				document.getElementById('sbsc_tpl_file').value = file.name;
			if (!document.getElementById('sbsc_tpl_id').value)
				document.getElementById('sbsc_tpl_id').value = file.name.replace(/\.json$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
			if (!document.getElementById('sbsc_tpl_name').value)
				document.getElementById('sbsc_tpl_name').value = file.name.replace(/\.json$/i, '');
		};
		reader.readAsText(file);
	},

	setSaveStatus: function(msg, isError) {
		var el = document.getElementById('sbsc_tpl_save_status');
		if (!el)
			return;
		el.textContent = msg || '';
		el.style.color = isError ? '#b00' : 'green';
	},

	saveTemplate: function(btn) {
		var id = document.getElementById('sbsc_tpl_id').value;
		var name = document.getElementById('sbsc_tpl_name').value;
		var file = document.getElementById('sbsc_tpl_file').value;
		var noNode = document.getElementById('sbsc_tpl_no_node').value || '➜ Direct';
		var enabled = document.getElementById('sbsc_tpl_enabled').checked;
		var content = document.getElementById('sbsc_tpl_content').value;
		var self = this;
		var done = function() { if (btn) { btn.classList.remove('spinning'); btn.disabled = false; } };
		if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
		self.setSaveStatus('', false);
		if (new TextEncoder().encode(content).length > 1048576) {
			self.setSaveStatus(_('模板大小超过 1 MiB 限制。'), true);
			done();
			return Promise.resolve();
		}
		return callWriteTemplate(id, name, file, noNode, enabled, content).then(function(res) {
			if (!res || res.ok !== true || res.phase !== 'complete') {
				self.setSaveStatus((res && res.error) || _('RPC 后端返回了无效响应。'), true);
				done();
				return;
			}
			// 后端在重启失败时仍然返回 ok:true(改动确实已经落盘), 但会带一条
			// warning。不显示的话用户会以为新模板已经生效。
			if (res.warning)
				self.setSaveStatus(_('模板已保存，但出现以下提示：') + String(res.warning), true);
			else
				self.setSaveStatus(_('模板已保存。'), false);
			return self.reloadTemplateList().then(function() {
				done();
			}, function(err) {
				var refreshError = (err && err.message) || String(err);
				var message = res.warning ?
					_('模板已保存，但出现以下提示：') + String(res.warning) + ' ' +
						_('刷新模板列表失败：') + refreshError :
					_('模板已保存，但刷新模板列表失败：') + refreshError;
				self.setSaveStatus(message, true);
				done();
			});
		}).catch(function(err) {
			self.setSaveStatus((err && err.message) || String(err), true);
			done();
		});
	},

	deleteTemplate: function(id) {
		if (!confirm(_('删除模板 ') + id + '?'))
			return;
		var self = this;
		return callDeleteTemplate(id).then(function(res) {
			if (!res || res.ok !== true || res.phase !== 'complete')
				return toast((res && res.error) || _('RPC 后端返回了无效响应。'), true);
			return self.reloadTemplateList().then(function() {
				if (res.warning)
					toast(_('模板已删除，但出现以下提示：') + String(res.warning), true);
				else
					toast(_('模板已删除。'));
			}, function(err) {
				var refreshError = (err && err.message) || String(err);
				var message = res.warning ?
					_('模板已删除，但出现以下提示：') + String(res.warning) + ' ' +
						_('刷新模板列表失败：') + refreshError :
					_('模板已删除，但刷新模板列表失败：') + refreshError;
				toast(message, true);
			});
		}).catch(function(err) { toast((err && err.message) || String(err), true); });
	},

	newTemplate: function() {
		document.getElementById('sbsc_tpl_id').value = '';
		document.getElementById('sbsc_tpl_name').value = '';
		document.getElementById('sbsc_tpl_file').value = '';
		document.getElementById('sbsc_tpl_no_node').value = '➜ Direct';
		document.getElementById('sbsc_tpl_enabled').checked = true;
		document.getElementById('sbsc_tpl_content').value = '';
		document.getElementById('sbsc_tpl_id').readOnly = false;
		document.getElementById('sbsc_tpl_file').readOnly = false;
		this._editingTemplate = '';
	}
});

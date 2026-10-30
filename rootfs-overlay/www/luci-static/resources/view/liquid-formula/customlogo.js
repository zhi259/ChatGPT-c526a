'use strict';
'require view';
'require form';
'require uci';
'require request';
'require rpc';
'require ui';

var DEFAULT_LOGO = '/etc/liquid-formula/assets/default-logo.svg';
var ASSET_PREFIX = '/etc/liquid-formula/assets/';
var MAX_UPLOAD_SIZE = 512 * 1024;
var UPLOAD_URL = (L.env.cgi_base || '/cgi-bin') + '/liquid-formula-upload';
var TUNING_RPC_TIMEOUT = 45;
var TUNING_RELOAD_DELAY = 60;
var TUNING_CLIENT_GUARD = 50;

var callTuningStatus = rpc.declare({ object: 'liquid_formula', method: 'tuning_status', expect: { '': {} } });
var callTuningApply  = rpc.declare({ object: 'liquid_formula', method: 'tuning_apply',  expect: { '': {} } });

// 这些选项存在 tuning 配置里, 但和 Custom Logo 共用一个 form.Map。
// uci.save() 会把所有已加载的配置一起提交, 所以跨配置读写是安全的。
function tuningValue(option, fallback) {
	var value = uci.get('tuning', 'main', option);
	return (value == null || value === '') ? fallback : String(value);
}

function bindTuning(o, option, fallback) {
	o.cfgvalue = function() { return tuningValue(option, fallback); };
	o.write = function(section_id, value) { uci.set('tuning', 'main', option, value); };
	o.remove = function() { uci.set('tuning', 'main', option, fallback); };
	o.forcewrite = true;
	return o;
}

function supportsCakeMq(release) {
	// Main-branch builds report a bare "SNAPSHOT" with no version numbers at
	// all. They always track something newer than the last tagged release, so
	// the numeric gate below must not reject them. Release-branch snapshots
	// keep their numeric prefix ("24.10-SNAPSHOT") and stay comparable.
	// Kept byte-for-byte in step with supports_cake_mq() in apply-tuning.sh.
	var text = String(release || '').replace(/^\s+|\s+$/g, '');
	var match, major, minor;
	if (/^snapshot$/i.test(text))
		return true;
	text = text.replace(/-snapshot$/i, '');
	match = text.match(/^(\d+)\.(\d+)(?:\.|$)/);
	if (!match)
		return false;
	major = Number(match[1]);
	minor = Number(match[2]);
	return major > 25 || (major === 25 && minor >= 12);
}

function liveRow(label, value, note) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width:38%' }, [ label ]),
		E('td', { 'class': 'td left' }, [
			E('strong', {}, [ value || '?' ]),
			note ? E('span', { 'class': 'cbi-value-description' }, [ ' ' + note ]) : ''
		])
	]);
}

function basename(path) {
	var parts = String(path || '').split(/[\\/]/);
	return parts[parts.length - 1] || '';
}

function extension(path) {
	var name = basename(path);
	var pos = name.lastIndexOf('.');
	return pos >= 0 ? name.substring(pos + 1).toLowerCase() : '';
}

function safeFilename(name, extensions) {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) &&
		name.length <= 96 && extensions.indexOf(extension(name)) >= 0;
}

var SecureUploadValue = form.Value.extend({
	__init__: function(map, section, option, title, description, settings) {
		this.super('__init__', [map, section, option, title, description]);
		this.uploadKind = settings.kind;
		this.extensions = settings.extensions;
		this.accept = settings.accept;
		this.stagingPath = settings.stagingPath;
		this.builtinPath = settings.builtinPath;
	},

	renderWidget: function(section_id, option_index, cfgvalue) {
		var current = cfgvalue || this.default || '';
		var readonly = (this.readonly != null) ? this.readonly : this.map.readonly;
		var valueWidget = new ui.Textfield(current, {
			id: this.cbid(section_id),
			optional: true,
			readonly: true,
			validate: this.getValidator(section_id),
			disabled: readonly
		});
		var valueNode = valueWidget.render();
		var fileInput = E('input', {
			'type': 'file',
			'accept': this.accept,
			'disabled': readonly ? '' : null,
			'style': 'display:none'
		});
		var status = E('span', {
			'class': 'upload-status',
			'aria-live': 'polite',
			'style': 'margin-inline-start:.75em'
		});
		var uploadButton = E('button', {
			'type': 'button',
			'class': 'btn cbi-button cbi-button-action',
			'disabled': readonly ? '' : null,
			'click': function(ev) {
				ev.preventDefault();
				fileInput.click();
			}
		}, _('上传文件…'));
		var builtinButton = this.builtinPath ? E('button', {
			'type': 'button',
			'class': 'btn cbi-button',
			'disabled': readonly ? '' : null,
			'style': 'margin-inline-start:.5em',
			'click': function(ev) {
				ev.preventDefault();
				valueWidget.setValue(this.builtinPath);
				valueNode.querySelector('input').dispatchEvent(new Event('change', { bubbles: true }));
				status.textContent = _('已选择内置资源。');
			}.bind(this)
		}, _('使用内置资源')) : null;

		fileInput.addEventListener('change', function() {
			var file = fileInput.files && fileInput.files[0];
			var name = file ? basename(file.name) : '';

			if (!file)
				return;

			if (!safeFilename(name, this.extensions)) {
				ui.addNotification(null, E('p', [
					_('文件名或类型不受支持。允许的扩展名：%s。')
						.format(this.extensions.join(', '))
				]));
				fileInput.value = '';
				return;
			}

			if (file.size < 1 || file.size > MAX_UPLOAD_SIZE) {
				ui.addNotification(null, E('p',
					_('文件大小必须在 1 字节至 512 KiB 之间。')));
				fileInput.value = '';
				return;
			}

			var data = new FormData();
			data.append('sessionid', rpc.getSessionID());
			data.append('filename', this.stagingPath);
			data.append('filedata', file);
			status.textContent = _('正在上传…');
			uploadButton.disabled = true;
			if (builtinButton)
				builtinButton.disabled = true;

			request.post('%s?kind=%s&name=%s'.format(
				UPLOAD_URL, encodeURIComponent(this.uploadKind), encodeURIComponent(name)), data, {
				timeout: 0,
				progress: function(pev) {
					if (pev.total)
						status.textContent = _('正在上传… %s%%')
							.format(Math.floor((pev.loaded / pev.total) * 100));
				}
			}).then(function(res) {
				var reply = res.json();

				if (!reply || reply.ok !== true || !reply.path)
					throw new Error(reply && reply.error ? reply.error : _('上传失败。'));

				valueWidget.setValue(reply.path);
				valueNode.querySelector('input').dispatchEvent(new Event('change', { bubbles: true }));
				status.textContent = _('上传完成。点击“保存并应用”以启用。');
			}).catch(function(err) {
				status.textContent = _('上传失败。');
				ui.addNotification(null, E('p', [
					_('上传失败：%s').format(err.message || err)
				]));
			}).finally(function() {
				uploadButton.disabled = readonly;
				if (builtinButton)
					builtinButton.disabled = readonly;
				fileInput.value = '';
			});
		}.bind(this));

		// form.Value.renderFrame() supplies the surrounding
		// .cbi-value-field. Returning another one here creates a nested field
		// with an extra Bootstrap margin and inconsistent third-party-theme
		// layout.
		return E('div', {}, [
			valueNode,
			E('div', { 'style': 'margin-top:.5em' }, [
				fileInput,
				uploadButton,
				builtinButton,
				status
			])
		]);
	},

	validate: function(section_id, value) {
		var name;

		if (!value || (this.builtinPath && value === this.builtinPath))
			return true;

		if (String(value).indexOf(ASSET_PREFIX) !== 0)
			return _('请选择内置 Logo，或在此页面上传文件。');

		name = basename(value);
		if (value !== ASSET_PREFIX + name || !safeFilename(name, this.extensions))
			return _('所选资源路径无效。');

		return true;
	}
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('customlogo'),
			uci.load('tuning').catch(function() {}),
			callTuningStatus().catch(function() { return null; })
		]);
	},

	render: function(data) {
		var m, s, o;
		var tuning = (data && data[2]) || {};
		var live = tuning.live || {};
		var irq = tuning.irqbalance || {};
		var cakeMqSupported = supportsCakeMq(tuning.openwrt_release);

		m = new form.Map('customlogo', _('外观与网络调优'),
			_('请使用软件包提供的可信内置 SVG，或上传 PNG Logo 和 PNG/ICO 浏览器图标。出于安全考虑，不允许上传用户自定义的 SVG 文件。'));

		s = m.section(form.NamedSection, 'main', 'customlogo', _('基础设置'));
		s.addremove = false;
		s.anonymous = true;

		o = s.option(form.Flag, 'enable', _('启用自定义 Logo'));
		o.rmempty = false;

		o = s.option(SecureUploadValue, 'logo', _('导航栏 Logo'),
			_('默认使用本软件包提供的内置 SVG。自定义文件必须为 PNG，且大小不得超过 512 KiB。'), {
				kind: 'logo',
				extensions: ['png'],
				accept: '.png,image/png',
				stagingPath: '/var/run/liquid-formula-upload/pending-logo',
				builtinPath: DEFAULT_LOGO
			});
	o.default = DEFAULT_LOGO;
	o.rmempty = true;
	o.retain = true;
	o.depends('enable', '1');

		o = s.option(SecureUploadValue, 'favicon', _('网站图标（Favicon）'),
			_('默认使用内置 SVG。自定义文件必须为 PNG 或 ICO，且大小不得超过 512 KiB。'), {
				kind: 'favicon',
				extensions: ['png', 'ico'],
				accept: '.png,.ico,image/png,image/x-icon',
				stagingPath: '/var/run/liquid-formula-upload/pending-favicon',
				builtinPath: DEFAULT_LOGO
			});
	o.default = DEFAULT_LOGO;
	o.rmempty = true;
	o.retain = true;
	o.depends('enable', '1');


		// ------------------------------------------------ 内核网络调优 ----

		s = m.section(form.NamedSection, 'main', 'customlogo', _('内核网络调优'),
			_('这些设置会写入 /etc/sysctl.d/99-liquid-formula.conf 并立即应用。该配置文件由本软件包管理，每次应用时都会重新生成，不会重复累积设置。'));
		s.addremove = false;
		s.anonymous = true;

		o = s.option(form.DummyValue, '_live', _('当前生效值'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			var rows = [
				liveRow(_('TCP Fast Open'), live.tcp_fastopen),
				liveRow(_('默认队列算法'), live.default_qdisc),
				liveRow(_('拥塞控制算法'), live.congestion_control),
				liveRow(_('SYN 队列长度'), live.tcp_max_syn_backlog),
				liveRow(_('IRQ 中断均衡'),
					irq.installed === false ? _('未安装')
						: (irq.running ? _('运行中') : _('已停止')))
			];
			var notes = [];

			if (tuning.sysctl_conf_conflict)
				notes.push(E('p', { 'class': 'alert-message warning' },
					_('/etc/sysctl.conf 仍设置了这些参数。OpenWrt 会在加载 /etc/sysctl.d/ 后再加载该文件，因此其中的设置会覆盖本页面。应用下方设置时，会将这些参数从原文件中移出，并在原文件旁保留 .liquid-formula.bak 备份。')));
			if (tuning.cake_module === false)
				notes.push(E('p', { 'class': 'alert-message warning' },
					_('尚未安装 kmod-sched-cake，因此无法启用 cake 队列算法。请安装该模块，或改用 fq_codel。')));
			if (tuning.bbr_module === false)
				notes.push(E('p', { 'class': 'alert-message warning' },
					_('尚未安装 kmod-tcp-bbr，因此无法启用 BBR 拥塞控制。请安装该模块，或选择内核报告为可用的其他算法。')));

			return E('div', {}, [E('table', { 'class': 'table' }, rows)].concat(notes)).innerHTML;
		};

		o = bindTuning(s.option(form.Flag, 'tuning_enabled', _('管理内核参数'),
			_('默认关闭：安装本软件包不会擅自更改内核网络行为。启用后，下方四项参数将由本页面统一管理。')),
			'enabled', '0');

		o = bindTuning(s.option(form.ListValue, 'tuning_tcp_fastopen', _('TCP Fast Open'),
			_('允许在 TCP 握手开始阶段发送数据，重复连接时可减少一个往返时延。')),
			'tcp_fastopen', '3');
		o.value('0', _('0 - 禁用'));
		o.value('1', _('1 - 仅客户端'));
		o.value('2', _('2 - 仅服务端'));
		o.value('3', _('3 - 客户端和服务端'));
		o.depends('tuning_enabled', '1');

		o = bindTuning(s.option(form.ListValue, 'tuning_default_qdisc', _('默认队列算法'),
			_('请选择当前固件版本支持的队列算法。cake 和 cake_mq 需要安装 kmod-sched-cake。')),
			'default_qdisc', 'cake');
		o.default = 'cake';
		o.value('cake', 'cake' + (tuning.cake_module === false ? ' (' + _('缺少内核模块') + ')' : ''));
		if (cakeMqSupported)
			o.value('cake_mq', 'cake_mq' + (tuning.cake_module === false ? ' (' + _('缺少内核模块') + ')' : ''));
		o.value('fq_codel', 'fq_codel');
		o.depends('tuning_enabled', '1');

		o = bindTuning(s.option(form.ListValue, 'tuning_congestion_control', _('拥塞控制算法'),
			_('请选择 bbr、cubic 或 reno。启用 bbr 需要安装 kmod-tcp-bbr。当前运行内核报告可用的算法：%s')
				.format(tuning.available_congestion_control || _('未知'))),
			'congestion_control', 'bbr');
		o.default = 'bbr';
		o.value('bbr', 'bbr' + (tuning.bbr_module === false ? ' (' + _('缺少内核模块') + ')' : ''));
		o.value('cubic', 'cubic');
		o.value('reno', 'reno');
		o.depends('tuning_enabled', '1');

		o = bindTuning(s.option(form.ListValue, 'tuning_backlog', _('SYN 队列长度'),
			_('半开连接队列的最大长度。')),
			'tcp_max_syn_backlog', '512');
		o.default = '512';
		o.value('128', '128');
		o.value('512', '512');
		o.value('1024', '1024');
		o.value('2048', '2048');
		o.depends('tuning_enabled', '1');

		o = bindTuning(s.option(form.Flag, 'tuning_irqbalance', _('均衡硬件中断'),
			_('MT7622 使用双核 A53。关闭 irqbalance 时，网卡中断可能集中到 CPU0；在高流量或 PPPoE 转发场景下，单个核心占满会限制吞吐量。此设置会写入 irqbalance 自身的配置并重启服务。')),
			'irqbalance', '0');
		if (irq.installed === false)
			o.description = _('尚未安装 irqbalance 软件包，安装前此开关不会生效。');

		return m.render();
	},

	_clearTuningApplyListeners: function() {
		if (this._tuningAppliedListener)
			document.removeEventListener('uci-applied', this._tuningAppliedListener);
		if (this._tuningRevertedListener)
			document.removeEventListener('uci-reverted', this._tuningRevertedListener);
		this._tuningAppliedListener = null;
		this._tuningRevertedListener = null;
	},

	_clearTuningApplyGuard: function() {
		if (this._tuningApplyGuard)
			window.clearTimeout(this._tuningApplyGuard);
		this._tuningApplyGuard = null;
	},

	_restoreApplyEnvironment: function() {
		if (this._originalApplyDisplay !== undefined) {
			L.env.apply_display = this._originalApplyDisplay;
			this._originalApplyDisplay = undefined;
		}
		if (this._originalRpcTimeout !== undefined) {
			L.env.rpctimeout = this._originalRpcTimeout;
			this._originalRpcTimeout = undefined;
		}
	},

	_runTuningApply: function() {
		var self = this;
		if (this._originalRpcTimeout === undefined)
			this._originalRpcTimeout = L.env.rpctimeout;
		L.env.rpctimeout = Math.max(Number(L.env.rpctimeout) || 0, TUNING_RPC_TIMEOUT);

		return callTuningApply().then(function(res) {
			return res || { code: 1, output: 'the tuning helper returned nothing' };
		}, function(error) {
			return { code: 1, output: String((error && error.message) || error || 'RPC call failed') };
		}).then(function(res) {
			// rpc.call() reads rpctimeout when the request starts, so restoring it
			// here does not shorten this request.
			if (self._originalRpcTimeout !== undefined) {
				L.env.rpctimeout = self._originalRpcTimeout;
				self._originalRpcTimeout = undefined;
			}
			return res;
		});
	},

	_reportTuningApply: function(res, inApplyModal) {
		if (res.code === 0)
			return true;
		var text = String(res.output || '').replace(/^partial\s*/, '');
		var message = res.code === 2
			? E('p', {}, [
				_('设置已保存，但内核拒绝了以下参数（通常是缺少相应模块）：'),
				E('code', {}, [ text ])
			])
			: E('p', {}, [
				_('无法应用内核网络调优设置：'),
				E('code', {}, [ text ])
			]);

		// During the official apply flow its status modal covers normal page
		// notifications. Reuse that modal so a helper failure remains visible
		// until the delayed official reload.
		if (inApplyModal && ui.changes && typeof ui.changes.displayStatus === 'function')
			ui.changes.displayStatus('warning', message);
		else
			ui.addNotification(null, message, res.code === 2 ? 'warning' : 'error');
		return false;
	},

	_hasPendingChanges: function(changes) {
		if (!changes || typeof changes !== 'object')
			return false;
		for (var config in changes)
			if (Object.prototype.hasOwnProperty.call(changes, config) &&
			    Array.isArray(changes[config]) && changes[config].length)
				return true;
		return false;
	},

	_reloadAfterTuningApply: function() {
		window.location = window.location.href.split('#')[0];
	},

	_armTuningAfterApply: function() {
		var self = this;
		this._clearTuningApplyListeners();
		this._clearTuningApplyGuard();
		this._restoreApplyEnvironment();

		this._tuningAppliedListener = function() {
			var settled = false;
			self._clearTuningApplyListeners();

			// The official handler schedules its reload only after synchronous
			// uci-applied listeners return. Raise the delay now so the helper's
			// 30-second lock wait and RPC response can finish first.
			self._originalApplyDisplay = L.env.apply_display;
			L.env.apply_display = Math.max(Number(L.env.apply_display) || 0, TUNING_RELOAD_DELAY);
			self._tuningApplyGuard = window.setTimeout(function() {
				if (settled)
					return;
				settled = true;
				self._clearTuningApplyGuard();
				self._restoreApplyEnvironment();
				self._reportTuningApply({
					code: 1,
					output: 'the tuning helper did not finish before the client safety deadline'
				}, true);
			}, TUNING_CLIENT_GUARD * 1000);

			self._runTuningApply().then(function(res) {
				if (settled)
					return;
				settled = true;
				self._clearTuningApplyGuard();
				self._restoreApplyEnvironment();
				if (self._reportTuningApply(res, true))
					self._reloadAfterTuningApply();
			});
		};
		this._tuningRevertedListener = function() {
			self._clearTuningApplyListeners();
			self._clearTuningApplyGuard();
			self._restoreApplyEnvironment();
		};
		document.addEventListener('uci-applied', this._tuningAppliedListener);
		document.addEventListener('uci-reverted', this._tuningRevertedListener);
	},

	// handleSave() stages the form values in LuCI's RPC UCI session. The
	// command-line uci used by tuning_apply cannot see that private delta
	// directory until the official apply flow commits it. LuCI 24.10, 25.12
	// and master all dispatch "uci-applied" after that commit and before their
	// delayed page reload, so run the helper from that event instead of
	// chaining from the fire-and-forget parent handleSaveApply().
	handleSaveApply: function(ev, mode) {
		var self = this;
		return this.handleSave(ev).then(function() {
			return uci.changes();
		}).then(function(changes) {
			self._clearTuningApplyListeners();
			self._clearTuningApplyGuard();
			self._restoreApplyEnvironment();
			var pending = self._hasPendingChanges(changes);
			var startOfficialApply = function() {
				try {
					// Match the official LuCI View implementation exactly. This
					// is deliberately invoked once and is not treated as a
					// Promise.
					ui.changes.apply(mode == '0');
				}
				catch (error) {
					self._clearTuningApplyListeners();
					self._clearTuningApplyGuard();
					self._restoreApplyEnvironment();
					throw error;
				}
			};

			if (!pending) {
				// No private UCI delta exists, so the helper already sees the
				// same values as the form. Run it now; the official no-changes
				// branch does not emit uci-applied.
				return self._runTuningApply().then(function(res) {
					self._reportTuningApply(res, false);
					startOfficialApply();
				});
			}

			// A failed/cancelled checked apply may leave the page open without
			// emitting either event. _armTuningAfterApply() removes stale
			// listeners from an earlier attempt, preventing a later success
			// from running the helper twice.
			self._armTuningAfterApply();
			startOfficialApply();
		});
	}
});

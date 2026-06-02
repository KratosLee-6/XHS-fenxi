// 小红书运营工具箱 popup.js — v2.3.0
// Provider 数据统一从 background.js 获取
(function() {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // ========== 全局缓存 ==========
  let _providers = null;

  function setStatus(cls, txt) {
    var dot = $('statusDot');
    var st  = $('statusText');
    if (dot) {
      dot.className = 'status-dot ' + (cls === 'ok' ? 'connected' : cls === 'err' ? 'error' : 'disconnected');
    }
    if (st) {
      st.textContent = txt || '';
      st.style.color = cls === 'ok' ? '#52c41a' : cls === 'err' ? '#ff4d4f' : '#888';
    }
  }

  function showMsg(txt, type) {
    var el = $('msgLine');
    if (!el) return;
    el.textContent = txt;
    el.style.color = type === 'ok' ? '#52c41a' : '#ff4d4f';
    if (type === 'ok') {
      setTimeout(function() { var e = $('msgLine'); if (e) e.textContent = ''; }, 3000);
    }
  }

  function updateApiInfo(cfg) {
    var el = $('apiInfo');
    if (!el) return;
    var key = cfg && cfg.apiKey || '';
    var masked = key ? key.slice(0,6) + '****' + key.slice(-4) : '(未填写)';
    el.textContent = (cfg && cfg.provider || '?').toUpperCase() + ' · ' + (cfg && cfg.model || '') + ' · Key: ' + masked;
  }

  // ========== 渲染服务商按钮 ==========
  function renderProviders(providers, activeKey) {
    var grid = $('provGrid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.keys(providers).forEach(function(key) {
      var p = providers[key];
      var btn = document.createElement('button');
      btn.className = 'prov-btn' + (key === activeKey ? ' selected' : '');
      btn.dataset.p = key;
      btn.dataset.ep = p.endpoint || '';
      btn.dataset.m = p.model || '';
      btn.textContent = p.name || key;
      grid.appendChild(btn);
    });
  }

  function bindProvClicks() {
    document.querySelectorAll('.prov-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.prov-btn').forEach(function(b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        var ep = $('inpEndpoint');
        var m  = $('inpModel');
        if (ep) ep.value = btn.dataset.ep || '';
        if (m)  m.value  = btn.dataset.m || '';
      });
    });
  }

  // ========== 初始化 ==========
  async function init() {
    setStatus('', '加载中…');

    // 1. 从 background 获取 provider 列表
    try {
      var provRes = await chrome.runtime.sendMessage({ action: 'getProviders' });
      if (provRes && provRes.success) {
        _providers = provRes.data;
      }
    } catch (_) {}

    // 2. 加载配置
    chrome.storage.local.get(['xhsConfig'], function(r) {
      var cfg = r && r.xhsConfig;
      var enabled = cfg ? cfg.enabled !== false : true;
      var chk = $('chkEnable');
      if (chk) chk.checked = enabled;

      var hint = $('toggleHint');
      if (hint) hint.textContent = enabled ? '已启用 · 正在运行' : '已停用 · 点击开启';
      setStatus(enabled ? 'ok' : '', enabled ? '已连接' : '已停用');

      if (cfg && cfg.ai) {
        var ai = cfg.ai;
        var ep  = $('inpEndpoint');
        var m   = $('inpModel');
        var key = $('inpKey');
        var tk  = $('inpTokens');
        if (ep)  ep.value  = ai.endpoint || '';
        if (m)   m.value   = ai.model || '';
        if (key) key.value = ai.apiKey || '';
        if (tk)  tk.value  = ai.maxTokens || 2000;
        updateApiInfo(ai);
      }

      // 3. 渲染 provider 按钮
      var activeProvider = (cfg && cfg.ai && cfg.ai.provider) || 'minimax';
      if (_providers) {
        renderProviders(_providers, activeProvider);
        bindProvClicks();
      } else {
        setTimeout(function() {
          if (_providers) {
            renderProviders(_providers, activeProvider);
            bindProvClicks();
          }
        }, 400);
      }
    });

    // 检测当前页面
    chrome.tabs.query({active:true, currentWindow:true}, function(tabs) {
      var tab = tabs && tabs[0];
      var badge = $('pageBadge');
      if (!badge) return;
      if (tab && tab.url && (tab.url.indexOf('xiaohongshu') !== -1 || tab.url.indexOf('xhs.cn') !== -1)) {
        badge.textContent = '📕 ' + (tab.title||'').slice(0,35);
        badge.className = 'page-badge xhs';
      } else {
        badge.textContent = '⚠️ 非小红书页面，功能受限';
        badge.className = 'page-badge other';
      }
    });
  }

  // ========== 事件绑定 ==========
  function bind() {
    // 插件开关
    var chk = $('chkEnable');
    if (chk) {
      chk.addEventListener('change', function() {
        var hint = $('toggleHint');
        if (hint) hint.textContent = chk.checked ? '已启用 · 正在运行' : '已停用 · 点击开启';
        setStatus(chk.checked ? 'ok' : '', chk.checked ? '已连接' : '已停用');
        chrome.storage.local.get(['xhsConfig'], function(r) {
          var cfg = (r && r.xhsConfig) || {};
          cfg.enabled = chk.checked;
          chrome.storage.local.set({xhsConfig: cfg});
        });
      });
    }

    // 打开侧边栏
    var btnSide = $('btnSidePanel');
    if (btnSide) {
      btnSide.addEventListener('click', function() {
        chrome.tabs.create({ url: 'sidepanel/sidepanel.html', active: true });
      });
    }

    // 抓取笔记
    var btnScrape = $('btnScrape');
    if (btnScrape) {
      btnScrape.addEventListener('click', function() {
        btnScrape.disabled = true;
        btnScrape.textContent = '⏳ 抓取中…';
        chrome.tabs.query({active:true, currentWindow:true}, function(tabs) {
          var tab = tabs && tabs[0];
          if (!tab) {
            resetScrapeBtn(btnScrape, '无法获取标签页');
            return;
          }
          chrome.tabs.sendMessage(tab.id, {action:'scrape'}, function(res) {
            btnScrape.disabled = false;
            btnScrape.textContent = '📥 抓取笔记';
            if (chrome.runtime.lastError) {
              var badge = $('pageBadge');
              if (badge) { badge.textContent = '⚠️ 请刷新小红书页面后重试'; badge.className = 'page-badge other'; }
              setStatus('err', '未检测到页面');
              return;
            }
            if (res && res.success) {
              var t = (res.data && res.data.title) || '无标题';
              setStatus('ok', '抓取成功');
              var badge = $('pageBadge');
              if (badge) { badge.textContent = '✅ ' + t.slice(0,30); badge.className = 'page-badge xhs'; }
            } else {
              setStatus('err', '抓取失败');
              var badge = $('pageBadge');
              if (badge) { badge.textContent = '❌ ' + (res&&res.error||'未知错误'); badge.className = 'page-badge other'; }
            }
          });
        });
      });
    }

    // 设置面板折叠
    var setHdr   = $('settingsHeader');
    var setBody  = $('settingsBody');
    var setArrow = $('settingsArrow');
    if (setHdr && setBody && setArrow) {
      setHdr.addEventListener('click', function() {
        var open = setBody.classList.contains('open');
        if (open) {
          setBody.classList.remove('open');
          setArrow.classList.remove('open');
        } else {
          setBody.classList.add('open');
          setArrow.classList.add('open');
        }
      });
    }

    // 保存设置
    var btnSave = $('btnSave');
    if (btnSave) {
      btnSave.addEventListener('click', function() {
        var ep  = $('inpEndpoint') ? $('inpEndpoint').value.trim() : '';
        var m   = $('inpModel')    ? $('inpModel').value.trim()    : '';
        var key = $('inpKey')      ? $('inpKey').value.trim()      : '';
        var tk  = $('inpTokens')   ? (parseInt($('inpTokens').value) || 2000) : 2000;

        if (!ep)  { showMsg('请填写 API 地址', 'err'); return; }
        if (!m)   { showMsg('请填写模型名称',   'err'); return; }
        if (!key) { showMsg('请填写 API Key',   'err'); return; }

        var sel = document.querySelector('.prov-btn.selected');
        var provider = sel ? sel.dataset.p : 'custom';
        var newAi = { provider: provider, endpoint: ep, model: m, apiKey: key, maxTokens: tk, temperature: 0.7 };

        chrome.storage.local.get(['xhsConfig'], function(r) {
          var cfg = r && r.xhsConfig || { enabled: true };
          cfg.ai = newAi;
          chrome.storage.local.set({xhsConfig: cfg}, function() {
            if (chrome.runtime.lastError) {
              showMsg('保存失败：' + chrome.runtime.lastError.message, 'err');
              return;
            }
            showMsg('✅ 设置已保存', 'ok');
            updateApiInfo(newAi);
          });
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    bind();
    init();
  });
})();

// XHS Assistant popup.js — MV3 external script
(function() {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function setDot(cls, txt) {
    var dot = $('dotEl');
    var st  = $('statusEl');
    if (dot) {
      dot.className = 'dot' + (cls ? ' ' + cls : '');
      dot.style.background = cls === 'ok' ? '#52c41a' : cls === 'err' ? '#ff4d4f' : '#ccc';
    }
    if (st) {
      st.textContent = txt || '';
      st.style.color = cls === 'ok' ? '#52c41a' : cls === 'err' ? '#ff4d4f' : '#888';
    }
  }

  function showMsg(txt, type) {
    var el = $('msgEl');
    if (!el) return;
    el.textContent = txt;
    el.style.color = type === 'ok' ? '#52c41a' : '#ff4d4f';
    if (type === 'ok') {
      setTimeout(function() { var e = $('msgEl'); if (e) e.textContent = ''; }, 3000);
    }
  }

  function updateCurApi(cfg) {
    var el = $('curApiEl');
    if (!el) return;
    var key = cfg && cfg.apiKey || '';
    var masked = key ? key.slice(0,6) + '****' + key.slice(-4) : '(empty)';
    el.textContent = (cfg && cfg.provider || '?').toUpperCase() + ' | ' + (cfg && cfg.model || '') + ' | Key:' + masked;
  }

  function syncProv(p) {
    document.querySelectorAll('.prov').forEach(function(b) {
      b.classList.toggle('sel', b.dataset.p === p);
    });
  }

  function init() {
    setDot('', 'Loading...');

    chrome.storage.local.get(['xhsConfig'], function(r) {
      var cfg = r && r.xhsConfig;
      var enabled = cfg ? cfg.enabled !== false : true;
      var chk = $('chkEl');
      if (chk) chk.checked = enabled;
      setDot(enabled ? 'ok' : '', enabled ? 'Enabled' : 'Disabled');

      if (cfg && cfg.ai) {
        var ai = cfg.ai;
        var ep  = $('inpEp');
        var m   = $('inpM');
        var key = $('inpKey');
        var tk  = $('inpTk');
        if (ep)  ep.value  = ai.endpoint || '';
        if (m)   m.value   = ai.model || '';
        if (key) key.value = ai.apiKey || '';
        if (tk)  tk.value  = ai.maxTokens || 2000;
        syncProv(ai.provider || 'minimax');
        updateCurApi(ai);
      }
    });

    chrome.tabs.query({active:true, currentWindow:true}, function(tabs) {
      var tab = tabs && tabs[0];
      var pel = $('pageEl');
      if (!pel) return;
      if (tab && tab.url && tab.url.indexOf('xiaohongshu') !== -1) {
        pel.textContent = 'XHS: ' + (tab.title||'').slice(0,50);
        pel.style.color = '#52c41a';
      } else {
        pel.textContent = 'Not XHS - open a note first';
        pel.style.color = '#888';
      }
    });
  }

  function bind() {
    // enable toggle
    var chk = $('chkEl');
    if (chk) {
      chk.addEventListener('change', function() {
        setDot(chk.checked ? 'ok' : '', chk.checked ? 'Enabled' : 'Disabled');
        chrome.storage.local.get(['xhsConfig'], function(r) {
          var cfg = r && r.xhsConfig || { enabled: true };
          cfg.enabled = chk.checked;
          chrome.storage.local.set({xhsConfig: cfg});
        });
      });
    }

    // sidepanel
    var btnSide = $('btnSide');
    if (btnSide) {
      btnSide.addEventListener('click', function() {
        // 直接打开 sidepanel.html 为新标签页，最可靠的方式
        chrome.tabs.create({ url: 'sidepanel/sidepanel.html', active: true });
      });
    }

    // scrape
    var btnScp = $('btnScp');
    if (btnScp) {
      btnScp.addEventListener('click', function() {
        btnScp.disabled = true;
        btnScp.textContent = 'Scraping...';
        chrome.tabs.query({active:true, currentWindow:true}, function(tabs) {
          var tab = tabs && tabs[0];
          if (!tab) {
            btnScp.disabled = false;
            btnScp.textContent = 'Scrape This Page';
            var pel = $('pageEl');
            if (pel) { pel.textContent = 'Cannot get tab'; pel.style.color='#ff4d4f'; }
            return;
          }
          chrome.tabs.sendMessage(tab.id, {action:'scrape'}, function(res) {
            btnScp.disabled = false;
            btnScp.textContent = 'Scrape This Page';
            if (chrome.runtime.lastError) {
              var pel = $('pageEl');
              if (pel) { pel.textContent = 'Content script not loaded. Refresh XHS page.'; pel.style.color='#ff4d4f'; }
              setDot('err', 'Error');
              return;
            }
            if (res && res.success) {
              var t = (res.data && res.data.title) || 'No title';
              var pel = $('pageEl');
              if (pel) { pel.textContent = 'OK: ' + t.slice(0,40); pel.style.color='#52c41a'; }
              setDot('ok', 'Done');
            } else {
              var pel = $('pageEl');
              if (pel) { pel.textContent = 'Error: ' + (res&&res.error||'Unknown'); pel.style.color='#ff4d4f'; }
              setDot('err', 'Error');
            }
          });
        });
      });
    }

    // settings toggle
    var setHdr   = $('setHdr');
    var setBody  = $('setBody');
    var setArrow = $('setArrow');
    if (setHdr && setBody) {
      setHdr.addEventListener('click', function() {
        var open = setBody.style.display === 'block';
        setBody.style.display = open ? 'none' : 'block';
        if (setArrow) setArrow.style.transform = open ? '' : 'rotate(180deg)';
      });
    }

    // provider buttons
    document.querySelectorAll('.prov').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.prov').forEach(function(b) { b.classList.remove('sel'); });
        btn.classList.add('sel');
        var ep = $('inpEp');
        var m  = $('inpM');
        if (ep) ep.value = btn.dataset.ep || '';
        if (m)  m.value  = btn.dataset.m || '';
      });
    });

    // save config
    var btnSv = $('btnSv');
    if (btnSv) {
      btnSv.addEventListener('click', function() {
        var ep  = $('inpEp')   ? $('inpEp').value.trim()   : '';
        var m   = $('inpM')   ? $('inpM').value.trim()     : '';
        var key = $('inpKey') ? $('inpKey').value.trim()  : '';
        var tk  = $('inpTk')  ? (parseInt($('inpTk').value) || 2000) : 2000;

        if (!ep)  { showMsg('Fill Endpoint', 'err'); return; }
        if (!m)   { showMsg('Fill Model',     'err'); return; }
        if (!key) { showMsg('Fill API Key',   'err'); return; }

        var sel = document.querySelector('.prov.sel');
        var provider = sel ? sel.dataset.p : 'custom';
        var newAi = { provider: provider, endpoint: ep, model: m, apiKey: key, maxTokens: tk, temperature: 0.7 };

        chrome.storage.local.get(['xhsConfig'], function(r) {
          var cfg = r && r.xhsConfig || { enabled: true };
          cfg.ai = newAi;
          chrome.storage.local.set({xhsConfig: cfg}, function() {
            if (chrome.runtime.lastError) {
              showMsg('Save failed: ' + chrome.runtime.lastError.message, 'err');
              return;
            }
            showMsg('Saved OK', 'ok');
            updateCurApi(newAi);
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

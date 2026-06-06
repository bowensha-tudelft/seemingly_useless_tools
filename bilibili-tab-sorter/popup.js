var listEl = document.getElementById('list');
var statusEl = document.getElementById('status');
var summaryEl = document.getElementById('summary');
var refreshBtn = document.getElementById('btn-refresh');
var sortBtn = document.getElementById('btn-sort');
var wakeBtn = document.getElementById('btn-wake');

var biliTabData = [];
var pinnedUrls = {}; // fast lookup: { canonicalUrl: true }

// ---------- pinned tab storage ----------
function canonical(url) {
  var u = (url || '').split('?')[0].split('#')[0];
  if (u.slice(-1) === '/') u = u.slice(0, -1);
  return u;
}

function loadPinned() {
  return chrome.storage.local.get('pinnedUrls').then(function (r) {
    var arr = r.pinnedUrls || [];
    pinnedUrls = {};
    arr.forEach(function (u) { pinnedUrls[u] = true; });
  });
}

function savePinned() {
  return chrome.storage.local.set({ pinnedUrls: Object.keys(pinnedUrls) });
}

// ---------- injected into Bilibili pages ----------
function extractDuration() {
  var dur = null;
  var flags = [];

  // A) Direct window.__INITIAL_STATE__ (MAIN world)
  try {
    var s = window.__INITIAL_STATE__;
    if (s) {
      flags.push('win-init-ok');
      var vd = s.videoData || s.videoInfo || s.epInfo || s.mediaInfo || {};
      if (vd && typeof vd.duration === 'number' && vd.duration > 0) {
        dur = vd.duration;
        flags.push('got-dur-main');
        return { d: dur, f: flags.join(',') };
      }
      if (vd && typeof vd.timelength === 'number' && vd.timelength > 0) {
        dur = vd.timelength;
        flags.push('got-len-main');
        return { d: dur, f: flags.join(',') };
      }
      var nested = s.epList || s.sections || s.pages || [];
      if (nested.length > 0 && typeof nested[0].duration === 'number' && nested[0].duration > 0) {
        dur = nested[0].duration;
        flags.push('got-nested');
        return { d: dur, f: flags.join(',') };
      }
      for (var k in s) {
        if (s.hasOwnProperty(k)) {
          var v = s[k];
          if (v && typeof v.duration === 'number' && v.duration > 0) {
            dur = v.duration;
            flags.push('got-key-' + k);
            return { d: dur, f: flags.join(',') };
          }
          if (v && typeof v.timelength === 'number' && v.timelength > 0) {
            dur = v.timelength;
            flags.push('got-key-' + k);
            return { d: dur, f: flags.join(',') };
          }
        }
      }
      flags.push('win-no-dur');
    } else {
      flags.push('win-init-null');
    }
  } catch (_) { flags.push('win-init-err'); }

  // B) Parse __INITIAL_STATE__ from inline script tag text
  try {
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || '';
      var idx = text.indexOf('__INITIAL_STATE__');
      if (idx === -1) continue;
      flags.push('has-script');

      var start = text.indexOf('{', idx);
      if (start === -1) { flags.push('no-brace'); break; }

      var depth = 0, inDQ = false, inSQ = false, inTK = false, esc = false;
      for (var j = start; j < text.length; j++) {
        var ch = text[j];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"' && !inSQ && !inTK) { inDQ = !inDQ; continue; }
        if (ch === "'" && !inDQ && !inTK) { inSQ = !inSQ; continue; }
        if (ch === '`' && !inDQ && !inSQ) { inTK = !inTK; continue; }
        if (inDQ || inSQ || inTK) continue;
        if (ch === '{') { depth++; }
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              var data = JSON.parse(text.substring(start, j + 1));
              var vd2 = data && (data.videoData || data.videoInfo || data.epInfo || data.mediaInfo || {});
              if (vd2 && typeof vd2.duration === 'number' && vd2.duration > 0) {
                if (dur == null) dur = vd2.duration;
                flags.push('parsed-dur');
              } else if (vd2 && typeof vd2.timelength === 'number' && vd2.timelength > 0) {
                if (dur == null) dur = vd2.timelength;
                flags.push('parsed-len');
              } else {
                for (var dk in data) {
                  if (data.hasOwnProperty(dk) && data[dk] && typeof data[dk].duration === 'number' && data[dk].duration > 0) {
                    if (dur == null) dur = data[dk].duration;
                    flags.push('scan-' + dk);
                    break;
                  }
                }
                if (dur == null) flags.push('parsed-no-dur');
              }
            } catch (_) { flags.push('json-err'); }
            break;
          }
        }
      }
      if (depth > 0) flags.push('depth-' + depth);
      break;
    }
    if (flags.indexOf('has-script') === -1) flags.push('no-script');
  } catch (_) {}

  // C) JSON-LD
  try {
    var ldList = document.querySelectorAll('script[type="application/ld+json"]');
    for (var li = 0; li < ldList.length; li++) {
      var json = JSON.parse(ldList[li].textContent);
      var items = Array.isArray(json) ? json : [json];
      for (var mi = 0; mi < items.length; mi++) {
        var durStr = items[mi].duration;
        if (typeof durStr === 'string') {
          var pm = durStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          if (pm) {
            if (dur == null) dur = (parseInt(pm[1]||'0')*3600)+(parseInt(pm[2]||'0')*60)+(parseInt(pm[3]||'0'));
            flags.push('jsonld');
          }
        }
      }
    }
  } catch (_) {}

  // D) Meta tag
  try {
    var meta = document.querySelector('meta[itemprop="duration"]');
    if (meta) {
      flags.push('meta');
      if (dur == null) {
        var mc = meta.getAttribute('content').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (mc) dur = (parseInt(mc[1]||'0')*3600)+(parseInt(mc[2]||'0')*60)+(parseInt(mc[3]||'0'));
      }
    }
  } catch (_) {}

  // E) Player time display
  try {
    var el = document.querySelector('.bilibili-player-video-time-total');
    if (el) {
      flags.push('player');
      if (dur == null) {
        var parts = el.textContent.trim().split(':');
        if (parts.length === 3) dur = parseInt(parts[0])*3600+parseInt(parts[1])*60+parseInt(parts[2]);
        else if (parts.length === 2) dur = parseInt(parts[0])*60+parseInt(parts[1]);
      }
    }
  } catch (_) {}

  return { d: dur, f: flags.join(',') };
}
// -----------------------------------------------

function fmt(sec) {
  if (sec == null) return '--';
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  return m + ':' + String(s).padStart(2,'0');
}

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function flagShort(flags) {
  if (!flags) return '';
  if (flags.indexOf('got-dur-main') !== -1) return 'MAIN✓';
  if (flags.indexOf('got-len-main') !== -1) return 'MAIN len';
  if (flags.indexOf('got-nested') !== -1) return 'nested';
  if (flags.indexOf('got-key-') !== -1) return 'scanned';
  if (flags.indexOf('win-no-dur') !== -1) return '无时长';
  if (flags.indexOf('win-init-null') !== -1) return '无INIT';
  if (flags.indexOf('win-init-err') !== -1) return 'window错误';
  if (flags.indexOf('parsed-dur') !== -1) return 'DOM✓';
  if (flags.indexOf('parsed-len') !== -1) return 'DOM len';
  if (flags.indexOf('scan-') !== -1) return 'scanned';
  if (flags.indexOf('parsed-no-dur') !== -1) return 'JSON无dur';
  if (flags.indexOf('json-err') !== -1) return 'JSON坏';
  if (flags.indexOf('depth-') !== -1) {
    var dm = flags.match(/depth-(\d+)/);
    return '缺括号' + (dm ? dm[1] : '');
  }
  if (flags.indexOf('has-script') !== -1) return '解析失败';
  if (flags.indexOf('no-script') !== -1 && flags.indexOf('jsonld') !== -1) return 'jsonld';
  if (flags.indexOf('no-script') !== -1 && flags.indexOf('meta') !== -1) return 'meta';
  if (flags.indexOf('no-script') !== -1 && flags.indexOf('player') !== -1) return 'player';
  if (flags.indexOf('no-script') !== -1) return '无script';
  return '?';
}

function flagDetail(flags) {
  if (!flags) return '';
  var map = {
    'got-dur-main': '从window读到duration',
    'got-len-main': '读到了timelength',
    'got-nested': '从嵌套列表读取',
    'got-key-': '扫描顶层key找到',
    'win-no-dur': '有INITIAL_STATE但无duration',
    'win-init-null': 'INITIAL_STATE为undefined',
    'win-init-err': '读取window时出错',
    'parsed-dur': '从script标签解析到duration',
    'parsed-len': '从script解析到timelength',
    'scan-': '扫描initState keys找到',
    'parsed-no-dur': 'JSON有数据但无时长',
    'json-err': 'JSON.parse失败',
    'depth-': '大括号不匹配',
    'no-brace': '找不到开头{',
    'has-script': '找到含INIT的script',
    'no-script': '没找到含INIT的script',
    'jsonld': '找到JSON-LD',
    'meta': '找到meta标签',
    'player': '找到播放器元素'
  };
  return flags.split(',').map(function(f) {
    var t = f.trim();
    if (map[t]) return map[t];
    for (var k in map) {
      if (map.hasOwnProperty(k) && t.indexOf(k) === 0) return map[k];
    }
    return t;
  }).join(' | ');
}

// ---------- load / render ----------
async function loadTabs() {
  refreshBtn.disabled = true;
  sortBtn.disabled = true;
  wakeBtn.style.display = 'none';
  listEl.innerHTML = '<div class="empty">正在读取标签页...</div>';
  statusEl.textContent = '';
  summaryEl.textContent = '';

  await loadPinned();

  var tabs = await chrome.tabs.query({
    url: ['*://*.bilibili.com/*', '*://bilibili.com/*'],
    currentWindow: true
  });

  // Clean up stale pinned URLs (tabs that no longer exist)
  var liveUrls = {};
  tabs.forEach(function (t) { liveUrls[canonical(t.url)] = true; });
  var changed = false;
  Object.keys(pinnedUrls).forEach(function (u) {
    if (!liveUrls[u]) { delete pinnedUrls[u]; changed = true; }
  });
  if (changed) savePinned();

  if (tabs.length === 0) {
    biliTabData = [];
    listEl.innerHTML = '<div class="empty">没有找到已打开的B站标签页</div>';
    refreshBtn.disabled = false;
    return;
  }

  var activeTabs = [];
  var discardedTabs = [];
  var pinnedTabs = [];

  tabs.forEach(function (tab) {
    if (pinnedUrls[canonical(tab.url)]) {
      pinnedTabs.push(tab);
    } else if (tab.discarded) {
      discardedTabs.push(tab);
    } else {
      activeTabs.push(tab);
    }
  });

  // Inject into active (non-pinned) tabs
  var activeResults = activeTabs.length > 0
    ? await Promise.all(activeTabs.map(function (tab) {
        return chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractDuration,
          world: 'MAIN'
        }).then(function (r) {
          var obj = (r[0].result && typeof r[0].result === 'object') ? r[0].result : { d: null, f: 'bad' };
          return {
            tab: tab, duration: (obj.d != null && typeof obj.d === 'number') ? obj.d : null,
            flags: obj.f || '', discarded: false, pinned: false
          };
        }).catch(function () {
          return { tab: tab, duration: null, flags: 'inject-fail', discarded: true, pinned: false };
        });
      }))
    : [];

  var discardedResults = discardedTabs.map(function (tab) {
    return { tab: tab, duration: null, flags: '休眠', discarded: true, pinned: false };
  });

  var pinnedResults = pinnedTabs.map(function (tab) {
    return { tab: tab, duration: null, flags: '已固定', discarded: false, pinned: true };
  });

  biliTabData = activeResults.concat(discardedResults).concat(pinnedResults).map(function (r) {
    return {
      id: r.tab.id, title: (r.tab.title || '').split(/[\-_\[\]\(\)]/)[0].trim() || '(无标题)',
      url: r.tab.url, index: r.tab.index,
      duration: r.duration, flags: r.flags, discarded: r.discarded, pinned: r.pinned
    };
  });

  renderList();
  refreshBtn.disabled = false;
  sortBtn.disabled = sortableCount() === 0;
}

function sortableCount() {
  return biliTabData.filter(function (t) { return !t.discarded && !t.pinned && t.duration != null; }).length;
}

function renderList() {
  var videoCount = biliTabData.filter(function (t) { return t.duration != null; }).length;
  var sleepCount = biliTabData.filter(function (t) { return t.discarded; }).length;
  var pinCount   = biliTabData.filter(function (t) { return t.pinned; }).length;
  var nonVideoCount = biliTabData.length - videoCount - sleepCount - pinCount;

  // Total duration of non-pinned video tabs
  var totalSec = 0;
  biliTabData.forEach(function (t) {
    if (!t.pinned && !t.discarded && t.duration != null) totalSec += t.duration;
  });
  var totalStr = '';
  if (totalSec > 0) {
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    totalStr = h > 0 ? h + ' 小时 ' + m + ' 分钟' : m + ' 分钟';
  }

  var parts = [biliTabData.length + ' 个标签页'];
  if (videoCount > 0) parts.push(videoCount + ' 个视频');
  if (sleepCount > 0) parts.push(sleepCount + ' 个休眠');
  if (pinCount > 0) parts.push(pinCount + ' 个已固定');
  if (nonVideoCount > 0) parts.push(nonVideoCount + ' 个无时长');
  summaryEl.textContent = parts.join('，') + (totalStr ? ' — 未固定视频共约 ' + totalStr : '');

  if (biliTabData.length === 0) {
    listEl.innerHTML = '<div class="empty">没有找到已打开的B站标签页</div>';
    return;
  }

  var byIndex = [].concat(biliTabData).sort(function (a, b) { return a.index - b.index; });

  listEl.innerHTML = byIndex.map(function (t) {
    var cu = canonical(t.url);
    var pinIcon = pinnedUrls[cu]
      ? '<span class="pin-btn on" data-tab-url="' + esc(cu) + '" title="取消固定">📍</span>'
      : '<span class="pin-btn" data-tab-url="' + esc(cu) + '" title="固定此标签页">📌</span>';

    if (t.pinned) {
      return '<div class="tab-item pinned">' +
        '<span class="index">#' + (t.index + 1) + '</span>' +
        '<span class="title" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
        '<span class="tag pin">已固定</span>' +
        pinIcon +
        '</div>';
    }

    if (t.discarded) {
      return '<div class="tab-item sleep">' +
        '<span class="index">#' + (t.index + 1) + '</span>' +
        '<span class="title" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
        '<span class="tag sleep">休眠</span>' +
        pinIcon +
        '</div>';
    }

    var fl = flagShort(t.flags);
    var tip = flagDetail(t.flags);
    var right;
    if (t.duration != null) {
      right = '<span class="duration" title="' + esc(tip) + '">' + fmt(t.duration) + '</span>';
    } else {
      right = '<span class="duration na" title="' + esc(tip) + '">--</span>' +
              '<span class="tag diag" title="' + esc(tip) + '">' + esc(fl) + '</span>';
    }

    return '<div class="tab-item">' +
      '<span class="index">#' + (t.index + 1) + '</span>' +
      '<span class="title" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
      right +
      pinIcon +
      '</div>';
  }).join('');

  if (sleepCount > 0) {
    wakeBtn.style.display = 'block';
    var wakeable = biliTabData.filter(function (t) { return t.discarded && !t.pinned; }).length;
    wakeBtn.textContent = '💤 唤醒 ' + wakeable + ' 个休眠标签';
    wakeBtn.disabled = wakeable === 0;
  } else {
    wakeBtn.style.display = 'none';
  }
}

// ---------- pin toggle ----------
async function togglePin(url) {
  if (pinnedUrls[url]) {
    delete pinnedUrls[url];
  } else {
    pinnedUrls[url] = true;
  }
  await savePinned();
  await loadTabs();
}

listEl.addEventListener('click', function (e) {
  var btn = e.target.closest('.pin-btn');
  if (!btn) return;
  var url = btn.dataset.tabUrl;
  if (url) togglePin(url);
});

// ---------- wake ----------
async function wakeTabs() {
  var discarded = biliTabData.filter(function (t) { return t.discarded && !t.pinned; });
  if (discarded.length === 0) return;

  wakeBtn.disabled = true;
  refreshBtn.disabled = true;
  sortBtn.disabled = true;

  var total = discarded.length;
  for (var i = 0; i < discarded.length; i++) {
    statusEl.textContent = '唤醒中 ' + (i + 1) + ' / ' + total + ' ...';
    statusEl.className = 'status';
    try { chrome.tabs.reload(discarded[i].id); } catch (_) {}
    if (i < discarded.length - 1) {
      await new Promise(function (r) { setTimeout(r, 200); });
    }
  }

  statusEl.textContent = '等待 ' + total + ' 个标签页加载完成...';
  var start = Date.now();
  var maxWait = 30000;

  while (Date.now() - start < maxWait) {
    await new Promise(function (r) { setTimeout(r, 1000); });
    var pending = 0;
    for (var j = 0; j < discarded.length; j++) {
      try { var t = await chrome.tabs.get(discarded[j].id); if (t.status !== 'complete') pending++; } catch (_) {}
    }
    statusEl.textContent = '等待加载: ' + pending + ' / ' + total + ' 剩余...';
    if (pending === 0) break;
  }

  statusEl.textContent = '';
  statusEl.className = 'status';
  await loadTabs();
}

// ---------- sort ----------
async function sortTabs() {
  sortBtn.disabled = true;
  refreshBtn.disabled = true;
  statusEl.textContent = '正在排序...';
  statusEl.className = 'status';

  var allTabs = await chrome.tabs.query({ currentWindow: true });
  var biliIds = {};
  biliTabData.forEach(function (t) { biliIds[t.id] = true; });

  // Sortable: non-pinned, non-discarded, with duration
  var sortable = [].concat(biliTabData)
    .filter(function (t) { return !t.pinned && !t.discarded && t.duration != null; })
    .sort(function (a, b) { return a.duration - b.duration; });

  // Other non-pinned Bilibili tabs (discarded or no duration) — keep relative order
  var others = [].concat(biliTabData)
    .filter(function (t) { return !t.pinned && (t.discarded || t.duration == null); })
    .sort(function (a, b) { return a.index - b.index; });

  var reordered = sortable.concat(others);
  var cursor = 0;
  var desired = allTabs.map(function (t) {
    if (pinnedUrls[canonical(t.url)]) return t.id;  // pinned → stays in place
    if (biliIds[t.id]) return reordered[cursor++].id; // other bilibili → reordered
    return t.id;                              // non-bilibili → stays in place
  });

  for (var pos = 0; pos < desired.length; pos++) {
    var currentTabs = await chrome.tabs.query({ currentWindow: true });
    if (currentTabs[pos] && currentTabs[pos].id !== desired[pos]) {
      await chrome.tabs.move(desired[pos], { index: pos });
    }
  }

  statusEl.textContent = '排序完成';
  statusEl.className = 'status ok';
  await loadTabs();
}

refreshBtn.addEventListener('click', loadTabs);
sortBtn.addEventListener('click', sortTabs);
wakeBtn.addEventListener('click', wakeTabs);
loadTabs();

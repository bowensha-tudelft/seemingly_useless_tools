(function() {
  'use strict';

  var PRICING = {
    'deepseek-v4-pro': {
      'Input (Cache hit)':  0.025,
      'Input (Cache miss)': 3,
      'Output':             6
    },
    'deepseek-v4-flash': {
      'Input (Cache hit)':  0.02,
      'Input (Cache miss)': 1,
      'Output':             2
    }
  };

  var TOKEN_TYPES = ['Input (Cache hit)', 'Input (Cache miss)', 'Output'];

  function parseTokenCount(text) {
    var m = text.match(/([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatPrice(price) {
    if (price === 0) return '¥0';
    if (price < 0.01) return '<¥0.01';
    return '¥' + (Math.floor(price * 100) / 100).toFixed(2);
  }

  function alreadyHasPrice(text) {
    return /[¥￥]\s*[\d.]+/.test(text);
  }

  // ---- model detection (position-based) ----

  function findModelForTooltip(tooltipEl) {
    var tr = tooltipEl.getBoundingClientRect();
    var midY = tr.top + tr.height / 2;
    var best = null, bestD = Infinity;

    var walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT,
      { acceptNode: function(n) {
          var t = n.textContent;
          if (t.indexOf('deepseek-v4-pro') !== -1) return NodeFilter.FILTER_ACCEPT;
          if (t.indexOf('deepseek-v4-flash') !== -1) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_REJECT;
        }}
    );

    var node;
    while ((node = walker.nextNode())) {
      var p = node.parentElement;
      if (!p || p === tooltipEl || tooltipEl.contains(p)) continue;
      var r = p.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom > midY + 60) continue;
      var d = midY - r.bottom;
      if (d >= 0 && d < bestD) {
        var txt = node.textContent;
        if (txt.indexOf('deepseek-v4-pro') !== -1) { best = 'deepseek-v4-pro'; bestD = d; }
        else if (txt.indexOf('deepseek-v4-flash') !== -1) { best = 'deepseek-v4-flash'; bestD = d; }
      }
    }
    return best;
  }

  // ============================================================
  // Process one tooltip element.
  //
  // We collect text nodes containing "xxx tokens" in document order.
  // The order is always: total, cache-hit, cache-miss, output.
  // This works regardless of the DOM structure (flex columns, tables, etc.)
  // ============================================================
  function processTooltip(el) {
    var fullText = el.textContent || '';
    // Support both English and Chinese UI
    var hasTokens = /tokens?/i.test(fullText);
    var hasInput  = fullText.indexOf('Input') !== -1 || fullText.indexOf('输入') !== -1;
    if (!hasTokens || !hasInput) return;
    if (alreadyHasPrice(fullText)) return;

    var model = findModelForTooltip(el);
    if (!model) return;
    var pricing = PRICING[model];

    // Gather text nodes with "xxx tokens" in document order
    var walker = document.createTreeWalker(
      el, NodeFilter.SHOW_TEXT,
      { acceptNode: function(n) {
          // Support "xxx tokens", "xxx token", "xxx 个 token", etc.
          return /\d[\d,]*\s*(?:个\s*)?tokens?/i.test(n.textContent)
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }}
    );

    var nodes = [];
    var node;
    while ((node = walker.nextNode())) { nodes.push(node); }

    if (nodes.length < 4) return;

    // nodes[0] = total, nodes[1] = cache-hit, nodes[2] = cache-miss, nodes[3] = output
    var ITEM_TYPES = ['Input (Cache hit)', 'Input (Cache miss)', 'Output'];

    var modifications = [];
    var totalPrice = 0;

    for (var i = 0; i < ITEM_TYPES.length && (i + 1) < nodes.length; i++) {
      var count = parseTokenCount(nodes[i + 1].textContent);
      if (count === null) continue;

      var unitPrice = pricing[ITEM_TYPES[i]];
      if (unitPrice === undefined) continue;

      var price = (count / 1000000) * unitPrice;
      totalPrice += price;
      modifications.push({ node: nodes[i + 1], count: count, price: price });
    }

    if (modifications.length === 0) return;

    // ---- alignment ----
    var maxLen = 0;
    for (var k = 0; k < modifications.length; k++) {
      var s = formatNumber(modifications[k].count);
      if (s.length > maxLen) maxLen = s.length;
    }
    var totalCount = parseTokenCount(nodes[0].textContent);
    var totalFmt = totalCount ? formatNumber(totalCount) : '';
    if (totalFmt.length > maxLen) maxLen = totalFmt.length;

    // ---- apply ----
    for (var k = 0; k < modifications.length; k++) {
      var m = modifications[k];
      var padded = formatNumber(m.count);
      if (padded.length < maxLen) {
        padded = new Array(maxLen - padded.length + 1).join(' ') + padded;
      }
      m.node.textContent = padded + ' tokens, ' + formatPrice(m.price);
    }

    if (totalCount && totalPrice > 0 && !alreadyHasPrice(nodes[0].textContent)) {
      var pt = totalFmt;
      if (pt.length < maxLen) {
        pt = new Array(maxLen - pt.length + 1).join(' ') + pt;
      }
      nodes[0].textContent = pt + ' tokens, ' + formatPrice(totalPrice);
    }
  }

  // ---- scanner ----

  function scan() {
    var tips = document.querySelectorAll('.recharts-tooltip-wrapper');
    for (var i = 0; i < tips.length; i++) { processTooltip(tips[i]); }

    var cs = document.querySelectorAll('div, span, section');
    for (var i = 0; i < cs.length; i++) {
      var el = cs[i];
      var style = window.getComputedStyle(el);
      if ((style.position === 'absolute' || style.position === 'fixed') &&
          el.offsetWidth > 0 && el.offsetHeight > 0) {
        processTooltip(el);
      }
    }
  }

  scan();
  setInterval(scan, 800);
  var observer = new MutationObserver(function(muts) {
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].addedNodes.length > 0 || muts[i].type === 'characterData') {
        scan(); break;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();

// Kasi Rails "Today": what was paid, for what, and its status. Owner PIN required.
(function () {
  'use strict';

  var REFRESH_MS = 5000;
  var PIN_KEY = 'kasi-rails.owner-pin'; // shared with the top-up page
  var EXPLORER = 'https://sepolia.basescan.org/tx/';

  var $ = function (id) { return document.getElementById(id); };
  var pin = '';
  var timer = null;
  var refunding = {}; // order id -> true while a refund is being sent

  function show(name) {
    $('screen-pin').hidden = name !== 'pin';
    $('screen-today').hidden = name !== 'today';
  }

  function formatRand(cents) {
    var rands = Math.floor(cents / 100);
    var c = String(cents % 100).padStart(2, '0');
    return 'R' + String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + c;
  }

  function shortCode(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }

  function time(iso) {
    var d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function savedPin() {
    try { return sessionStorage.getItem(PIN_KEY) || ''; } catch (e) { return pin; }
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json', 'x-owner-pin': savedPin() || pin }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) { var err = new Error(body.error || 'Request failed (' + res.status + ')'); err.code = body.code; throw err; }
        return body;
      });
    });
  }

  function lock(message) {
    if (timer) { clearInterval(timer); timer = null; }
    try { sessionStorage.removeItem(PIN_KEY); } catch (e) { /* ignore */ }
    pin = '';
    renderPin();
    $('pin-error').textContent = message || '';
    show('pin');
  }

  // ---- PIN
  function renderPin() {
    $('pin-dots').textContent = pin ? '•'.repeat(pin.length) : '····';
    $('pin-ok').disabled = pin.length < 4;
  }

  $('pin-keypad').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var key = b.getAttribute('data-key');
    if (key === 'back') pin = pin.slice(0, -1);
    else if (key === 'clear') pin = '';
    else if (pin.length < 8) pin += key;
    $('pin-error').textContent = '';
    renderPin();
  });

  $('pin-ok').addEventListener('click', function () {
    $('pin-ok').disabled = true;
    api('/owner/check-pin', { method: 'POST', headers: { 'x-owner-pin': pin } }).then(function () {
      try { sessionStorage.setItem(PIN_KEY, pin); } catch (e) { /* PIN then lives only in memory */ }
      start();
    }).catch(function (err) {
      pin = '';
      renderPin();
      $('pin-error').textContent = err.message;
    });
  });

  // ---- Data
  function load() {
    return Promise.all([api('/orders?day=today'), api('/topups?day=today'), api('/float')]).then(function (r) {
      render(r[0].orders || [], r[1].topUps || [], r[2]);
      $('today-error').textContent = '';
      $('updated').textContent = 'Updated ' + time(new Date().toISOString());
    }).catch(function (err) {
      if (err.code === 'BAD_PIN' || err.code === 'PIN_LOCKED') return lock(err.message);
      $('today-error').textContent = "Couldn't update: " + err.message;
    });
  }

  function render(orders, topUps, float) {
    var sales = orders.filter(function (o) { return o.status === 'PAID'; });
    var refunded = orders.filter(function (o) { return o.status === 'REFUNDED'; });
    var salesCents = sales.reduce(function (s, o) { return s + o.zarCents; }, 0);
    var topupCents = topUps.reduce(function (s, t) { return s + t.zarCents; }, 0);
    var feeCents = topUps.reduce(function (s, t) { return s + t.feeZarCents; }, 0);

    $('shop-name').textContent = float.shopName || 'Kasi Rails';
    $('t-sales').textContent = formatRand(salesCents);
    $('t-count').textContent = sales.length + (sales.length === 1 ? ' sale' : ' sales');
    $('t-topups').textContent = formatRand(topupCents);
    $('t-fees').textContent = 'fees ' + formatRand(feeCents);
    $('t-float').textContent = formatRand(float.zarCents);
    $('t-refunds').textContent = refunded.length ? refunded.length + ' refunded' : ' ';
    $('t-cash').textContent = formatRand(topupCents);

    var rows = orders.map(function (o) { return { kind: 'sale', at: o.createdAt, item: o }; })
      .concat(topUps.map(function (t) { return { kind: 'topup', at: t.createdAt, item: t }; }))
      .sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); });

    var list = $('list');
    list.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nothing yet today.';
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (r) { list.appendChild(r.kind === 'sale' ? saleRow(r.item) : topUpRow(r.item)); });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function txLink(label, hash) {
    var a = el('a', '', label);
    a.href = EXPLORER + hash;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  function saleRow(o) {
    var row = el('div', 'row');
    row.appendChild(el('div', 'main', 'Sale · ' + formatRand(o.zarCents)));
    var side = el('div', 'side');
    side.appendChild(el('span', 'chip ' + o.status, o.status));
    if (o.status === 'PAID' && !o.refundTxHash) {
      var btn = el('button', 'refund', refunding[o.id] ? 'Refunding…' : 'Refund');
      btn.disabled = !!refunding[o.id];
      btn.addEventListener('click', function () { refund(o, btn); });
      side.appendChild(btn);
    } else if (o.status === 'PAID' && o.refundTxHash) {
      side.appendChild(el('span', 'updated', 'Refund confirming…'));
    }
    row.appendChild(side);

    var meta = el('div', 'meta');
    meta.appendChild(document.createTextNode(time(o.createdAt) + (o.payer ? ' · from ' + shortCode(o.payer) + ' · ' : '')));
    if (o.txHash) meta.appendChild(txLink('payment', o.txHash));
    if (o.refundTxHash) { meta.appendChild(document.createTextNode(' · ')); meta.appendChild(txLink('refund', o.refundTxHash)); }
    row.appendChild(meta);
    return row;
  }

  function topUpRow(t) {
    var row = el('div', 'row');
    row.appendChild(el('div', 'main', 'Top-up · ' + formatRand(t.zarCents)));
    var side = el('div', 'side');
    side.appendChild(el('span', 'chip TOPUP', 'SENT'));
    row.appendChild(side);
    var meta = el('div', 'meta');
    meta.appendChild(document.createTextNode(time(t.createdAt) + ' · to ' + shortCode(t.customerAddress) + ' · fee ' + formatRand(t.feeZarCents) + ' · '));
    meta.appendChild(txLink('payment', t.txHash));
    row.appendChild(meta);
    return row;
  }

  function refund(order, btn) {
    var who = order.payer ? ' to ' + shortCode(order.payer) : '';
    if (!window.confirm('Refund ' + formatRand(order.zarCents) + who + '? The money goes back from your float.')) return;
    refunding[order.id] = true;
    btn.disabled = true;
    btn.textContent = 'Refunding…';
    api('/orders/' + encodeURIComponent(order.id) + '/refund', { method: 'POST', body: '{}' })
      .then(function () { delete refunding[order.id]; return load(); })
      .catch(function (err) {
        delete refunding[order.id];
        if (err.code === 'BAD_PIN' || err.code === 'PIN_LOCKED') return lock(err.message);
        window.alert('Refund failed: ' + err.message);
        load();
      });
  }

  function start() {
    show('today');
    load();
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      // Don't redraw mid-refund; the button state would be lost.
      if (Object.keys(refunding).length === 0) load();
    }, REFRESH_MS);
  }

  renderPin();
  if (savedPin()) start(); else show('pin');
})();

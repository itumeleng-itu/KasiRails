// Kasi Rails till: key in rand, show a QR, poll until PAID or EXPIRED.
(function () {
  'use strict';

  var POLL_MS = 1500;
  var MAX_CENTS = 1000000; // R10,000, matches the server
  var EXPLORER = 'https://sepolia.basescan.org/tx/';

  var $ = function (id) { return document.getElementById(id); };
  var screens = ['keypad', 'qr', 'paid', 'expired'];

  var entry = ''; // what's been typed, e.g. "85.5"
  var current = null; // { order, deadline, pollTimer, tickTimer, ttlMs }
  var lastZarCents = 0;
  var audioCtx = null;

  function show(name) {
    screens.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
  }

  function formatRand(cents) {
    var rands = Math.floor(cents / 100);
    var c = String(cents % 100).padStart(2, '0');
    return 'R' + String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + c;
  }

  function formatUsdc(units) {
    var n = Number(units) / 1e6;
    return n.toFixed(n < 1 ? 4 : 2) + ' USDC';
  }

  function entryToCents(text) {
    if (!text || text === '.') return 0;
    var parts = text.split('.');
    var cents = Number(parts[0] || '0') * 100;
    if (parts[1]) cents += Number((parts[1] + '0').slice(0, 2));
    return cents;
  }

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Request failed (' + res.status + ')');
        return body;
      });
    });
  }

  // ---- Sound: browsers only allow audio after a tap, so unlock on the first one.
  function unlockAudio() {
    if (audioCtx) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
    var el = $('paid-sound');
    el.muted = true;
    el.play().then(function () { el.pause(); el.currentTime = 0; el.muted = false; }).catch(function () { el.muted = false; });
  }

  function chime() {
    if (!audioCtx) return;
    [880, 1320].forEach(function (freq, i) {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      var t = audioCtx.currentTime + i * 0.18;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  function playPaid() {
    var el = $('paid-sound');
    el.currentTime = 0;
    // The bundled clip is a placeholder; fall back to a chime if it can't play.
    el.play().catch(chime);
  }

  // ---- Keypad
  function renderEntry() {
    var cents = entryToCents(entry);
    $('amount').textContent = entry ? entry : '0';
    $('charge').disabled = cents <= 0 || cents > MAX_CENTS;
    $('keypad-error').textContent = cents > MAX_CENTS ? 'Maximum is ' + formatRand(MAX_CENTS) : '';
  }

  function press(key) {
    if (key === 'back') {
      entry = entry.slice(0, -1);
    } else if (key === '.') {
      if (entry.indexOf('.') === -1) entry = (entry || '0') + '.';
    } else {
      var dot = entry.indexOf('.');
      if (dot !== -1 && entry.length - dot > 2) return; // max 2 decimals
      if (entry === '0') entry = '';
      if (entry.replace('.', '').length >= 7) return;
      entry += key;
    }
    renderEntry();
  }

  document.querySelector('.keypad').addEventListener('click', function (e) {
    var key = e.target.closest('button') && e.target.closest('button').getAttribute('data-key');
    if (key) { unlockAudio(); press(key); }
  });

  document.addEventListener('keydown', function (e) {
    if ($('screen-keypad').hidden) return;
    if (/^[0-9.]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter' && !$('charge').disabled) charge(entryToCents(entry));
  });

  // ---- Charging
  function charge(zarCents) {
    unlockAudio();
    lastZarCents = zarCents;
    $('charge').disabled = true;
    $('keypad-error').textContent = '';
    api('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zar: zarCents / 100 }),
    }).then(startOrder).catch(function (err) {
      show('keypad');
      $('keypad-error').textContent = err.message;
      renderEntry();
    });
  }

  function startOrder(order) {
    stopOrder();
    // Use the server's TTL, timed from now, so a wrong phone clock doesn't matter.
    var ttlMs = Date.parse(order.expiresAt) - Date.parse(order.createdAt);
    current = { order: order, ttlMs: ttlMs, deadline: Date.now() + ttlMs };

    var payload = JSON.stringify({ kasiRails: 1, orderId: order.id, api: window.location.origin });
    $('qr').src = 'qr.svg?data=' + encodeURIComponent(payload);
    $('qr-zar').textContent = formatRand(order.zarCents);
    $('qr-usdc').textContent = '≈ ' + formatUsdc(order.usdcAmount);
    $('qr-status').textContent = 'Scan to pay';
    show('qr');

    tick();
    current.tickTimer = setInterval(tick, 250);
    current.pollTimer = setInterval(poll, POLL_MS);
  }

  function stopOrder() {
    if (!current) return;
    clearInterval(current.tickTimer);
    clearInterval(current.pollTimer);
    current = null;
  }

  function tick() {
    if (!current) return;
    var left = Math.max(0, current.deadline - Date.now());
    $('countdown-bar').style.width = (100 * left / current.ttlMs) + '%';
    if (current.order.txHash) {
      $('qr-status').textContent = 'Payment received, confirming…';
    } else if (left > 0) {
      $('qr-status').textContent = 'Scan to pay · ' + Math.ceil(left / 1000) + 's';
    } else {
      $('qr-status').textContent = 'Checking…';
    }
  }

  function poll() {
    if (!current) return;
    var id = current.order.id;
    api('/orders/' + encodeURIComponent(id)).then(function (order) {
      if (!current || current.order.id !== id) return;
      current.order = order;
      if (order.status === 'PAID') onPaid(order);
      else if (order.status === 'EXPIRED') onExpired(order);
    }).catch(function () { /* keep polling through blips */ });
  }

  function onPaid(order) {
    stopOrder();
    $('paid-zar').textContent = formatRand(order.zarCents);
    var link = $('paid-tx');
    if (order.txHash) { link.href = EXPLORER + order.txHash; link.hidden = false; } else { link.hidden = true; }
    show('paid');
    playPaid();
  }

  function onExpired(order) {
    stopOrder();
    $('expired-zar').textContent = formatRand(order.zarCents);
    show('expired');
  }

  function newSale() {
    stopOrder();
    entry = '';
    renderEntry();
    show('keypad');
  }

  $('charge').addEventListener('click', function () { charge(entryToCents(entry)); });
  $('cancel').addEventListener('click', newSale);
  $('charge-again').addEventListener('click', function () { charge(lastZarCents); });
  Array.prototype.forEach.call(document.querySelectorAll('.new-sale'), function (b) {
    b.addEventListener('click', newSale);
  });

  // ---- Header: shop name and rate
  api('/rate').then(function (r) {
    $('rate').textContent = '1 USDC = R' + r.zarPerUsdc.toFixed(2) + (r.source === 'fallback' ? ' (offline rate)' : '');
  }).catch(function () {});
  api('/health').then(function (h) {
    if (h.shopName) { $('shop-name').textContent = h.shopName; document.title = h.shopName + ' · Till'; }
  }).catch(function () {
    $('keypad-error').textContent = 'Cannot reach the server.';
  });

  renderEntry();
})();

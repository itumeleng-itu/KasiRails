// Kasi Rails top-up: the customer pays cash, the shop sends them USDC from its float.
(function () {
  'use strict';

  var MAX_CENTS = 1000000; // R10,000, matches the server
  var PIN_LENGTH_MAX = 8;
  var EXPLORER = 'https://sepolia.basescan.org/tx/';
  var PIN_KEY = 'kasi-rails.owner-pin';

  var $ = function (id) { return document.getElementById(id); };
  var screens = ['pin', 'scan', 'amount', 'done'];

  var pin = '';
  var entry = '';
  var customer = null;
  var float = null; // { zarCents, zarPerUsdc, feeBps }
  var scanner = null;

  function show(name) {
    screens.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    if (name === 'scan') startScanner(); else stopScanner();
  }

  function formatRand(cents) {
    var rands = Math.floor(cents / 100);
    var c = String(cents % 100).padStart(2, '0');
    return 'R' + String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + c;
  }

  function shortCode(a) { return a.slice(0, 6) + '…' + a.slice(-4); }

  function entryToCents(text) {
    if (!text || text === '.') return 0;
    var parts = text.split('.');
    var cents = Number(parts[0] || '0') * 100;
    if (parts[1]) cents += Number((parts[1] + '0').slice(0, 2));
    return cents;
  }

  function savedPin() {
    try { return sessionStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; }
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
    else if (pin.length < PIN_LENGTH_MAX) pin += key;
    $('pin-error').textContent = '';
    renderPin();
  });

  $('pin-ok').addEventListener('click', function () {
    $('pin-ok').disabled = true;
    api('/owner/check-pin', { method: 'POST', headers: { 'x-owner-pin': pin } }).then(function () {
      try { sessionStorage.setItem(PIN_KEY, pin); } catch (e) { /* PIN then lives only in memory */ }
      loadFloat();
      show('scan');
    }).catch(function (err) {
      pin = '';
      renderPin();
      $('pin-error').textContent = err.message;
    });
  });

  // ---- Float
  function loadFloat() {
    return api('/float').then(function (f) {
      float = f;
      $('float').textContent = 'Float: ' + formatRand(f.zarCents) + ' · fee ' + (f.feeBps / 100) + '%';
      Array.prototype.forEach.call(document.querySelectorAll('.shop-name'), function (el) { el.textContent = f.shopName; });
      renderAmount();
    }).catch(function () { $('float').textContent = 'Float: unavailable'; });
  }

  // ---- Scanning the customer's Receive code
  function acceptCode(text) {
    var code = String(text || '').trim().replace(/^ethereum:/i, '').split(/[@?]/)[0];
    if (!/^0x[0-9a-fA-F]{40}$/.test(code)) {
      $('scan-error').textContent = "That isn't a Kasi Rails Receive code.";
      return false;
    }
    customer = code;
    entry = '';
    $('scan-error').textContent = '';
    $('customer-code').textContent = 'Customer ' + shortCode(code);
    renderAmount();
    show('amount');
    return true;
  }

  function startScanner() {
    if (scanner || typeof Html5Qrcode === 'undefined') return;
    if (!window.isSecureContext) {
      $('scan-error').textContent = 'The camera needs https. Type the code instead, or open this page on the hosted server.';
      return;
    }
    scanner = new Html5Qrcode('reader');
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: function (w, h) { var s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
      function onScan(text) { acceptCode(text); },
      function onNoCode() { /* keep scanning */ }
    ).catch(function () {
      $('scan-error').textContent = "Couldn't open the camera. Allow camera access, or type the code.";
      scanner = null;
    });
  }

  function stopScanner() {
    if (!scanner) return;
    var s = scanner;
    scanner = null;
    s.stop().then(function () { s.clear(); }).catch(function () {});
  }

  $('code-ok').addEventListener('click', function () { acceptCode($('code-input').value); });
  $('code-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') acceptCode($('code-input').value); });

  // ---- Amount
  function renderAmount() {
    var cents = entryToCents(entry);
    $('amount').textContent = entry || '0';
    var error = '';
    if (cents > MAX_CENTS) error = 'Maximum is ' + formatRand(MAX_CENTS);
    if (float && cents > 0) {
      var fee = Math.floor(cents * float.feeBps / 10000);
      var net = cents - fee;
      $('breakdown').textContent = 'Customer gets ' + formatRand(net) + ' · fee ' + formatRand(fee);
      if (net > float.zarCents) error = 'Not enough float (' + formatRand(float.zarCents) + ')';
    } else {
      $('breakdown').innerHTML = '&nbsp;';
    }
    $('amount-error').textContent = error;
    $('send').disabled = cents <= 0 || !!error;
  }

  $('amount-keypad').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var key = b.getAttribute('data-key');
    if (key === 'back') entry = entry.slice(0, -1);
    else if (key === '.') { if (entry.indexOf('.') === -1) entry = (entry || '0') + '.'; }
    else {
      var dot = entry.indexOf('.');
      if (dot !== -1 && entry.length - dot > 2) return;
      if (entry === '0') entry = '';
      if (entry.replace('.', '').length >= 7) return;
      entry += key;
    }
    renderAmount();
  });

  $('change-customer').addEventListener('click', function (e) { e.preventDefault(); customer = null; show('scan'); });

  $('send').addEventListener('click', function () {
    var cents = entryToCents(entry);
    $('send').disabled = true;
    $('send').textContent = 'Sending…';
    $('amount-error').textContent = '';
    api('/topups', { method: 'POST', body: JSON.stringify({ zar: cents / 100, customerAddress: customer }) })
      .then(function (r) {
        var t = r.topUp;
        float = r.float;
        $('done-net').textContent = formatRand(t.zarCents - t.feeZarCents);
        $('done-detail').textContent = 'to ' + shortCode(t.customerAddress) + ' · collect ' + formatRand(t.zarCents) + ' cash';
        $('done-tx').href = EXPLORER + t.txHash;
        show('done');
      })
      .catch(function (err) {
        if (err.code === 'BAD_PIN' || err.code === 'PIN_LOCKED') return lock(err.message);
        $('amount-error').textContent = err.message;
        renderAmount();
      })
      .then(function () { $('send').textContent = 'Send top-up'; });
  });

  $('next').addEventListener('click', function () {
    customer = null;
    entry = '';
    loadFloat();
    show('scan');
  });

  // ---- Start
  renderPin();
  if (savedPin()) { loadFloat(); show('scan'); } else { show('pin'); }
})();

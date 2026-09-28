/* ==========================================================================
   eveningchairs — landing-page instrumentation
   Two jobs:
     1. send waitlist signups to a Google Sheet (via an Apps Script web app)
     2. send engagement analytics to PostHog (the loader lives in <head>)
   Shared by eveningchairs.html (EN) and eveningchairs-ru.html (RU): the form
   is read generically from #formBody, so each page can have its own fields.
   ========================================================================== */

/* --- config --------------------------------------------------------------- */

/* Google Apps Script web-app URL — see apps-script.gs for how to create it.
   Looks like: https://script.google.com/macros/s/AKfyc.../exec            */
var SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyWci20Qe_EYuNadw6qyRXXQCByqDT9-cKMqmEYhd6rRV2NQlUBlByMNaO8ZLt5Wdke/exec';

var LANG = (document.documentElement.lang || 'en').slice(0, 2);

/* the few UI strings that live in JS */
var T = LANG === 'ru'
  ? { perJob: ' на заказ', copied: 'Скопировано ✓' }
  : { perJob: ' per job',  copied: 'Copied ✓' };

/* --- helpers ------------------------------------------------------------- */

function track(name, props) {
  try { if (window.posthog) posthog.capture(name, props || {}); } catch (e) {}
}

/* every event carries the page language, so EN and RU split cleanly */
try { if (window.posthog) posthog.register({ lang: LANG }); } catch (e) {}

/* utm_* + referrer — attribution for whoever ends up signing up */
function campaignParams() {
  var q = new URLSearchParams(location.search);
  var out = { referrer: document.referrer || '(direct)' };
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
    out[k] = q.get(k) || '';
  });
  return out;
}

function throttleRAF(fn) {
  var queued = false;
  return function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; fn(); });
  };
}

/* cost buckets for the Sheet — fine-grained at the low end to see micro-orders */
function costBucket(v) { return v < 1 ? 'lt1' : v < 10 ? '1-10' : v < 100 ? '10-100' : 'gt100'; }

var EMAIL_RE = /^\S+@\S+\.\S+$/;
var TG_RE    = /^@?[A-Za-z0-9_]{5,32}$/;

/* ======================================================================== */
/* 1. WAITLIST FORM                                                          */
/* ======================================================================== */

(function () {
  var body = document.getElementById('formBody');
  if (!body) return;

  var trap = document.getElementById('company_site'); // honeypot
  var fields = Array.prototype.filter.call(
    body.querySelectorAll('input[name], select[name], textarea[name]'),
    function (el) { return el !== trap; }
  );

  var formStarted = false;
  fields.forEach(function (el) {
    el.addEventListener('focus', function () {
      if (formStarted) return;
      formStarted = true;
      track('form_start');
    });
    el.addEventListener('input', function () { el.style.borderColor = ''; });
    el.addEventListener('change', function () {
      var group = el.closest('fieldset[data-required]');
      if (group) group.classList.remove('bad');
    });
  });

  /* rules: every <select> is required; type=email must be an email;
     data-kind="contact" accepts an email or a Telegram @username;
     data-kind="agent-json" must contain a JSON object (checked separately);
     data-kind="range-required" — the slider has to be moved at least once;
     fieldset[data-required] needs at least one ticked box;
     textareas and single checkboxes stay optional.
     Fields inside a [hidden] panel (the answer mode not in use) are skipped. */
  function invalid(el) {
    if (el.type === 'checkbox') return false;
    if (el.dataset.kind === 'range-required') return el.dataset.touched !== '1';
    var v = el.value.trim();
    if (el.tagName === 'SELECT') return !v;
    if (el.type === 'email') return !EMAIL_RE.test(v);
    if (el.dataset.kind === 'contact') return !EMAIL_RE.test(v) && !TG_RE.test(v);
    return false;
  }

  /* the agent's reply: take the first {...} block (agents like to wrap JSON in prose or ``` fences) */
  function parseAgent(text) {
    var s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    try {
      var o = JSON.parse(text.slice(s, e + 1));
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    } catch (x) { return null; }
  }

  function fail(el, field) {
    el.focus();
    if (el.type === 'range') el.closest('.field').classList.add('bad');
    else el.style.borderColor = '#A9542E';
    track('form_error', { field: field || el.name });
  }

  document.getElementById('submitBtn').addEventListener('click', function () {
    var active = fields.filter(function (el) { return !el.closest('[hidden]'); });

    var groups = body.querySelectorAll('fieldset[data-required]');
    for (var g = 0; g < groups.length; g++) {
      if (groups[g].closest('[hidden]')) continue;
      if (!groups[g].querySelector('input[type=checkbox]:checked')) {
        var first = groups[g].querySelector('input[type=checkbox]');
        groups[g].classList.add('bad');
        first.focus();
        track('form_error', { field: first.name });
        return;
      }
    }

    var answer = null, parsed = null;
    for (var i = 0; i < active.length; i++) {
      if (active[i].dataset.kind === 'agent-json') { answer = active[i]; continue; }
      if (invalid(active[i])) { fail(active[i]); return; }
    }
    if (answer) {
      var err = document.getElementById('agentErr');
      parsed = parseAgent(answer.value);
      if (err) err.hidden = !!parsed;
      if (!parsed) { fail(answer, 'agent_answer'); return; }
    }

    showSuccess();

    // bot filled the hidden field — keep the UI honest, record nothing
    if (trap && trap.value) return;

    var payload = { lang: LANG, mode: body.dataset.mode || 'manual', ts: new Date().toISOString() };
    active.forEach(function (el) {
      if (el.type === 'checkbox' && el.hasAttribute('value')) {       // multi-choice group → "a, b, c"
        if (!(el.name in payload)) payload[el.name] = '';
        if (el.checked) payload[el.name] += (payload[el.name] ? ', ' : '') + el.value;
      } else if (el.type === 'checkbox') {                            // single opt-in box
        payload[el.name] = el.checked ? 'yes' : 'no';
      } else {
        payload[el.name] = el.value.trim();
      }
    });
    if (parsed) {                                                     // agent answers land in the same columns
      ['needs', 'vendors', 'cost', 'cost_usd', 'orders', 'rails'].forEach(function (k) {
        if (parsed[k] != null) payload[k] = Array.isArray(parsed[k]) ? parsed[k].join(', ') : String(parsed[k]);
      });
      var usd = parseFloat(String(payload.cost_usd || '').replace(',', '.'));
      if (!isNaN(usd)) { payload.cost_usd = usd; payload.cost = costBucket(usd); }
      else if (payload.cost_usd) { payload.cost = 'unknown'; }
      if (parsed.task) payload.agent = String(parsed.task);
      payload.agent_answer = payload.agent_answer.slice(0, 4000);
    }
    Object.assign(payload, campaignParams());

    // analytics — the signup as a funnel step (no raw contact as an event prop)
    var props = {};
    ['mode', 'orders', 'needs', 'category', 'cost', 'cost_usd', 'rails', 'newsletter'].forEach(function (k) {
      if (payload[k]) props[k] = payload[k];
    });
    if ('agent' in payload) props.has_agent_desc = payload.agent.length > 0;
    track('waitlist_signup', props);

    // tie the person record to the contact so a lost Sheet write is still recoverable
    var id = payload.email || payload.contact;
    try {
      if (window.posthog && id) posthog.identify(id, { contact: id, orders: payload.orders || '' });
    } catch (e) {}

    // Sheet write — fire-and-forget. Apps Script can't send CORS headers, so we
    // use no-cors: the request goes through, we just can't read the response.
    if (SHEET_ENDPOINT.indexOf('XXXX') === -1) {
      fetch(SHEET_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(payload)
      }).catch(function () { track('waitlist_signup_write_failed'); });
    }
  });

  function showSuccess() {
    body.classList.add('hidden');
    document.getElementById('successBody').classList.remove('hidden');
    var tabs = document.querySelector('.mode-tabs');
    if (tabs) tabs.classList.add('hidden');
  }
})();

/* 1a. cost slider (RU page): log-ish scale → exact $ + the old bucket for the sheet */
(function () {
  var r = document.getElementById('costRange');
  if (!r) return;
  var out = document.getElementById('costVal');
  var bucketIn = document.getElementById('cost'), usdIn = document.getElementById('costUsd');
  var VALUES = r.dataset.values.split(',').map(Number), last = VALUES.length - 1;
  function money(v) { return v < 1 ? v.toFixed(2) : String(v); }
  function paint() {
    var i = +r.value, v = VALUES[i];
    if (r.dataset.touched !== '1') return;
    r.style.setProperty('--fill', (i / last * 100) + '%');
    out.textContent = '≈ $' + money(v) + (i === last ? '+' : '') + T.perJob;
    out.classList.remove('empty');
    bucketIn.value = costBucket(v);
    usdIn.value = v;
    r.closest('.field').classList.remove('bad');
  }
  r.addEventListener('input', function () {
    r.dataset.touched = '1';
    r.classList.add('touched');
    paint();
  });
})();

/* 1b. answer modes (RU page): fill it in yourself, or hand a prompt to the agent */
(function () {
  var tabs = document.querySelectorAll('.mode-tab');
  var body = document.getElementById('formBody');
  if (!tabs.length || !body) return;
  body.dataset.mode = 'manual';

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var m = t.dataset.mode;
      if (m === body.dataset.mode) return;
      body.dataset.mode = m;
      tabs.forEach(function (x) {
        x.classList.toggle('on', x === t);
        x.setAttribute('aria-selected', x === t ? 'true' : 'false');
      });
      body.querySelectorAll('.mode-panel').forEach(function (p) { p.hidden = p.dataset.mode !== m; });
      track('form_mode', { mode: m });
    });
  });

  var copy = document.getElementById('copyPrompt');
  var pre  = document.getElementById('agentPrompt');
  if (!copy || !pre) return;
  var label = copy.textContent;
  copy.addEventListener('click', function () {
    var text = pre.textContent;
    function ok() {
      copy.textContent = T.copied;
      copy.classList.add('done');
      setTimeout(function () { copy.textContent = label; copy.classList.remove('done'); }, 2000);
      track('prompt_copy');
    }
    function fallback() {           // file:// and old browsers: select the text and copy
      var r = document.createRange();
      r.selectNodeContents(pre);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      try { if (document.execCommand('copy')) ok(); } catch (e) {}
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  });
})();

/* ======================================================================== */
/* 2. ENGAGEMENT ANALYTICS                                                   */
/* ======================================================================== */

/* 2a. CTA + outbound (Telegram) clicks ---------------------------------- */
/* RU | EN switch: remember the choice so the root page stops auto-routing by browser language */
document.querySelectorAll('[data-setlang]').forEach(function (a) {
  a.addEventListener('click', function () {
    try { localStorage.setItem('ec_lang', a.getAttribute('data-setlang')); } catch (e) {}
    track('lang_switch', { to: a.getAttribute('data-setlang') });
  });
});

(function () {
  var nav = document.querySelector('.nav-cta');
  if (nav) nav.addEventListener('click', function () { track('cta_click', { location: 'nav' }); });

  var hero = document.getElementById('heroCta');
  if (hero) hero.addEventListener('click', function () {
    track('cta_click', { location: 'hero' });
    document.getElementById('waitlist').scrollIntoView();
  });

  document.querySelectorAll('a.tg-link').forEach(function (a) {
    a.addEventListener('click', function () {
      var where = a.closest('nav') ? 'nav' : a.closest('footer') ? 'footer' : 'success';
      track('telegram_click', { location: where });
    });
  });
})();

/* 2b. which blocks actually get read (>=50% visible for >=3s) ----------- */
var sectionsRead = {};
(function () {
  if (!('IntersectionObserver' in window)) return;

  var SECTIONS = ['problem', 'how', 'layer', 'growth', 'cases', 'trust', 'who', 'waitlist'];
  var timers = {}, seen = {};

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var id = entry.target.id;
      var visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;

      if (visible && !seen[id]) {
        seen[id] = true;
        track('section_view', { section: id });
      }

      if (visible && !sectionsRead[id] && !timers[id]) {
        timers[id] = setTimeout(function () {
          sectionsRead[id] = true;
          timers[id] = null;
          track('section_read', { section: id });
        }, 3000);
      } else if (!visible && timers[id]) {
        clearTimeout(timers[id]);
        timers[id] = null;
      }
    });
  }, { threshold: [0, 0.5, 1] });

  SECTIONS.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();

/* 2c. scroll-depth milestones ----------------------------------------- */
var maxScrollPct = 0;
(function () {
  var marks = [25, 50, 75, 90], hit = {};

  var measure = throttleRAF(function () {
    var doc = document.documentElement;
    var pct = Math.round((window.scrollY + window.innerHeight) / doc.scrollHeight * 100);
    if (pct > maxScrollPct) maxScrollPct = pct;
    marks.forEach(function (m) {
      if (pct >= m && !hit[m]) {
        hit[m] = true;
        track('scroll_depth', { percent: m });
      }
    });
  });

  window.addEventListener('scroll', measure, { passive: true });
  measure();
})();

/* 2f. how-it-works (RU page) — "four chairs": one step at a time ---------- */
(function () {
  var box = document.getElementById('howStepper');
  if (!box) return;
  box.classList.add('js');
  var rail  = box.querySelector('.hc-track');
  var nodes = box.querySelectorAll('.hc-node');
  var panes = box.querySelectorAll('.hc-pane');
  var last = panes.length - 1, cur = 0;

  function show(i, via) {
    cur = i;
    panes.forEach(function (p, k) {
      p.classList.toggle('on', k === i);
      p.setAttribute('aria-hidden', k === i ? 'false' : 'true');
    });
    nodes.forEach(function (n, k) {
      n.classList.toggle('on', k === i);
      n.classList.toggle('done', k < i);
      n.querySelector('use').setAttribute('href', k === i ? '#chairmark' : '#chair');   // current step gets the coin
      if (k === i) n.setAttribute('aria-current', 'step'); else n.removeAttribute('aria-current');
    });
    rail.style.setProperty('--p', last ? i / last : 0);
    if (via) track('how_step', { step: i + 1, via: via });
  }

  box.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go]');
    if (!t) return;
    var d = t.dataset.go;
    if (d === 'waitlist') {
      track('cta_click', { location: 'how' });
      document.getElementById('waitlist').scrollIntoView();
      return;
    }
    var i = d === 'next' ? Math.min(last, cur + 1) : d === 'back' ? Math.max(0, cur - 1) : +d;
    if (i !== cur) show(i, d === 'next' || d === 'back' ? d : 'tab');
  });
  show(0);
})();

/* 2e. cases carousel (RU page) — arrows, counter, which cases get seen */
(function () {
  var rail = document.getElementById('caseTrack');
  if (!rail) return;
  var cards = rail.querySelectorAll('.case');
  var now  = document.getElementById('caseNow');
  var prev = document.querySelector('.case-btn[data-dir="-1"]');
  var next = document.querySelector('.case-btn[data-dir="1"]');
  var seen = {}, current = -1;

  function step() {
    return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : rail.clientWidth;
  }

  var update = throttleRAF(function () {
    var max = rail.scrollWidth - rail.clientWidth;
    var i = rail.scrollLeft >= max - 4 ? cards.length - 1 : Math.round(rail.scrollLeft / step());
    prev.disabled = rail.scrollLeft <= 4;
    next.disabled = rail.scrollLeft >= max - 4;
    if (i === current) return;
    var first = current === -1;
    current = i;
    now.textContent = i + 1;
    var id = cards[i].dataset.case;
    // the first card on load is covered by section_view; count only cases reached by browsing
    if (!first && !seen[id]) {
      seen[id] = true;
      track('case_view', { case: id, index: i + 1 });
    }
  });

  [prev, next].forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = Math.max(0, Math.min(cards.length - 1, current + Number(btn.dataset.dir)));
      rail.scrollTo({ left: cards[target].offsetLeft - cards[0].offsetLeft, behavior: 'smooth' });
    });
  });
  rail.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

/* 2d. exit ping — time on page + how far + what was read -------------- */
(function () {
  var start = Date.now(), sent = false;

  function ping() {
    if (sent) return;
    sent = true;
    track('page_exit', {
      seconds_on_page: Math.round((Date.now() - start) / 1000),
      max_scroll_percent: maxScrollPct,
      sections_read: Object.keys(sectionsRead)
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') ping();
  });
  window.addEventListener('pagehide', ping);
})();

'use strict';

// First-run guided setup: welcome -> assistant -> goals -> focus blocking -> Google Calendar -> done.
// Every step after the welcome can be skipped; everything here can be changed later in Settings.
// Helpers (h, $, state, saveSettings, toast, loadEvents, renderRail) come from app.js.

const COMMON_SITES = ['youtube.com', 'reddit.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'netflix.com', 'twitch.tv'];
const WIZ_STEPS = ['Welcome', 'Assistant', 'Goals', 'Focus', 'Calendar', 'Done'];

async function openWizard() {
  const root = h('div', { class: 'wiz-scrim', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wiz-title' });
  const card = h('div', { class: 'wiz' });
  root.append(card);
  document.body.append(root);

  let step = 0;
  const data = { detect: null, running: null, goals: null };
  tempo.ai.detect().then((d) => { data.detect = d; if (step === 1) draw(); });

  const finish = async () => {
    await saveSettings({ onboarded: true });
    root.remove();
    loadEvents(); renderRail();
  };
  const go = (n) => { step = n; draw(); };

  function frame(title, sub, body, { next = 'Continue', onNext, skip = true, back = true } = {}) {
    const dots = h('div', { class: 'wiz-dots', 'aria-label': `Step ${step + 1} of ${WIZ_STEPS.length}` },
      WIZ_STEPS.map((name, i) => h('span', { class: `wd${i === step ? ' on' : ''}${i < step ? ' past' : ''}`, title: name })));
    const nextBtn = h('button', { class: 'btn primary', onclick: async () => { if (onNext && (await onNext()) === false) return; go(step + 1); } }, next);
    card.replaceChildren(
      h('div', { class: 'wiz-top' }, dots, h('span', { class: 'wiz-count' }, `${step + 1} / ${WIZ_STEPS.length}`)),
      h('h2', { id: 'wiz-title' }, title),
      sub && h('p', { class: 'wiz-sub' }, sub),
      h('div', { class: 'wiz-body' }, body),
      h('div', { class: 'wiz-foot' },
        back && step > 0 ? h('button', { class: 'btn', onclick: () => go(step - 1) }, 'Back') : h('span'),
        h('span', { class: 'spacer' }),
        skip ? h('button', { class: 'btn quiet', onclick: () => go(step + 1) }, 'Skip this step') : null,
        nextBtn));
    nextBtn.focus();
  }

  // ---- steps ----------------------------------------------------------------------------------------

  function welcome() {
    card.replaceChildren(
      h('div', { class: 'wiz-hero' }, h('span', { class: 'logo big' })),
      h('h2', { id: 'wiz-title', class: 'center' }, 'Welcome to Tempo'),
      h('p', { class: 'wiz-sub center' }, 'Your calendar, your daily goals, and focus blocks that close distractions while you work. Setup takes about two minutes.'),
      h('ul', { class: 'wiz-points' },
        h('li', {}, h('b', {}, 'Talk to it. '), 'Press Ctrl+Alt+T and say "deep work tomorrow 9 to 11".'),
        h('li', {}, h('b', {}, 'Keep your goals in view. '), 'Gym, LeetCode, calories: tick them off beside your calendar.'),
        h('li', {}, h('b', {}, 'Protect focus time. '), 'During a Focus block, Tempo closes the apps and sites you choose.')),
      h('div', { class: 'wiz-foot' },
        h('button', { class: 'btn quiet', onclick: finish }, 'Skip setup'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', id: 'wiz-start', onclick: () => go(1) }, "Let's set it up")));
    $('#wiz-start').focus();
  }

  function assistant() {
    const s = state.settings;
    let provider = s.provider === 'api' ? 'api' : 'claude-code';
    const found = data.detect ? data.detect.claudeCode : null;
    const key = h('input', { type: 'password', placeholder: s.hasAnthropicKey ? 'Saved (leave blank to keep)' : 'sk-ant-...', 'aria-label': 'Anthropic API key' });
    const cc = h('select', { 'aria-label': 'Model' },
      [['sonnet', 'Sonnet (fast)'], ['opus', 'Opus (smartest)'], ['haiku', 'Haiku (fastest)']].map(([v, l]) => h('option', { value: v, selected: s.ccModel === v }, l)));
    const option = (value, title, desc, extra) => h('label', { class: `wiz-choice${provider === value ? ' on' : ''}` },
      h('input', { type: 'radio', name: 'prov', value, checked: provider === value, onchange: () => { provider = value; card.querySelectorAll('.wiz-choice').forEach((c) => c.classList.toggle('on', c.querySelector('input').value === value)); } }),
      h('div', {}, h('b', {}, title), h('div', { class: 'hint' }, desc), extra));
    frame('Who powers the assistant?', 'The chat and voice commands need Claude. Pick how Tempo reaches it.', [
      option('claude-code', 'Claude Code (your Claude login)',
        found === null ? 'Checking this PC...' : found ? 'Found on this PC. No API key needed; uses your Claude plan.' : 'Not found on this PC. Install Claude Code and sign in, or use an API key.',
        h('div', { class: 'wiz-inline' }, h('span', { class: 'hint' }, 'Model'), cc)),
      option('api', 'Anthropic API key', 'Pay per use with your own key. Stored encrypted on this PC.', h('div', { class: 'wiz-inline' }, key)),
    ], {
      onNext: async () => {
        const patch = { provider, ccModel: cc.value };
        if (provider === 'api' && key.value.trim()) patch.anthropicKey = key.value.trim();
        if (provider === 'api' && !key.value.trim() && !s.hasAnthropicKey) { toast('Add an API key, or pick Claude Code, or skip this step.'); return false; }
        await saveSettings(patch);
      },
    });
  }

  async function goals() {
    if (!data.goals) data.goals = (await tempo.habits.list()).map((g) => ({ ...g, keep: true }));
    const newName = h('input', { type: 'text', placeholder: 'Add your own, e.g. Read 20 pages', 'aria-label': 'New goal name' });
    const rows = data.goals.map((g) => h('div', { class: `wiz-goal${g.keep ? '' : ' off'}`, style: `--c:${g.color}` },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: g.keep, onchange: (e) => { g.keep = e.target.checked; e.target.closest('.wiz-goal').classList.toggle('off', !g.keep); } }), h('b', {}, g.name)),
      g.kind === 'number'
        ? h('div', { class: 'wiz-inline' }, h('span', { class: 'hint' }, g.direction === 'atmost' ? 'at most' : 'at least'),
          h('input', { type: 'number', value: g.target ?? '', 'aria-label': `${g.name} target`, class: 'wiz-num', onchange: (e) => { g.target = e.target.value === '' ? null : Number(e.target.value); } }),
          h('span', { class: 'hint' }, g.unit || ''))
        : h('span', { class: 'hint' }, 'tick or cross')));
    frame('What do you want to do every day?', 'These show beside your calendar so they stay in view. Untick what you don\'t want; adjust targets.', [
      h('div', { class: 'wiz-goals' }, rows),
      h('div', { class: 'wiz-inline' }, newName, h('button', { class: 'btn', onclick: () => {
        const name = newName.value.trim();
        if (!name) return;
        data.goals.push({ id: null, name, kind: 'check', color: '#7c93ff', keep: true, isNew: true });
        goals();
      } }, 'Add')),
    ], {
      onNext: async () => {
        for (const g of data.goals) {
          if (g.isNew) { if (g.keep) await tempo.habits.save({ name: g.name, kind: 'check' }); continue; }
          if (!g.keep) { await tempo.habits.remove(g.id); continue; }
          if (g.kind === 'number') await tempo.habits.save({ id: g.id, target: g.target });
        }
        data.goals = null;
      },
    });
  }

  async function focus() {
    const types = state.settings.types;
    const ft = types.find((t) => t.id === 'focus') || types[0];
    if (!ft) { go(step + 1); return; }
    const picked = new Set(ft.apps);
    const sites = new Set(ft.sites);
    const names = new Map((await tempo.apps.names([...picked])).map((n, i) => [[...picked][i], n]));
    const status = await tempo.blocker.state();

    const chosenBox = h('div', { class: 'chips' });
    // One chip per app name: several processes can belong to one app (Steam has steam.exe and steamwebhelper.exe).
    const groups = () => {
      const m = new Map();
      for (const exe of picked) { const n = names.get(exe) || exe; if (!m.has(n)) m.set(n, []); m.get(n).push(exe); }
      return m;
    };
    const drawChosen = () => {
      const g = groups();
      chosenBox.replaceChildren(...(g.size ? [...g].map(([name, exes]) => h('button', {
        class: 'chipx on', title: `Stop closing ${name} (${exes.join(', ')})`, 'aria-label': `Remove ${name}`,
        onclick: () => { exes.forEach((x) => picked.delete(x)); drawChosen(); drawRunning(); },
      }, name, h('span', { 'aria-hidden': 'true' }, ' ✕'))) : [h('span', { class: 'hint' }, 'No apps yet. Pick from what\'s open below.')]));
    };
    const runningBox = h('div', { class: 'chips' }, h('span', { class: 'hint' }, 'Looking at your open apps...'));
    const drawRunning = () => {
      if (!data.running) return;
      const chosenNames = new Set(groups().keys());
      const list = data.running.filter((a) => !picked.has(a.exe) && !chosenNames.has(a.name));
      runningBox.replaceChildren(...(list.length ? list.map((a) => h('button', {
        class: 'chipx', title: a.exe, onclick: () => { picked.add(a.exe); names.set(a.exe, a.name); drawChosen(); drawRunning(); },
      }, '+ ', a.name)) : [h('span', { class: 'hint' }, 'Nothing else is open. Open the apps that distract you and come back, or add them later.')]));
    };
    drawChosen();
    tempo.apps.running().then((r) => { data.running = r; drawRunning(); });

    const siteBoxes = h('div', { class: 'wiz-sites' }, [...new Set([...COMMON_SITES, ...sites])].map((d) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: sites.has(d), onchange: (e) => { if (e.target.checked) sites.add(d); else sites.delete(d); } }), d)));

    const perm = h('div', { class: 'wiz-perm' });
    const drawPerm = (ready) => perm.replaceChildren(ready
      ? h('span', { class: 'ok-text' }, '✓ Website blocking is enabled.')
      : h('span', {}, 'Blocking websites needs one Windows permission prompt. ', h('button', { class: 'btn', onclick: async () => {
        try { await tempo.blocker.enableSites(); drawPerm(true); } catch (err) { toast(err.message); }
      } }, 'Enable website blocking')));
    drawPerm(status.sitesReady);

    frame('What should Focus time block?', `When a "${ft.name}" event is on your calendar, Tempo gives these apps a 10-second warning (save your work), then closes them. You can allow a few minutes when you really need to.`, [
      h('div', { class: 'wiz-lbl' }, 'Apps to close'), chosenBox,
      h('div', { class: 'wiz-lbl' }, 'Open right now (click to add)'), runningBox,
      h('div', { class: 'wiz-lbl' }, 'Websites to block'), siteBoxes, perm,
    ], {
      onNext: async () => {
        const next = types.map((t) => (t === ft ? { ...t, apps: [...picked], sites: [...sites] } : t));
        await saveSettings({ types: next });
      },
    });
  }

  async function calendar() {
    const g = await tempo.google.state();
    const status = h('div', { class: 'wiz-perm' });
    const draw2 = (st) => {
      status.replaceChildren(st.connected
        ? h('span', { class: 'ok-text' }, '✓ Connected to Google Calendar.')
        : st.hasClient
          ? h('span', {}, 'Credentials loaded. ', h('button', { class: 'btn primary', onclick: async (e) => {
            e.target.textContent = 'Finish in your browser...';
            try { draw2(await tempo.google.connect()); } catch (err) { toast(err.message); draw2(await tempo.google.state()); }
          } }, 'Connect Google'))
          : h('span', { class: 'hint' }, 'No credentials yet.'));
    };
    draw2(g);
    frame('Sync with Google Calendar (optional)', 'Tempo works on its own. To see and edit your Google events here, Google needs a small one-time setup on your account.', [
      h('ol', { class: 'wiz-steps' },
        h('li', {}, 'In ', h('a', { href: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', target: '_blank' }, 'Google Cloud Console'), ', create a project and enable the Google Calendar API.'),
        h('li', {}, 'Under OAuth consent screen, add yourself as a test user.'),
        h('li', {}, 'Create credentials: OAuth client ID, type ', h('b', {}, 'Desktop app'), '. Download the JSON.'),
        h('li', {}, 'Load that file here, then connect.')),
      h('div', { class: 'wiz-inline' }, h('button', { class: 'btn', onclick: async () => {
        const r = await tempo.google.loadClientFile();
        if (r.canceled) return;
        if (!r.ok) { toast(r.error, 6000); return; }
        toast('Credentials loaded.');
        draw2(r.state);
      } }, g.hasClient ? 'Load a different file' : 'Load client_secret.json')),
      status,
    ], { next: 'Continue' });
  }

  function done() {
    const key = (s) => (s || '').replace('Control', 'Ctrl');
    const s = state.settings;
    frame("You're set", 'A few ways to get around quickly:', [
      h('table', { class: 'wiz-keys' },
        [[key(s.hotkeyChat) || '-', 'Talk to Tempo from anywhere (press again to send)'],
          [key(s.hotkeyCalendar) || '-', 'Open or hide the calendar'],
          ['n', 'New event'], ['g', 'Show or collapse goals'], ['d  w  m  y', 'Day, week, month, year'], ['?', 'All shortcuts']]
          .map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))),
      h('p', { class: 'hint' }, 'You can run this setup again from Settings.'),
    ], { next: 'Start using Tempo', skip: false, onNext: async () => { await finish(); return false; } });
  }

  function draw() { [welcome, assistant, goals, focus, calendar, done][step](); }

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); }
    if (e.key === 'Tab') { // keep focus inside the wizard
      const f = [...card.querySelectorAll('button, input, select, a[href]')].filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  draw();
  // Setup can open before the window is shown; give the primary action focus once the window is active.
  window.addEventListener('focus', () => { if (root.isConnected && !root.contains(document.activeElement)) card.querySelector('.btn.primary')?.focus(); }, { once: true });
}

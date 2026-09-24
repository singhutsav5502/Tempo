'use strict';

// Settings drawer, in four tabs. Changes save immediately and flash "Saved".
// Helpers (h, $, state, field, saveSettings, toast, openModal, closeModal, ...) come from app.js.

const SETTINGS_TABS = [['connections', 'Connections'], ['blocking', 'Blocking'], ['goals', 'Goals'], ['general', 'General']];

// Many changes redraw the drawer, so the flag's state lives here rather than on the element.
let savedUntil = 0;
function showSavedFlag() {
  const el = $('#saved-flag');
  if (!el) return;
  const on = Date.now() < savedUntil;
  el.textContent = on ? 'Saved ✓' : '';
  el.classList.toggle('on', on);
}
function flashSaved() {
  savedUntil = Date.now() + 1600;
  showSavedFlag();
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(showSavedFlag, 1650);
}

async function saveAndFlash(patch) {
  await saveSettings(patch);
  flashSaved();
}

function drawSettings() {
  const d = $('#drawer');
  const scroll = d.scrollTop;
  const tab = state.settingsTab;
  const tabs = h('div', { class: 'stabs', role: 'tablist', 'aria-label': 'Settings sections' },
    SETTINGS_TABS.map(([id, label]) => h('button', {
      class: `stab${tab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', id: `stab-${id}`,
      onclick: () => { state.settingsTab = id; d.scrollTop = 0; drawSettings(); },
    }, label)));
  const body = h('div', { role: 'tabpanel', 'aria-labelledby': `stab-${tab}` },
    ({ connections: connectionsTab, blocking: blockingTab, goals: goalsTab, general: generalTab })[tab]());
  d.replaceChildren(
    h('div', { class: 'row shead' }, h('h2', {}, 'Settings'), h('span', { id: 'saved-flag', 'aria-live': 'polite' }),
      h('button', { class: 'icon-btn', style: 'flex:none', 'aria-label': 'Close settings', onclick: () => { d.hidden = true; } }, '✕')),
    tabs, body);
  d.setAttribute('aria-label', 'Settings');
  showSavedFlag();
  d.scrollTop = scroll;
}

// ---- Connections --------------------------------------------------------------------------------------

function connectionsTab() {
  const s = state.settings; const g = state.google;
  const status = g.connected
    ? h('div', { class: 'status-line' }, h('span', { class: `dot ${g.error ? 'err' : 'ok'}` }), g.error ? g.error : `Connected${g.lastSync ? ` · synced ${timeAgo(g.lastSync)}` : ''}`)
    : h('div', { class: 'status-line' }, h('span', { class: 'dot' }), g.hasClient ? 'Credentials loaded, not connected yet' : 'Not set up');

  const clientId = h('input', { type: 'text', value: s.googleClientId, placeholder: 'xxxx.apps.googleusercontent.com', onchange: (e) => saveAndFlash({ googleClientId: e.target.value.trim() }) });
  const clientSecret = h('input', { type: 'password', placeholder: s.hasGoogleSecret ? '•••••••• saved' : 'GOCSPX-…', onchange: async (e) => { await saveAndFlash({ googleClientSecret: e.target.value.trim() }); e.target.value = ''; state.google = await tempo.google.state(); drawSettings(); } });

  const provider = h('select', { onchange: async (e) => { await saveAndFlash({ provider: e.target.value }); drawSettings(); } },
    h('option', { value: 'claude-code', selected: s.provider !== 'api' }, 'Claude Code (my Claude login)'),
    h('option', { value: 'api', selected: s.provider === 'api' }, 'Anthropic API key'));
  const ccModel = h('select', { onchange: (e) => saveAndFlash({ ccModel: e.target.value }) },
    [['sonnet', 'Sonnet (fast)'], ['opus', 'Opus (smartest)'], ['haiku', 'Haiku (fastest)']].map(([v, l]) => h('option', { value: v, selected: s.ccModel === v }, l)));
  const apiKey = h('input', { type: 'password', placeholder: s.hasAnthropicKey ? '•••••••• saved' : 'sk-ant-…', onchange: async (e) => { await saveAndFlash({ anthropicKey: e.target.value.trim() }); e.target.value = ''; drawSettings(); } });
  const model = h('input', { type: 'text', value: s.model, list: 'models', onchange: (e) => saveAndFlash({ model: e.target.value.trim() }) });

  return [
    h('section', {}, h('h3', {}, 'Google Calendar'),
      status,
      h('div', { class: 'row' },
        g.connected
          ? [h('button', { class: 'btn', onclick: () => tempo.google.sync() }, 'Sync now'), h('button', { class: 'btn danger', onclick: async () => { state.google = await tempo.google.disconnect(); loadEvents(); drawSettings(); } }, 'Disconnect')]
          : [h('button', { class: 'btn', onclick: async () => {
            const r = await tempo.google.loadClientFile();
            if (r.canceled) return;
            if (!r.ok) { toast(r.error, 6000); return; }
            state.google = r.state; state.settings = await tempo.settings.get(); flashSaved(); drawSettings();
          } }, 'Load client_secret.json'),
          g.hasClient && h('button', { class: 'btn primary', onclick: async (e) => { e.target.textContent = 'Finish in your browser…'; try { state.google = await tempo.google.connect(); loadEvents(); } catch (err) { toast(err.message); } drawSettings(); } }, 'Connect Google')]),
      h('details', { class: 'more-opts' }, h('summary', {}, 'Enter credentials by hand'),
        field('OAuth client ID', clientId), field('OAuth client secret', clientSecret, 'From a Google Cloud OAuth client of type "Desktop app". Stored encrypted on this PC.'))),
    h('section', {}, h('h3', {}, 'Assistant'),
      field('Powered by', provider, s.provider === 'api'
        ? 'Calls the Anthropic API directly with your own key (billed per use).'
        : 'Runs your installed Claude Code in the background using your Claude login. No API key needed.'),
      s.provider === 'api'
        ? [field('Anthropic API key', apiKey, 'Stored encrypted on this PC and only sent to Anthropic.'),
          field('Model', model), h('datalist', { id: 'models' }, ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'].map((m) => h('option', { value: m })))]
        : field('Model', ccModel, 'Sonnet is the fastest for everyday scheduling; Opus is smarter but slower.')),
  ];
}

// ---- Blocking -----------------------------------------------------------------------------------------

function blockingTab() {
  const s = state.settings; const b = state.blocker;
  const num = (key, min, max) => h('input', { type: 'number', min, max, value: s[key], onchange: (e) => saveAndFlash({ [key]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) }) });
  return [
    h('section', {}, h('h3', {}, 'Block types'),
      h('div', { class: 'hint', style: 'margin:-2px 0 12px' }, 'Give a calendar event one of these types and, while it is on, its apps are closed and its sites are blocked.'),
      s.types.map((t, i) => typeCard(t, i)),
      h('button', { class: 'btn', onclick: async () => { s.types.push({ id: `t${Date.now().toString(36)}`, name: 'New type', color: '#7c93ff', apps: [], sites: [] }); await saveAndFlash({ types: s.types }); drawSettings(); } }, '+ Add block type')),
    h('section', {}, h('h3', {}, 'Rules'),
      h('div', { class: 'grid2' },
        field('Warning before an app closes (seconds)', num('warnSeconds', 3, 120)),
        field('"Allow" lasts (minutes)', num('overrideMinutes', 1, 60)),
        field('"Allow" uses per block', num('overridesPerBlock', 0, 20))),
      h('div', { class: 'hint', style: 'margin:-6px 0 14px' }, 'Set uses to 0 for strict mode: blocked apps close after the warning, with no way to allow them.'),
      h('div', { class: 'status-line' }, h('span', { class: `dot ${b.sitesReady ? 'ok' : ''}` }), b.sitesReady ? 'Website blocking is enabled' : 'Website blocking needs a one-time permission'),
      !b.sitesReady && h('button', { class: 'btn primary', onclick: async () => { try { state.blocker = await tempo.blocker.enableSites(); toast('Website blocking enabled.'); } catch (err) { toast(err.message); } drawSettings(); } }, 'Enable website blocking'),
      !b.sitesReady && h('div', { class: 'hint' }, 'Shows one Windows permission prompt so Tempo can edit the hosts file. After that it runs without admin rights.'),
      h('div', { class: 'hint', style: 'margin-top:10px' }, 'Tabs that are already open keep working until they reload.')),
  ];
}

function typeCard(t, i) {
  const s = state.settings;
  const patch = async (p) => { s.types[i] = { ...t, ...p }; await saveAndFlash({ types: s.types }); drawSettings(); loadEvents(); };

  const appChips = h('div', { class: 'chips' }, h('span', { class: 'hint' }, '…'));
  tempo.apps.names(t.apps).then((names) => {
    const groups = new Map();
    t.apps.forEach((exe, k) => { const n = names[k]; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(exe); });
    appChips.replaceChildren(...(groups.size ? [...groups].map(([name, exes]) => h('button', {
      class: 'chipx on', title: `${exes.join(', ')} · click to remove`, 'aria-label': `Remove ${name} from ${t.name}`,
      onclick: () => patch({ apps: t.apps.filter((x) => !exes.includes(x)) }),
    }, name, h('span', { 'aria-hidden': 'true' }, ' ✕'))) : [h('span', { class: 'hint' }, 'No apps.')]));
  });

  const picker = h('div', { class: 'picker', hidden: true });
  const openPicker = async () => {
    picker.hidden = false;
    picker.replaceChildren(h('span', { class: 'hint' }, 'Looking at your open apps…'));
    const running = (await tempo.apps.running()).filter((a) => !t.apps.includes(a.exe));
    const manual = h('input', { type: 'text', placeholder: 'or type a program name, e.g. game.exe', 'aria-label': 'Program name' });
    const addManual = () => {
      let v = manual.value.trim().toLowerCase();
      if (!v) return;
      if (!v.endsWith('.exe')) v += '.exe';
      patch({ apps: [...new Set([...t.apps, v])] });
    };
    manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') addManual(); });
    picker.replaceChildren(
      h('div', { class: 'hint', style: 'margin:0 0 6px' }, running.length ? 'Open right now:' : 'No other apps are open. Open the app you want to block, or type its program name.'),
      h('div', { class: 'chips' }, running.map((a) => h('button', { class: 'chipx', title: a.exe, onclick: () => patch({ apps: [...t.apps, a.exe] }) }, '+ ', a.name))),
      h('div', { class: 'row', style: 'margin-top:8px' }, manual, h('button', { class: 'btn', style: 'flex:none', onclick: addManual }, 'Add')));
  };

  const siteInput = h('input', { type: 'text', placeholder: 'Add a website, e.g. news.ycombinator.com', 'aria-label': `Add a website to ${t.name}` });
  const addSite = () => {
    const v = siteInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (!v || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) { toast('Enter a website like example.com'); return; }
    patch({ sites: [...new Set([...t.sites, v])] });
  };
  siteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSite(); });

  return h('div', { class: 'type-card', style: `--c:${t.color}` },
    h('div', { class: 'head' },
      h('input', { type: 'color', value: t.color, 'aria-label': `${t.name} colour`, onchange: (e) => patch({ color: e.target.value }) }),
      h('input', { type: 'text', value: t.name, 'aria-label': 'Block type name', onchange: (e) => patch({ name: e.target.value.trim() || t.name }) }),
      h('button', { class: 'icon-btn', title: `Delete ${t.name}`, 'aria-label': `Delete block type ${t.name}`, onclick: () => deleteType(t, i) }, '✕')),
    h('div', { class: 'lbl' }, 'Apps to close'), appChips,
    h('button', { class: 'btn add-app', onclick: openPicker }, '+ Add app'), picker,
    h('div', { class: 'lbl', style: 'margin-top:12px' }, 'Websites to block'),
    h('div', { class: 'chips' }, t.sites.length ? t.sites.map((site) => h('button', {
      class: 'chipx on', 'aria-label': `Remove ${site} from ${t.name}`, onclick: () => patch({ sites: t.sites.filter((x) => x !== site) }),
    }, site, h('span', { 'aria-hidden': 'true' }, ' ✕'))) : h('span', { class: 'hint' }, 'No websites.')),
    h('div', { class: 'row', style: 'margin-top:8px' }, siteInput, h('button', { class: 'btn', style: 'flex:none', onclick: addSite }, 'Add')));
}

async function deleteType(t, i) {
  const now = Date.now();
  const upcoming = (await tempo.events.range(now - 86400000, now + 180 * 86400000)).filter((e) => e.type === t.id && Date.parse(e.end) > now);
  const doDelete = async () => {
    state.settings.types.splice(i, 1);
    await saveAndFlash({ types: state.settings.types });
    drawSettings(); loadEvents();
  };
  if (!upcoming.length) { doDelete(); return; }
  openModal(h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': `Delete ${t.name}?`, style: 'width:400px' },
    h('div', { style: 'font-weight:600;font-size:15px' }, `Delete "${t.name}"?`),
    h('div', { class: 'hint', style: 'margin:0' }, `${upcoming.length} upcoming event${upcoming.length > 1 ? 's use' : ' uses'} it (next: ${upcoming[0].title}). They'll stay on your calendar but stop blocking anything.`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: closeModal }, 'Keep it'),
      h('button', { class: 'btn danger', onclick: () => { closeModal(); doDelete(); } }, 'Delete type'))));
}

// ---- Goals & reminders --------------------------------------------------------------------------------

function goalsTab() {
  const s = state.settings;
  const archivedBox = h('div', {}, h('span', { class: 'hint' }, '…'));
  tempo.habits.archived().then((list) => {
    archivedBox.replaceChildren(...(list.length ? list.map((g) => h('div', { class: 'row arch' },
      h('span', { class: 'arch-name', style: `--c:${g.color}` }, g.name),
      h('button', { class: 'btn', style: 'flex:none', onclick: async () => { await tempo.habits.restore(g.id); flashSaved(); drawSettings(); renderRail(); } }, 'Restore'))) : [h('span', { class: 'hint' }, 'Nothing removed. Removed goals keep their history and can be restored here.')]));
  });
  return [
    h('section', {}, h('h3', {}, 'Your goals'),
      h('div', { class: 'row' }, h('button', { class: 'btn', style: 'flex:none', onclick: () => { $('#drawer').hidden = true; setPage('sheet'); openHabitEditor(); } }, 'Edit goals…'),
        h('span', { class: 'hint' }, 'Add, rename, reorder, set targets and days.'))),
    h('section', {}, h('h3', {}, 'Reminders'),
      h('div', { class: 'grid2', style: 'grid-template-columns:1fr 1fr;margin-bottom:0' },
        field('Morning list of goals', h('input', { type: 'time', value: s.goalsMorning || '', onchange: (e) => saveAndFlash({ goalsMorning: e.target.value }) })),
        field('Evening, if goals are open', h('input', { type: 'time', value: s.goalsEvening || '', onchange: (e) => saveAndFlash({ goalsEvening: e.target.value }) }))),
      h('div', { class: 'hint', style: 'margin:-6px 0 10px' }, 'Clear a time to turn that reminder off.')),
    h('section', {}, h('h3', {}, 'Removed goals'), archivedBox),
  ];
}

// ---- General ------------------------------------------------------------------------------------------

function generalTab() {
  const s = state.settings;
  const check = (key, label, hint) => h('div', { class: 'field' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s[key] !== false && !!s[key], onchange: (e) => saveAndFlash({ [key]: e.target.checked }) }), label),
    hint && h('div', { class: 'hint', style: 'margin:2px 0 0 24px' }, hint));
  return [
    h('section', {}, h('h3', {}, 'Floating widget'),
      check('widgetVisible', 'Show the floating widget', 'You can also hide or show it from the tray icon menu.'),
      check('widgetHideFullscreen', 'Hide it while a full-screen app is in front', 'For games and full-screen video. Maximized windows don\'t count.'),
      check('voiceAutoSend', 'Send voice commands automatically when I stop talking')),
    h('section', {}, h('h3', {}, 'Hotkeys'),
      h('div', { class: 'grid2', style: 'grid-template-columns:1fr 1fr' },
        hotkeyField('Talk to Tempo', 'hotkeyChat'), hotkeyField('Open the calendar', 'hotkeyCalendar')),
      h('div', { class: 'hint', style: 'margin-top:-6px' }, 'Click a box and press the new keys. Backspace clears one.')),
    h('section', {}, h('h3', {}, 'Calendar'),
      h('div', { class: 'grid2', style: 'grid-template-columns:1fr 1fr;margin-bottom:6px' },
        field('Day starts at', hourSelect(s, 'dayStartHour', 0, 20)), field('Day ends at', hourSelect(s, 'dayEndHour', 4, 24))),
      check('launchAtStartup', 'Start Tempo when I sign in to Windows')),
    h('section', {}, h('h3', {}, 'Help'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { $('#drawer').hidden = true; openWizard(); } }, 'Run setup again'),
        h('button', { class: 'btn', onclick: () => { $('#drawer').hidden = true; openShortcuts(); } }, 'Keyboard shortcuts'))),
  ];
}

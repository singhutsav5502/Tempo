'use strict';
let current = null, raf = 0;
const $ = (s) => document.querySelector(s);
tempo.alert.onShow((a) => {
  current = a;
  $('#kicker').textContent = `${a.blockName} block`;
  $('#msg').textContent = `${a.label} is blocked right now`;
  $('#allow').hidden = !a.canOverride;
  $('#allow').textContent = `Allow ${a.minutes} min · ${a.overridesLeft} left`;
  const total = Math.max(1, a.deadline - Date.now());
  cancelAnimationFrame(raf);
  const tick = () => {
    const left = Math.max(0, a.deadline - Date.now());
    $('#sub').textContent = `Closing in ${Math.ceil(left / 1000)}s`;
    $('#bar').style.transform = `scaleX(${left / total})`;
    if (left > 0 && current === a) raf = requestAnimationFrame(tick);
  };
  tick();
});
$('#close').onclick = () => tempo.alert.act(current.id, 'close');
$('#allow').onclick = () => tempo.alert.act(current.id, 'allow');

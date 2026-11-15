// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, round score,
// team pips, killfeed, bomb status, damage direction and the buy menu. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const buyPanel = $('buy');
  const buyList = $('buy-list');
  const crosshair = $('crosshair');
  let hitTimer = 0;
  let feedTimer = 0;
  let last = {};

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(hp, armor) {
      setText($('health-num'), 'hp', String(Math.max(0, Math.ceil(hp))));
      $('health-fill').style.width = `${Math.max(0, Math.min(100, hp))}%`;
      setText($('armor-num'), 'armor', armor > 0 ? String(Math.ceil(armor)) : '');
      $('armor-row').style.display = armor > 0 ? 'flex' : 'none';
    },
    setAmmo(mag, reserve) {
      setText($('ammo-mag'), 'mag', String(mag));
      setText($('ammo-reserve'), 'res', `/ ${reserve}`);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setWeapon(name) { setText($('weapon-name'), 'wpn', name); },
    setMoney(value) { setText($('money'), 'money', `$${value}`); },
    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      setText($('timer'), 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      $('timer').classList.toggle('planted', planted);
    },
    setScore(a, b) { setText($('rounds'), 'score', `${a} — ${b}`); },
    setPips(aliveA, totalA, aliveB, totalB) {
      setText($('pips-a'), 'pa', '●'.repeat(aliveA) + '○'.repeat(Math.max(0, totalA - aliveA)));
      setText($('pips-b'), 'pb', '●'.repeat(aliveB) + '○'.repeat(Math.max(0, totalB - aliveB)));
    },
    setBomb(text) {
      setText($('bomb'), 'bomb', text);
      $('bomb').style.display = text ? 'block' : 'none';
    },
    setHint(text) {
      setText($('hint'), 'hint', text);
      $('hint').style.display = text ? 'block' : 'none';
    },
    setSpread(gapPx) {
      crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 120) {
      const hm = $('hitmarker');
      hm.classList.add('on');
      hm.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hm.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(angleDeg) {
      const d = $('damage');
      d.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      d.classList.add('on');
      clearTimeout(d._t);
      d._t = setTimeout(() => d.classList.remove('on'), 450);
    },
    killfeed(text) {
      const feed = $('feed');
      const line = document.createElement('div');
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      clearTimeout(feedTimer);
      feedTimer = setTimeout(() => { feed.innerHTML = ''; }, 6000);
    },
    showOverlay(mode, data) {
      const copyText = {
        start: ['EMBERLINE', 'Foundry Yard — plant the spike at Furnace or Crane Bay, or wipe the Slate squad. First to 5 rounds takes the match.', 'Click to play'],
        paused: ['EMBERLINE', 'Paused. Click to resume.', 'Click to resume'],
        buy: ['EMBERLINE', 'Buy phase — press B to open the buy menu, then click to play.', 'Click to play'],
        roundwin: ['Round won', data, 'Next round'],
        roundlose: ['Round lost', data, 'Next round'],
        matchwin: ['Match won', data, 'Play again'],
        matchlose: ['Match lost', data, 'Play again'],
      }[mode];
      title.textContent = copyText[0];
      copy.textContent = copyText[1];
      play.textContent = copyText[2];
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
    showBuy(items, money, onBuy) {
      buyList.innerHTML = '';
      items.forEach((item, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = money < item.price;
        row.innerHTML = `<span class="buy-key">${i + 1}</span><span>${item.label}</span><span class="buy-price">$${item.price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyList.appendChild(row);
      });
      $('buy-money').textContent = `$${money}`;
      buyPanel.hidden = false;
    },
    hideBuy() { buyPanel.hidden = true; },
    setBuyMoney(money) { $('buy-money').textContent = `$${money}`; },
  };
}

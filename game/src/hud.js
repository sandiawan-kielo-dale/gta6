// HUD: health bar, cash, wanted stars, speed, mission objective, the 2D minimap with
// roads, cars, police and the mission marker, plus menus, toasts and the damage flash.
SM.hud = (function hud() {
  let el = {};
  let toastTimer = 0;
  let bannerTimer = 0;
  let mapTimer = 0;
  let vignetteTimer = 0;

  function $(id) { return document.getElementById(id); }

  function init() {
    el = {
      hud: $('hud'), topleft: $('topleft'), healthfill: $('healthfill'), healthtext: $('healthtext'),
      money: $('money'), stars: $('stars'), wantedlabel: $('wantedlabel'),
      minimap: $('minimap'), carinfo: $('carinfo'), carname: $('carname'), speed: $('speed'),
      objkicker: $('objkicker'), objtext: $('objtext'), objsub: $('objsub'),
      message: $('message'), submessage: $('submessage'), interact: $('interact'),
      crosshair: $('crosshair'), hint: $('hint'), vignette: $('vignette'), edgearrow: $('edgearrow'),
      menu: $('menu'), pause: $('pause'), end: $('end'), endtitle: $('endtitle'), endtext: $('endtext'),
      status: $('status'),
    };
  }

  function setStars(n) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < n ? '\u2605' : '<span class="off">\u2605</span>';
    el.stars.innerHTML = s;
    el.wantedlabel.textContent = n > 0 ? 'Wanted — lose the police' : 'No heat';
  }

  function drawMinimap() {
    const ctx = el.minimap.getContext('2d');
    const S = 180;
    const map = SM.city.map;
    if (!map) return;
    const scale = S / 560;
    const toX = (x) => S / 2 + x * scale;
    const toZ = (z) => S / 2 + z * scale;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#20242e';
    ctx.fillRect(0, 0, S, S);
    // Sea and beach (east edge).
    ctx.fillStyle = '#2e7f9e';
    ctx.fillRect(toX(map.seaX), 0, S - toX(map.seaX), S);
    ctx.fillStyle = '#e8d29a';
    ctx.fillRect(toX(map.beachX), 0, toX(map.seaX) - toX(map.beachX), S);
    // Roads.
    ctx.strokeStyle = '#5a5a63';
    ctx.lineWidth = 5;
    for (let c = map.roads.min; c <= map.roads.max; c += map.roads.step) {
      ctx.beginPath(); ctx.moveTo(toX(c), toZ(map.roads.min)); ctx.lineTo(toX(c), toZ(map.roads.max)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(toX(map.roads.min), toZ(c)); ctx.lineTo(toX(map.roads.max), toZ(c)); ctx.stroke();
    }
    // Buildings.
    ctx.fillStyle = '#3d4454';
    for (const b of map.buildings) {
      ctx.fillRect(toX(b.x - b.w / 2), toZ(b.z - b.d / 2), b.w * scale, b.d * scale);
    }
    // Traffic cars (white dots).
    ctx.fillStyle = '#ffffff';
    for (const c of SM.vehicles.cars) {
      if (c.isPlayer || c.isPolice) continue;
      ctx.fillRect(toX(c.x) - 1, toZ(c.z) - 1, 2, 2);
    }
    // Mission marker (pulsing yellow diamond).
    const target = SM.missions.currentTarget();
    if (target) {
      const pulse = 4 + Math.sin(performance.now() * 0.006) * 1.5;
      ctx.fillStyle = '#ffd23c';
      const mx = toX(target.x), mz = toZ(target.z);
      ctx.beginPath();
      ctx.moveTo(mx, mz - pulse);
      ctx.lineTo(mx + pulse, mz);
      ctx.lineTo(mx, mz + pulse);
      ctx.lineTo(mx - pulse, mz);
      ctx.closePath();
      ctx.fill();
    }
    // Police (red dots).
    ctx.fillStyle = '#ff3b30';
    for (const c of SM.vehicles.police) {
      ctx.beginPath();
      ctx.arc(toX(c.x), toZ(c.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    const p = SM.people.player;
    if (p) {
      const px = toX(p.x), pz = toZ(p.z);
      const h = p.car ? p.car.heading : p.heading;
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(-h);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Point the edge arrow at the objective when it is off screen. */
  function updateArrow(camera) {
    const target = SM.missions.currentTarget();
    const p = SM.people.player;
    if (!target || !p || !camera) { el.edgearrow.classList.add('hidden'); return; }
    const v = new THREE.Vector3(target.x, 3, target.z).project(camera);
    const onScreen = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.9;
    if (onScreen) { el.edgearrow.classList.add('hidden'); return; }
    el.edgearrow.classList.remove('hidden');
    // Bearing of the target relative to where the camera looks.
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const dx = target.x - p.x, dz = target.z - p.z;
    const targetAngle = Math.atan2(dx, dz);
    const camAngle = Math.atan2(camDir.x, camDir.z);
    let rel = targetAngle - camAngle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    // Arrow points up when the target is ahead; rotate as it swings around.
    const deg = -rel * 180 / Math.PI;
    el.edgearrow.style.transform = `translateX(-50%) rotate(${deg}deg)`;
  }

  function update(dt, game) {
    const p = SM.people.player;
    if (!p) return;
    // Health.
    const hp = Math.max(0, Math.round(p.health));
    el.healthfill.style.width = hp + '%';
    el.healthfill.classList.toggle('low', hp < 35);
    el.healthtext.textContent = 'Health ' + hp + (p.ammo !== undefined && p.onFoot ? '  ·  Ammo ' + p.ammo + '/12' : '');
    el.money.textContent = SM.money(game.money());
    setStars(game.wantedStars());
    // Car info.
    if (p.car) {
      el.carinfo.classList.remove('hidden');
      el.carname.textContent = p.car.name || 'Sedan';
      el.speed.textContent = Math.round(Math.abs(p.car.speed) * 3.2);
    } else {
      el.carinfo.classList.add('hidden');
    }
    el.crosshair.classList.toggle('hidden', !p.onFoot || game.state() !== 'playing');
    // Timers.
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) { el.message.textContent = ''; el.submessage.textContent = ''; }
    }
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) { el.message.textContent = ''; el.submessage.textContent = ''; }
    }
    if (vignetteTimer > 0) {
      vignetteTimer -= dt;
      el.vignette.style.opacity = String(Math.max(0, vignetteTimer));
      if (vignetteTimer <= 0) el.vignette.style.opacity = '0';
    }
    // Minimap at ~12 Hz.
    mapTimer -= dt;
    if (mapTimer <= 0) {
      mapTimer = 0.08;
      drawMinimap();
    }
    updateArrow(game.camera());
    // Screen-reader status line.
    if (Math.floor(performance.now() / 2000) !== update._lastStatus) {
      update._lastStatus = Math.floor(performance.now() / 2000);
      el.status.textContent = `Health ${hp}. Cash ${SM.money(game.money())}. Wanted ${game.wantedStars()} stars. ${el.objtext.textContent}`;
    }
  }

  return {
    init: init,
    update: update,
    setObjective: function setObjective(kicker, text, sub) {
      el.objkicker.textContent = kicker;
      el.objtext.textContent = text;
      el.objsub.textContent = sub || '';
    },
    toast: function toast(title, sub) {
      el.message.textContent = title;
      el.submessage.textContent = sub || '';
      toastTimer = 4.5;
      bannerTimer = 0;
    },
    banner: function banner(title, sub) {
      el.message.textContent = title;
      el.submessage.textContent = sub || '';
      bannerTimer = 4.5;
      toastTimer = 0;
    },
    flashDamage: function flashDamage() {
      vignetteTimer = 0.7;
      el.vignette.style.opacity = '0.9';
    },
    setInteract: function setInteract(text) {
      if (!text) { el.interact.classList.add('hidden'); return; }
      el.interact.textContent = text;
      el.interact.classList.remove('hidden');
    },
    showHud: function showHud(on) { el.hud.classList.toggle('hidden', !on); },
    showMenu: function showMenu(on) { el.menu.classList.toggle('hidden', !on); },
    showPause: function showPause(on, savedText) {
      el.pause.classList.toggle('hidden', !on);
      if (savedText !== undefined) document.getElementById('pausesaved').textContent = savedText;
    },
    showEnd: function showEnd(on, title, text, cls) {
      el.end.classList.toggle('hidden', !on);
      if (on) {
        el.endtitle.textContent = title;
        el.endtitle.className = 'bigword ' + (cls || 'red');
        el.endtext.textContent = text;
      }
    },
    setContinueVisible: function setContinueVisible(on) {
      document.getElementById('btncontinue').classList.toggle('hidden', !on);
    },
  };
})();

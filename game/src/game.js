// Solmarina — Sunset Streets: bootstrap, the main loop, third-person camera, input,
// the wanted system, particles, and the ?shot= staging used for screenshots.
SM.game = (function game() {
  let renderer = null;
  let scene = null;
  let camera = null;
  let state = 'menu';
  let money = 0;
  let heat = 0; // 0..1000; stars follow thresholds
  let time = 0;
  let lastCrimeAt = -99;
  let camYaw = Math.PI;
  let camPitch = 0.32;
  let camDist = 10;
  let camShake = 0;
  let keys = {};
  let input = { up: false, down: false, left: false, right: false, run: false, jump: false, handbrake: false, interact: false };
  let dragging = false;
  let dragX = 0, dragY = 0;
  let shotMode = null;
  let shotFrames = 0;
  let storyComplete = false;
  let saveTimer = 0;
  let menuAngle = 0;

  const STAR_HEAT = [0, 60, 200, 400, 600, 850];
  const DEBT = 5000;

  // ---------------------------------------------------------------- particles
  const FX_MAX = 600;
  let fxGeo = null, fxPts = null;
  let fxPos = null, fxVel = null, fxLife = null, fxCol = null;
  let fxCursor = 0;
  let tracers = [];

  function initFx() {
    fxPos = new Float32Array(FX_MAX * 3);
    fxVel = new Float32Array(FX_MAX * 3);
    fxLife = new Float32Array(FX_MAX);
    fxCol = new Float32Array(FX_MAX * 3);
    for (let i = 0; i < FX_MAX; i++) fxPos[i * 3 + 1] = -100;
    fxGeo = new THREE.BufferGeometry();
    fxGeo.setAttribute('position', new THREE.BufferAttribute(fxPos, 3));
    fxGeo.setAttribute('color', new THREE.BufferAttribute(fxCol, 3));
    const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    fxPts = new THREE.Points(fxGeo, mat);
    fxPts.frustumCulled = false;
    scene.add(fxPts);
  }

  SM.fx = {
    burst: function burst(x, y, z, n, color) {
      if (!fxPos) return;
      const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
      for (let k = 0; k < n; k++) {
        const i = fxCursor;
        fxCursor = (fxCursor + 1) % FX_MAX;
        fxPos[i * 3] = x; fxPos[i * 3 + 1] = y; fxPos[i * 3 + 2] = z;
        fxVel[i * 3] = (Math.random() - 0.5) * 8;
        fxVel[i * 3 + 1] = Math.random() * 6 + 1;
        fxVel[i * 3 + 2] = (Math.random() - 0.5) * 8;
        fxCol[i * 3] = r; fxCol[i * 3 + 1] = g; fxCol[i * 3 + 2] = b;
        fxLife[i] = 0.5 + Math.random() * 0.5;
      }
    },
    tracer: function tracer(a, b) {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
      scene.add(line);
      tracers.push({ line: line, life: 0.12 });
    },
  };

  function updateFx(dt) {
    if (!fxPos) return;
    for (let i = 0; i < FX_MAX; i++) {
      if (fxLife[i] <= 0) continue;
      fxLife[i] -= dt;
      if (fxLife[i] <= 0) { fxPos[i * 3 + 1] = -100; continue; }
      fxVel[i * 3 + 1] -= 9 * dt;
      fxPos[i * 3] += fxVel[i * 3] * dt;
      fxPos[i * 3 + 1] += fxVel[i * 3 + 1] * dt;
      fxPos[i * 3 + 2] += fxVel[i * 3 + 2] * dt;
    }
    fxGeo.attributes.position.needsUpdate = true;
    fxGeo.attributes.color.needsUpdate = true;
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.12) * 0.9;
      if (t.life <= 0) {
        scene.remove(t.line);
        t.line.geometry.dispose();
        tracers.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- wanted
  function wantedStars() {
    let s = 0;
    for (let i = 0; i < STAR_HEAT.length; i++) if (heat >= STAR_HEAT[i]) s = i;
    return s;
  }

  function addWanted(n, reason) {
    heat = Math.min(1000, heat + n);
    lastCrimeAt = time;
    if (SM.hud && n >= 100) SM.hud.toast('WANTED', reason || 'The police are coming');
  }

  function updateWanted(dt) {
    const p = SM.people.player;
    if (!p) return;
    const stars = wantedStars();
    if (stars === 0) return;
    let copNear = false;
    for (const c of SM.vehicles.police) {
      if (SM.dist2d(p.x, p.z, c.x, c.z) < 60) { copNear = true; break; }
    }
    if (!copNear) {
      for (const c of SM.people.footCops) {
        if (c.state !== 'down' && SM.dist2d(p.x, p.z, c.x, c.z) < 40) { copNear = true; break; }
      }
    }
    if (!copNear && time - lastCrimeAt > 3) {
      heat = Math.max(0, heat - 26 * dt);
    }
  }

  // ---------------------------------------------------------------- flow
  function startGame(fromSave) {
    SM.audio.unlock();
    SM.hud.showMenu(false);
    SM.hud.showHud(true);
    state = 'playing';
    if (fromSave) {
      const s = SM.save.load();
      if (s) {
        const mission = SM.save.apply(s);
        if (mission === -1) {
          storyComplete = true;
          SM.hud.setObjective('Free Roam', 'Solmarina is yours', 'Side jobs appear around the city');
          SM.missions.spawnSideJob();
        } else {
          SM.missions.startMission(mission);
        }
        SM.hud.toast('Welcome back', 'Your save was loaded');
      } else {
        newGame();
      }
    } else {
      newGame();
    }
    if (SM.save) SM.save.save();
  }

  function newGame() {
    money = 0;
    heat = 0;
    storyComplete = false;
    const p = SM.people.player;
    p.x = -24; p.z = -8; p.y = 0; p.health = 100;
    p.mesh.position.set(-24, 0, -8);
    p.heading = Math.PI / 2;
    SM.missions.startStory();
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    SM.hud.showPause(true);
    SM.audio.engine(0, false);
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    SM.hud.showPause(false);
  }

  function quitToMenu() {
    state = 'menu';
    SM.hud.showPause(false);
    SM.hud.showHud(false);
    SM.hud.showMenu(true);
    SM.hud.setContinueVisible(SM.save.has());
    if (SM.save) SM.save.save();
  }

  function respawnAtHospital() {
    const p = SM.people.player;
    const h = SM.city.places.hospital;
    p.x = h.x + 14; p.z = h.z; p.y = 0;
    p.health = 100;
    p.onFoot = true;
    if (p.car) { p.car.isPlayer = false; p.car.parked = true; p.car = null; }
    p.mesh.visible = true;
    p.mesh.position.set(p.x, 0, p.z);
    heat = 0;
    state = 'playing';
    SM.hud.showEnd(false);
    SM.hud.toast('Patched up', 'St. Marina Clinic — try not to come back');
    if (SM.save) SM.save.save();
  }

  function busted() {
    if (state !== 'playing') return;
    state = 'busted';
    const loss = Math.floor(money * 0.1);
    money -= loss;
    SM.audio.busted();
    SM.hud.showEnd(true, 'BUSTED', `The Solmarina Police caught you. Bail cost ${SM.money(loss)}.`, 'blue');
  }

  function wasted() {
    if (state !== 'playing') return;
    state = 'wasted';
    const loss = Math.floor(money * 0.1);
    money -= loss;
    SM.audio.busted();
    SM.hud.showEnd(true, 'WASTED', `You woke up at St. Marina Clinic. The hospital kept ${SM.money(loss)} for the trouble.`, 'red');
  }

  function carWrecked(car) {
    const p = SM.people.player;
    if (p.car === car) {
      p.car = null;
      p.onFoot = true;
      p.mesh.visible = true;
      p.x = car.x + 3; p.z = car.z;
      p.mesh.position.set(p.x, 0, p.z);
      SM.hud.toast('WRECKED', 'Your car is finished. Find another one.');
    }
  }

  // ---------------------------------------------------------------- car enter/exit
  function tryEnterCar() {
    const p = SM.people.player;
    if (!p || !p.onFoot) return;
    const car = SM.vehicles.nearestCar(p.x, p.z, 4.5, false);
    if (!car) return;
    if (car.isPolice) { SM.hud.toast('Locked', 'That one is a police cruiser'); return; }
    const wasParked = car.parked;
    const hadDriver = car.driver;
    car.parked = false;
    car.isPlayer = true;
    car.driver = false;
    p.car = car;
    p.onFoot = false;
    p.mesh.visible = false;
    SM.audio.click();
    if (car.owner !== 'player') {
      if (car.id === 'taxi1') {
        // Mara's work taxi: taking it is the job, not a crime.
      } else if (wasParked) {
        addWanted(100, 'car stolen');
      } else if (hadDriver) {
        addWanted(150, 'carjacking!');
      }
    }
    car.owner = 'player';
    SM.missions.onEnterCar(car);
    SM.hud.setInteract('');
  }

  function exitCar() {
    const p = SM.people.player;
    if (!p || p.onFoot || !p.car) return;
    const car = p.car;
    car.isPlayer = false;
    car.parked = true;
    car.speed = 0;
    car.owner = 'player';
    p.car = null;
    p.onFoot = true;
    p.mesh.visible = true;
    const side = Math.cos(car.heading);
    p.x = car.x - Math.cos(car.heading) * 0 + (side >= 0 ? 2.8 : -2.8);
    p.z = car.z + 2.8;
    p.y = 0;
    SM.city.resolveCollision(p, 0.7);
    p.mesh.position.set(p.x, 0, p.z);
    p.heading = car.heading;
    SM.audio.click();
  }

  // ---------------------------------------------------------------- camera
  function updateCamera(dt) {
    const p = SM.people.player;
    if (!p) return;
    let tx, tz, ty, dist, height;
    if (p.car) {
      tx = p.car.x; tz = p.car.z; ty = 1.4;
      dist = camDist + 3;
      height = 4.6;
      // Chase cam: drift behind the car's heading.
      const targetYaw = Math.atan2(Math.sin(p.car.heading), Math.cos(p.car.heading));
      camYaw = SM.angleLerp(camYaw, targetYaw, 1 - Math.exp(-1.6 * dt));
    } else {
      tx = p.x; tz = p.z; ty = 1.7;
      dist = camDist;
      height = 3.4;
    }
    const cx = tx - Math.sin(camYaw) * dist * Math.cos(camPitch);
    const cz = tz - Math.cos(camYaw) * dist * Math.cos(camPitch);
    const cy = ty + Math.sin(camPitch) * dist + height * 0.4;
    camera.position.x = SM.damp(camera.position.x, cx, 8, dt);
    camera.position.z = SM.damp(camera.position.z, cz, 8, dt);
    camera.position.y = SM.damp(camera.position.y, Math.max(0.7, cy), 8, dt);
    // Keep the camera out of buildings.
    const cpos = { x: camera.position.x, z: camera.position.z };
    SM.city.resolveCollision(cpos, 0.6);
    camera.position.x = cpos.x;
    camera.position.z = cpos.z;
    if (camShake > 0) {
      camShake = Math.max(0, camShake - dt * 2.2);
      camera.position.x += (Math.random() - 0.5) * camShake * 0.5;
      camera.position.y += (Math.random() - 0.5) * camShake * 0.5;
    }
    camera.lookAt(tx, ty, tz);
  }

  // ---------------------------------------------------------------- input
  function readInput() {
    input.up = !!(keys.KeyW || keys.ArrowUp);
    input.down = !!(keys.KeyS || keys.ArrowDown);
    input.left = !!(keys.KeyA || keys.ArrowLeft);
    input.right = !!(keys.KeyD || keys.ArrowRight);
    input.run = !!(keys.ShiftLeft || keys.ShiftRight);
    input.jump = !!keys.Space;
    input.handbrake = !!keys.Space;
    input.interact = !!keys.KeyE;
    // Screenshot staging: keep a staged car driving so the shot shows motion.
    if (shotMode && SM.people.player && SM.people.player.car) input.up = true;
  }

  function bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { keys[e.code] = true; return; }
      keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
      if (state !== 'playing') return;
      if (e.code === 'KeyE') tryEnterCarOrExit();
      if (e.code === 'KeyF') SM.people.punch();
      if (e.code === 'KeyM') {
        const m = SM.audio.toggleMute();
        SM.hud.toast(m ? 'Muted' : 'Sound on', '');
      }
      if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    const canvas = document.getElementById('game');
    canvas.addEventListener('pointerdown', (e) => {
      if (state !== 'playing') return;
      if (e.button === 0 && SM.people.player && SM.people.player.onFoot) {
        SM.people.shoot(camera);
        camShake = Math.min(0.6, camShake + 0.25);
      }
      dragging = true;
      dragX = e.clientX; dragY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      camYaw -= (e.clientX - dragX) * 0.005;
      camPitch = SM.clamp(camPitch + (e.clientY - dragY) * 0.003, 0.05, 1.1);
      dragX = e.clientX; dragY = e.clientY;
    });
    window.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('wheel', (e) => {
      camDist = SM.clamp(camDist + Math.sign(e.deltaY) * 1.5, 6, 18);
    }, { passive: true });
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    // Menu buttons.
    document.getElementById('btnnew').addEventListener('click', () => { SM.audio.unlock(); SM.save.clear(); startGame(false); });
    document.getElementById('btncontinue').addEventListener('click', () => startGame(true));
    document.getElementById('btnhow').addEventListener('click', () => {
      document.getElementById('howto').classList.toggle('hidden');
    });
    document.getElementById('btnresume').addEventListener('click', resumeGame);
    document.getElementById('btnsave').addEventListener('click', () => {
      const ok = SM.save.save();
      SM.hud.showPause(true, ok ? 'Saved just now.' : 'Save failed (storage unavailable).');
    });
    document.getElementById('btnrestartmission').addEventListener('click', () => {
      resumeGame();
      SM.missions.resetMission();
      SM.hud.toast('Mission restarted', '');
    });
    document.getElementById('btnquit').addEventListener('click', quitToMenu);
    document.getElementById('btnrespawn').addEventListener('click', respawnAtHospital);
  }

  function tryEnterCarOrExit() {
    const p = SM.people.player;
    if (!p) return;
    if (p.onFoot) tryEnterCar();
    else exitCar();
  }

  // ---------------------------------------------------------------- shot staging
  function stageShot(name) {
    const p = SM.people.player;
    SM.hud.showMenu(false);
    SM.hud.showHud(true);
    state = 'playing';
    const place = (x, z, heading) => {
      p.x = x; p.z = z; p.heading = heading;
      p.mesh.position.set(x, 0, z);
      p.mesh.rotation.y = heading;
      camYaw = heading;
    };
    if (name === 'chase') {
      // Vault-job escape: sports car, 3 stars, cruisers closing in.
      const car = SM.vehicles.addCar('sports', 0xd81e2c, 0, -48, 0, { parked: false });
      car.isPlayer = true; car.owner = 'player';
      p.car = car; p.onFoot = false; p.mesh.visible = false;
      car.speed = 24;
      // One cruiser ahead to cut the player off, two more on the tail (minimap).
      const c1 = SM.vehicles.addCar('police', 0x1c1c22, -4, 20, Math.PI, {});
      const c2 = SM.vehicles.addCar('police', 0x1c1c22, -4, -92, 0, {});
      const c3 = SM.vehicles.addCar('police', 0x1c1c22, 5, -112, 0, {});
      c1.speed = 20; c2.speed = 24; c3.speed = 24;
      heat = 420;
      SM.missions.stage(4, 1);
      camYaw = 0;
    } else if (name === 'drive') {
      // Beachfront cruise in the taxi, first fare on the board. Drive south so the
      // sea stays on the right of the frame.
      const car = SM.vehicles.addCar('taxi', 0xffc93c, 236, 100, Math.PI, { parked: false });
      car.isPlayer = true; car.owner = 'player';
      p.car = car; p.onFoot = false; p.mesh.visible = false;
      car.speed = 20;
      SM.missions.stage(1, 1);
      camYaw = Math.PI;
    } else if (name === 'foot') {
      // On foot on road x=0 heading south to Mara's office, beacon ahead-left.
      place(0, 40, 0);
      SM.missions.stage(0, 0);
      camYaw = 0;
      camDist = 7;
    } else if (name === 'mission') {
      // Pier 9 pickup, two stars, a cruiser closing in from the beach road.
      place(352, 2, Math.PI / 2);
      heat = 220;
      const c1 = SM.vehicles.addCar('police', 0x1c1c22, 252, 40, Math.PI / 2, {});
      c1.speed = 20;
      SM.missions.stage(3, 0);
      camYaw = Math.PI / 2;
      camDist = 7;
    }
    window.__shotReady = false;
    shotFrames = 0;
  }

  // ---------------------------------------------------------------- main loop
  let lastT = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    if (state === 'playing') {
      time += dt;
      readInput();
      const p = SM.people.player;
      if (p) {
        if (p.onFoot) SM.people.updatePlayer(dt, input, camYaw);
        else if (p.car && !p.car.wrecked) SM.vehicles.drivePlayer(p.car, input, dt);
        else if (p.car && p.car.wrecked) { /* wrecked: car stays put */ }
      }
      SM.vehicles.updateTraffic(dt, p);
      const nearestCop = SM.vehicles.updatePolice(dt, p, p && p.car ? p.car : null);
      SM.vehicles.collideCars(dt);
      SM.people.updatePeds(dt, p, null);
      SM.people.updateFootCops(dt, p);
      SM.missions.update(dt, p, input);
      updateWanted(dt);
      // Interact prompt.
      let prompt = '';
      if (p && p.onFoot) {
        const car = SM.vehicles.nearestCar(p.x, p.z, 4.5, false);
        if (car && !car.isPolice) prompt = car.id === 'taxi1' ? 'Press E — get in the taxi' : car.parked ? 'Press E — steal the car' : 'Press E — take the car';
        else {
          const step = SM.missions.currentStep();
          if (step && step.kind === 'pickup') {
            const pos = SM.city.places[step.at];
            if (pos && SM.dist2d(p.x, p.z, pos.x, pos.z) < step.r) prompt = 'Hold E — grab it';
          }
        }
      } else if (p && p.car) {
        prompt = 'Press E — get out';
      }
      SM.hud.setInteract(prompt || '');
      // Engine + siren.
      const carSpeed = p && p.car ? Math.abs(p.car.speed) / 35 : 0;
      SM.audio.engine(carSpeed, !!(p && p.car));
      SM.audio.siren(nearestCop);
      // Clouds drift; tower beacon blinks.
      for (const c of SM.city.clouds) {
        c.position.x += dt * 1.5;
        if (c.position.x > 480) c.position.x = -480;
      }
      if (SM.city.beacon) {
        const on = Math.floor(t / 500) % 2 === 0;
        SM.city.beacon.material.color.setHex(on ? 0xff3b30 : 0x551111);
      }
      // Autosave every 60s.
      saveTimer += dt;
      if (saveTimer > 60) { saveTimer = 0; SM.save.save(); }
      updateCamera(dt);
      updateFx(dt);
      SM.hud.update(dt, SM.game);
      // Screenshot staging: signal readiness after the scene has settled.
      if (shotMode) {
        shotFrames++;
        if (shotFrames > 60) window.__shotReady = true;
      }
    } else if (state === 'menu') {
      // Slow attract orbit around the plaza.
      menuAngle += dt * 0.05;
      const cx = -24 + Math.sin(menuAngle) * 60;
      const cz = -24 + Math.cos(menuAngle) * 60;
      camera.position.set(cx, 26, cz);
      camera.lookAt(-24, 6, -24);
      for (const c of SM.city.clouds) {
        c.position.x += dt * 1.5;
        if (c.position.x > 480) c.position.x = -480;
      }
      SM.vehicles.updateTraffic(dt, { x: -24, z: -24 });
      SM.people.updatePeds(dt, { x: -24, z: -24 }, null);
      updateFx(dt);
    }
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- init
  function init() {
    const params = SM.params();
    const seed = params.seed ? parseInt(params.seed, 10) : 20261124;
    const rng = SM.makeRng(seed);
    shotMode = params.shot || null;

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);
    camera.position.set(-80, 30, 40);

    SM.city.build(scene, rng);
    SM.vehicles.init(scene, rng);
    SM.people.init(scene, rng);
    SM.missions.init(scene, rng);
    SM.hud.init();
    initFx();

    // Player, pedestrians, parked cars. Spawn clear of the fountain collider.
    SM.people.createPlayer(-24, -8);
    SM.people.spawnPeds(22);
    const lots = SM.city.parkingLots || [];
    for (let i = 0; i < Math.min(8, lots.length); i++) {
      const lot = lots[i];
      const car = SM.vehicles.addCar(SM.pick(rng, ['sedan', 'sedan', 'taxi']), SM.pick(rng, [0x3a6fd8, 0xd8d8d8, 0x2a9d5c, 0x8a5fd8]), lot.x + SM.rand(rng, -8, 8), lot.z + SM.rand(rng, -8, 8), SM.rand(rng, 0, Math.PI * 2), { parked: true });
      car.parked = true;
    }
    // A few parked cars along roads too.
    for (let i = 0; i < 6; i++) {
      const road = Math.round(SM.rand(rng, -5, 5)) * 48;
      const along = SM.rand(rng, -220, 220);
      const car = SM.vehicles.addCar('sedan', SM.pick(rng, [0xd81e2c, 0x2a9d5c, 0xe07b28, 0x4db2d8]), along, road + 5.5, 0, { parked: true });
      car.parked = true;
    }

    bindInput();
    SM.hud.setContinueVisible(SM.save.has());
    if (shotMode) {
      stageShot(shotMode);
    }
    requestAnimationFrame(loop);
  }

  return {
    init: init,
    state: function stateFn() { return state; },
    time: function timeFn() { return time; },
    money: function moneyFn() { return money; },
    addMoney: function addMoney(n) { money += n; },
    setMoney: function setMoney(n) { money = n; },
    debtLeft: function debtLeft() { return Math.max(0, DEBT - money); },
    wantedStars: wantedStars,
    addWanted: addWanted,
    setWantedStars: function setWantedStars(n) { heat = STAR_HEAT[Math.max(0, Math.min(5, n))]; lastCrimeAt = time; },
    clearWanted: function clearWanted() { heat = 0; },
    camera: function cameraFn() { return camera; },
    busted: busted,
    wasted: wasted,
    carWrecked: carWrecked,
    missionStarted: function missionStarted() { /* hook for future use */ },
    storyComplete: function storyComplete() { storyComplete = true; },
    isStoryComplete: function isStoryComplete() { return storyComplete; },
  };
})();

// Boot once the page (and all classic scripts) have loaded.
window.addEventListener('load', () => {
  try {
    SM.game.init();
  } catch (err) {
    document.getElementById('status').textContent = 'Failed to start: ' + err.message;
    throw err;
  }
});

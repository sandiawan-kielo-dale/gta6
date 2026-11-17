// Missions and story: Mara Solano's jobs across Solmarina, plus side jobs after the
// story. Each mission is a list of steps (walk somewhere, get in a car, steal a car,
// hold to pick something up, drive somewhere, escape the police). A glowing beacon
// marks the current objective in the world and on the minimap.
SM.missions = (function missions() {
  let scene = null;
  let rng = null;
  let marker = null;
  let markerRing = null;
  let markerGem = null;
  let beaconLight = null;

  const STORY = [
    {
      id: 'welcome', title: 'Welcome to Solmarina', reward: 250,
      intro: 'Mara: "Dario. You owe Vince five grand. Work for me and we will fix that. Come see me."',
      steps: [
        { kind: 'goto', at: 'mara', r: 7, text: 'Walk to Mara\u2019s office', sub: 'Follow the yellow beacon' },
      ],
    },
    {
      id: 'fare', title: 'First Fare', reward: 500,
      intro: 'Mara: "A client needs a ride to the Grand Hotel. Take the yellow taxi outside. Drive like you mean it."',
      steps: [
        { kind: 'enterCar', carId: 'taxi1', text: 'Get in the yellow taxi', sub: 'It is parked by the plaza' },
        { kind: 'driveTo', at: 'hotel', r: 9, text: 'Drive the client to the Grand Solmarina Hotel', sub: 'Stay on the roads, watch the traffic', carId: 'taxi1' },
      ],
    },
    {
      id: 'hotwheels', title: 'Hot Wheels', reward: 750,
      intro: 'Mara: "Vince wants the red Comet S from Solmarina Motors. Take it. Quietly. Then bring it to Kroll\u2019s Garage."',
      steps: [
        { kind: 'steal', carId: 'sports1', text: 'Steal the red Comet S from the showroom', sub: 'Someone will notice. Be quick.' },
        { kind: 'driveTo', at: 'garage', r: 9, text: 'Deliver the Comet S to Kroll\u2019s Garage', sub: 'Lose the cops on the way if you have to', carId: 'sports1' },
      ],
    },
    {
      id: 'package', title: 'The Package', reward: 1000,
      intro: 'Mara: "A package waits at the end of Pier 9. Pick it up, take it to the Tower. The police will be interested."',
      steps: [
        { kind: 'pickup', at: 'pier', r: 6, hold: 2, text: 'Pick up the package at the end of Pier 9', sub: 'Hold E to grab it' },
        { kind: 'driveTo', at: 'tower', r: 9, text: 'Deliver the package to Solmarina Tower', sub: 'The cops are coming. Drive!' },
      ],
      onPickupWanted: 2,
    },
    {
      id: 'vault', title: 'The Vault Job', reward: 2500,
      intro: 'Mara: "Last one, Dario. The Bank of Solmarina. Grab the cash, get to the Safehouse, and your debt is gone."',
      steps: [
        { kind: 'pickup', at: 'bank', r: 7, hold: 3, text: 'Grab the cash from the Bank of Solmarina', sub: 'Hold E. This will be loud.' },
        { kind: 'escape', at: 'safehouse', r: 10, text: 'Escape to the Safehouse', sub: 'Get clear of the police, then reach the Safehouse' },
      ],
      onPickupWanted: 3,
    },
  ];

  let missionIndex = 0;
  let stepIndex = 0;
  let active = null; // {def, side, title}
  let holdProgress = 0;
  let holding = false;
  let storyDone = false;
  let sideCount = 0;

  function targetPos(step) {
    if (step.at) {
      const p = SM.city.places[step.at];
      return { x: p.x, z: p.z };
    }
    return null;
  }

  function buildMarker() {
    marker = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 30;
    marker.add(beam);
    markerRing = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    markerRing.rotation.x = -Math.PI / 2;
    markerRing.position.y = 0.15;
    marker.add(markerRing);
    markerGem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1),
      new THREE.MeshBasicMaterial({ color: 0xffd23c })
    );
    markerGem.position.y = 5;
    marker.add(markerGem);
    beaconLight = new THREE.PointLight(0xffd23c, 12, 30);
    beaconLight.position.y = 4;
    marker.add(beaconLight);
    marker.visible = false;
    scene.add(marker);
  }

  function placeMarker(x, z) {
    if (!marker) return;
    marker.position.set(x, 0, z);
    marker.visible = true;
  }

  function hideMarker() {
    if (marker) marker.visible = false;
  }

  function startMission(index, side) {
    const def = side || STORY[index];
    if (!def) return;
    active = { def: def, side: !!side, title: def.title };
    stepIndex = 0;
    holdProgress = 0;
    if (def.intro) SM.hud.toast(def.title, def.intro);
    SM.hud.setObjective(def.title, currentStep().text, currentStep().sub || '');
    if (SM.game) SM.game.missionStarted(def);
  }

  function currentStep() {
    if (!active) return null;
    return active.def.steps[stepIndex] || null;
  }

  function currentTarget() {
    const step = currentStep();
    if (!step) return null;
    const pos = targetPos(step);
    if (!pos) {
      // enterCar / steal steps target their car.
      const car = SM.vehicles.cars.find((c) => c.id === step.carId);
      if (car) return { x: car.x, z: car.z, text: step.text, sub: step.sub || '' };
      return null;
    }
    return { x: pos.x, z: pos.z, text: step.text, sub: step.sub || '' };
  }

  function advanceStep() {
    stepIndex++;
    holdProgress = 0;
    const step = currentStep();
    if (!step) {
      completeMission();
      return;
    }
    SM.hud.setObjective(active.title, step.text, step.sub || '');
    SM.audio.pickup();
  }

  function completeMission() {
    const def = active.def;
    const reward = def.reward;
    if (SM.game) SM.game.addMoney(reward);
    SM.hud.banner('MISSION COMPLETE', `+${SM.money(reward)}  —  ${def.title}`);
    SM.audio.mission();
    if (SM.save) SM.save.save();
    hideMarker();
    if (active.side) {
      sideCount++;
      active = null;
      setTimeout(() => { if (SM.game && SM.game.state() === 'playing') spawnSideJob(); }, 8000);
      return;
    }
    missionIndex++;
    active = null;
    if (missionIndex >= STORY.length) {
      storyDone = true;
      SM.hud.banner('STORY COMPLETE', 'Your debt is paid. Solmarina is yours — free roam and side jobs await.');
      setTimeout(() => { if (SM.game && SM.game.state() === 'playing') spawnSideJob(); }, 10000);
      if (SM.game) SM.game.storyComplete();
      return;
    }
    setTimeout(() => { if (SM.game && SM.game.state() === 'playing') startMission(missionIndex); }, 2500);
  }

  function spawnSideJob() {
    const places = SM.city.places;
    const dests = [places.hotel, places.tower, places.bank, places.pier, places.plaza, places.hospital];
    const dest = dests[Math.floor(rng() * dests.length)];
    const isFare = rng() < 0.5;
    const pay = isFare ? 50 + Math.floor(rng() * 8) * 10 : 80 + Math.floor(rng() * 6) * 20;
    const start = isFare ? places.plaza : places.pier;
    const job = {
      id: 'side' + sideCount,
      title: isFare ? 'Side Job: Taxi Fare' : 'Side Job: Courier Run',
      reward: pay,
      intro: isFare ? 'A rider is waiting at the plaza. Give them a lift.' : 'A parcel waits at Pier 9. Deliver it, fast.',
      steps: isFare
        ? [
          { kind: 'goto', at: 'plaza', r: 7, text: 'Pick up the rider at the plaza', sub: 'They are waiting by the fountain' },
          { kind: 'driveTo', at: 'hotel', r: 9, text: 'Drop the rider at the Grand Hotel', sub: 'Any car will do' },
        ]
        : [
          { kind: 'pickup', at: 'pier', r: 6, hold: 2, text: 'Pick up the parcel at Pier 9', sub: 'Hold E to grab it' },
          { kind: 'driveTo', at: 'tower', r: 9, text: 'Deliver the parcel to Solmarina Tower', sub: 'Quick and clean' },
        ],
    };
    // Point the driveTo at the random destination.
    job.steps[1].at = dest === places.hotel ? 'hotel' : dest === places.tower ? 'tower' : dest === places.bank ? 'bank' : dest === places.pier ? 'pier' : dest === places.plaza ? 'plaza' : 'hospital';
    startMission(0, job);
  }

  /** Called when the player enters any car. */
  function onEnterCar(car) {
    const step = currentStep();
    if (!step) return;
    if ((step.kind === 'enterCar' || step.kind === 'steal') && car.id === step.carId) {
      if (step.kind === 'steal') {
        if (SM.game) SM.game.addWanted(150, 'car stolen');
        SM.hud.toast('STOLEN', 'The alarm is going off. Drive!');
        SM.audio.denied();
      }
      advanceStep();
    }
  }

  /** Called every frame while playing: checks the current step's condition. */
  function update(dt, player, input) {
    if (marker) {
      const t = 0.001 * performance.now();
      if (markerGem) { markerGem.rotation.y += dt * 2; markerGem.position.y = 5 + Math.sin(t * 2) * 0.5; }
      if (markerRing) { const s = 1 + Math.sin(t * 3) * 0.12; markerRing.scale.set(s, s, 1); }
    }
    const step = currentStep();
    if (!step || !player) return;
    const target = currentTarget();
    if (target) placeMarker(target.x, target.z);
    const px = player.x, pz = player.z;

    if (step.kind === 'goto' || step.kind === 'driveTo') {
      const pos = targetPos(step);
      if (!pos) return;
      const needCar = step.carId;
      const inRightCar = !needCar || (player.car && player.car.id === needCar);
      if (SM.dist2d(px, pz, pos.x, pos.z) < step.r) {
        if (needCar && !inRightCar) {
          SM.hud.setObjective(active.title, step.text, 'You need the marked car for this');
        } else {
          advanceStep();
        }
      }
    } else if (step.kind === 'enterCar' || step.kind === 'steal') {
      // The player may already be sitting in the right car (stole it early).
      if (player.car && player.car.id === step.carId) advanceStep();
    } else if (step.kind === 'pickup') {
      const pos = targetPos(step);
      if (!pos) return;
      const near = SM.dist2d(px, pz, pos.x, pos.z) < step.r;
      if (near && input.interact) {
        holding = true;
        holdProgress += dt;
        SM.hud.setObjective(active.title, step.text, `Hold E… ${Math.ceil(step.hold - holdProgress)}s`);
        if (holdProgress >= step.hold) {
          holding = false;
          holdProgress = 0;
          if (active.def.onPickupWanted) {
            const stars = active.def.onPickupWanted;
            if (SM.game) SM.game.setWantedStars(stars);
            SM.hud.toast('THE HEAT IS ON', `${stars} wanted stars — run!`);
          }
          SM.audio.pickup();
          advanceStep();
        }
      } else {
        holding = false;
        holdProgress = Math.max(0, holdProgress - dt * 2);
      }
    } else if (step.kind === 'escape') {
      const pos = targetPos(step);
      if (!pos) return;
      const copNear = SM.vehicles.police.some((c) => SM.dist2d(px, pz, c.x, c.z) < 50) ||
        SM.people.footCops.some((c) => c.state !== 'down' && SM.dist2d(px, pz, c.x, c.z) < 40);
      if (SM.dist2d(px, pz, pos.x, pos.z) < step.r) {
        if (!copNear) {
          if (SM.game) SM.game.clearWanted();
          advanceStep();
        } else {
          SM.hud.setObjective(active.title, step.text, 'Cops are too close — get clear of them first');
        }
      }
    }
    // enterCar / steal steps are completed by onEnterCar.
  }

  /** Staging helper for screenshots: jump straight to a story mission/step. */
  function stage(index, step) {
    missionIndex = index;
    const def = STORY[index];
    if (!def) return;
    active = { def: def, side: false, title: def.title };
    stepIndex = step;
    holdProgress = 0;
    SM.hud.setObjective(def.title, currentStep().text, currentStep().sub || '');
  }

  function resetMission() {
    if (active && !active.side) {
      startMission(missionIndex);
    } else if (active && active.side) {
      active = null;
      spawnSideJob();
    }
  }

  return {
    init: function init(s, r) {
      scene = s; rng = r;
      buildMarker();
      // Mission cars: the yellow taxi by the plaza and the red Comet S at the showroom.
      const taxi = SM.vehicles.addCar('taxi', 0xffc93c, -8, -8, Math.PI * 0.75, { parked: true, id: 'taxi1' });
      taxi.parked = true;
      const sports = SM.vehicles.addCar('sports', 0xd81e2c, 58, 112, -Math.PI / 2, { parked: true, id: 'sports1' });
      sports.parked = true;
    },
    startStory: function startStory() { missionIndex = 0; storyDone = false; startMission(0); },
    startMission: startMission,
    stage: stage,
    update: update,
    onEnterCar: onEnterCar,
    currentTarget: currentTarget,
    currentStep: currentStep,
    resetMission: resetMission,
    spawnSideJob: spawnSideJob,
    get missionIndex() { return missionIndex; },
    get storyDone() { return storyDone; },
    get active() { return active; },
  };
})();

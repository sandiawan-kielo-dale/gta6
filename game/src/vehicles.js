// Vehicles: car meshes, arcade driving physics, traffic that follows the road grid,
// parked cars to steal, and police cars that chase the player when wanted.
// Forward is (sin(heading), 0, cos(heading)); a mesh built nose-first along +Z.
SM.vehicles = (function vehicles() {
  const TYPES = {
    sedan: { top: 28, accel: 11, len: 4.4, wid: 2.0, color: 0x3a6fd8, name: 'Sedan' },
    taxi: { top: 26, accel: 10, len: 4.4, wid: 2.0, color: 0xffc93c, name: 'Taxi — Yellow Cab' },
    sports: { top: 35, accel: 16, len: 4.2, wid: 2.0, color: 0xd81e2c, name: 'Comet S — Sports' },
    police: { top: 30, accel: 14, len: 4.5, wid: 2.0, color: 0x1c1c22, name: 'Police Cruiser' },
    truck: { top: 22, accel: 8, len: 5.6, wid: 2.3, color: 0x7a7f85, name: 'Box Truck' },
  };
  const COLORS = [0x3a6fd8, 0xd8d8d8, 0x2a9d5c, 0xd81e2c, 0x8a5fd8, 0xe07b28, 0x222831, 0xc9a06a, 0x4db2d8];

  let scene = null;
  let rng = null;
  let cars = []; // every car: traffic, parked, police, player
  let police = [];
  let trafficTimer = 0;
  let policeTimer = 0;

  function makeCarMesh(type, color) {
    const t = TYPES[type] || TYPES.sedan;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: color });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x141c26 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(t.wid, 0.85, t.len), bodyMat);
    body.position.y = 0.72;
    body.castShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.86, 0.75, t.len * 0.48), glassMat);
    cabin.position.set(0, 1.45, -t.len * 0.06);
    cabin.castShadow = true;
    g.add(cabin);
    // Wheels (front pair steers visually, all four spin).
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const wheels = [];
    for (const [wx, wz, front] of [[-0.95, 1.45, true], [0.95, 1.45, true], [-0.95, -1.45, false], [0.95, -1.45, false]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx * (t.wid / 2), 0.42, wz * (t.len / 4.4));
      w.castShadow = true;
      g.add(w);
      wheels.push({ mesh: w, front: front });
    }
    // Headlights and taillights.
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1e });
    for (const sx of [-0.65, 0.65]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), headMat);
      h.position.set(sx, 0.78, t.len / 2 + 0.02);
      g.add(h);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), tailMat);
      tl.position.set(sx, 0.78, -t.len / 2 - 0.02);
      g.add(tl);
    }
    if (type === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.5), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
      sign.position.set(0, 1.95, 0);
      g.add(sign);
    }
    if (type === 'police') {
      const bar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      red.position.x = -0.35;
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0x2040ff }));
      blue.position.x = 0.35;
      bar.add(red);
      bar.add(blue);
      bar.position.set(0, 1.95, 0);
      g.add(bar);
      g.userData.lightBar = { red: red, blue: blue };
    }
    if (type === 'sports') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.9, 0.1, 0.5), bodyMat);
      spoiler.position.set(0, 1.25, -t.len / 2 + 0.15);
      g.add(spoiler);
    }
    g.userData.wheels = wheels;
    return g;
  }

  function addCar(type, color, x, z, heading, opts) {
    const o = opts || {};
    const mesh = makeCarMesh(type, color);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    const car = {
      mesh: mesh,
      type: type,
      color: color,
      x: x, z: z,
      heading: heading,
      speed: 0,
      steer: 0,
      health: 100,
      isPolice: type === 'police',
      isPlayer: false,
      parked: !!o.parked,
      driver: o.driver !== false,
      id: o.id || null,
      name: o.name || (TYPES[type] || TYPES.sedan).name,
      // Traffic state.
      axis: o.axis || 'z',
      dir: o.dir || 1,
      roadCoord: o.roadCoord !== undefined ? o.roadCoord : (o.axis === 'x' ? z : x),
      targetSpeed: o.targetSpeed || 0,
      stuck: 0,
      flashT: 0,
    };
    cars.push(car);
    if (car.isPolice) police.push(car);
    return car;
  }

  /** A car on the road grid at (x, z) heading along `axis` in direction `dir`. */
  function spawnTrafficCar(x, z, axis, dir) {
    const type = SM.pick(rng, ['sedan', 'sedan', 'sedan', 'taxi', 'truck']);
    const color = SM.pick(rng, COLORS);
    const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const car = addCar(type, color, x, z, heading, { axis: axis, dir: dir, roadCoord: axis === 'x' ? z : x, targetSpeed: SM.rand(rng, 8, 12) });
    return car;
  }

  function randomRoadSpawn(player) {
    // Pick a road point 100-200 units from the player.
    for (let tries = 0; tries < 12; tries++) {
      const axis = rng() < 0.5 ? 'x' : 'z';
      const road = Math.round(SM.rand(rng, -5, 5)) * 48;
      const along = SM.rand(rng, -240, 240);
      const x = axis === 'x' ? along : road;
      const z = axis === 'x' ? road : along;
      const d = SM.dist2d(x, z, player.x, player.z);
      if (d > 100 && d < 220) return { x: x, z: z, axis: axis, dir: rng() < 0.5 ? 1 : -1 };
    }
    return null;
  }

  function updateTraffic(dt, player) {
    trafficTimer -= dt;
    const traffic = cars.filter((c) => !c.isPolice && !c.isPlayer && !c.parked);
    if (trafficTimer <= 0) {
      trafficTimer = 1.5;
      // Top up traffic near the player, cull far cars.
      for (let i = traffic.length - 1; i >= 0; i--) {
        const c = traffic[i];
        if (SM.dist2d(c.x, c.z, player.x, player.z) > 230) {
          scene.remove(c.mesh);
          cars.splice(cars.indexOf(c), 1);
        }
      }
      const count = cars.filter((c) => !c.isPolice && !c.isPlayer && !c.parked).length;
      for (let k = count; k < 12; k++) {
        const s = randomRoadSpawn(player);
        if (s) spawnTrafficCar(s.x, s.z, s.axis, s.dir);
      }
    }
    for (const c of cars) {
      if (c.isPolice || c.isPlayer || c.parked) continue;
      // Slow down for a car ahead in the same lane.
      let want = c.targetSpeed;
      for (const o of cars) {
        if (o === c || o.parked) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 13 && d > 0.01) {
          const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
          const ahead = (dx * fx + dz * fz) / d;
          const side = Math.abs(dx * fz - dz * fx);
          if (ahead > 0.7 && side < 3) {
            want = Math.min(want, d < 7 ? 0 : o.speed * 0.85);
          }
        }
      }
      c.speed = SM.damp(c.speed, want, 1.2, dt);
      const step = c.speed * dt;
      if (c.axis === 'x') c.x += step * c.dir;
      else c.z += step * c.dir;
      // At an intersection, maybe turn.
      const along = c.axis === 'x' ? c.x : c.z;
      const nextCross = (Math.floor(along / 48) + (c.dir > 0 ? 1 : 0)) * 48;
      const crossed = c.dir > 0 ? along >= nextCross : along <= nextCross;
      if (crossed && Math.abs(nextCross) <= 240) {
        if (c.axis === 'x') c.x = nextCross; else c.z = nextCross;
        const r = rng();
        if (r < 0.3) {
          // Turn: switch axis at this intersection.
          const newDir = rng() < 0.5 ? 1 : -1;
          const newAxis = c.axis === 'x' ? 'z' : 'x';
          c.axis = newAxis;
          c.dir = newDir;
          c.roadCoord = nextCross;
          c.heading = newAxis === 'x' ? (newDir > 0 ? Math.PI / 2 : -Math.PI / 2) : (newDir > 0 ? 0 : Math.PI);
        } else {
          // Straight on: keep heading, snap the other coordinate to the road.
          if (c.axis === 'x') c.z = c.roadCoord; else c.x = c.roadCoord;
        }
      } else if (crossed) {
        // Edge of the city: turn back in.
        c.dir = -c.dir;
        c.heading += Math.PI;
      }
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
      spinWheels(c, dt);
    }
  }

  function spinWheels(c, dt) {
    const wheels = c.mesh.userData.wheels;
    if (!wheels) return;
    for (const w of wheels) {
      w.mesh.rotation.x += (c.speed * dt) / 0.42;
      if (w.front) w.mesh.rotation.y = c.steer * 0.5;
    }
  }

  /** Player driving: arcade physics with steering, handbrake drift and collisions. */
  function drivePlayer(car, input, dt) {
    const t = TYPES[car.type];
    if (input.up) car.speed += t.accel * dt;
    if (input.down) {
      if (car.speed > 0.5) car.speed -= 26 * dt;
      else car.speed -= 7 * dt;
    }
    if (!input.up && !input.down) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 4 * dt);
    car.speed -= car.speed * 0.35 * dt;
    car.speed = SM.clamp(car.speed, -9, t.top);
    const steerTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    car.steer = SM.damp(car.steer, steerTarget, 8, dt);
    const grip = input.handbrake ? 1.7 : 1;
    const turnRate = car.steer * 2.1 * grip * SM.clamp(Math.abs(car.speed) / 10, 0, 1) * (car.speed >= 0 ? 1 : -1);
    car.heading += turnRate * dt;
    if (input.handbrake) car.speed = SM.damp(car.speed, car.speed * 0.86, 6, dt);
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    car.x += fx * car.speed * dt;
    car.z += fz * car.speed * dt;
    // Buildings and the world edge.
    const before = { x: car.x, z: car.z };
    SM.city.resolveCollision(car, 2.1);
    const hit = Math.abs(car.x - before.x) > 0.01 || Math.abs(car.z - before.z) > 0.01;
    if (hit && Math.abs(car.speed) > 6) {
      damageCar(car, (Math.abs(car.speed) - 6) * 1.5);
      SM.audio.crash(Math.abs(car.speed) > 16);
      if (SM.fx) SM.fx.burst(car.x - fx * 2, 1, car.z - fz * 2, 10, 0xffc46a);
      car.speed *= 0.45;
    }
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    spinWheels(car, dt);
    return hit;
  }

  /** Police pursuit: steer at the player, ram the player's car, flash the light bar. */
  function updatePolice(dt, player, playerCar) {
    policeTimer -= dt;
    const want = SM.game ? SM.game.wantedStars() : 0;
    if (policeTimer <= 0) {
      policeTimer = 1;
      const target = want === 0 ? 0 : Math.min(1 + want, 5);
      while (police.length < target) {
        const s = randomRoadSpawn(player);
        if (!s) break;
        const car = addCar('police', 0x1c1c22, s.x, s.z, 0, { targetSpeed: 0 });
        car.heading = Math.atan2(player.x - s.x, player.z - s.z);
      }
      while (police.length > target) {
        const c = police.pop();
        scene.remove(c.mesh);
        cars.splice(cars.indexOf(c), 1);
      }
    }
    let nearest = null;
    for (const c of police) {
      const dx = player.x - c.x, dz = player.z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (nearest === null || d < nearest) nearest = d;
      const desired = Math.atan2(dx, dz);
      const turn = SM.clamp(SM.angleDiff(c.heading, desired), -1, 1);
      c.heading += turn * 2.4 * dt;
      const targetSpeed = d > 30 ? 30 : d > 10 ? 26 : 18;
      c.speed = SM.damp(c.speed, targetSpeed, 1.5, dt);
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;
      SM.city.resolveCollision(c, 2.1);
      // Ram the player's car.
      if (playerCar && d < 4.6) {
        const push = 3.2;
        playerCar.x += (dx / (d || 1)) * -push * dt * 3;
        playerCar.z += (dz / (d || 1)) * -push * dt * 3;
        damageCar(playerCar, 6 * dt);
        if (Math.random() < dt * 2) SM.audio.crash(false);
      }
      // Flash the light bar.
      c.flashT += dt;
      const bar = c.mesh.userData.lightBar;
      if (bar) {
        const on = Math.floor(c.flashT * 4) % 2 === 0;
        bar.red.material.color.setHex(on ? 0xff2020 : 0x550000);
        bar.blue.material.color.setHex(on ? 0x102060 : 0x2040ff);
      }
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
      spinWheels(c, dt);
    }
    return nearest;
  }

  /** Circle-circle shoves between cars (traffic bumps, player rams). */
  function collideCars(dt) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.parked && b.parked) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const min = 4.2;
        if (d < min && d > 0.01) {
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          if (!a.parked) { a.x -= nx * push; a.z -= nz * push; }
          if (!b.parked) { b.x += nx * push; b.z += nz * push; }
          const rel = Math.abs(a.speed - b.speed);
          if (rel > 8) {
            damageCar(a, rel * 0.6);
            damageCar(b, rel * 0.6);
            if (SM.fx) SM.fx.burst((a.x + b.x) / 2, 1, (a.z + b.z) / 2, 8, 0xffc46a);
            SM.audio.crash(rel > 16);
          }
          a.mesh.position.set(a.x, 0, a.z);
          b.mesh.position.set(b.x, 0, b.z);
        }
      }
    }
  }

  function damageCar(car, amt) {
    if (car.isPlayer) {
      car.health -= amt;
      if (car.health <= 0 && !car.wrecked) {
        car.wrecked = true;
        car.speed = 0;
        if (SM.fx) SM.fx.burst(car.x, 1.5, car.z, 26, 0x888888);
        if (SM.game) SM.game.carWrecked(car);
      }
    }
  }

  /** Nearest drivable car to a point (for stealing / entering). */
  function nearestCar(x, z, maxDist, onlyParked) {
    let best = null, bestD = maxDist;
    for (const c of cars) {
      if (c.isPlayer) continue;
      if (onlyParked && !c.parked && c.driver) continue;
      const d = SM.dist2d(x, z, c.x, c.z);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  function removeCar(car) {
    scene.remove(car.mesh);
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    const p = police.indexOf(car);
    if (p >= 0) police.splice(p, 1);
  }

  return {
    init: function init(s, r) { scene = s; rng = r; cars = []; police = []; },
    addCar: addCar,
    spawnTrafficCar: spawnTrafficCar,
    updateTraffic: updateTraffic,
    updatePolice: updatePolice,
    drivePlayer: drivePlayer,
    collideCars: collideCars,
    damageCar: damageCar,
    nearestCar: nearestCar,
    removeCar: removeCar,
    get cars() { return cars; },
    get police() { return police; },
    TYPES: TYPES,
  };
})();

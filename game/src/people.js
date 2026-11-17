// People: the player on foot, pedestrians who stroll the sidewalks and flee from
// trouble, foot police who chase and shoot when the player is wanted, and combat
// (pistol shots and punches). Forward is (sin(heading), 0, cos(heading)).
SM.people = (function people() {
  let scene = null;
  let rng = null;
  let player = null;
  let peds = [];
  let footCops = [];
  let pedTimer = 0;
  let copTimer = 0;

  const SHIRTS = [0xd84a4a, 0x4a7dd8, 0x4ad87a, 0xd8c94a, 0x9a4ad8, 0xd87a4a, 0x4ad8c9, 0xe8e8e8, 0x333333];
  const PANTS = [0x2a2f3a, 0x3a4a6a, 0x5a4a3a, 0x222222];
  const SKINS = [0xe8b98a, 0xc98a5e, 0x8a5e3c, 0xf2c9a0];

  function makePersonMesh(shirt, pants, skin, police) {
    const g = new THREE.Group();
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
    const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
    const skinMat = new THREE.MeshLambertMaterial({ color: skin });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), pantsMat);
    legL.position.set(-0.14, 0.4, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), pantsMat);
    legR.position.set(0.14, 0.4, 0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.36), shirtMat);
    body.position.y = 1.18;
    body.castShadow = true;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.65, 0.18), shirtMat);
    armL.position.set(-0.42, 1.2, 0);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.65, 0.18), shirtMat);
    armR.position.set(0.42, 1.2, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
    head.position.y = 1.78;
    head.castShadow = true;
    g.add(legL, legR, body, armL, armR, head);
    if (police) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), new THREE.MeshLambertMaterial({ color: 0x14181f }));
      cap.position.y = 2.0;
      g.add(cap);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd23c }));
      badge.position.set(0.18, 1.35, 0.19);
      g.add(badge);
    }
    g.userData.parts = { legL: legL, legR: legR, armL: armL, armR: armR, body: body, head: head };
    return g;
  }

  function animateWalk(mesh, phase, speed01) {
    const p = mesh.userData.parts;
    if (!p) return;
    const swing = Math.sin(phase) * 0.7 * speed01;
    p.legL.rotation.x = swing;
    p.legR.rotation.x = -swing;
    p.armL.rotation.x = -swing * 0.8;
    p.armR.rotation.x = swing * 0.8;
    mesh.position.y = mesh.userData.baseY || 0;
    mesh.position.y += Math.abs(Math.sin(phase)) * 0.05 * speed01;
  }

  function createPlayer(x, z) {
    const mesh = makePersonMesh(0xd84a2c, 0x2a2f3a, 0xe8b98a, false);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    player = {
      mesh: mesh,
      x: x, z: z, y: 0, vy: 0,
      heading: Math.PI,
      speed: 0,
      onFoot: true,
      car: null,
      health: 100,
      ammo: 12,
      reloading: 0,
      lastDamage: -99,
      walkPhase: 0,
      bustedT: 0,
      cash: 0,
    };
    return player;
  }

  /** Move the player on foot: camera-relative WASD, sprint, jump, collisions. */
  function updatePlayer(dt, input, camYaw) {
    if (!player || !player.onFoot) return;
    const run = input.run ? 10 : 6;
    let fx = 0, fz = 0;
    if (input.up) { fx += Math.sin(camYaw); fz += Math.cos(camYaw); }
    if (input.down) { fx -= Math.sin(camYaw); fz -= Math.cos(camYaw); }
    if (input.left) { fx -= Math.cos(camYaw); fz += Math.sin(camYaw); }
    if (input.right) { fx += Math.cos(camYaw); fz -= Math.sin(camYaw); }
    const len = Math.sqrt(fx * fx + fz * fz);
    if (len > 0.01) {
      fx /= len; fz /= len;
      const target = Math.atan2(fx, fz);
      player.heading = SM.angleLerp(player.heading, target, 1 - Math.exp(-12 * dt));
      player.speed = SM.damp(player.speed, run, 8, dt);
    } else {
      player.speed = SM.damp(player.speed, 0, 10, dt);
    }
    player.x += Math.sin(player.heading) * player.speed * dt;
    player.z += Math.cos(player.heading) * player.speed * dt;
    // Jump and gravity.
    if (input.jump && player.y <= 0.01) player.vy = 7;
    player.vy -= 22 * dt;
    player.y += player.vy * dt;
    if (player.y < 0) { player.y = 0; player.vy = 0; }
    SM.city.resolveCollision(player, 0.7);
    // Bumped by cars.
    for (const c of SM.vehicles.cars) {
      const d = SM.dist2d(player.x, player.z, c.x, c.z);
      if (d < 2.4 && Math.abs(c.speed) > 2) {
        const nx = (player.x - c.x) / (d || 1), nz = (player.z - c.z) / (d || 1);
        player.x += nx * 2.2;
        player.z += nz * 2.2;
        damagePlayer(Math.abs(c.speed) * 0.9, 'car');
        SM.audio.crash(false);
        if (SM.fx) SM.fx.burst(player.x, 1, player.z, 8, 0xff8a5a);
      }
    }
    player.walkPhase += dt * player.speed * 1.6;
    animateWalk(player.mesh, player.walkPhase, SM.clamp(player.speed / 10, 0, 1));
    player.mesh.position.set(player.x, player.y, player.z);
    player.mesh.rotation.y = player.heading;
    // Reload timer.
    if (player.reloading > 0) {
      player.reloading -= dt;
      if (player.reloading <= 0) player.ammo = 12;
    }
    // Slow health regen out of combat.
    if (SM.game && SM.game.time() - player.lastDamage > 6 && player.health > 0 && player.health < 100) {
      player.health = Math.min(100, player.health + 3 * dt);
    }
  }

  function damagePlayer(amt, source) {
    if (!player || player.health <= 0) return;
    player.health -= amt;
    player.lastDamage = SM.game ? SM.game.time() : 0;
    if (SM.hud) SM.hud.flashDamage();
    if (player.health <= 0) {
      player.health = 0;
      if (SM.game) SM.game.wasted();
    }
  }

  /** Pistol shot from the camera through the crosshair: nearest target in a 70m cone. */
  function shoot(camera) {
    if (!player || !player.onFoot || player.health <= 0) return false;
    if (player.reloading > 0) return false;
    if (player.ammo <= 0) {
      player.reloading = 1.2;
      SM.audio.denied();
      return false;
    }
    player.ammo--;
    if (player.ammo === 0) player.reloading = 1.2;
    SM.audio.shoot();
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    let best = null, bestD = 70;
    const test = (x, y, z, r, ref) => {
      const vx = x - origin.x, vy = y - origin.y, vz = z - origin.z;
      const along = vx * dir.x + vy * dir.y + vz * dir.z;
      if (along < 1 || along > bestD) return;
      const px = origin.x + dir.x * along, py = origin.y + dir.y * along, pz = origin.z + dir.z * along;
      const dd = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py) + (z - pz) * (z - pz));
      if (dd < r) { best = ref; bestD = along; }
    };
    for (const p of peds) if (p.state === 'walk' || p.state === 'flee') test(p.x, 1.2, p.z, 1.1, { kind: 'ped', ref: p });
    for (const c of footCops) if (c.state !== 'down') test(c.x, 1.2, c.z, 1.1, { kind: 'cop', ref: c });
    for (const car of SM.vehicles.cars) test(car.x, 1.0, car.z, 2.4, { kind: 'car', ref: car });
    const end = origin.clone().add(dir.clone().multiplyScalar(bestD));
    if (SM.fx) SM.fx.tracer(origin, end);
    if (SM.fx) SM.fx.burst(end.x, end.y, end.z, 6, 0xffd23c);
    if (best) {
      if (best.kind === 'ped') {
        knockDownPed(best.ref);
        if (SM.game) SM.game.addWanted(100, 'shot a pedestrian');
      } else if (best.kind === 'cop') {
        best.ref.hits = (best.ref.hits || 0) + 1;
        if (best.ref.hits >= 2) knockDownCop(best.ref);
        if (SM.game) SM.game.addWanted(150, 'shot a cop');
      } else if (best.kind === 'car') {
        SM.vehicles.damageCar(best.ref, 12);
        if (SM.fx) SM.fx.burst(best.ref.x, 1.2, best.ref.z, 10, 0xffc46a);
      }
      return true;
    }
    return false;
  }

  function punch() {
    if (!player || !player.onFoot || player.health <= 0) return false;
    SM.audio.punch();
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    for (const p of peds) {
      if (p.state !== 'walk' && p.state !== 'flee') continue;
      const dx = p.x - player.x, dz = p.z - player.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2.4 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
        knockDownPed(p);
        if (SM.game) SM.game.addWanted(60, 'assault');
        return true;
      }
    }
    for (const c of footCops) {
      if (c.state === 'down') continue;
      const dx = c.x - player.x, dz = c.z - player.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2.4 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
        knockDownCop(c);
        if (SM.game) SM.game.addWanted(150, 'assaulted a cop');
        return true;
      }
    }
    return false;
  }

  function knockDownPed(p) {
    p.state = 'down';
    p.downT = 6;
    p.mesh.rotation.x = -Math.PI / 2;
    p.mesh.position.y = 0.3;
    if (SM.fx) SM.fx.burst(p.x, 1, p.z, 8, 0xff6a5a);
  }

  function knockDownCop(c) {
    c.state = 'down';
    c.downT = 8;
    c.mesh.rotation.x = -Math.PI / 2;
    c.mesh.position.y = 0.3;
    if (SM.fx) SM.fx.burst(c.x, 1, c.z, 10, 0x5a8aff);
  }

  function spawnPed(x, z) {
    const mesh = makePersonMesh(SM.pick(rng, SHIRTS), SM.pick(rng, PANTS), SM.pick(rng, SKINS), false);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const p = {
      mesh: mesh, x: x, z: z,
      heading: SM.rand(rng, 0, Math.PI * 2),
      speed: SM.rand(rng, 1.4, 2.4),
      state: 'walk',
      walkPhase: SM.rand(rng, 0, 6),
      fleeT: 0,
      downT: 0,
      target: null,
    };
    peds.push(p);
    return p;
  }

  function spawnPeds(n) {
    for (let k = 0; k < n; k++) {
      // Sidewalk spots: just off a road.
      const road = Math.round(SM.rand(rng, -5, 5)) * 48;
      const along = SM.rand(rng, -230, 230);
      const side = rng() < 0.5 ? 9.5 : -9.5;
      const x = rng() < 0.5 ? along : road + side;
      const z = rng() < 0.5 ? road + side : along;
      if (x > 240 || x < -250 || z > 250 || z < -250) continue;
      spawnPed(x, z);
    }
  }

  function updatePeds(dt, playerPos, gunshotAt) {
    pedTimer -= dt;
    if (pedTimer <= 0) {
      pedTimer = 2;
      const want = 22;
      for (let i = peds.length - 1; i >= 0; i--) {
        if (peds[i].state === 'down' && peds[i].downT <= 0) {
          scene.remove(peds[i].mesh);
          peds.splice(i, 1);
        }
      }
      for (let k = peds.length; k < want; k++) {
        const road = Math.round(SM.rand(rng, -5, 5)) * 48;
        const along = SM.rand(rng, -230, 230);
        const side = rng() < 0.5 ? 9.5 : -9.5;
        spawnPed(along, road + side);
      }
    }
    for (const p of peds) {
      if (p.state === 'down') {
        p.downT -= dt;
        continue;
      }
      // Flee gunshots and close cars.
      let fleeX = 0, fleeZ = 0;
      if (gunshotAt && SM.dist2d(p.x, p.z, gunshotAt.x, gunshotAt.z) < 34) {
        fleeX = p.x - gunshotAt.x; fleeZ = p.z - gunshotAt.z;
        p.fleeT = 3;
      }
      for (const c of SM.vehicles.cars) {
        if (c.parked) continue;
        const d = SM.dist2d(p.x, p.z, c.x, c.z);
        if (d < 7 && Math.abs(c.speed) > 4) {
          fleeX = p.x - c.x; fleeZ = p.z - c.z;
          p.fleeT = 2.5;
          break;
        }
      }
      if (p.fleeT > 0) {
        p.fleeT -= dt;
        p.state = 'flee';
        const l = Math.sqrt(fleeX * fleeX + fleeZ * fleeZ) || 1;
        p.heading = SM.angleLerp(p.heading, Math.atan2(fleeX / l, fleeZ / l), 1 - Math.exp(-6 * dt));
        p.x += Math.sin(p.heading) * 5 * dt;
        p.z += Math.cos(p.heading) * 5 * dt;
      } else {
        p.state = 'walk';
        if (!p.target || SM.dist2d(p.x, p.z, p.target.x, p.target.z) < 2) {
          // Next sidewalk waypoint: along the current road to a random intersection.
          const rp = SM.city.nearestRoadPoint(p.x, p.z);
          const cross = Math.round(SM.rand(rng, -5, 5)) * 48;
          if (Math.abs(p.x - rp.x) < Math.abs(p.z - rp.z)) p.target = { x: rp.x + (rng() < 0.5 ? 9.5 : -9.5), z: cross };
          else p.target = { x: cross, z: rp.z + (rng() < 0.5 ? 9.5 : -9.5) };
        }
        const dx = p.target.x - p.x, dz = p.target.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.1) {
          p.heading = SM.angleLerp(p.heading, Math.atan2(dx / d, dz / d), 1 - Math.exp(-4 * dt));
          p.x += Math.sin(p.heading) * p.speed * dt;
          p.z += Math.cos(p.heading) * p.speed * dt;
        }
      }
      SM.city.resolveCollision(p, 0.6);
      p.walkPhase += dt * (p.state === 'flee' ? 9 : 4);
      animateWalk(p.mesh, p.walkPhase, p.state === 'flee' ? 1 : 0.6);
      p.mesh.position.set(p.x, p.mesh.position.y, p.z);
      p.mesh.rotation.y = p.heading;
    }
  }

  function spawnFootCop(x, z) {
    const mesh = makePersonMesh(0x1c2a4a, 0x14181f, 0xe8b98a, true);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const c = { mesh: mesh, x: x, z: z, heading: 0, speed: 7.5, state: 'chase', walkPhase: 0, shootT: SM.rand(rng, 0.5, 1.5), downT: 0, hits: 0 };
    footCops.push(c);
    return c;
  }

  /** Foot police: run the player down, shoot when close, bust when they grab him. */
  function updateFootCops(dt, playerPos) {
    const stars = SM.game ? SM.game.wantedStars() : 0;
    copTimer -= dt;
    if (copTimer <= 0) {
      copTimer = 1;
      const want = player.onFoot ? Math.max(0, stars - 1) : 0;
      while (footCops.filter((c) => c.state !== 'down').length < want) {
        const a = SM.rand(rng, 0, Math.PI * 2);
        const d = SM.rand(rng, 40, 70);
        const rp = SM.city.nearestRoadPoint(playerPos.x + Math.sin(a) * d, playerPos.z + Math.cos(a) * d);
        spawnFootCop(rp.x, rp.z);
      }
      for (let i = footCops.length - 1; i >= 0; i--) {
        const c = footCops[i];
        if (c.state === 'down' && c.downT <= 0) {
          scene.remove(c.mesh);
          footCops.splice(i, 1);
        } else if (stars === 0 && SM.dist2d(c.x, c.z, playerPos.x, playerPos.z) > 90) {
          scene.remove(c.mesh);
          footCops.splice(i, 1);
        }
      }
    }
    for (const c of footCops) {
      if (c.state === 'down') {
        c.downT -= dt;
        continue;
      }
      const dx = playerPos.x - c.x, dz = playerPos.z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2.6) {
        // Grabbed: hold the player.
        player.bustedT += dt;
        if (player.bustedT > 2 && SM.game) SM.game.busted();
      } else {
        player.bustedT = Math.max(0, player.bustedT - dt);
      }
      if (d > 3) {
        c.heading = SM.angleLerp(c.heading, Math.atan2(dx / (d || 1), dz / (d || 1)), 1 - Math.exp(-5 * dt));
        c.x += Math.sin(c.heading) * c.speed * dt;
        c.z += Math.cos(c.heading) * c.speed * dt;
        SM.city.resolveCollision(c, 0.7);
      }
      // Shoot at the player from range.
      c.shootT -= dt;
      if (c.shootT <= 0 && d < 30 && d > 4 && player.health > 0) {
        c.shootT = SM.rand(rng, 1.0, 1.8);
        const hitChance = SM.clamp(0.65 - d * 0.015, 0.12, 0.6);
        const from = new THREE.Vector3(c.x, 1.4, c.z);
        const to = new THREE.Vector3(playerPos.x, 1.2, playerPos.z);
        if (SM.fx) SM.fx.tracer(from, to);
        SM.audio.shoot();
        if (rng() < hitChance) damagePlayer(6, 'cop');
      }
      c.walkPhase += dt * 9;
      animateWalk(c.mesh, c.walkPhase, 1);
      c.mesh.position.set(c.x, c.mesh.position.y, c.z);
      c.mesh.rotation.y = c.heading;
    }
  }

  return {
    init: function init(s, r) { scene = s; rng = r; peds = []; footCops = []; },
    createPlayer: createPlayer,
    updatePlayer: updatePlayer,
    damagePlayer: damagePlayer,
    shoot: shoot,
    punch: punch,
    spawnPeds: spawnPeds,
    updatePeds: updatePeds,
    updateFootCops: updateFootCops,
    knockDownPed: knockDownPed,
    get player() { return player; },
    get peds() { return peds; },
    get footCops() { return footCops; },
  };
})();

// Solmarina, the city: a seeded, sun-soaked coastal grid. Roads every 48 units, blocks
// of 34, a beach and sea to the east, a pier, a central plaza and named landmarks the
// missions use. Builds the Three.js scene and exports colliders, road data and places.
SM.city = (function city() {
  const ROAD_STEP = 48;
  const ROAD_HALF = 7;
  const GRID = 5; // blocks from -5..4, roads at -240..240
  const SEA_X = 330; // water starts here
  const BEACH_X = 242;

  let colliders = [];
  let places = {};
  let mapData = null;

  /** Axis-aligned building colliders, plus the sea edge. */
  function addCollider(x0, z0, x1, z1) {
    colliders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  }

  /** Push a circle (pos.x, pos.z, radius) out of every building AABB it overlaps. */
  function resolveCollision(pos, radius) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const cx = SM.clamp(pos.x, c.x0, c.x1);
      const cz = SM.clamp(pos.z, c.z0, c.z1);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          // Dead centre inside the box: push out along the smallest penetration.
          const pl = pos.x - c.x0, pr = c.x1 - pos.x, pt = pos.z - c.z0, pb = c.z1 - pos.z;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) pos.x = c.x0 - radius;
          else if (m === pr) pos.x = c.x1 + radius;
          else if (m === pt) pos.z = c.z0 - radius;
          else pos.z = c.z1 + radius;
        }
      }
    }
    // World edge: keep everyone inside the built city and off the open sea (the pier is the exception).
    const onPier = Math.abs(pos.z) < 9 && pos.x > BEACH_X && pos.x < 388;
    const maxX = onPier ? 388 : SEA_X - 4;
    if (pos.x > maxX) pos.x = maxX;
    if (pos.x < -252) pos.x = -252;
    if (pos.z > 252) pos.z = 252;
    if (pos.z < -252) pos.z = -252;
    return pos;
  }

  function onRoad(x, z) {
    for (let i = -GRID; i <= GRID; i++) {
      if (Math.abs(x - i * ROAD_STEP) < ROAD_HALF + 0.5) return true;
      if (Math.abs(z - i * ROAD_STEP) < ROAD_HALF + 0.5) return true;
    }
    return false;
  }

  /** Snap a point to the nearest road centreline. */
  function nearestRoadPoint(x, z) {
    const snap = (v) => Math.round(v / ROAD_STEP) * ROAD_STEP;
    const rx = snap(x), rz = snap(z);
    // Pick the closer of the vertical (x=rx) and horizontal (z=rz) road.
    if (Math.abs(x - rx) < Math.abs(z - rz)) return { x: rx, z: z };
    return { x: x, z: rz };
  }

  /** Canvas texture: a building face with lit and dark windows. */
  function facadeTexture(rng, base, lit) {
    return SM.canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      const cols = 6, rows = 12;
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const isLit = rng() < lit;
          g.fillStyle = isLit ? (rng() < 0.7 ? '#ffd98a' : '#ffe9b8') : '#232a38';
          g.fillRect(c * cw + 3, r * ch + 4, cw - 6, ch - 8);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, h - 10, w, 10);
    });
  }

  /** Canvas texture: a road with a dashed centre line and edge lines. */
  function roadTexture() {
    return SM.canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#2c2c31';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#3a3a40';
      for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      g.fillStyle = '#e8c33c';
      g.fillRect(w / 2 - 2, 8, 4, 26);
      g.fillRect(w / 2 - 2, 72, 4, 26);
      g.fillStyle = '#d8d8d8';
      g.fillRect(4, 0, 2, h);
      g.fillRect(w - 6, 0, 2, h);
    });
  }

  /** Canvas texture: a glowing shop sign with text. */
  function signTexture(text, bg, fg) {
    return SM.canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.font = 'bold 30px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 1);
    });
  }

  function build(scene, rng) {
    colliders = [];
    places = {};
    const buildingsForMap = [];
    const group = new THREE.Group();
    scene.add(group);

    // --- Sky, sun, fog ---
    scene.background = new THREE.Color(0xf7b06a);
    scene.fog = new THREE.Fog(0xf2b57e, 260, 950);
    const hemi = new THREE.HemisphereLight(0x9fc8e8, 0x8a6f4d, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.9);
    sun.position.set(-180, 140, -120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -260;
    sun.shadow.camera.right = 260;
    sun.shadow.camera.top = 260;
    sun.shadow.camera.bottom = -260;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffe0b8, 0.25));
    SM.city.sun = sun;

    // --- Ground, roads, sidewalks ---
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1100, 1100),
      new THREE.MeshLambertMaterial({ color: 0x8a8172 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(60, -0.05, 0);
    ground.receiveShadow = true;
    group.add(ground);

    const roadTex = roadTexture();
    roadTex.wrapS = THREE.RepeatWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;
    const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
    const walkMat = new THREE.MeshLambertMaterial({ color: 0x9a938a });
    for (let i = -GRID; i <= GRID; i++) {
      const c = i * ROAD_STEP;
      const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 520), roadMat.clone());
      vRoad.material.map = roadTex.clone();
      vRoad.material.map.repeat.set(1, 520 / 48);
      vRoad.material.map.needsUpdate = true;
      vRoad.rotation.x = -Math.PI / 2;
      vRoad.rotation.z = Math.PI / 2;
      vRoad.position.set(c, 0.02, 0);
      vRoad.receiveShadow = true;
      group.add(vRoad);
      const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(520, ROAD_HALF * 2), roadMat.clone());
      hRoad.material.map = roadTex.clone();
      hRoad.material.map.repeat.set(520 / 48, 1);
      hRoad.material.map.needsUpdate = true;
      hRoad.rotation.x = -Math.PI / 2;
      hRoad.position.set(0, 0.02, c);
      hRoad.receiveShadow = true;
      group.add(hRoad);
    }
    // Sidewalk slabs per block.
    const walkGeo = new THREE.PlaneGeometry(36, 36);
    for (let bx = -GRID; bx < GRID; bx++) {
      for (let bz = -GRID; bz < GRID; bz++) {
        const cx = bx * ROAD_STEP + ROAD_STEP / 2;
        const cz = bz * ROAD_STEP + ROAD_STEP / 2;
        const slab = new THREE.Mesh(walkGeo, walkMat);
        slab.rotation.x = -Math.PI / 2;
        slab.position.set(cx, 0.01, cz);
        slab.receiveShadow = true;
        group.add(slab);
      }
    }

    // --- Beach and sea ---
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 560),
      new THREE.MeshLambertMaterial({ color: 0xe8d29a })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(BEACH_X + 42, 0.01, 0);
    sand.receiveShadow = true;
    group.add(sand);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 1100),
      new THREE.MeshLambertMaterial({ color: 0x2e7f9e })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(SEA_X + 290, 0.0, 0);
    group.add(sea);
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1100),
      new THREE.MeshBasicMaterial({ color: 0xeaf7f7, transparent: true, opacity: 0.7 })
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(SEA_X + 1, 0.03, 0);
    group.add(foam);

    // --- Building materials ---
    const palette = ['#c9a06a', '#b98a6a', '#8fa3b5', '#a89a7d', '#c47f5e'];
    const facadeMats = palette.map((base) => {
      const tex = facadeTexture(rng, base, 0.38);
      return new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffc46a, emissiveMap: tex, emissiveIntensity: 0.28 });
    });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a4640 });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);

    function addBuilding(cx, cz, w, h, d, mat, sign) {
      const m = new THREE.Mesh(boxGeo, mat);
      m.scale.set(w, h, d);
      m.position.set(cx, h / 2, cz);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      const roof = new THREE.Mesh(boxGeo, roofMat);
      roof.scale.set(w + 0.6, 0.5, d + 0.6);
      roof.position.set(cx, h + 0.25, cz);
      group.add(roof);
      addCollider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
      buildingsForMap.push({ x: cx, z: cz, w: w, d: d });
      if (sign) {
        const tex = signTexture(sign.text, sign.bg, sign.fg);
        const sm = new THREE.Mesh(
          new THREE.PlaneGeometry(sign.w || 16, 3.2),
          new THREE.MeshBasicMaterial({ map: tex })
        );
        sm.position.set(cx, Math.min(h - 2, 14), cz + d / 2 + 0.15);
        group.add(sm);
      }
      return m;
    }

    // --- Named landmarks ---
    // Central plaza with a fountain (open block, no building).
    places.plaza = { x: -24, z: -24 };
    const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 1.2, 20), new THREE.MeshLambertMaterial({ color: 0xb8b0a0 }));
    fountainBase.position.set(-24, 0.6, -24);
    fountainBase.castShadow = true;
    group.add(fountainBase);
    const fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.4, 20), new THREE.MeshLambertMaterial({ color: 0x4db2d8 }));
    fountainWater.position.set(-24, 1.2, -24);
    group.add(fountainWater);
    addCollider(-31, -31, -17, -17);
    // Solmarina Tower (tall, with a beacon).
    places.tower = { x: 24, z: -24 };
    addBuilding(24, -24, 26, 88, 26, facadeMats[2], { text: 'SOLMARINA TOWER', bg: '#1c2b45', fg: '#ffd23c', w: 22 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    beacon.position.set(24, 90, -24);
    group.add(beacon);
    SM.city.beacon = beacon;
    // Bank of Solmarina (white, columns).
    places.bank = { x: 24, z: 72 };
    addBuilding(24, 72, 24, 16, 20, new THREE.MeshLambertMaterial({ color: 0xe8e2d2 }), { text: 'BANK OF SOLMARINA', bg: '#f2ead8', fg: '#223344', w: 20 });
    for (let k = -1; k <= 1; k++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 10, 10), new THREE.MeshLambertMaterial({ color: 0xf5efe0 }));
      col.position.set(24 + k * 8, 5, 72 + 10.6);
      group.add(col);
    }
    // Mara Solano's office.
    places.mara = { x: -24, z: 72 };
    addBuilding(-24, 72, 18, 12, 16, facadeMats[0], { text: "MARA'S OFFICE", bg: '#3a1c2e', fg: '#ffb03c', w: 15 });
    // Solmarina Motors showroom (with a forecourt).
    places.showroom = { x: 72, z: 120 };
    addBuilding(72, 120, 26, 10, 18, facadeMats[3], { text: 'SOLMARINA MOTORS', bg: '#123a2a', fg: '#7dff9a', w: 20 });
    // Kroll's Garage (drop-off).
    places.garage = { x: -120, z: 144 };
    addBuilding(-120, 144, 22, 9, 18, facadeMats[4], { text: "KROLL'S GARAGE", bg: '#222222', fg: '#ff8a3c', w: 18 });
    // Grand Solmarina Hotel (beachfront).
    places.hotel = { x: 216, z: -96 };
    addBuilding(216, -96, 24, 42, 22, facadeMats[1], { text: 'GRAND SOLMARINA HOTEL', bg: '#7a2e4d', fg: '#ffe9b8', w: 22 });
    // St. Marina Clinic (respawn point).
    places.hospital = { x: -168, z: -168 };
    addBuilding(-168, -168, 20, 14, 18, new THREE.MeshLambertMaterial({ color: 0xf0f4f0 }), { text: 'ST. MARINA CLINIC', bg: '#ffffff', fg: '#1e8a4c', w: 18 });
    // Safehouse (small house, west-south corner).
    places.safehouse = { x: -216, z: 216 };
    addBuilding(-216, 216, 14, 7, 12, facadeMats[3], { text: 'SAFEHOUSE', bg: '#2a2a3a', fg: '#ffd23c', w: 12 });
    // Pier 9 (package pickup at the end).
    places.pier = { x: 372, z: 0 };
    const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(140, 0.8, 18), new THREE.MeshLambertMaterial({ color: 0x8a6a42 }));
    pierDeck.position.set(320, 0.6, 0);
    pierDeck.castShadow = true;
    pierDeck.receiveShadow = true;
    group.add(pierDeck);
    for (let x = 258; x <= 388; x += 16) {
      for (const dz of [-8, 8]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 8), new THREE.MeshLambertMaterial({ color: 0x6a4a2a }));
        post.position.set(x, -0.6, dz);
        group.add(post);
      }
    }
    const shack = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
    shack.scale.set(8, 5, 7);
    shack.position.set(378, 3.4, 0);
    shack.castShadow = true;
    group.add(shack);
    addCollider(374, -3.5, 382, 3.5);
    const pierSign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.4), new THREE.MeshBasicMaterial({ map: signTexture('PIER 9', '#123a4d', '#bfeaff') }));
    pierSign.position.set(378, 6.4, 3.6);
    group.add(pierSign);

    // --- Procedural blocks ---
    const landmarkBlocks = new Set(['-24,-24', '24,-24', '24,72', '-24,72', '72,120', '-120,144', '216,-96', '-168,-168', '-216,216']);
    for (let bx = -GRID; bx < GRID; bx++) {
      for (let bz = -GRID; bz < GRID; bz++) {
        const cx = bx * ROAD_STEP + ROAD_STEP / 2;
        const cz = bz * ROAD_STEP + ROAD_STEP / 2;
        if (landmarkBlocks.has(`${cx},${cz}`)) continue;
        const roll = rng();
        if (roll < 0.14) {
          // Park: trees and benches, no building.
          for (let t = 0; t < 5; t++) addPalm(group, rng, cx + SM.rand(rng, -13, 13), cz + SM.rand(rng, -13, 13));
          continue;
        }
        if (roll < 0.24) {
          // Parking lot: flat, with a few parked cars (meshes added later by vehicles).
          SM.city.parkingLots = SM.city.parkingLots || [];
          SM.city.parkingLots.push({ x: cx, z: cz });
          continue;
        }
        const n = SM.randInt(rng, 1, 3);
        for (let b = 0; b < n; b++) {
          const w = SM.rand(rng, 10, 16);
          const d = SM.rand(rng, 10, 16);
          const h = SM.rand(rng, 8, 46);
          const ox = SM.rand(rng, -8, 8);
          const oz = SM.rand(rng, -8, 8);
          const mat = SM.pick(rng, facadeMats);
          addBuilding(cx + ox, cz + oz, w, h, d, mat, null);
        }
      }
    }

    // --- Palms along the beach and boulevards ---
    for (let z = -230; z <= 230; z += 32) {
      addPalm(group, rng, BEACH_X + 14, z + SM.rand(rng, -6, 6));
      if (rng() < 0.6) addPalm(group, rng, BEACH_X + 26, z + 14);
    }
    for (let i = 0; i < 40; i++) {
      const x = SM.rand(rng, -230, 230);
      const z = SM.rand(rng, -230, 230);
      if (onRoad(x, z)) continue;
      addPalm(group, rng, x, z);
    }

    // --- Street lamps at intersections ---
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
    for (let i = -GRID; i <= GRID; i += 2) {
      for (let j = -GRID; j <= GRID; j += 2) {
        const x = i * ROAD_STEP + 8;
        const z = j * ROAD_STEP + 8;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 7, 8), lampMat);
        pole.position.set(x, 3.5, z);
        group.add(pole);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), lampGlowMat);
        head.position.set(x, 7.1, z);
        group.add(head);
      }
    }

    // --- Clouds (slow white blobs) ---
    SM.city.clouds = [];
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xfff2e0, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(SM.rand(rng, 8, 16), 10, 8), cloudMat);
        s.position.set(k * 12 - 18 + SM.rand(rng, -4, 4), SM.rand(rng, -2, 2), SM.rand(rng, -5, 5));
        s.scale.y = 0.45;
        c.add(s);
      }
      c.position.set(SM.rand(rng, -350, 450), SM.rand(rng, 90, 150), SM.rand(rng, -350, 350));
      group.add(c);
      SM.city.clouds.push(c);
    }

    mapData = {
      buildings: buildingsForMap,
      roads: { step: ROAD_STEP, min: -GRID * ROAD_STEP, max: GRID * ROAD_STEP, half: ROAD_HALF },
      beachX: BEACH_X,
      seaX: SEA_X,
      bounds: 252,
    };
    return { colliders: colliders, places: places, map: mapData };
  }

  function addPalm(group, rng, x, z) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.45, 7, 7),
      new THREE.MeshLambertMaterial({ color: 0x8a6a42 })
    );
    trunk.position.set(x, 3.5, z);
    trunk.rotation.z = SM.rand(rng, -0.08, 0.08);
    trunk.castShadow = true;
    group.add(trunk);
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e8a4a, side: THREE.DoubleSide });
    for (let k = 0; k < 6; k++) {
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), frondMat);
      const a = (k / 6) * Math.PI * 2;
      frond.position.set(x + Math.cos(a) * 1.6, 7.1, z + Math.sin(a) * 1.6);
      frond.rotation.set(-0.5, -a + Math.PI / 2, 0);
      frond.rotation.order = 'YXZ';
      group.add(frond);
    }
    addCollider(x - 0.6, z - 0.6, x + 0.6, z + 0.6);
  }

  return {
    build: build,
    resolveCollision: resolveCollision,
    onRoad: onRoad,
    nearestRoadPoint: nearestRoadPoint,
    get colliders() { return colliders; },
    get places() { return places; },
    get map() { return mapData; },
    clouds: [],
    beacon: null,
    sun: null,
    parkingLots: [],
  };
})();

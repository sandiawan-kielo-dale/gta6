// Save and load: one localStorage slot holding cash, health, story progress and the
// player's spot in the city. Autosaves after every mission; the menu offers Continue.
SM.save = (function save() {
  const KEY = 'solmarina-save-v1';

  function snapshot() {
    const p = SM.people.player;
    if (!p) return null;
    return {
      v: 1,
      money: SM.game.money(),
      health: Math.round(p.health),
      missionIndex: SM.missions.missionIndex,
      storyDone: SM.missions.storyDone,
      x: Math.round(p.x * 10) / 10,
      z: Math.round(p.z * 10) / 10,
      time: Date.now(),
    };
  }

  return {
    save: function saveGame() {
      try {
        const s = snapshot();
        if (!s) return false;
        localStorage.setItem(KEY, JSON.stringify(s));
        return true;
      } catch (e) {
        return false;
      }
    },
    has: function has() {
      try {
        return localStorage.getItem(KEY) !== null;
      } catch (e) {
        return false;
      }
    },
    load: function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== 1) return null;
        return s;
      } catch (e) {
        return null;
      }
    },
    clear: function clear() {
      try { localStorage.removeItem(KEY); } catch (e) { /* no storage */ }
    },
    /** Apply a loaded snapshot to a fresh game: returns the mission to start at. */
    apply: function apply(s) {
      const p = SM.people.player;
      if (!p || !s) return 0;
      p.x = s.x;
      p.z = s.z;
      p.health = s.health;
      p.mesh.position.set(s.x, 0, s.z);
      if (SM.game) SM.game.setMoney(s.money);
      return s.storyDone ? -1 : s.missionIndex;
    },
  };
})();

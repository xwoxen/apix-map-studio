// Walking test on apix_pvp_arena: running into a stone pillar stops at its collision footprint, noclip passes
// through, Space jumps, and the class switch loads another character with its motions.
(async () => {
  const s = window.__studio, w = s.walker;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const hold = async (key, ms) => { w.keyDown(key); await wait(ms); w.keyUp(key); await wait(100); };
  const pillar = s.objects.find((o) => o.crc === 796958272);
  const px = pillar.x / 100, pz = -pillar.y / 100;
  const dir = new (w.root.position.constructor)(px - 128, 0, pz - 128).normalize();        // outward from the centre
  const sx = px + dir.x * 5, sz = pz + dir.z * 5;
  await w.beginPlacing();
  s.startWalking(sx, sz);
  for (let i = 0; i < 50 && !w.objectGrid; i++) await wait(100);
  w.view.yaw = Math.atan2(dir.x, dir.z);                         // camera behind, W runs toward the pillar
  const out = { gridReady: Boolean(w.objectGrid) };
  await hold("w", 2500);
  out.stopAt = +Math.hypot(w.root.position.x - px, w.root.position.z - pz).toFixed(2);
  out.stoppedByPillar = out.stopAt > 0.3 && out.stopAt < 2;
  w.noclip = true; await hold("w", 600); w.noclip = false;
  out.noclipDistance = +Math.hypot(w.root.position.x - px, w.root.position.z - pz).toFixed(2);
  const y0 = w.root.position.y; w.keyDown(" "); await wait(250); out.jumpHeight = +(w.root.position.y - y0).toFixed(2); w.keyUp(" "); await wait(900);
  out.landed = Math.abs(w.root.position.y - y0) < 0.2;
  await w.load("assassin");
  out.assassin = Object.keys(w.actions);
  s.startWalking(128, 190); w.view.yaw = Math.PI; w.view.dist = 6;
  await hold("w", 600); w.keyDown("w"); await wait(300);
  return out;
})();

// Play mode test on apix_pvp_arena: running north from the centre stops at the duel floor's blocked edge,
// noclip passes the wall and moat, and the character ends on the plaza for the screenshot.
(async () => {
  const s = window.__studio, w = s.walker;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const hold = async (key, ms) => { w.keyDown(key); await wait(ms); w.keyUp(key); await wait(100); };
  await w.beginPlacing();
  s.startWalking(128, 128);
  w.view.yaw = 0;                                   // camera looks north, W runs north (-z)
  const out = { animations: Object.keys(w.actions), start: w.root.position.z };
  await hold("w", 6000);
  out.stoppedAtZ = +w.root.position.z.toFixed(1);
  out.stoppedAtFloorEdge = 128 - w.root.position.z > 19 && 128 - w.root.position.z < 23;
  out.blockedShown = w.blocked;
  w.noclip = true;
  await hold("w", 1300);
  out.noclipZ = +w.root.position.z.toFixed(1);
  out.noclipOnWaterY = +w.root.position.y.toFixed(2);
  await hold("w", 2500);
  out.passedMoat = 128 - w.root.position.z > 32;
  w.noclip = false;
  s.startWalking(128, 128 + 56);                    // plaza, south of the stands
  w.view.yaw = 0; w.view.dist = 7; w.view.pitch = 0.3;
  await hold("s", 800);                             // run toward the camera so the face is visible
  w.keyDown("w"); await wait(400);
  out.playing = w.current === w.actions.run;
  return out;
})();

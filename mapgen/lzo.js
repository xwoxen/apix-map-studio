// LZO1X for server_attr sectors. compress() writes one literal run (always valid LZO1X, the server only
// needs it to decompress to 65536 bytes); decompress() reads real sectors from existing maps for checks.

function compress(src) {
  const n = src.length, head = [];
  if (n <= 238) head.push(n + 17);
  else {
    // first-byte literal codes stop at 238, so use the generic run: 0, zero bytes of 255, remainder; length - 18
    let t = n - 18;
    head.push(0);
    while (t > 255) { head.push(0); t -= 255; }
    head.push(t);
  }
  return Buffer.concat([Buffer.from(head), Buffer.from(src), Buffer.from([0x11, 0, 0])]);
}

function decompress(src, outSize) {
  const out = Buffer.alloc(outSize);
  let ip = 0, op = 0, t, m;
  const copyMatch = (dist, len) => { let mp = op - dist; while (len--) out[op++] = out[mp++]; };
  const lit = (len) => { src.copy(out, op, ip, ip + len); op += len; ip += len; };
  let state = "start";
  if (src[ip] > 17) {
    t = src[ip++] - 17;
    lit(t);
    state = t < 4 ? "match_next" : "first_literal";
  }
  for (;;) {
    if (state === "start") {
      t = src[ip++];
      if (t >= 16) { state = "match"; }
      else {
        if (t === 0) { while (src[ip] === 0) { t += 255; ip++; } t += 15 + src[ip++]; }
        lit(t + 3);
        state = "first_literal";
      }
    }
    if (state === "first_literal") {
      t = src[ip++];
      if (t >= 16) state = "match";
      else {
        m = 1 + 0x0800 + (t >> 2) + (src[ip++] << 2);
        copyMatch(m, 3);
        state = "match_done";
      }
    }
    if (state === "match") {
      for (;;) {
        if (t >= 64) {
          m = 1 + ((t >> 2) & 7) + (src[ip++] << 3);
          copyMatch(m, (t >> 5) - 1 + 2);
        } else if (t >= 32) {
          t &= 31;
          if (t === 0) { while (src[ip] === 0) { t += 255; ip++; } t += 31 + src[ip++]; }
          m = 1 + ((src[ip] | (src[ip + 1] << 8)) >> 2); ip += 2;
          copyMatch(m, t + 2);
        } else if (t >= 16) {
          let dist = (t & 8) << 11;
          t &= 7;
          if (t === 0) { while (src[ip] === 0) { t += 255; ip++; } t += 7 + src[ip++]; }
          dist += (src[ip] | (src[ip + 1] << 8)) >> 2; ip += 2;
          if (dist === 0) return out.subarray(0, op);       // end marker
          copyMatch(dist + 0x4000, t + 2);
        } else {
          m = 1 + (t >> 2) + (src[ip++] << 2);
          copyMatch(m, 2);
        }
        // trailing literals of the previous instruction
        t = src[ip - 2] & 3;
        if (t === 0) break;
        lit(t);
        t = src[ip++];
      }
      state = "start";
      continue;
    }
    if (state === "match_done") {
      t = src[ip - 2] & 3;
      if (t === 0) { state = "start"; continue; }
      lit(t);
      t = src[ip++];
      state = "match";
      continue;
    }
    if (state === "match_next") {
      lit(0);
      t = src[ip++];
      state = "match";
    }
  }
}

module.exports = { compress, decompress };

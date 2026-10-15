'use strict';
const OnlineSmoothing = (() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
  function create() {
    let anchor = performance.now(), server = Date.now(), lastNow = server, delay = 100, interval = 50, lastArrival = null, stalled = false, stalls = 0, stallMs = 0;
    function now() { lastNow = Math.max(lastNow, server + performance.now() - anchor); return lastNow }
    function initialize(value) { server = value; anchor = performance.now(); lastNow = value }
    function sync(sample, rtt) { if (!Number.isFinite(sample)) return; const current = now(), difference = sample - current; server = current + clamp(difference * (rtt < 500 ? .2 : .05), -3, 3); anchor = performance.now() }
    function receive(clock, arrival = performance.now()) {
      if (lastArrival !== null) {
        const gap = arrival - lastArrival;
        if (gap > 0 && gap < 2000) { const variation = Math.abs(gap - interval); interval += clamp(gap - interval, -15, 15) * .12; delay = clamp(Math.max(delay * .992, 80 + variation * 1.6, gap + 15), 100, 240) }
      } lastArrival = arrival
    }
    function target(dt) { delay = clamp(delay - Math.min(dt, 0.08) * 2, 100, 240); return now() - delay }
    function starve(active, dt) { if (active && !stalled) stalls++; if (active) stallMs += dt * 1000; stalled = active }
    function stats() { return { bufferMs: Math.round(delay), stalls, stallMs: Math.round(stallMs), intervalMs: Math.round(interval) } }
    function reset() { delay = 100; interval = 50; lastArrival = null; stalled = false; stalls = 0; stallMs = 0 }
    return { now, initialize, sync, receive, target, starve, stats, reset };
  }
  function pose(frames, g, time) {
    if (!frames.length) return null; let a = frames[0], b = frames.at(-1);
    for (let i = 1; i < frames.length; i++) { if (frames[i].clock >= time) { a = frames[i - 1]; b = frames[i]; break } a = frames[i] }
    const left = a.racers[g], right = b.racers[g], span = b.clock - a.clock;
    if (time > b.clock) {
      const previous = frames.at(-2); if (!previous) return { ...right, starved: true };
      const seconds = clamp((time - b.clock) / 1000, 0, .12), history = (b.clock - previous.clock) / 1000;
      if (history <= 0) return { ...right, starved: true };
      const older = previous.racers[g];
      if (right.eliminated || right.finish !== null || !right.started) return { ...right, starved: false };
      return { ...right, x: right.x + clamp((right.x - older.x) / history, -260, 260) * seconds, y: right.y + clamp((right.y - older.y) / history, -260, 260) * seconds, angle: right.angle + clamp(angle(right.angle - older.angle) / history, -3, 3) * seconds, starved: true }
    }
    const t = span > 0 ? clamp((time - a.clock) / span, 0, 1) : 1;
    return { ...right, x: left.x + (right.x - left.x) * t, y: left.y + (right.y - left.y) * t, angle: left.angle + angle(right.angle - left.angle) * t, poseLeg: left.poseLeg + (right.poseLeg - left.poseLeg) * t, poseDrift: left.poseDrift + (right.poseDrift - left.poseDrift) * t, starved: false }
  }
  function follow(previous, target, dt) {
    if (!previous) return { x: target.x, y: target.y, angle: target.angle };
    const distance = Math.hypot(target.x - previous.x, target.y - previous.y);
    if (distance > 80) return { x: target.x, y: target.y, angle: target.angle };
    const blend = 1 - Math.exp(-Math.min(dt, .08) * 14);
    return { x: previous.x + (target.x - previous.x) * blend, y: previous.y + (target.y - previous.y) * blend, angle: previous.angle + angle(target.angle - previous.angle) * blend };
  }
  return { create, pose, follow, angle };
})();

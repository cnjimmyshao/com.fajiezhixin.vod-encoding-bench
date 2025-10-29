import { execSync } from "node:child_process";

export function detectScenes(inputFile, sceneThresh) {
  const cmd = `ffmpeg -hide_banner -i "${inputFile}" -filter:v "select='gt(scene,${sceneThresh})',showinfo" -an -f null - 2>&1`;
  const stderr = execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString("utf8");
  const cuts = [];
  const re = /pts_time:([0-9.]+)/g;
  let m;
  while ((m = re.exec(stderr)) !== null) {
    cuts.push(parseFloat(m[1]));
  }
  const uniq = Array.from(new Set(cuts)).sort((a,b)=>a-b);
  return uniq;
}

export function buildSegments(sceneCuts, totalDur, minDurSec = 4.0, maxDurSec = 8.0) {
  let segs = [];
  let curStart = 0.0;
  let idx = 0;
  while (curStart < totalDur - 0.01) {
    const minT = curStart + minDurSec;
    const maxT = Math.min(curStart + maxDurSec, totalDur);
    let pick = null;
    while (idx < sceneCuts.length && sceneCuts[idx] < minT) idx++;
    let j = idx;
    while (j < sceneCuts.length && sceneCuts[j] <= maxT) {
      pick = sceneCuts[j];
      j++;
    }
    const end = pick ?? maxT;
    const dur = +(end - curStart).toFixed(3);
    segs.push({ start: curStart, dur, end });
    curStart = end;
  }
  return segs;
}

export function getDurationSeconds(inputFile) {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${inputFile}"`,
    { stdio: "pipe" }
  ).toString("utf8").trim();
  return parseFloat(out);
}

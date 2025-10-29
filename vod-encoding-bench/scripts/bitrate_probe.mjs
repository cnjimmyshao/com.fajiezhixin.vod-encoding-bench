import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

function sh(cmd) {
  return execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString("utf8");
}

function encodeRefSegment({
  inputFile, start, dur, height, tmpDir
}) {
  const refOut = join(tmpDir, `ref_${start.toFixed(3).replace('.','p')}.mp4`);
  sh(
    `ffmpeg -y -hide_banner -ss ${start} -t ${dur} -i "${inputFile}" ` +
    `-vf "scale=-2:${height}" ` +
    `-c:v libx264 -preset veryslow -crf 10 -pix_fmt yuv420p ` +
    `-c:a aac -b:a 192k "${refOut}"`
  );
  return refOut;
}

// 生成段的一个候选码率版本
function encodeCandidate({
  inputFile, start, dur, height, codec, bitrateKbps, gopSec, audioKbps, tmpDir
}) {
  const gopFrames = Math.max(1, Math.round(gopSec * 30));
  const outFile = join(tmpDir,
    `cand_${start.toFixed(3).replace('.','p')}_${bitrateKbps}k_${codec}.mp4`
  );

  let videoArgs;
  if (codec === "libx265") {
    videoArgs =
      `-c:v libx265 -preset slow -b:v ${bitrateKbps}k ` +
      `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0 -bf 3`;
  } else if (codec === "libaom-av1") {
    videoArgs =
      `-c:v libaom-av1 -cpu-used 4 -b:v ${bitrateKbps}k ` +
      `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0`;
  } else if (codec === "libvpx-vp9") {
    videoArgs =
      `-c:v libvpx-vp9 -b:v ${bitrateKbps}k -deadline good -cpu-used 1 ` +
      `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0`;
  } else if (codec === "libx264") {
    videoArgs =
      `-c:v libx264 -preset slow -b:v ${bitrateKbps}k ` +
      `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0 -bf 3`;
  } else {
    throw new Error("Unsupported codec " + codec);
  }

  sh(
    `ffmpeg -y -hide_banner -ss ${start} -t ${dur} -i "${inputFile}" ` +
    `-vf "scale=-2:${height}" ` +
    `${videoArgs} ` +
    `-c:a aac -b:a ${audioKbps}k -movflags +faststart "${outFile}"`
  );

  return outFile;
}

function measureVmaf({
  distFile, refFile, vmafModel, tmpDir
}) {
  const vmafLog = join(tmpDir, `vmaf_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  sh(
    `ffmpeg -hide_banner -r 30 -i "${distFile}" -r 30 -i "${refFile}" ` +
    `-lavfi "[0:v][1:v]libvmaf=model_path='${vmafModel}':log_fmt=json:log_path='${vmafLog}'" ` +
    `-f null -`
  );
  const obj = JSON.parse(readFileSync(vmafLog,"utf8"));
  const score =
    (obj.global_metrics && obj.global_metrics.vmaf) ||
    (obj.aggregate && obj.aggregate.VMAF_score) ||
    (obj.VMAF_score) ||
    0;
  return score;
}

// 决定单个segment的最优码率（满足targetVmaf的最低kbps）
export function decideBitrateForSegment({
  inputFile, start, dur,
  height, codec,
  probeBitratesKbps,
  gopSec, audioKbps,
  tmpDir, vmafModel,
  targetVmaf
}) {
  const refFile = encodeRefSegment({ inputFile, start, dur, height, tmpDir });

  const candidates = [];
  for (const kbps of probeBitratesKbps) {
    const candFile = encodeCandidate({
      inputFile, start, dur, height, codec, bitrateKbps: kbps,
      gopSec, audioKbps, tmpDir
    });
    const vmafScore = measureVmaf({
      distFile: candFile, refFile, vmafModel, tmpDir
    });
    candidates.push({ kbps, vmaf: vmafScore });
  }

  // 最小kbps但 vmaf>=target
  const ok = candidates
    .filter(c => c.vmaf >= targetVmaf)
    .sort((a,b)=>a.kbps-b.kbps);

  const pick = ok.length>0
    ? ok[0]
    : candidates.sort((a,b)=>b.kbps-a.kbps)[0]; //兜底

  return {
    chosenBitrateKbps: pick.kbps,
    estVmaf: pick.vmaf,
    start,
    dur
  };
}

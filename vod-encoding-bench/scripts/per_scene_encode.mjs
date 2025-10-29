import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function sh(cmd) {
  return execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString("utf8");
}

function exportFinalSegment({
  inputFile, start, dur,
  height, codec,
  bitrateKbps,
  gopSec, audioKbps,
  outPath
}) {
  const gopFrames = Math.max(1, Math.round(gopSec * 30));
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
    throw new Error("暂不支持的编码器 / Unsupported codec: " + codec);
  }

  sh(
    `ffmpeg -y -hide_banner -ss ${start} -t ${dur} -i "${inputFile}" ` +
    `-vf "scale=-2:${height}" ` +
    `${videoArgs} ` +
    `-c:a aac -b:a ${audioKbps}k ` +
    `-movflags +faststart "${outPath}"`
  );
}

function concatSegmentsToFile(segFiles, finalFile) {
  const listPath = finalFile + ".txt";
  const listContent = segFiles.map(f => `file '${f.replace(/'/g,"'\\''")}'`).join("\n");
  writeFileSync(listPath, listContent, "utf8");

  sh(
    `ffmpeg -hide_banner -f concat -safe 0 -i "${listPath}" ` +
    `-c copy -movflags +faststart "${finalFile}"`
  );
}

function makeReferenceWhole(inputFile, height, refFile) {
  sh(
    `ffmpeg -y -hide_banner -i "${inputFile}" ` +
    `-vf "scale=-2:${height}" ` +
    `-c:v libx264 -preset veryslow -crf 10 -pix_fmt yuv420p ` +
    `-c:a aac -b:a 192k "${refFile}"`
  );
}

function measureFinalVmaf({ finalFile, referenceFile, vmafModel, outJson }) {
  sh(
    `ffmpeg -hide_banner -r 30 -i "${finalFile}" -r 30 -i "${referenceFile}" ` +
    `-lavfi "[0:v][1:v]libvmaf=model_path='${vmafModel}':log_fmt=json:log_path='${outJson}'" ` +
    `-f null -`
  );
  const obj = JSON.parse(readFileSync(outJson,"utf8"));
  const score =
    (obj.global_metrics && obj.global_metrics.vmaf) ||
    (obj.aggregate && obj.aggregate.VMAF_score) ||
    (obj.VMAF_score) ||
    0;
  return score;
}

export function runPerSceneEncode({
  inputFile, height, codec,
  segmentPlan, // [{start, dur, chosenBitrateKbps, estVmaf}, ...]
  gopSec, audioKbps,
  workdir, vmafModel,
  modeTag = "perScene"
}) {
  const safeTag = modeTag.replace(/[^a-zA-Z0-9_]+/g, "_");
  mkdirSync(workdir, { recursive: true });
  const segDir   = join(workdir, `${safeTag}_segments`);
  const repDir   = join(workdir, "report");
  const finalOut = join(workdir, `final_${codec}_${safeTag}.mp4`);
  const refOut   = join(workdir, `ref_full_${height}p_${safeTag}.mp4`);
  const vmafJson = join(repDir,  `final_vmaf_${codec}_${safeTag}.json`);

  mkdirSync(segDir, { recursive: true });
  mkdirSync(repDir, { recursive: true });

  // 输出每个片段 / Export each segment
  const segFiles = [];
  segmentPlan.forEach((seg, idx) => {
    const outPath = join(segDir, `seg_${String(idx).padStart(4,"0")}.mp4`);
    exportFinalSegment({
      inputFile,
      start: seg.start,
      dur: seg.dur,
      height,
      codec,
      bitrateKbps: seg.chosenBitrateKbps,
      gopSec,
      audioKbps,
      outPath
    });
    segFiles.push(outPath);
  });

  // 拼接生成整片 / Concatenate into the full video
  concatSegmentsToFile(segFiles, finalOut);

  // 生成高质量参考整片 / Produce a high-quality reference encode
  makeReferenceWhole(inputFile, height, refOut);

  // 计算整片 VMAF / Measure full-video VMAF
  const wholeVmaf = measureFinalVmaf({
    finalFile: finalOut,
    referenceFile: refOut,
    vmafModel,
    outJson: vmafJson
  });

  return {
    finalFile: finalOut,
    finalVmaf: wholeVmaf
  };
}

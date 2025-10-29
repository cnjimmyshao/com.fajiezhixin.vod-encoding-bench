import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execSync } from "node:child_process";
import { detectScenes, buildSegments, getDurationSeconds } from "./scene_detect.mjs";
import { decideBitrateForSegment } from "./bitrate_probe.mjs";
import { runPerSceneEncode } from "./per_scene_encode.mjs";

function sh(cmd) {
  return execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString("utf8");
}

function avgBitrateKbps(file) {
  // 用文件大小和时长估算平均码率
  const sizeBytes = statSync(file).size;
  const durationSec = parseFloat(
    execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${file}"`,
      { stdio: "pipe" }
    ).toString("utf8").trim()
  );
  const bits = sizeBytes * 8;
  const kbps = bits / 1000 / durationSec;
  return kbps;
}

function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error("用法: node run_experiment.mjs <inputVideoFile>");
    process.exit(1);
  }
  const INPUT = resolve(inputArg);

  // 读配置
  const cfg = JSON.parse(readFileSync("./configs/experiment_matrix.json","utf8"));
  const {
    targetVmaf,
    heightList,
    codecs,
    probeBitratesKbps,
    gopSec,
    sceneThresh,
    audioKbps,
    vmafModel
  } = cfg;

  const baseName = basename(INPUT).replace(/\.[^.]+$/,"");
  const rootWork = resolve("./workdir", baseName);
  mkdirSync(rootWork, { recursive: true });
  mkdirSync(join(rootWork,"tmp"), { recursive: true });
  mkdirSync(join(rootWork,"segments"), { recursive: true });
  mkdirSync(join(rootWork,"report"), { recursive: true });

  const totalDur = getDurationSeconds(INPUT);
  const sceneCuts = detectScenes(INPUT, sceneThresh);
  const segments = buildSegments(sceneCuts, totalDur, 4.0, 8.0);

  const summaryRows = [];

  for (const height of heightList) {
    for (const codec of codecs) {
      console.log(`=== Running per_scene mode for codec=${codec}, height=${height}p ===`);

      // 对每个segment探测合适码率
      const plan = [];
      for (const seg of segments) {
        const pick = decideBitrateForSegment({
          inputFile: INPUT,
          start: seg.start,
          dur: seg.dur,
          height,
          codec,
          probeBitratesKbps,
          gopSec,
          audioKbps,
          tmpDir: join(rootWork,"tmp"),
          vmafModel,
          targetVmaf
        });
        plan.push(pick);
      }

      // 真实输出+整片VMAF
      const { finalFile, finalVmaf } = runPerSceneEncode({
        inputFile: INPUT,
        height,
        codec,
        segmentPlan: plan,
        gopSec,
        audioKbps,
        workdir: rootWork,
        vmafModel
      });

      const kbps = avgBitrateKbps(finalFile);

      summaryRows.push({
        mode: "per_scene",
        codec,
        height,
        targetVmaf,
        finalVmaf,
        avgBitrateKbps: kbps,
        outputFile: finalFile
      });

      console.log(`Result: codec=${codec}, height=${height}p, finalVmaf=${finalVmaf.toFixed(2)}, ~${kbps.toFixed(1)} kbps`);
    }
  }

  const summaryPath = join("./results", `${baseName}_summary.json`);
  mkdirSync("./results", { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summaryRows,null,2), "utf8");
  console.log("Summary written:", summaryPath);
}

main();

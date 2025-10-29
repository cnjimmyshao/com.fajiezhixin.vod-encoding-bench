import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execSync } from "node:child_process";
import { detectScenes, buildSegments, getDurationSeconds } from "./scene_detect.mjs";
import { decideBitrateForSegment } from "./bitrate_probe.mjs";
import { runPerSceneEncode } from "./per_scene_encode.mjs";

function sh(cmd) {
  return execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString("utf8");
}

function bilingual(chinese, english) {
  return `${chinese}\n${english}`;
}

function avgBitrateKbps(file) {
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

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function sanitizeTag(tag) {
  return tag.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function createSegmentFetcher(sceneThresh) {
  const cache = new Map();
  return function fetchSegments(sourceFile) {
    if (cache.has(sourceFile)) {
      return cache.get(sourceFile);
    }
    console.log(bilingual(
      `  -> 正在对 ${sourceFile} 进行场景检测 (阈值=${sceneThresh})`,
      `  -> Performing scene detection on ${sourceFile} (threshold=${sceneThresh})`
    ));
    const totalDur = getDurationSeconds(sourceFile);
    const cuts = detectScenes(sourceFile, sceneThresh);
    const segments = buildSegments(cuts, totalDur, 4.0, 8.0);
    console.log(bilingual(
      `  -> 检测到 ${segments.length} 个片段`,
      `  -> Detected ${segments.length} segments`
    ));
    cache.set(sourceFile, segments);
    return segments;
  };
}

function isImplementationSupported(codec, implementation) {
  if (implementation === "cpu") {
    return true;
  }
  if (implementation === "nvenc") {
    return codec === "libx264" || codec === "libx265";
  }
  return false;
}

function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error(bilingual(
      "用法: node ./scripts/run_experiment.mjs <输入视频文件>",
      "Usage: node ./scripts/run_experiment.mjs <inputVideoFile>"
    ));
    process.exit(1);
  }
  const INPUT = resolve(inputArg);

  const cfg = JSON.parse(readFileSync("./configs/experiment_matrix.json", "utf8"));
  const {
    targetVmaf,
    heightList,
    codecs,
    encoderImplementations = ["cpu"],
    probeBitratesKbps,
    gopSec,
    sceneThresh,
    audioKbps,
    vmafModel,
    modes = ["per_scene"],
    aiPreprocessModel = "realesrgan_x4plus"
  } = cfg;

  const implementations = Array.isArray(encoderImplementations)
    ? encoderImplementations
    : ["cpu"];

  const baseName = basename(INPUT).replace(/\.[^.]+$/, "");
  const rootWork = resolve("./workdir", baseName);
  ensureDir(rootWork);

  const fetchSegments = createSegmentFetcher(sceneThresh);
  const summaryRows = [];
  const modesToRun = Array.isArray(modes) ? modes : ["per_scene"];

  function runPerSceneFlow({ modeLabel, sourceFile }) {
    const segments = fetchSegments(sourceFile);
    for (const height of heightList) {
      for (const codec of codecs) {
        for (const implementation of implementations) {
          if (!isImplementationSupported(codec, implementation)) {
            console.warn(bilingual(
              `=== 跳过: 模式=${modeLabel} 编码器=${codec} 实现=${implementation} 暂不支持 ===`,
              `=== Skipping: mode=${modeLabel} codec=${codec} implementation=${implementation} not supported ===`
            ));
            continue;
          }

          console.log(bilingual(
            `=== 模式:${modeLabel} 编码器:${codec} 实现:${implementation} 分辨率:${height}p ===`,
            `=== Mode:${modeLabel} Codec:${codec} Implementation:${implementation} Resolution:${height}p ===`
          ));

          const safeMode = sanitizeTag(modeLabel);
          const modeWorkdir = join(rootWork, `${safeMode}_${height}p_${codec}_${implementation}`);
          ensureDir(modeWorkdir);
          const tmpDir = join(modeWorkdir, "tmp");
          ensureDir(tmpDir);

          const plan = segments.map(seg => {
            const result = decideBitrateForSegment({
              inputFile: sourceFile,
              start: seg.start,
              dur: seg.dur,
              height,
              codec,
              implementation,
              probeBitratesKbps,
              gopSec,
              audioKbps,
              tmpDir,
              vmafModel,
              targetVmaf
            });
            console.log(bilingual(
              `    片段[${seg.start.toFixed(2)}s-${(seg.start + seg.dur).toFixed(2)}s] -> ${result.chosenBitrateKbps} kbps (估算VMAF=${result.estVmaf.toFixed(2)})`,
              `    Segment [${seg.start.toFixed(2)}s-${(seg.start + seg.dur).toFixed(2)}s] -> ${result.chosenBitrateKbps} kbps (est. VMAF=${result.estVmaf.toFixed(2)})`
            ));
            return result;
          });

          const { finalFile, finalVmaf } = runPerSceneEncode({
            inputFile: sourceFile,
            height,
            codec,
            implementation,
            segmentPlan: plan,
            gopSec,
            audioKbps,
            workdir: modeWorkdir,
            vmafModel,
            modeTag: `${safeMode}_${height}p_${codec}_${implementation}`
          });

          const kbps = avgBitrateKbps(finalFile);

          summaryRows.push({
            mode: modeLabel,
            codec,
            height,
            implementation,
            targetVmaf,
            finalVmaf,
            avgBitrateKbps: kbps,
            outputFile: finalFile
          });

          console.log(bilingual(
            `结果: 模式=${modeLabel}, 编码器=${codec}, 实现=${implementation}, 分辨率=${height}p, 整体VMAF=${finalVmaf.toFixed(2)}, 平均码率≈${kbps.toFixed(1)} kbps`,
            `Result: mode=${modeLabel}, codec=${codec}, implementation=${implementation}, resolution=${height}p, final VMAF=${finalVmaf.toFixed(2)}, avg bitrate≈${kbps.toFixed(1)} kbps`
          ));
        }
      }
    }
  }

  for (const mode of modesToRun) {
    if (mode === "per_scene") {
      runPerSceneFlow({ modeLabel: "per_scene", sourceFile: INPUT });
    } else if (mode === "ai_preprocess+per_scene") {
      const aiDir = join(rootWork, "ai_preprocess");
      ensureDir(aiDir);
      const enhancedInput = join(aiDir, `${baseName}_enhanced.mp4`);
      console.log(bilingual(
        `=== 模式:ai_preprocess+per_scene -> 启动 AI 预处理 (模型=${aiPreprocessModel}) ===`,
        `=== Mode: ai_preprocess+per_scene -> Launching AI preprocessing (model=${aiPreprocessModel}) ===`
      ));
      sh(
        `python3 ./ai_preprocess/preprocess_video.py --input "${INPUT}" --output "${enhancedInput}" --model ${aiPreprocessModel}`
      );
      runPerSceneFlow({ modeLabel: "ai_preprocess+per_scene", sourceFile: enhancedInput });
    } else {
      console.warn(bilingual(
        `模式 ${mode} 尚未实现，已跳过。`,
        `Mode ${mode} not implemented yet, skipped.`
      ));
    }
  }

  const summaryPath = join("./results", `${baseName}_summary.json`);
  ensureDir("./results");
  writeFileSync(summaryPath, JSON.stringify(summaryRows, null, 2), "utf8");
  console.log(bilingual(
    `摘要结果已写入: ${summaryPath}`,
    `Summary saved to: ${summaryPath}`
  ));
}

main();

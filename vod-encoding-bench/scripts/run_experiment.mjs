import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
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

async function promptForInputFile() {
  const rl = createInterface({ input, output });
  try {
    console.log(
      bilingual(
        "请选择输入视频来源:\n  1) 使用本地视频文件\n  2) 使用 FFmpeg 生成随机测试视频 (30 秒)",
        "Select the input video source:\n  1) Use a local video file\n  2) Generate a random test video with FFmpeg (30 seconds)"
      )
    );

    let choice = "";
    while (choice !== "1" && choice !== "2") {
      choice = (await rl.question(
        bilingual("请输入选项 (1 或 2): ", "Enter your choice (1 or 2): ")
      )).trim();
      if (choice !== "1" && choice !== "2") {
        console.log(bilingual("无效选项，请重试。", "Invalid choice, please try again."));
      }
    }

    if (choice === "1") {
      while (true) {
        const answer = (await rl.question(
          bilingual("请输入本地视频文件路径: ", "Enter the local video file path: ")
        )).trim();
        if (!answer) {
          console.log(bilingual("路径不能为空。", "Path cannot be empty."));
          continue;
        }
        const candidate = resolve(answer);
        if (!existsSync(candidate)) {
          console.log(
            bilingual(`文件不存在: ${candidate}`, `File does not exist: ${candidate}`)
          );
          continue;
        }
        try {
          const stats = statSync(candidate);
          if (!stats.isFile()) {
            console.log(
              bilingual(`路径不是文件: ${candidate}`, `Path is not a file: ${candidate}`)
            );
            continue;
          }
        } catch (err) {
          console.log(
            bilingual(`无法访问文件: ${candidate}`, `Unable to access file: ${candidate}`)
          );
          continue;
        }
        return candidate;
      }
    }

    const duration = 30;
    const generatedDir = resolve("./workdir", "generated_inputs");
    ensureDir(generatedDir);
    const outputFile = join(generatedDir, `random_${Date.now()}.mp4`);
    const seed = Date.now();
    console.log(
      bilingual(
        `正在使用 FFmpeg 生成随机测试视频 (${duration} 秒)...`,
        `Generating a random test video (${duration} seconds) with FFmpeg...`
      )
    );
    const ffmpegCmd =
      `ffmpeg -y -hide_banner -loglevel error -f lavfi -i "life=s=1280x720:mold=10:r=30:ratio=0.5:seed=${seed}" ` +
      `-f lavfi -i "sine=frequency=1000:sample_rate=44100" -shortest -c:v libx264 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 128k -t ${duration} "${outputFile}"`;
    sh(ffmpegCmd);
    console.log(
      bilingual(
        `随机视频已生成: ${outputFile}`,
        `Random video generated at: ${outputFile}`
      )
    );
    return outputFile;
  } finally {
    rl.close();
  }
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

async function main() {
  const inputArg = process.argv[2];
  const INPUT = inputArg ? resolve(inputArg) : await promptForInputFile();

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

main().catch(err => {
  console.error(err);
  process.exit(1);
});

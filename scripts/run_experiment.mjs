import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  detectScenes,
  buildSegments,
  getDurationSeconds,
} from "./scene_detect.mjs";
import { decideBitrateForSegment } from "./bitrate_probe.mjs";
import { runPerSceneEncode } from "./per_scene_encode.mjs";
import { runBaselineCrfEncode } from "./baseline_crf_encode.mjs";

function sh(cmd) {
  return execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString("utf8");
}

function checkNvencSupport() {
  const result = {
    supported: false,
    hasGpu: false,
    encoders: [],
  };

  try {
    try {
      execSync("nvidia-smi", {
        stdio: "pipe",
        shell: "/bin/bash",
        timeout: 5000,
      });
      result.hasGpu = true;
      console.log("  ✓ 检测到 NVIDIA GPU");
    } catch (gpuError) {
      console.log("  ✗ 未检测到 NVIDIA GPU (nvidia-smi 不可用)");
      return result;
    }

    const encoders = sh("ffmpeg -hide_banner -encoders 2>/dev/null");
    const nvencEncoders = [
      { name: "h264_nvenc", display: "H.264 NVENC" },
      { name: "hevc_nvenc", display: "H.265/HEVC NVENC" },
      { name: "av1_nvenc", display: "AV1 NVENC" },
    ];

    for (const encoder of nvencEncoders) {
      if (encoders.includes(encoder.name)) {
        result.encoders.push(encoder.name);
        console.log(`  ✓ 支持 ${encoder.display} (${encoder.name})`);
      } else {
        console.log(`  ✗ 不支持 ${encoder.display} (${encoder.name})`);
      }
    }

    result.supported = result.hasGpu && result.encoders.length > 0;

    return result;
  } catch (error) {
    console.error("  ✗ NVENC 检测过程出错:", error.message);
    return result;
  }
}

function avgBitrateKbps(file) {
  const sizeBytes = statSync(file).size;
  const durationSec = parseFloat(
    execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${file}"`,
      { stdio: "pipe", shell: "/bin/bash" }
    )
      .toString("utf8")
      .trim()
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

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.length > 0);
  }
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  const item = String(value);
  return item.length > 0 ? [item] : [];
}

function normalizeNumericArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  }
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  }
  const num = Number(value);
  return Number.isFinite(num) ? [num] : [];
}

export async function promptForInputFile() {
  const rl = createInterface({ input, output });
  try {
    console.log(
      "请选择输入视频来源:\n  1) 使用本地视频文件\n  2) 使用 FFmpeg 生成随机测试视频 (30 秒)"
    );

    let choice = "";
    while (choice !== "1" && choice !== "2") {
      choice = (await rl.question("请输入选项 (1 或 2): ")).trim();
      if (choice !== "1" && choice !== "2") {
        console.log("无效选项，请重试。");
      }
    }

    if (choice === "1") {
      while (true) {
        const answer = (await rl.question("请输入本地视频文件路径: ")).trim();
        if (!answer) {
          console.log("路径不能为空。");
          continue;
        }
        const candidate = resolve(answer);
        if (!existsSync(candidate)) {
          console.log(`文件不存在: ${candidate}`);
          continue;
        }
        try {
          const stats = statSync(candidate);
          if (!stats.isFile()) {
            console.log(`路径不是文件: ${candidate}`);
            continue;
          }
        } catch (err) {
          console.log(`无法访问文件: ${candidate}`);
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
    console.log(`正在使用 FFmpeg 生成随机测试视频 (${duration} 秒)...`);
    const ffmpegCmd =
      `ffmpeg -y -hide_banner -loglevel error -f lavfi -i "life=s=1280x720:mold=10:r=30:ratio=0.5:seed=${seed}" ` +
      `-f lavfi -i "sine=frequency=1000:sample_rate=44100" -shortest -c:v libx264 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 128k -t ${duration} "${outputFile}"`;
    sh(ffmpegCmd);
    console.log(`随机视频已生成: ${outputFile}`);
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
    console.log(`  -> 正在对 ${sourceFile} 进行场景检测 (阈值=${sceneThresh})`);
    const totalDur = getDurationSeconds(sourceFile);
    const cuts = detectScenes(sourceFile, sceneThresh);
    const segments = buildSegments(cuts, totalDur, 4.0, 8.0);
    console.log(`  -> 检测到 ${segments.length} 个片段`);
    cache.set(sourceFile, segments);
    return segments;
  };
}

function isImplementationSupported(codec, implementation) {
  if (implementation === "cpu") {
    return true;
  }
  if (implementation === "nvenc") {
    return codec === "libx264" || codec === "libx265" || codec === "libaom-av1";
  }
  return false;
}

export async function runExperiment({
  inputFile,
  configPath = "./configs/experiment_matrix.json",
  configOverrides = {},
  onSummaryRow,
  onLog,
} = {}) {
  if (!inputFile) {
    throw new Error("inputFile is required");
  }

  const INPUT = resolve(inputFile);
  if (!existsSync(INPUT)) {
    throw new Error(`输入文件不存在: ${INPUT}`);
  }

  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const mergedConfig = { ...cfg, ...configOverrides };

  let {
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
    aiPreprocessModel = "realesrgan_x4plus",
    baselineCrf = 23,
  } = mergedConfig;

  heightList = normalizeNumericArray(heightList);
  codecs = normalizeStringArray(codecs);
  encoderImplementations = normalizeStringArray(encoderImplementations);
  probeBitratesKbps = normalizeNumericArray(probeBitratesKbps);
  modes = normalizeStringArray(modes);

  if (heightList.length === 0) {
    throw new Error("heightList 配置为空");
  }
  if (codecs.length === 0) {
    throw new Error("codecs 配置为空");
  }
  if (probeBitratesKbps.length === 0) {
    throw new Error("probeBitratesKbps 配置为空");
  }

  onLog?.(`开始编码实验: ${INPUT}`);

  console.log("\n=== 检测 NVENC 硬件编码支持 ===");
  const nvencInfo = checkNvencSupport();
  if (!nvencInfo.supported && encoderImplementations.includes("nvenc")) {
    console.warn("\n⚠️  NVENC 不可用，将跳过所有 NVENC 编码任务");
    if (!nvencInfo.hasGpu) {
      console.warn("   原因: 未检测到 NVIDIA GPU");
    } else if (nvencInfo.encoders.length === 0) {
      console.warn("   原因: FFmpeg 未编译 NVENC 编码器支持");
    }
  } else if (nvencInfo.supported) {
    console.log(
      `\n✓ NVENC 可用 (${nvencInfo.encoders.length} 个编码器: ${nvencInfo.encoders.join(", ")})`
    );
  }
  console.log("");

  const nvencSupported = nvencInfo.supported;
  const implementations = encoderImplementations.length
    ? encoderImplementations.filter(
        (impl) => impl === "cpu" || (impl === "nvenc" && nvencSupported)
      )
    : ["cpu"];

  const baseName = basename(INPUT).replace(/\.[^.]+$/, "");
  const rootWork = resolve("./workdir", baseName);
  ensureDir(rootWork);

  const fetchSegments = createSegmentFetcher(sceneThresh);
  const summaryRows = [];
  const modesToRun = modes.length ? modes : ["per_scene"];

  ensureDir("./results");
  const summaryPath = join("./results", `${baseName}_summary.json`);
  const summaryStreamPath = join("./results", `${baseName}_stream.jsonl`);
  writeFileSync(summaryStreamPath, "", "utf8");

  const recordSummaryRow = (row) => {
    summaryRows.push(row);
    appendFileSync(summaryStreamPath, `${JSON.stringify(row)}\n`, "utf8");
    onSummaryRow?.(row);
  };

  function runPerSceneFlow({ modeLabel, sourceFile }) {
    const segments = fetchSegments(sourceFile);
    for (const height of heightList) {
      for (const codec of codecs) {
        for (const implementation of implementations) {
          if (!isImplementationSupported(codec, implementation)) {
            console.warn(
              `=== 跳过: 模式=${modeLabel} 编码器=${codec} 实现=${implementation} 暂不支持 ===`
            );
            continue;
          }

          console.log(
            `=== 模式:${modeLabel} 编码器:${codec} 实现:${implementation} 分辨率:${height}p ===`
          );

          const safeMode = sanitizeTag(modeLabel);
          const modeWorkdir = join(
            rootWork,
            `${safeMode}_${height}p_${codec}_${implementation}`
          );
          ensureDir(modeWorkdir);
          const tmpDir = join(modeWorkdir, "tmp");
          ensureDir(tmpDir);

          try {
            let previousResult = null;
            let totalProbeCount = 0;
            let totalProbeEncodeTime = 0;

            const plan = [];
            for (let index = 0; index < segments.length; index++) {
              const seg = segments[index];
              try {
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
                  targetVmaf,
                  previousSegmentResult: previousResult,
                  useAdaptiveSearch: true,
                });

                totalProbeCount += result.probesUsed || 0;
                totalProbeEncodeTime += result.probeEncodeTime || 0;

                const probesInfo = result.probesUsed
                  ? ` (${result.probesUsed} 次探测)`
                  : "";
                console.log(
                  `    片段 ${index + 1}/${
                    segments.length
                  } [${seg.start.toFixed(2)}s-${(seg.start + seg.dur).toFixed(
                    2
                  )}s] -> ${
                    result.chosenBitrateKbps
                  } kbps (估算VMAF=${result.estVmaf.toFixed(2)})${probesInfo}`
                );

                previousResult = result;
                plan.push(result);
              } catch (segError) {
                console.error(
                  `    ❌ 片段 ${index + 1}/${segments.length} 探测失败: ${
                    segError.message
                  }`
                );
                if (segError.signal) {
                  console.error(`       信号: ${segError.signal}`);
                }
                throw segError;
              }
            }

            const { finalFile, finalVmaf, finalEncodeTime } = runPerSceneEncode({
              inputFile: sourceFile,
              height,
              codec,
              implementation,
              segmentPlan: plan,
              gopSec,
              audioKbps,
              workdir: modeWorkdir,
              vmafModel,
              modeTag: `${safeMode}_${height}p_${codec}_${implementation}`,
            });

            const kbps = avgBitrateKbps(finalFile);
            const videoDuration = getDurationSeconds(sourceFile);
            const totalEncodeTime = totalProbeEncodeTime + finalEncodeTime;
            const encodingEfficiency = totalEncodeTime / videoDuration;

            recordSummaryRow({
              mode: modeLabel,
              codec,
              height,
              implementation,
              targetVmaf,
              finalVmaf,
              avgBitrateKbps: kbps,
              probeCount: totalProbeCount,
              finalEncodeCount: segments.length,
              totalEncodeCount: totalProbeCount + segments.length,
              probeEncodeTimeSeconds:
                Math.round(totalProbeEncodeTime * 100) / 100,
              finalEncodeTimeSeconds: Math.round(finalEncodeTime * 100) / 100,
              totalEncodeTimeSeconds: Math.round(totalEncodeTime * 100) / 100,
              videoDurationSeconds: Math.round(videoDuration * 100) / 100,
              encodingEfficiency: Math.round(encodingEfficiency * 100) / 100,
              outputFile: finalFile,
            });

            console.log(
              `结果: 模式=${modeLabel}, 编码器=${codec}, 实现=${implementation}, 分辨率=${height}p, ` +
                `整体VMAF=${finalVmaf.toFixed(2)}, 平均码率≈${kbps.toFixed(
                  1
                )} kbps, ` +
                `编码次数=${
                  totalProbeCount + segments.length
                } (探测=${totalProbeCount}, 最终=${segments.length}), ` +
                `编码效率=${encodingEfficiency.toFixed(
                  2
                )}x (耗时=${totalEncodeTime.toFixed(
                  1
                )}s / 视频=${videoDuration.toFixed(1)}s)`
            );
          } catch (error) {
            console.error(
              `❌ 编码失败: 模式=${modeLabel}, 编码器=${codec}, 实现=${implementation}, 分辨率=${height}p`
            );
            console.error(`   错误: ${error.message}`);
            if (error.signal) {
              console.error(`   信号: ${error.signal}`);
            }
            console.error("   跳过此配置，继续下一个...\n");
          }
        }
      }
    }
  }

  for (const mode of modesToRun) {
    if (mode === "baseline_crf") {
      for (const height of heightList) {
        for (const codec of codecs) {
          for (const implementation of implementations) {
            if (!isImplementationSupported(codec, implementation)) {
              console.warn(
                `=== 跳过: 模式=baseline_crf 编码器=${codec} 实现=${implementation} 暂不支持 ===`
              );
              continue;
            }

            console.log(
              `=== 模式:baseline_crf 编码器:${codec} 实现:${implementation} 分辨率:${height}p CRF=${baselineCrf} ===`
            );

            const modeWorkdir = join(
              rootWork,
              `baseline_crf_${height}p_${codec}_${implementation}`
            );
            ensureDir(modeWorkdir);

            try {
              const { finalFile, finalVmaf, encodeTime } = runBaselineCrfEncode({
                inputFile: INPUT,
                height,
                codec,
                implementation,
                crf: baselineCrf,
                gopSec,
                audioKbps,
                workdir: modeWorkdir,
                vmafModel,
                modeTag: `baseline_crf_${height}p_${codec}_${implementation}`,
              });

              const kbps = avgBitrateKbps(finalFile);
              const videoDuration = getDurationSeconds(INPUT);
              const encodingEfficiency = encodeTime / videoDuration;

              recordSummaryRow({
                mode: "baseline_crf",
                codec,
                height,
                implementation,
                crf: baselineCrf,
                targetVmaf: null,
                finalVmaf,
                avgBitrateKbps: kbps,
                probeCount: 0,
                finalEncodeCount: 1,
                totalEncodeCount: 1,
                probeEncodeTimeSeconds: 0,
                finalEncodeTimeSeconds: Math.round(encodeTime * 100) / 100,
                totalEncodeTimeSeconds: Math.round(encodeTime * 100) / 100,
                videoDurationSeconds: Math.round(videoDuration * 100) / 100,
                encodingEfficiency: Math.round(encodingEfficiency * 100) / 100,
                outputFile: finalFile,
              });

              console.log(
                `结果: 模式=baseline_crf, 编码器=${codec}, 实现=${implementation}, 分辨率=${height}p, ` +
                  `CRF=${baselineCrf}, VMAF=${finalVmaf.toFixed(
                    2
                  )}, 平均码率≈${kbps.toFixed(1)} kbps, ` +
                  `编码次数=1, 编码效率=${encodingEfficiency.toFixed(
                    2
                  )}x (耗时=${encodeTime.toFixed(
                    1
                  )}s / 视频=${videoDuration.toFixed(1)}s)`
              );
            } catch (error) {
              console.error(
                `❌ 编码失败: 模式=baseline_crf, 编码器=${codec}, 实现=${implementation}, 分辨率=${height}p`
              );
              console.error(`   错误: ${error.message}`);
              if (error.signal) {
                console.error(`   信号: ${error.signal}`);
              }
              console.error("   跳过此配置，继续下一个...\n");
            }
          }
        }
      }
    } else if (mode === "per_scene") {
      runPerSceneFlow({ modeLabel: "per_scene", sourceFile: INPUT });
    } else if (mode === "ai_preprocess+per_scene") {
      const aiDir = join(rootWork, "ai_preprocess");
      ensureDir(aiDir);
      const enhancedInput = join(aiDir, `${baseName}_enhanced.mp4`);
      console.log(
        `=== 模式:ai_preprocess+per_scene -> 启动 AI 预处理 (模型=${aiPreprocessModel}) ===`
      );
      sh(
        `python3 ./ai_preprocess/preprocess_video.py --input "${INPUT}" --output "${enhancedInput}" --model ${aiPreprocessModel}`
      );
      runPerSceneFlow({
        modeLabel: "ai_preprocess+per_scene",
        sourceFile: enhancedInput,
      });
    } else {
      console.warn(`模式 ${mode} 尚未实现，已跳过。`);
    }
  }

  writeFileSync(summaryPath, JSON.stringify(summaryRows, null, 2), "utf8");
  console.log(`摘要结果已写入: ${summaryPath}`);
  onLog?.(`摘要结果已写入: ${summaryPath}`);

  return {
    inputFile: INPUT,
    summaryPath,
    summaryStreamPath,
    summaryRows,
    config: {
      ...mergedConfig,
      heightList,
      codecs,
      encoderImplementations,
      probeBitratesKbps,
      modes: modesToRun,
    },
  };
}

async function cliMain() {
  const inputArg = process.argv[2];
  const inputFile = inputArg ? resolve(inputArg) : await promptForInputFile();
  await runExperiment({ inputFile });
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  cliMain().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

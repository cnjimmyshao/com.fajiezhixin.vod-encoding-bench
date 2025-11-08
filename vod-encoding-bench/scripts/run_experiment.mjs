import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
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

/**
 * 执行 Shell 命令
 *
 * @param {string} cmd - 要执行的命令
 * @returns {string} 命令输出
 */
function sh(cmd) {
  return execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString("utf8");
}

/**
 * 检测系统是否支持 NVENC 硬件编码
 *
 * 检查两个条件：
 * 1. 系统是否有 NVIDIA GPU（通过 nvidia-smi 命令）
 * 2. FFmpeg 是否支持 NVENC 编码器（h264_nvenc, hevc_nvenc, av1_nvenc）
 *
 * @returns {{supported: boolean, hasGpu: boolean, encoders: string[]}} 检测结果
 *   - supported: 是否支持 NVENC（GPU 和编码器都可用）
 *   - hasGpu: 是否检测到 NVIDIA GPU
 *   - encoders: 可用的 NVENC 编码器列表
 */
function checkNvencSupport() {
  const result = {
    supported: false,
    hasGpu: false,
    encoders: [],
  };

  try {
    // 1. 检测 NVIDIA GPU
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
      return result; // GPU 不可用，直接返回
    }

    // 2. 检测 FFmpeg NVENC 编码器支持
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

    // 只要有任意一个 NVENC 编码器可用，就认为支持
    result.supported = result.hasGpu && result.encoders.length > 0;

    return result;
  } catch (error) {
    console.error("  ✗ NVENC 检测过程出错:", error.message);
    return result;
  }
}

/**
 * 计算视频文件的平均码率
 *
 * 通过文件大小和时长计算实际平均码率（kbps）。
 *
 * @param {string} file - 视频文件路径
 * @returns {number} 平均码率 (kbps)
 */
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

/**
 * 确保目录存在
 *
 * 递归创建目录（相当于 mkdir -p）。
 *
 * @param {string} path - 目录路径
 */
function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

/**
 * 清理标签字符串
 *
 * 将标签中的非字母数字字符替换为下划线，用于生成安全的文件名。
 *
 * @param {string} tag - 原始标签
 * @returns {string} 清理后的标签
 *
 * @example
 * sanitizeTag('ai_preprocess+per_scene') // 返回: 'ai_preprocess_per_scene'
 */
function sanitizeTag(tag) {
  return tag.replace(/[^a-zA-Z0-9_]+/g, "_");
}

/**
 * 提示用户选择输入视频源
 *
 * 交互式命令行界面，让用户选择：
 * 1. 使用本地视频文件
 * 2. 使用 FFmpeg 生成随机测试视频（30 秒）
 *
 * @returns {Promise<string>} 视频文件的绝对路径
 */
async function promptForInputFile() {
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

/**
 * 创建场景片段获取器（带缓存）
 *
 * 返回一个函数，该函数对视频进行场景检测并构建片段列表。
 * 使用 Map 缓存结果，避免对同一文件重复检测。
 *
 * @param {number} sceneThresh - 场景切换阈值 (0.0-1.0)
 * @returns {Function} 片段获取函数，接受 sourceFile 参数，返回片段数组
 *
 * @example
 * const fetchSegments = createSegmentFetcher(0.4);
 * const segments = fetchSegments('./video.mp4');
 * // 返回: [{start: 0, dur: 5.2, end: 5.2}, ...]
 */
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

/**
 * 检查编码器实现是否受支持
 *
 * 判断指定的编码器和实现方式组合是否可用。
 * NVENC 支持 H.264、H.265 和 AV1（需要 RTX 40 系列或更新的 GPU）
 * VP9 仅支持 CPU（NVENC 不支持 VP9）
 *
 * @param {string} codec - 编码器名称 (libx264, libx265, libvpx-vp9, libaom-av1)
 * @param {string} implementation - 实现方式 ('cpu' 或 'nvenc')
 * @returns {boolean} true 表示支持，false 表示不支持
 */
function isImplementationSupported(codec, implementation) {
  if (implementation === "cpu") {
    return true;
  }
  if (implementation === "nvenc") {
    // NVENC 支持 H.264、H.265 和 AV1
    return codec === "libx264" || codec === "libx265" || codec === "libaom-av1";
  }
  return false;
}

/**
 * 主实验流程
 *
 * 运行视频编码基准测试的完整流程：
 * 1. 获取输入视频（从命令行参数或交互提示）
 * 2. 加载实验配置（experiment_matrix.json）
 * 3. 检测 NVENC 支持并过滤不可用的实现
 * 4. 对每个模式/编码器/实现/分辨率组合执行：
 *    - 场景检测和片段构建
 *    - 自适应码率探测
 *    - 按场景编码
 *    - VMAF 质量评估
 * 5. 生成摘要结果 JSON
 *
 * 支持的模式：
 * - 'per_scene': 直接按场景编码
 * - 'ai_preprocess+per_scene': AI 预处理后按场景编码
 *
 * 结果保存到 results/<输入名称>_summary.json
 *
 * @throws {Error} 任何步骤失败时抛出错误并退出
 */
async function main() {
  const inputArg = process.argv[2];
  const INPUT = inputArg ? resolve(inputArg) : await promptForInputFile();

  const cfg = JSON.parse(
    readFileSync("./configs/experiment_matrix.json", "utf8")
  );
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
    aiPreprocessModel = "realesrgan_x4plus",
    baselineCrf = 23,
  } = cfg;

  // 检测 NVENC 支持
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
      `\n✓ NVENC 可用 (${
        nvencInfo.encoders.length
      } 个编码器: ${nvencInfo.encoders.join(", ")})`
    );
  }
  console.log("");

  const nvencSupported = nvencInfo.supported;

  const implementations = Array.isArray(encoderImplementations)
    ? encoderImplementations.filter(
        (impl) => impl === "cpu" || (impl === "nvenc" && nvencSupported)
      )
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
            // 使用自适应码率搜索，在片段之间传递历史信息
            // Use adaptive bitrate search with historical info between segments
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
                  previousSegmentResult: previousResult, // 传递上一个片段的结果
                  useAdaptiveSearch: true, // 启用自适应搜索
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

                // 保存当前结果供下一个片段使用
                // Save current result for next segment
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
                throw segError; // 重新抛出，让外层处理
              }
            }

            const { finalFile, finalVmaf, finalEncodeTime } = runPerSceneEncode(
              {
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
              }
            );

            const kbps = avgBitrateKbps(finalFile);
            const videoDuration = getDurationSeconds(sourceFile);
            const totalEncodeTime = totalProbeEncodeTime + finalEncodeTime;
            const encodingEfficiency = totalEncodeTime / videoDuration;

            summaryRows.push({
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
      // Baseline CRF 模式：固定 CRF 编码，无场景检测
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
              const { finalFile, finalVmaf, encodeTime } = runBaselineCrfEncode(
                {
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
                }
              );

              const kbps = avgBitrateKbps(finalFile);
              const videoDuration = getDurationSeconds(INPUT);
              const encodingEfficiency = encodeTime / videoDuration;

              summaryRows.push({
                mode: "baseline_crf",
                codec,
                height,
                implementation,
                crf: baselineCrf,
                targetVmaf: null, // CRF 模式不使用目标 VMAF
                finalVmaf,
                avgBitrateKbps: kbps,
                probeCount: 0, // 无探测
                finalEncodeCount: 1, // 单次编码
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

  const summaryPath = join("./results", `${baseName}_summary.json`);
  ensureDir("./results");
  writeFileSync(summaryPath, JSON.stringify(summaryRows, null, 2), "utf8");
  console.log(`摘要结果已写入: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

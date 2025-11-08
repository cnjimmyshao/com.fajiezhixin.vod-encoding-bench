import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
 * 解析编码器视频参数（内部使用，已废弃）
 *
 * 注意：此函数保留用于向后兼容，建议使用 encoder_config.mjs 的 getEncoderArgs()。
 *
 * @deprecated 请使用 encoder_config.mjs 的 getEncoderArgs()
 * @param {Object} params - 编码器参数
 * @param {string} params.codec - 编码器名称
 * @param {string} params.implementation - 实现方式 ('cpu' 或 'nvenc')
 * @param {number} params.bitrateKbps - 目标码率 (kbps)
 * @param {number} params.gopFrames - GOP 帧数
 * @returns {string|null} FFmpeg 参数字符串，不支持返回 null
 */
function resolveVideoArgs({ codec, implementation, bitrateKbps, gopFrames }) {
  if (implementation === "cpu") {
    if (codec === "libx265") {
      return (
        `-c:v libx265 -preset slow -b:v ${bitrateKbps}k ` +
        `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0 -bf 3`
      );
    }
    if (codec === "libsvtav1") {
      return (
        `-c:v libsvtav1 -cpu-used 4 -b:v ${bitrateKbps}k ` +
        `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0`
      );
    }
    if (codec === "libvpx-vp9") {
      return (
        `-c:v libvpx-vp9 -b:v ${bitrateKbps}k -deadline good -cpu-used 1 ` +
        `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0`
      );
    }
    if (codec === "libx264") {
      return (
        `-c:v libx264 -preset slow -b:v ${bitrateKbps}k ` +
        `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0 -bf 3`
      );
    }
    return null;
  }

  if (implementation === "nvenc") {
    const maxrate = Math.round(bitrateKbps * 1.2);
    const bufsize = Math.round(bitrateKbps * 2.5);
    if (codec === "libx264") {
      return (
        `-c:v h264_nvenc -preset p5 -rc vbr_hq -b:v ${bitrateKbps}k ` +
        `-maxrate ${maxrate}k -bufsize ${bufsize}k -pix_fmt yuv420p ` +
        `-g ${gopFrames} -bf 3`
      );
    }
    if (codec === "libx265") {
      return (
        `-c:v hevc_nvenc -preset p5 -rc vbr_hq -b:v ${bitrateKbps}k ` +
        `-maxrate ${maxrate}k -bufsize ${bufsize}k -pix_fmt yuv420p ` +
        `-g ${gopFrames} -bf 3`
      );
    }
    return null;
  }

  return null;
}

/**
 * 导出最终编码的视频片段
 *
 * 使用指定的编码器、码率和参数编码视频片段并保存到文件。
 * 包含音频编码和 MP4 快速启动优化。
 *
 * @param {Object} params - 编码参数
 * @param {string} params.inputFile - 输入视频文件路径
 * @param {number} params.start - 片段起始时间（秒）
 * @param {number} params.dur - 片段持续时间（秒）
 * @param {number} params.height - 目标视频高度（像素）
 * @param {string} params.codec - 编码器名称 (libx264, libx265, libvpx-vp9, libsvtav1)
 * @param {string} params.implementation - 实现方式 ('cpu' 或 'nvenc')
 * @param {number} params.bitrateKbps - 目标码率 (kbps)
 * @param {number} params.gopSec - GOP 时长（秒）
 * @param {number} params.audioKbps - 音频码率 (kbps)
 * @param {string} params.outPath - 输出文件路径
 * @returns {number} 编码时间（秒）
 * @throws {Error} 不支持的编码器/实现组合时抛出错误
 */
function exportFinalSegment({
  inputFile,
  start,
  dur,
  height,
  codec,
  implementation,
  bitrateKbps,
  gopSec,
  audioKbps,
  outPath,
}) {
  const gopFrames = Math.max(1, Math.round(gopSec * 30));
  const videoArgs = resolveVideoArgs({
    codec,
    implementation,
    bitrateKbps,
    gopFrames,
  });
  if (!videoArgs) {
    throw new Error(
      `暂不支持的编码器实现: codec=${codec} implementation=${implementation}\n` +
        `Unsupported codec implementation: codec=${codec} implementation=${implementation}`
    );
  }

  const startTime = Date.now();
  sh(
    `ffmpeg -y -hide_banner -ss ${start} -t ${dur} -i "${inputFile}" ` +
      `-vf "scale=-2:${height}" ` +
      `${videoArgs} ` +
      `-c:a aac -b:a ${audioKbps}k ` +
      `-movflags +faststart "${outPath}"`
  );
  const endTime = Date.now();
  return (endTime - startTime) / 1000;
}

/**
 * 拼接多个视频片段为单个文件
 *
 * 使用 FFmpeg concat demuxer 无损拼接视频片段（-c copy），保持原始编码。
 * 自动创建临时文件列表并处理特殊字符转义。
 *
 * @param {string[]} segFiles - 片段文件路径数组
 * @param {string} finalFile - 输出文件路径
 */
function concatSegmentsToFile(segFiles, finalFile) {
  const listPath = finalFile + ".txt";
  const listContent = segFiles
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
    .join("\n");
  writeFileSync(listPath, listContent, "utf8");

  sh(
    `ffmpeg -hide_banner -f concat -safe 0 -i "${listPath}" ` +
      `-c copy -movflags +faststart "${finalFile}"`
  );
}

/**
 * 生成高质量参考视频（整片）
 *
 * 使用 libx264 和 CRF 10 编码生成接近无损的参考视频，用于最终 VMAF 评估。
 *
 * @param {string} inputFile - 输入视频文件路径
 * @param {number} height - 目标视频高度（像素）
 * @param {string} refFile - 输出参考文件路径
 */
function makeReferenceWhole(inputFile, height, refFile) {
  sh(
    `ffmpeg -y -hide_banner -i "${inputFile}" ` +
      `-vf "scale=-2:${height}" ` +
      `-c:v libx264 -preset veryslow -crf 10 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 192k "${refFile}"`
  );
}

/**
 * 测量最终视频的 VMAF 分数
 *
 * 使用 FFmpeg libvmaf 过滤器计算编码后整片视频相对于参考视频的 VMAF 分数。
 * 自动兼容 FFmpeg 8.0+ 和旧版本的模型参数格式。
 *
 * @param {Object} params - VMAF 测量参数
 * @param {string} params.finalFile - 编码后的视频文件路径
 * @param {string} params.referenceFile - 参考视频文件路径
 * @param {string} params.vmafModel - VMAF 模型文件或版本名称
 * @param {string} params.outJson - 输出 JSON 结果文件路径
 * @returns {number} VMAF 平均分数 (0-100)
 */
function measureFinalVmaf({ finalFile, referenceFile, vmafModel, outJson }) {
  // FFmpeg 8.0+ uses 'model' instead of 'model_path'
  let modelArg = "";
  if (vmafModel) {
    if (vmafModel.includes("/") || vmafModel.includes("\\")) {
      modelArg = `model=path='${vmafModel}':`;
    } else if (vmafModel.includes("vmaf_v")) {
      const versionMatch = vmafModel.match(/(vmaf_v\d+\.\d+\.\d+)/);
      if (versionMatch) {
        modelArg = `model=version=${versionMatch[1]}:`;
      }
    }
  }

  sh(
    `ffmpeg -hide_banner -r 30 -i "${finalFile}" -r 30 -i "${referenceFile}" ` +
      `-lavfi "[0:v][1:v]libvmaf=${modelArg}log_fmt=json:log_path='${outJson}'" ` +
      `-f null -`
  );
  const obj = JSON.parse(readFileSync(outJson, "utf8"));
  // Support multiple libvmaf JSON formats
  const score =
    obj.pooled_metrics?.vmaf?.mean ||
    obj.global_metrics?.vmaf ||
    obj.aggregate?.VMAF_score ||
    obj.VMAF_score ||
    0;
  return score;
}

/**
 * 运行按场景编码的完整工作流
 *
 * 执行按场景编码的完整流程：
 * 1. 根据片段计划编码每个片段（使用已探测的最优码率）
 * 2. 拼接所有片段为完整视频
 * 3. 生成高质量参考视频
 * 4. 计算整片 VMAF 质量分数
 *
 * 这是按场景编码策略的核心执行函数，每个片段使用独立的最优码率编码。
 *
 * @param {Object} params - 编码流程参数
 * @param {string} params.inputFile - 输入视频文件路径
 * @param {number} params.height - 目标视频高度（像素）
 * @param {string} params.codec - 编码器名称 (libx264, libx265, libvpx-vp9, libsvtav1)
 * @param {string} params.implementation - 实现方式 ('cpu' 或 'nvenc')
 * @param {Array<{start: number, dur: number, chosenBitrateKbps: number, estVmaf: number}>} params.segmentPlan
 *        片段计划数组，每个片段包含：
 *        - start: 起始时间（秒）
 *        - dur: 持续时间（秒）
 *        - chosenBitrateKbps: 最优码率 (kbps)
 *        - estVmaf: 预估 VMAF 分数
 * @param {number} params.gopSec - GOP 时长（秒）
 * @param {number} params.audioKbps - 音频码率 (kbps)
 * @param {string} params.workdir - 工作目录路径
 * @param {string} params.vmafModel - VMAF 模型文件或版本名称
 * @param {string} [params.modeTag="perScene"] - 模式标签，用于文件命名
 * @returns {{finalFile: string, finalVmaf: number}} 结果对象
 *          - finalFile: 最终视频文件路径
 *          - finalVmaf: 整片 VMAF 分数
 *
 * @example
 * const result = runPerSceneEncode({
 *   inputFile: './video.mp4',
 *   height: 1080,
 *   codec: 'libx264',
 *   implementation: 'cpu',
 *   segmentPlan: [
 *     { start: 0, dur: 5.2, chosenBitrateKbps: 2500, estVmaf: 95.1 },
 *     { start: 5.2, dur: 7.3, chosenBitrateKbps: 3200, estVmaf: 95.4 }
 *   ],
 *   gopSec: 2,
 *   audioKbps: 128,
 *   workdir: './workdir/test',
 *   vmafModel: 'vmaf_v0.6.1.json',
 *   modeTag: 'per_scene'
 * });
 * // 返回: { finalFile: './workdir/test/final_libx264_cpu_per_scene.mp4', finalVmaf: 95.234 }
 */
export function runPerSceneEncode({
  inputFile,
  height,
  codec,
  implementation,
  segmentPlan, // [{start, dur, chosenBitrateKbps, estVmaf, implementation}, ...]
  gopSec,
  audioKbps,
  workdir,
  vmafModel,
  modeTag = "perScene",
}) {
  const safeTag = modeTag.replace(/[^a-zA-Z0-9_]+/g, "_");
  mkdirSync(workdir, { recursive: true });
  const segDir = join(workdir, `${safeTag}_segments_${implementation}`);
  const repDir = join(workdir, "report");
  const finalOut = join(
    workdir,
    `final_${codec}_${implementation}_${safeTag}.mp4`
  );
  const refOut = join(
    workdir,
    `ref_full_${height}p_${implementation}_${safeTag}.mp4`
  );
  const vmafJson = join(
    repDir,
    `final_vmaf_${codec}_${implementation}_${safeTag}.json`
  );

  mkdirSync(segDir, { recursive: true });
  mkdirSync(repDir, { recursive: true });

  // 输出每个片段
  // Export each segment
  const segFiles = [];
  let totalFinalEncodeTime = 0;
  segmentPlan.forEach((seg, idx) => {
    const outPath = join(segDir, `seg_${String(idx).padStart(4, "0")}.mp4`);
    const encodeTime = exportFinalSegment({
      inputFile,
      start: seg.start,
      dur: seg.dur,
      height,
      codec,
      implementation,
      bitrateKbps: seg.chosenBitrateKbps,
      gopSec,
      audioKbps,
      outPath,
    });
    totalFinalEncodeTime += encodeTime;
    segFiles.push(outPath);
  });

  // 拼接生成整片
  // Concatenate into the full video
  concatSegmentsToFile(segFiles, finalOut);

  // 生成高质量参考整片
  // Produce a high-quality reference encode
  makeReferenceWhole(inputFile, height, refOut);

  // 计算整片 VMAF
  // Measure full-video VMAF
  const wholeVmaf = measureFinalVmaf({
    finalFile: finalOut,
    referenceFile: refOut,
    vmafModel,
    outJson: vmafJson,
  });

  return {
    finalFile: finalOut,
    finalVmaf: wholeVmaf,
    finalEncodeTime: totalFinalEncodeTime,
  };
}

/**
 * Baseline CRF 编码模块
 * Baseline CRF Encoding Module
 *
 * 使用固定 CRF 值进行编码，无场景检测，无码率探测
 * Use fixed CRF value for encoding, no scene detection, no bitrate probing
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 执行 Shell 命令并测量执行时间
 *
 * @param {string} cmd - 要执行的命令
 * @returns {{output: string, timeSeconds: number}} 命令输出和执行时间（秒）
 */
function sh(cmd) {
  const startTime = Date.now();
  const output = execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString(
    "utf8"
  );
  const endTime = Date.now();
  const timeSeconds = (endTime - startTime) / 1000;
  return { output, timeSeconds };
}

/**
 * 获取 CRF 编码器参数
 *
 * @param {string} codec - 编码器名称
 * @param {string} implementation - 实现方式 ('cpu' 或 'nvenc')
 * @param {number} crf - CRF 值
 * @param {number} gopFrames - GOP 帧数
 * @returns {string|null} FFmpeg 参数字符串
 */
function getCrfEncoderArgs(codec, implementation, crf, gopFrames) {
  const commonArgs = `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0`;

  if (implementation === "cpu") {
    switch (codec) {
      case "libx264":
        return `-c:v libx264 -preset slow -crf ${crf} ${commonArgs} -bf 3`;
      case "libx265":
        return `-c:v libx265 -preset slow -crf ${crf} ${commonArgs} -bf 3`;
      case "libvpx-vp9":
        return `-c:v libvpx-vp9 -crf ${crf} -b:v 0 -deadline good -cpu-used 1 ${commonArgs}`;
      case "libsvtav1":
        return `-c:v libsvtav1 -crf ${crf} -b:v 0 -cpu-used 4 ${commonArgs}`;
      default:
        return null;
    }
  }

  if (implementation === "nvenc") {
    // NVENC 使用 CQ 模式（类似 CRF）
    switch (codec) {
      case "libx264":
        return `-c:v h264_nvenc -preset slow -cq ${crf} ${commonArgs.replace(
          "-sc_threshold 0",
          ""
        )} -bf 3`;
      case "libx265":
        return `-c:v hevc_nvenc -preset slow -cq ${crf} ${commonArgs.replace(
          "-sc_threshold 0",
          ""
        )} -bf 3`;
      case "libaom-av1":
        // AV1 NVENC 需要 RTX 40 系列或更新的 GPU
        // 使用 p5 预设（较快速度）
        return `-c:v av1_nvenc -preset p5 -cq ${crf} ${commonArgs.replace(
          "-sc_threshold 0",
          ""
        )} -bf 3`;
      default:
        return null;
    }
  }

  return null;
}

/**
 * 生成高质量参考视频（整片）
 *
 * @param {string} inputFile - 输入视频文件路径
 * @param {number} height - 目标视频高度（像素）
 * @param {string} refFile - 输出参考文件路径
 * @returns {number} 编码时间（秒）
 */
function makeReferenceWhole(inputFile, height, refFile) {
  const { timeSeconds } = sh(
    `ffmpeg -y -hide_banner -i "${inputFile}" ` +
      `-vf "scale=-2:${height}" ` +
      `-c:v libx264 -preset veryslow -crf 10 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 192k "${refFile}"`
  );
  return timeSeconds;
}

/**
 * 测量最终视频的 VMAF 分数
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
 * 运行 Baseline CRF 编码
 *
 * 使用固定 CRF 值对整个视频进行单次编码，无场景检测，无码率探测。
 * 这是最简单的编码策略，适合快速编码和基准对比。
 *
 * @param {Object} params - 编码参数
 * @param {string} params.inputFile - 输入视频文件路径
 * @param {number} params.height - 目标视频高度（像素）
 * @param {string} params.codec - 编码器名称 (libx264, libx265, libvpx-vp9, libsvtav1)
 * @param {string} params.implementation - 实现方式 ('cpu' 或 'nvenc')
 * @param {number} params.crf - CRF 值 (0-51，通常 18-28，越低质量越高)
 * @param {number} params.gopSec - GOP 时长（秒）
 * @param {number} params.audioKbps - 音频码率 (kbps)
 * @param {string} params.workdir - 工作目录路径
 * @param {string} params.vmafModel - VMAF 模型文件或版本名称
 * @param {string} [params.modeTag="baseline_crf"] - 模式标签，用于文件命名
 * @returns {{finalFile: string, finalVmaf: number, encodeTime: number}} 结果对象
 *          - finalFile: 最终视频文件路径
 *          - finalVmaf: 整片 VMAF 分数
 *          - encodeTime: 编码时间（秒）
 *
 * @example
 * const result = runBaselineCrfEncode({
 *   inputFile: './video.mp4',
 *   height: 1080,
 *   codec: 'libx264',
 *   implementation: 'cpu',
 *   crf: 23,
 *   gopSec: 2,
 *   audioKbps: 128,
 *   workdir: './workdir/test',
 *   vmafModel: 'vmaf_v0.6.1.json'
 * });
 * // 返回: { finalFile: '...mp4', finalVmaf: 94.5, encodeTime: 45.2 }
 */
export function runBaselineCrfEncode({
  inputFile,
  height,
  codec,
  implementation,
  crf,
  gopSec,
  audioKbps,
  workdir,
  vmafModel,
  modeTag = "baseline_crf",
}) {
  const safeTag = modeTag.replace(/[^a-zA-Z0-9_]+/g, "_");
  mkdirSync(workdir, { recursive: true });
  const repDir = join(workdir, "report");
  mkdirSync(repDir, { recursive: true });

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

  const gopFrames = Math.max(1, Math.round(gopSec * 30));
  const videoArgs = getCrfEncoderArgs(codec, implementation, crf, gopFrames);

  if (!videoArgs) {
    throw new Error(
      `暂不支持的编码器实现: codec=${codec} implementation=${implementation}`
    );
  }

  // 单次 CRF 编码
  const { timeSeconds: encodeTime } = sh(
    `ffmpeg -y -hide_banner -i "${inputFile}" ` +
      `-vf "scale=-2:${height}" ` +
      `${videoArgs} ` +
      `-c:a aac -b:a ${audioKbps}k -movflags +faststart "${finalOut}"`
  );

  // 生成高质量参考
  makeReferenceWhole(inputFile, height, refOut);

  // 计算 VMAF
  const wholeVmaf = measureFinalVmaf({
    finalFile: finalOut,
    referenceFile: refOut,
    vmafModel,
    outJson: vmafJson,
  });

  return {
    finalFile: finalOut,
    finalVmaf: wholeVmaf,
    encodeTime,
  };
}

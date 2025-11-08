/**
 * 编码器配置模块
 * Encoder Configuration Module
 *
 * 管理不同编码器的参数配置
 * Manage parameter configurations for different encoders
 */

import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * 执行 Shell 命令并测量执行时间（带重试）
 *
 * @param {string} cmd - 要执行的命令
 * @param {number} maxRetries - 最大重试次数
 * @returns {{output: string, timeSeconds: number}} 命令输出和执行时间（秒）
 */
function sh(cmd, maxRetries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const startTime = Date.now();
      const output = execSync(cmd, {
        stdio: "pipe",
        shell: "/bin/bash",
        timeout: 300000, // 5分钟超时
      }).toString("utf8");
      const endTime = Date.now();
      const timeSeconds = (endTime - startTime) / 1000;
      return { output, timeSeconds };
    } catch (error) {
      lastError = error;

      // 如果是 SIGSEGV 或其他严重错误，等待后重试
      if (error.signal === "SIGSEGV" || error.signal === "SIGABRT") {
        if (attempt < maxRetries) {
          console.warn(
            `    ⚠️  FFmpeg 崩溃 (${error.signal})，正在重试 (${
              attempt + 1
            }/${maxRetries})...`
          );
          // 等待一小段时间后重试
          execSync("sleep 0.5", { stdio: "pipe" });
          continue;
        }
      }

      // 其他错误或最后一次重试失败，直接抛出
      throw error;
    }
  }

  throw lastError;
}

/**
 * 编码高质量参考视频片段
 *
 * 使用 libx264 编码器和 CRF 10 生成接近无损的参考视频，用于 VMAF 质量对比。
 * 参考片段质量极高，作为质量评估的基准。
 *
 * @param {Object} params - 编码参数
 * @param {string} params.inputFile - 输入视频文件路径
 * @param {number} params.start - 片段起始时间（秒）
 * @param {number} params.dur - 片段持续时间（秒）
 * @param {number} params.height - 目标视频高度（像素）
 * @param {string} params.tmpDir - 临时文件目录路径
 * @returns {string} 参考视频文件路径
 *
 * @example
 * const refFile = encodeReference({
 *   inputFile: './video.mp4',
 *   start: 0,
 *   dur: 8,
 *   height: 1080,
 *   tmpDir: './tmp'
 * });
 * // 返回: './tmp/ref_0p000.mp4'
 */
export function encodeReference({ inputFile, start, dur, height, tmpDir }) {
  const refOut = join(tmpDir, `ref_${start.toFixed(3).replace(".", "p")}.mp4`);
  const { timeSeconds } = sh(
    `ffmpeg -y -hide_banner -ss ${start} -t ${dur} -i "${inputFile}" ` +
      `-vf "scale=-2:${height}" ` +
      `-c:v libx264 -preset veryslow -crf 10 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 192k "${refOut}"`
  );
  return { file: refOut, encodeTime: timeSeconds };
}

/**
 * 获取指定编码器的 FFmpeg 视频参数
 *
 * 根据编码器类型和实现方式（CPU/NVENC）生成对应的 FFmpeg 命令行参数。
 * 支持多种编码器：H.264、H.265、VP9、AV1 的 CPU 和 NVENC 实现。
 *
 * @param {Object} params - 编码器配置参数
 * @param {string} params.codec - 编码器名称 (libx264, libx265, libvpx-vp9, libsvtav1)
 * @param {string} params.implementation - 实现方式 ('cpu' 或 'nvenc')
 * @param {number} params.bitrateKbps - 目标码率 (kbps)
 * @param {number} params.gopFrames - GOP 帧数
 * @returns {string|null} FFmpeg 视频参数字符串，不支持的组合返回 null
 *
 * @example
 * const args = getEncoderArgs({
 *   codec: 'libx264',
 *   implementation: 'cpu',
 *   bitrateKbps: 2500,
 *   gopFrames: 60
 * });
 * // 返回: "-c:v libx264 -preset slow -b:v 2500k -pix_fmt yuv420p -g 60 ..."
 */
export function getEncoderArgs({
  codec,
  implementation,
  bitrateKbps,
  gopFrames,
}) {
  if (implementation === "cpu") {
    return getCpuEncoderArgs(codec, bitrateKbps, gopFrames);
  }

  if (implementation === "nvenc") {
    return getNvencEncoderArgs(codec, bitrateKbps, gopFrames);
  }

  return null;
}

/**
 * 获取 CPU 软件编码器的参数
 *
 * 为 CPU 软件编码器生成优化的 FFmpeg 参数，支持 H.264、H.265、VP9、AV1。
 *
 * @param {string} codec - 编码器名称
 * @param {number} bitrateKbps - 目标码率 (kbps)
 * @param {number} gopFrames - GOP 帧数
 * @returns {string|null} FFmpeg 参数字符串，不支持的编码器返回 null
 */
function getCpuEncoderArgs(codec, bitrateKbps, gopFrames) {
  const commonArgs = `-pix_fmt yuv420p -g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0`;

  switch (codec) {
    case "libx264":
      return `-c:v libx264 -preset slow -b:v ${bitrateKbps}k ${commonArgs} -bf 3`;

    case "libx265":
      return `-c:v libx265 -preset slow -b:v ${bitrateKbps}k ${commonArgs} -bf 3`;

    case "libvpx-vp9":
      return `-c:v libvpx-vp9 -b:v ${bitrateKbps}k -deadline good -cpu-used 1 ${commonArgs}`;

    case "libsvtav1":
      return `-c:v libsvtav1 -cpu-used 4 -b:v ${bitrateKbps}k ${commonArgs}`;

    default:
      return null;
  }
}

/**
 * 获取 NVENC 硬件编码器的参数
 *
 * 为 NVIDIA NVENC 硬件编码器生成 FFmpeg 参数。
 * 支持 H.264 (h264_nvenc)、H.265 (hevc_nvenc) 和 AV1 (av1_nvenc)。
 * 注意：VP9 不支持 NVENC；AV1 NVENC 需要 RTX 40 系列或更新的 GPU。
 *
 * @param {string} codec - 编码器名称 (libx264, libx265, libaom-av1)
 * @param {number} bitrateKbps - 目标码率 (kbps)
 * @param {number} gopFrames - GOP 帧数
 * @returns {string|null} FFmpeg 参数字符串，不支持的编码器返回 null
 */
function getNvencEncoderArgs(codec, bitrateKbps, gopFrames) {
  const maxrate = Math.round(bitrateKbps * 1.2);
  const bufsize = Math.round(bitrateKbps * 2.5);
  const commonArgs = `-pix_fmt yuv420p -g ${gopFrames} -bf 3`;

  switch (codec) {
    case "libx264":
      return `-c:v h264_nvenc -preset slow -b:v ${bitrateKbps}k -maxrate ${maxrate}k -bufsize ${bufsize}k ${commonArgs}`;

    case "libx265":
      return `-c:v hevc_nvenc -preset slow -b:v ${bitrateKbps}k -maxrate ${maxrate}k -bufsize ${bufsize}k ${commonArgs}`;

    case "libaom-av1":
      // AV1 NVENC 需要 RTX 40 系列或更新的 GPU
      // 使用 p5 预设（较快速度）而非 slow（NVENC 预设不同于 CPU）
      return `-c:v av1_nvenc -preset p5 -b:v ${bitrateKbps}k -maxrate ${maxrate}k -bufsize ${bufsize}k ${commonArgs}`;

    default:
      return null; // VP9 不支持 NVENC
  }
}

/**
 * 编码测试视频片段
 *
 * 使用指定的编码器、码率和参数编码视频片段，用于码率探测或最终输出。
 * 自动计算 GOP 帧数，添加音频编码，并优化输出文件。
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
 * @param {string} params.tmpDir - 临时文件目录路径
 * @returns {{file: string, encodeTime: number}} 编码后的视频文件路径和编码时间（秒）
 * @throws {Error} 不支持的编码器/实现组合时抛出错误
 *
 * @example
 * const result = encodeSegment({
 *   inputFile: './video.mp4',
 *   start: 0,
 *   dur: 8,
 *   height: 1080,
 *   codec: 'libx264',
 *   implementation: 'cpu',
 *   bitrateKbps: 2500,
 *   gopSec: 2,
 *   audioKbps: 128,
 *   tmpDir: './tmp'
 * });
 * // result: { file: './tmp/...mp4', encodeTime: 12.5 }
 */
export function encodeSegment({
  inputFile,
  start,
  dur,
  height,
  codec,
  implementation,
  bitrateKbps,
  gopSec,
  audioKbps,
  tmpDir,
}) {
  const gopFrames = Math.max(1, Math.round(gopSec * 30));
  const outFile = join(
    tmpDir,
    `cand_${start
      .toFixed(3)
      .replace(".", "p")}_${bitrateKbps}k_${codec}_${implementation}.mp4`
  );

  const videoArgs = getEncoderArgs({
    codec,
    implementation,
    bitrateKbps,
    gopFrames,
  });
  if (!videoArgs) {
    throw new Error(
      `Unsupported codec/implementation: ${codec}/${implementation}`
    );
  }

  const { timeSeconds } = sh(
    `ffmpeg -y -hide_banner -ss ${start} -t ${dur} -i "${inputFile}" ` +
      `-vf "scale=-2:${height}" ` +
      `${videoArgs} ` +
      `-c:a aac -b:a ${audioKbps}k -movflags +faststart "${outFile}"`
  );

  return { file: outFile, encodeTime: timeSeconds };
}

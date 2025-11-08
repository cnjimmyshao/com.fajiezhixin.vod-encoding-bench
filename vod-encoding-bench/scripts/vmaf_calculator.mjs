/**
 * VMAF 评估模块
 * VMAF Evaluation Module
 *
 * 处理 VMAF 质量评估
 * Handle VMAF quality evaluation
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
 * 测量两个视频之间的 VMAF 质量分数
 *
 * 使用 FFmpeg 的 libvmaf 过滤器比较失真视频和参考视频，返回 VMAF 质量分数。
 * 支持 FFmpeg 8.0+ 的新模型参数格式和旧版本的兼容性。
 *
 * @param {Object} params - 测量参数
 * @param {string} params.distortedFile - 待测视频文件路径（已编码的视频）
 * @param {string} params.referenceFile - 参考视频文件路径（高质量参考）
 * @param {string} params.vmafModel - VMAF 模型文件路径或版本名称（如 "vmaf_v0.6.1.json"）
 * @param {string} params.tmpDir - 临时文件目录路径（用于存储 VMAF JSON 输出）
 * @returns {number} VMAF 分数（0-100，越高表示质量越好，95+ 表示优秀质量）
 *
 * @example
 * const score = measureVmaf({
 *   distortedFile: './encoded.mp4',
 *   referenceFile: './reference.mp4',
 *   vmafModel: 'vmaf_v0.6.1.json',
 *   tmpDir: './tmp'
 * });
 * console.log(`VMAF Score: ${score}`); // 输出: VMAF Score: 95.23
 */
export function measureVmaf({
  distortedFile,
  referenceFile,
  vmafModel,
  tmpDir,
}) {
  const vmafLog = join(
    tmpDir,
    `vmaf_${Date.now()}_${Math.random().toString(36).slice(2)}.json`
  );

  // FFmpeg 8.0+ 使用 'model' 而不是 'model_path'
  // FFmpeg 8.0+ uses 'model' instead of 'model_path'
  const modelArg = buildModelArg(vmafModel);

  sh(
    `ffmpeg -hide_banner -r 30 -i "${distortedFile}" -r 30 -i "${referenceFile}" ` +
      `-lavfi "[0:v][1:v]libvmaf=${modelArg}log_fmt=json:log_path='${vmafLog}'" ` +
      `-f null -`
  );

  return parseVmafScore(vmafLog);
}

/**
 * 构建 FFmpeg libvmaf 过滤器的模型参数
 *
 * 根据 VMAF 模型文件路径或名称，生成适合不同 FFmpeg 版本的模型参数字符串。
 * - FFmpeg 8.0+: 使用 `model=version=` 或 `model=path=`
 * - 旧版本: 使用 `model_path=`（已弃用）
 *
 * @param {string} vmafModel - VMAF 模型文件名或路径
 * @returns {string} FFmpeg 模型参数字符串（带冒号结尾）
 *
 * @example
 * buildModelArg('vmaf_v0.6.1.json') // 返回: "model=version=vmaf_v0.6.1:"
 * buildModelArg('/path/to/model.json') // 返回: "model=path='/path/to/model.json':"
 */
function buildModelArg(vmafModel) {
  if (!vmafModel) return "";

  // 检查是否是完整路径
  // Check if it's a full path
  if (vmafModel.includes("/") || vmafModel.includes("\\")) {
    return `model=path='${vmafModel}':`;
  }

  // 提取版本号，如 "vmaf_v0.6.1" from "vmaf_v0.6.1.json"
  // Extract version like "vmaf_v0.6.1" from "vmaf_v0.6.1.json"
  if (vmafModel.includes("vmaf_v")) {
    const versionMatch = vmafModel.match(/(vmaf_v\d+\.\d+\.\d+)/);
    if (versionMatch) {
      return `model=version=${versionMatch[1]}:`;
    }
  }

  return "";
}

/**
 * 解析 VMAF JSON 日志文件，提取 VMAF 分数
 *
 * 支持多种 FFmpeg 版本的 libvmaf JSON 输出格式：
 * - FFmpeg 8.0+: pooled_metrics.vmaf.mean
 * - 旧版本: global_metrics.vmaf, aggregate.VMAF_score, VMAF_score
 *
 * @param {string} vmafLogPath - VMAF JSON 日志文件路径
 * @returns {number} VMAF 分数（如果所有格式都不匹配则返回 0）
 */
function parseVmafScore(vmafLogPath) {
  const obj = JSON.parse(readFileSync(vmafLogPath, "utf8"));

  // 支持多种 libvmaf JSON 格式
  // Support multiple libvmaf JSON formats:
  // - FFmpeg 8.0+: pooled_metrics.vmaf.mean
  // - Older versions: global_metrics.vmaf, aggregate.VMAF_score, VMAF_score
  const score =
    obj.pooled_metrics?.vmaf?.mean ||
    obj.global_metrics?.vmaf ||
    obj.aggregate?.VMAF_score ||
    obj.VMAF_score ||
    0;

  return score;
}

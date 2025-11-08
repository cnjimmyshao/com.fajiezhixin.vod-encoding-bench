import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * 计算视频质量 VMAF 分数
 *
 * 使用 FFmpeg libvmaf 过滤器计算失真视频相对于参考视频的 VMAF 质量分数。
 * VMAF (Video Multimethod Assessment Fusion) 是 Netflix 开发的感知视频质量评估指标，
 * 分数范围 0-100，越高表示质量越好，95+ 表示接近无损。
 *
 * 自动兼容 FFmpeg 8.0+ 的新 model 参数格式和旧版本的 model_path 格式。
 *
 * @param {string} distFile - 失真视频文件路径（待评估的编码视频）
 * @param {string} refFile - 参考视频文件路径（高质量基准视频）
 * @param {string} vmafModel - VMAF 模型文件路径或版本名称
 *                             例如: 'vmaf_v0.6.1.json' 或 '/path/to/model.json'
 * @param {string} outJson - 输出 JSON 结果文件路径
 * @returns {number} VMAF 平均分数 (0-100)
 * @throws {Error} FFmpeg 执行失败时抛出错误
 *
 * @example
 * const vmaf = computeVmaf(
 *   './encoded.mp4',      // 编码后的视频
 *   './reference.mp4',    // 参考视频
 *   'vmaf_v0.6.1.json',   // 模型版本
 *   './vmaf_result.json'  // 结果输出
 * );
 * // 返回: 95.234 （表示质量得分 95.234）
 */
export function computeVmaf(distFile, refFile, vmafModel, outJson) {
  // FFmpeg 8.0+ uses 'model' instead of 'model_path'
  // If vmafModel is a simple name like "vmaf_v0.6.1.json", extract the version
  let modelArg = "";
  if (vmafModel) {
    // Check if it's a full path or just a model name
    if (vmafModel.includes("/") || vmafModel.includes("\\")) {
      // Full path - use path option
      modelArg = `model=path='${vmafModel}':`;
    } else if (vmafModel.includes("vmaf_v")) {
      // Extract version like "vmaf_v0.6.1" from "vmaf_v0.6.1.json" or "vmaf_v0.6.1"
      const versionMatch = vmafModel.match(/(vmaf_v\d+\.\d+\.\d+)/);
      if (versionMatch) {
        modelArg = `model=version=${versionMatch[1]}:`;
      }
    }
  }

  execSync(
    `ffmpeg -hide_banner -r 30 -i "${distFile}" -r 30 -i "${refFile}" ` +
      `-lavfi "[0:v][1:v]libvmaf=${modelArg}log_fmt=json:log_path='${outJson}'" ` +
      `-f null -`,
    { stdio: "pipe", shell: "/bin/bash" }
  );
  const obj = JSON.parse(readFileSync(outJson, "utf8"));
  // Support multiple libvmaf JSON formats across versions:
  // - FFmpeg 8.0+: pooled_metrics.vmaf.mean
  // - Older versions: global_metrics.vmaf, aggregate.VMAF_score, VMAF_score
  const score =
    (obj.pooled_metrics &&
      obj.pooled_metrics.vmaf &&
      obj.pooled_metrics.vmaf.mean) ||
    (obj.global_metrics && obj.global_metrics.vmaf) ||
    (obj.aggregate && obj.aggregate.VMAF_score) ||
    obj.VMAF_score ||
    0;
  return score;
}

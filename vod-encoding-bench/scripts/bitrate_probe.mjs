/**
 * 码率探测协调器
 * Bitrate Probe Coordinator
 *
 * 使用模块化组件进行码率探测
 * Use modular components for bitrate probing
 */

import {
  getBitrateStrategy,
  adjustSearchRange,
} from "./resolution_strategy.mjs";
import { encodeReference, encodeSegment } from "./encoder_config.mjs";
import { measureVmaf } from "./vmaf_calculator.mjs";

/**
 * 自适应二分搜索算法寻找最优码率
 *
 * 使用二分搜索 + 历史参考优化，通常只需 3-5 次探测即可找到满足目标 VMAF 的最低码率
 *
 * @param {Object} params - 搜索参数
 * @param {string} params.inputFile - 输入视频文件路径
 * @param {number} params.start - 片段起始时间（秒）
 * @param {number} params.dur - 片段持续时间（秒）
 * @param {number} params.height - 目标视频高度（像素）
 * @param {string} params.codec - 编码器名称 (libx264, libx265, libvpx-vp9, libsvtav1)
 * @param {string} params.implementation - 编码器实现方式 (cpu 或 nvenc)
 * @param {number} params.gopSec - GOP 时长（秒）
 * @param {number} params.audioKbps - 音频码率 (kbps)
 * @param {string} params.tmpDir - 临时文件目录路径
 * @param {string} params.vmafModel - VMAF 模型文件路径或版本
 * @param {number} params.targetVmaf - 目标 VMAF 分数
 * @param {Object|null} params.previousSegmentResult - 上一个片段的探测结果，用于优化搜索范围
 * @returns {Object} 探测结果
 * @returns {number} return.chosenBitrateKbps - 选定的码率 (kbps)
 * @returns {number} return.estVmaf - 估算的 VMAF 分数
 * @returns {number} return.start - 片段起始时间
 * @returns {number} return.dur - 片段持续时间
 * @returns {string} return.implementation - 使用的编码器实现
 * @returns {number} return.probesUsed - 实际使用的探测次数
 */
function adaptiveBitrateSearch({
  inputFile,
  start,
  dur,
  height,
  codec,
  implementation,
  gopSec,
  audioKbps,
  tmpDir,
  vmafModel,
  targetVmaf,
  previousSegmentResult = null,
}) {
  const strategy = getBitrateStrategy(height);
  const { min, max } = adjustSearchRange(
    strategy,
    previousSegmentResult,
    targetVmaf
  );
  const { file: refFile, encodeTime: refEncodeTime } = encodeReference({
    inputFile,
    start,
    dur,
    height,
    tmpDir,
  });

  // 目标 VMAF 范围：95-95.5，容差 0.5
  const targetMin = targetVmaf;
  const targetMax = targetVmaf + 0.5;

  const probeResults = [];
  let probeCount = 0;
  let totalProbeEncodeTime = refEncodeTime; // 参考编码时间
  const maxProbes = strategy.maxProbes;
  let minBitrate = min;
  let maxBitrate = max;

  let currentBitrate = Math.round((minBitrate + maxBitrate) / 2);

  while (probeCount < maxProbes && maxBitrate - minBitrate > 200) {
    const { file: candFile, encodeTime } = encodeSegment({
      inputFile,
      start,
      dur,
      height,
      codec,
      implementation,
      bitrateKbps: currentBitrate,
      gopSec,
      audioKbps,
      tmpDir,
    });

    totalProbeEncodeTime += encodeTime;

    const vmafScore = measureVmaf({
      distortedFile: candFile,
      referenceFile: refFile,
      vmafModel,
      tmpDir,
    });

    probeResults.push({ kbps: currentBitrate, vmaf: vmafScore });
    probeCount++;

    // 在目标区间内，优先选择
    if (vmafScore >= targetMin && vmafScore <= targetMax) {
      // 找到了理想区间内的结果
      const inRange = probeResults.filter(
        (r) => r.vmaf >= targetMin && r.vmaf <= targetMax
      );
      if (inRange.length > 0) {
        break;
      }
    }

    if (vmafScore > targetMax) {
      // 分数过高，降低码率
      maxBitrate = currentBitrate;
    } else if (vmafScore < targetMin) {
      // 分数不足，提高码率
      minBitrate = currentBitrate;
    } else {
      // 在目标区间内，尝试降低码率看能否保持
      maxBitrate = currentBitrate;
    }

    const nextBitrate = Math.round((minBitrate + maxBitrate) / 2);
    if (
      nextBitrate === currentBitrate ||
      Math.abs(nextBitrate - currentBitrate) < 100
    ) {
      break;
    }
    currentBitrate = nextBitrate;
  }

  if (
    probeResults.filter((r) => r.vmaf >= targetMin).length === 0 &&
    probeCount < maxProbes
  ) {
    const highBitrate = Math.min(strategy.max, maxBitrate * 1.5);
    const { file: candFile, encodeTime } = encodeSegment({
      inputFile,
      start,
      dur,
      height,
      codec,
      implementation,
      bitrateKbps: highBitrate,
      gopSec,
      audioKbps,
      tmpDir,
    });

    totalProbeEncodeTime += encodeTime;

    const vmafScore = measureVmaf({
      distortedFile: candFile,
      referenceFile: refFile,
      vmafModel,
      tmpDir,
    });
    probeResults.push({ kbps: highBitrate, vmaf: vmafScore });
  }

  // 优先选择在目标区间 [targetVmaf, targetVmaf+0.5] 内的最低码率
  const inRange = probeResults
    .filter((r) => r.vmaf >= targetMin && r.vmaf <= targetMax)
    .sort((a, b) => a.kbps - b.kbps);

  // 如果有在目标区间内的，选择最低码率的
  if (inRange.length > 0) {
    const chosen = inRange[0];
    return {
      chosenBitrateKbps: chosen.kbps,
      estVmaf: chosen.vmaf,
      start,
      dur,
      implementation,
      probesUsed: probeResults.length,
      probeEncodeTime: totalProbeEncodeTime,
    };
  }

  // 否则选择刚好满足最低要求的
  const acceptable = probeResults
    .filter((r) => r.vmaf >= targetMin)
    .sort((a, b) => a.kbps - b.kbps);

  const chosen =
    acceptable.length > 0
      ? acceptable[0]
      : probeResults.sort((a, b) => b.vmaf - a.vmaf)[0];

  return {
    chosenBitrateKbps: chosen.kbps,
    estVmaf: chosen.vmaf,
    start,
    dur,
    implementation,
    probesUsed: probeResults.length,
    probeEncodeTime: totalProbeEncodeTime,
  };
}

/**
 * 决定单个视频片段的最优码率
 *
 * 主协调函数，根据配置选择使用自适应搜索或传统线性探测方法。
 * 自适应搜索（推荐）：通过二分搜索快速找到最优码率，探测次数少
 * 线性探测：遍历所有候选码率，探测次数多但向后兼容
 *
 * @param {Object} params - 探测参数
 * @param {string} params.inputFile - 输入视频文件路径
 * @param {number} params.start - 片段起始时间（秒）
 * @param {number} params.dur - 片段持续时间（秒）
 * @param {number} params.height - 目标视频高度（像素）
 * @param {string} params.codec - 编码器名称 (libx264, libx265, libvpx-vp9, libsvtav1)
 * @param {string} params.implementation - 编码器实现方式 (cpu 或 nvenc)
 * @param {number[]} params.probeBitratesKbps - 候选码率列表 (kbps)，仅在线性探测模式使用
 * @param {number} params.gopSec - GOP 时长（秒）
 * @param {number} params.audioKbps - 音频码率 (kbps)
 * @param {string} params.tmpDir - 临时文件目录路径
 * @param {string} params.vmafModel - VMAF 模型文件路径或版本
 * @param {number} params.targetVmaf - 目标 VMAF 分数（通常为 95）
 * @param {Object|null} [params.previousSegmentResult=null] - 上一个片段的探测结果，用于优化搜索
 * @param {boolean} [params.useAdaptiveSearch=true] - 是否使用自适应搜索（推荐开启）
 * @returns {Object} 探测结果
 * @returns {number} return.chosenBitrateKbps - 选定的码率 (kbps)
 * @returns {number} return.estVmaf - 估算的 VMAF 分数
 * @returns {number} return.start - 片段起始时间
 * @returns {number} return.dur - 片段持续时间
 * @returns {string} return.implementation - 使用的编码器实现
 * @returns {number} [return.probesUsed] - 实际使用的探测次数（自适应搜索模式）
 *
 * @example
 * // 使用自适应搜索（推荐）
 * const result = decideBitrateForSegment({
 *   inputFile: './video.mp4',
 *   start: 0,
 *   dur: 8,
 *   height: 1080,
 *   codec: 'libx264',
 *   implementation: 'cpu',
 *   gopSec: 2,
 *   audioKbps: 128,
 *   tmpDir: './tmp',
 *   vmafModel: 'vmaf_v0.6.1.json',
 *   targetVmaf: 95,
 *   useAdaptiveSearch: true
 * });
 * // result: { chosenBitrateKbps: 2800, estVmaf: 95.2, probesUsed: 4, ... }
 *
 * @example
 * // 使用传统线性探测
 * const result = decideBitrateForSegment({
 *   inputFile: './video.mp4',
 *   start: 0,
 *   dur: 8,
 *   height: 1080,
 *   codec: 'libx264',
 *   implementation: 'cpu',
 *   probeBitratesKbps: [600, 1000, 1500, 2500, 3500],
 *   gopSec: 2,
 *   audioKbps: 128,
 *   tmpDir: './tmp',
 *   vmafModel: 'vmaf_v0.6.1.json',
 *   targetVmaf: 95,
 *   useAdaptiveSearch: false
 * });
 */
export function decideBitrateForSegment({
  inputFile,
  start,
  dur,
  height,
  codec,
  implementation,
  probeBitratesKbps,
  gopSec,
  audioKbps,
  tmpDir,
  vmafModel,
  targetVmaf,
  previousSegmentResult = null,
  useAdaptiveSearch = true,
}) {
  if (useAdaptiveSearch) {
    return adaptiveBitrateSearch({
      inputFile,
      start,
      dur,
      height,
      codec,
      implementation,
      gopSec,
      audioKbps,
      tmpDir,
      vmafModel,
      targetVmaf,
      previousSegmentResult,
    });
  }

  // 传统线性探测 / Traditional linear probing
  const { file: refFile, encodeTime: refEncodeTime } = encodeReference({
    inputFile,
    start,
    dur,
    height,
    tmpDir,
  });
  const candidates = [];
  let totalProbeEncodeTime = refEncodeTime;

  for (const kbps of probeBitratesKbps) {
    const { file: candFile, encodeTime } = encodeSegment({
      inputFile,
      start,
      dur,
      height,
      codec,
      implementation,
      bitrateKbps: kbps,
      gopSec,
      audioKbps,
      tmpDir,
    });

    totalProbeEncodeTime += encodeTime;

    const vmafScore = measureVmaf({
      distortedFile: candFile,
      referenceFile: refFile,
      vmafModel,
      tmpDir,
    });
    candidates.push({ kbps, vmaf: vmafScore });
  }

  const ok = candidates
    .filter((c) => c.vmaf >= targetVmaf)
    .sort((a, b) => a.kbps - b.kbps);

  const pick =
    ok.length > 0 ? ok[0] : candidates.sort((a, b) => b.kbps - a.kbps)[0];

  return {
    chosenBitrateKbps: pick.kbps,
    estVmaf: pick.vmaf,
    start,
    dur,
    implementation,
    probesUsed: candidates.length,
    probeEncodeTime: totalProbeEncodeTime,
  };
}

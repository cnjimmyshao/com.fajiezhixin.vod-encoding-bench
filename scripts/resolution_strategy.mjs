/**
 * 分辨率策略模块
 * Resolution Strategy Module
 *
 * 定义不同分辨率的码率搜索策略
 * Define bitrate search strategies for different resolutions
 */

/**
 * 根据视频分辨率获取对应的码率探测策略
 *
 * 为不同分辨率定制化的码率搜索范围和最大探测次数，确保在合理范围内找到最优码率。
 * 策略自动匹配最接近的分辨率档位。
 *
 * @param {number} height - 视频高度（像素），如 1080、720、480
 * @returns {Object} 策略配置对象
 * @returns {number} return.min - 最小码率 (kbps)
 * @returns {number} return.max - 最大码率 (kbps)
 * @returns {number} return.maxProbes - 最大探测次数
 *
 * @example
 * const strategy = getBitrateStrategy(1080);
 * // 返回: { min: 1500, max: 10000, maxProbes: 6 }
 *
 * @example
 * const strategy = getBitrateStrategy(360);
 * // 返回: { min: 300, max: 1500, maxProbes: 4 }
 */
export function getBitrateStrategy(height) {
  // 为不同分辨率定制的码率策略
  // Customized bitrate strategy for different resolutions
  const strategies = {
    2160: { min: 5000, max: 20000, maxProbes: 6 }, // 4K
    1440: { min: 3000, max: 12000, maxProbes: 6 }, // 2K
    1080: { min: 1500, max: 10000, maxProbes: 6 }, // 1080p
    720: { min: 800, max: 5000, maxProbes: 5 }, // 720p
    480: { min: 400, max: 2500, maxProbes: 5 }, // 480p
    360: { min: 300, max: 1500, maxProbes: 4 }, // 360p
  };

  // 找到最接近的分辨率策略
  // Find the closest resolution strategy
  const heights = Object.keys(strategies)
    .map(Number)
    .sort((a, b) => b - a);
  const closestHeight =
    heights.find((h) => height >= h) || heights[heights.length - 1];

  return strategies[closestHeight];
}

/**
 * 根据上一个片段的探测结果调整码率搜索范围
 *
 * 利用视频片段之间的相似性，通过历史结果优化搜索范围，减少探测次数。
 * 调整策略：
 * - VMAF 接近目标（±3）：在上次码率的 ±30% 范围内搜索
 * - VMAF 低于目标：向更高码率方向搜索
 * - VMAF 高于目标：向更低码率方向搜索
 *
 * @param {Object} strategy - 基础分辨率策略
 * @param {number} strategy.min - 策略最小码率 (kbps)
 * @param {number} strategy.max - 策略最大码率 (kbps)
 * @param {Object|null} previousResult - 上一个片段的探测结果
 * @param {number} previousResult.chosenBitrateKbps - 上次选定的码率
 * @param {number} previousResult.estVmaf - 上次估算的 VMAF 分数
 * @param {number} targetVmaf - 目标 VMAF 分数（通常为 95）
 * @returns {Object} 调整后的搜索范围
 * @returns {number} return.min - 调整后的最小码率 (kbps)
 * @returns {number} return.max - 调整后的最大码率 (kbps)
 *
 * @example
 * const strategy = { min: 1500, max: 10000, maxProbes: 6 };
 * const previous = { chosenBitrateKbps: 3000, estVmaf: 94.5 };
 * const adjusted = adjustSearchRange(strategy, previous, 95);
 * // 返回: { min: 3000, max: 4800 } // VMAF 略低，向上搜索
 */
export function adjustSearchRange(strategy, previousResult, targetVmaf) {
  if (!previousResult) {
    return { min: strategy.min, max: strategy.max };
  }

  const { chosenBitrateKbps, estVmaf } = previousResult;
  const vmafGap = targetVmaf - estVmaf;

  let min = strategy.min;
  let max = strategy.max;

  if (Math.abs(vmafGap) < 3) {
    // VMAF 接近目标，在附近搜索 ±30%
    // VMAF close to target, search within ±30%
    min = Math.max(strategy.min, Math.round(chosenBitrateKbps * 0.7));
    max = Math.min(strategy.max, Math.round(chosenBitrateKbps * 1.3));
  } else if (vmafGap > 0) {
    // VMAF 低于目标，需要更高码率
    // VMAF below target, need higher bitrate
    const multiplier = 1 + vmafGap / 100;
    min = Math.max(strategy.min, chosenBitrateKbps);
    max = Math.min(
      strategy.max,
      Math.round(chosenBitrateKbps * multiplier * 1.5)
    );
  } else {
    // VMAF 高于目标，可以降低码率
    // VMAF above target, can reduce bitrate
    const multiplier = 1 + vmafGap / 100;
    min = Math.max(
      strategy.min,
      Math.round(chosenBitrateKbps * multiplier * 0.7)
    );
    max = Math.min(strategy.max, chosenBitrateKbps);
  }

  return { min, max };
}

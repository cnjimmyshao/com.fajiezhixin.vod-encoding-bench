# 自适应码率搜索优化 / Adaptive Bitrate Search Optimization

## 概述 / Overview

新的自适应码率搜索系统通过以下三个关键优化，显著减少编码探测次数并提高效率：

The new adaptive bitrate search system significantly reduces encoding probe count and improves efficiency through three key optimizations:

## 核心优化 / Core Optimizations

### 1. 分辨率相关的码率策略 / Resolution-Specific Bitrate Strategy

不同分辨率使用不同的码率范围和步长：

Different resolutions use different bitrate ranges and step sizes:

| 分辨率 / Resolution | 最小码率 / Min | 最大码率 / Max | 初始步长 / Initial Step | 最大探测次数 / Max Probes |
| ------------------- | -------------- | -------------- | ----------------------- | ------------------------- |
| 4K (2160p)          | 5000 kbps      | 20000 kbps     | 3000 kbps               | 6                         |
| 2K (1440p)          | 3000 kbps      | 12000 kbps     | 2000 kbps               | 6                         |
| 1080p               | 1500 kbps      | 10000 kbps     | 1500 kbps               | 6                         |
| 720p                | 800 kbps       | 5000 kbps      | 800 kbps                | 5                         |
| 480p                | 400 kbps       | 2500 kbps      | 400 kbps                | 5                         |
| 360p                | 300 kbps       | 1500 kbps      | 300 kbps                | 4                         |

**优势 / Benefits:**

- 避免对低分辨率视频探测不必要的高码率
- 为高分辨率视频提供足够的码率范围
- Avoids probing unnecessarily high bitrates for low-resolution videos
- Provides sufficient bitrate range for high-resolution videos

### 2. 二分搜索算法 / Binary Search Algorithm

使用二分搜索替代线性遍历所有候选码率：

Uses binary search instead of linearly traversing all candidate bitrates:

**传统方法 / Traditional Method:**

```
探测: 600 → 800 → 1000 → 1500 → 2500 → 3500 → 5000
Probe: 600 → 800 → 1000 → 1500 → 2500 → 3500 → 5000
结果: 7次探测 / Result: 7 probes
```

**自适应搜索 / Adaptive Search:**

```
1. 探测中点: 2650 kbps → VMAF=92 (低于95)
   Probe midpoint: 2650 kbps → VMAF=92 (below 95)
2. 提高码率: 探测 5325 kbps → VMAF=96 (达标)
   Increase bitrate: probe 5325 kbps → VMAF=96 (meets target)
3. 降低码率: 探测 3987 kbps → VMAF=94 (略低)
   Lower bitrate: probe 3987 kbps → VMAF=94 (slightly low)
4. 微调: 探测 4656 kbps → VMAF=95 (完美)
   Fine-tune: probe 4656 kbps → VMAF=95 (perfect)

结果: 4次探测 / Result: 4 probes
```

**效率提升 / Efficiency Improvement:**

- 探测次数从 O(n) 降低到 O(log n)
- 典型场景减少 40-60% 的探测次数
- Probe count reduced from O(n) to O(log n)
- Typically reduces probes by 40-60%

### 3. 片段间历史参考 / Inter-Segment Historical Reference

利用前一个片段的结果优化后续片段的搜索范围：

Uses previous segment results to optimize search range for subsequent segments:

**场景 A: VMAF 接近目标（±3）/ Close to Target (±3):**

```
前一片段 / Previous: 3000 kbps → VMAF=94
搜索范围 / Search range: 2100-3900 kbps (±30%)
预期: 更快收敛 / Expected: Faster convergence
```

**场景 B: VMAF 低于目标 / Below Target:**

```
前一片段 / Previous: 2000 kbps → VMAF=88 (差距7分)
推测需要更高码率 / Estimate needs higher bitrate
搜索范围 / Search range: 2000-3500 kbps
跳过低码率探测 / Skip low bitrate probes
```

**场景 C: VMAF 高于目标 / Above Target:**

```
前一片段 / Previous: 5000 kbps → VMAF=98 (超出3分)
可以降低码率 / Can reduce bitrate
搜索范围 / Search range: 3500-5000 kbps
避免探测更高码率 / Avoid probing higher bitrates
```

## 使用方法 / Usage

### 启用自适应搜索 / Enable Adaptive Search

在 `configs/experiment_matrix.json` 中设置：

Set in `configs/experiment_matrix.json`:

```json
{
  "useAdaptiveBitrateSearch": true,
  "targetVmaf": 95
}
```

### 禁用自适应搜索（使用传统方法）/ Disable (Use Traditional Method)

```json
{
  "useAdaptiveBitrateSearch": false,
  "probeBitratesKbps": [600, 800, 1000, 1500, 2500, 3500, 5000, 7000, 10000]
}
```

### 测试对比 / Test Comparison

运行对比测试脚本：

Run comparison test script:

```bash
node test_adaptive_bitrate.mjs
```

这将对比传统线性探测和自适应搜索的效率。

This compares efficiency between traditional linear probing and adaptive search.

## 预期效果 / Expected Results

基于典型视频内容：

Based on typical video content:

| 指标 / Metric                       | 传统方法 / Traditional | 自适应搜索 / Adaptive | 改进 / Improvement     |
| ----------------------------------- | ---------------------- | --------------------- | ---------------------- |
| 每片段探测次数 / Probes per segment | 7-9                    | 3-5                   | 40-60% ↓               |
| 总编码时间 / Total encoding time    | 基准 / Baseline        | -40% ~ -60%           | 显著减少 / Significant |
| 质量准确度 / Quality accuracy       | ±1 VMAF                | ±1 VMAF               | 保持不变 / Unchanged   |

## 高级配置 / Advanced Configuration

如需调整自适应策略参数，编辑 `scripts/bitrate_probe.mjs` 中的 `getBitrateStrategyForResolution()` 函数：

To adjust adaptive strategy parameters, edit `getBitrateStrategyForResolution()` in `scripts/bitrate_probe.mjs`:

```javascript
const strategies = {
  1080: {
    min: 1500, // 最小探测码率 / Minimum probe bitrate
    max: 10000, // 最大探测码率 / Maximum probe bitrate
    initialStep: 1500, // 初始步长（未使用在二分搜索中）
    maxProbes: 6, // 最大探测次数 / Maximum number of probes
  },
};
```

## 技术细节 / Technical Details

### 二分搜索终止条件 / Binary Search Termination

1. 达到最大探测次数
2. 搜索范围收敛至 <200 kbps
3. 找到满足条件的最低码率
4. 连续两次探测相同码率（避免死循环）

5. Reached maximum probe count
6. Search range converged to <200 kbps
7. Found lowest bitrate meeting target
8. Probed same bitrate twice consecutively (avoid infinite loop)

### 历史参考权重调整 / Historical Reference Weight Adjustment

基于 VMAF 差距动态调整搜索范围：

Dynamically adjust search range based on VMAF gap:

- `|VMAF差距| < 3`：窄范围搜索（±30%）
- `VMAF差距 > 3`：向上扩展搜索
- `VMAF差距 < -3`：向下压缩搜索

- `|VMAF gap| < 3`: Narrow search (±30%)
- `VMAF gap > 3`: Expand search upward
- `VMAF gap < -3`: Compress search downward

## 故障排除 / Troubleshooting

### 探测次数未减少 / Probe Count Not Reduced

**可能原因 / Possible causes:**

1. 视频内容变化大，片段间相关性低
2. 目标 VMAF 设置过高
3. 码率策略范围设置不当

**解决方案 / Solutions:**

1. 调整 `maxProbes` 参数
2. 降低目标 VMAF 或扩大码率范围
3. 检查分辨率策略配置

### 质量不达标 / Quality Below Target

如果最终 VMAF 低于目标：

If final VMAF is below target:

1. 检查分辨率策略的 `max` 值是否足够高
2. 增加 `maxProbes` 允许更多探测
3. 临时禁用自适应搜索以排查问题

4. Check if `max` value in resolution strategy is high enough
5. Increase `maxProbes` to allow more probes
6. Temporarily disable adaptive search to diagnose

## 向后兼容性 / Backward Compatibility

通过 `useAdaptiveSearch` 参数保持完全向后兼容：

Full backward compatibility maintained via `useAdaptiveSearch` parameter:

- `useAdaptiveSearch: true` → 使用新的自适应算法
- `useAdaptiveSearch: false` → 使用原有线性探测
- 参数缺失 → 默认为 `true`（推荐新用户使用自适应）

- `useAdaptiveSearch: true` → Use new adaptive algorithm
- `useAdaptiveSearch: false` → Use original linear probing
- Parameter missing → Defaults to `true` (recommended for new users)

## 未来改进方向 / Future Improvements

1. **机器学习预测**：基于视频内容特征预测初始码率
2. **动态调整 maxProbes**：根据搜索收敛速度动态调整
3. **多分辨率联合优化**：不同分辨率间共享码率-VMAF 曲线信息
4. **内容复杂度分析**：根据场景复杂度调整搜索策略

5. **ML-based prediction**: Predict initial bitrate based on video content features
6. **Dynamic maxProbes**: Adjust based on search convergence speed
7. **Multi-resolution optimization**: Share bitrate-VMAF curve info across resolutions
8. **Content complexity analysis**: Adjust search strategy based on scene complexity

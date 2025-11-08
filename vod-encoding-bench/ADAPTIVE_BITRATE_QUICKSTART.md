# 自适应码率搜索 - 快速开始指南

# Adaptive Bitrate Search - Quick Start Guide

## 什么是自适应码率搜索？

## What is Adaptive Bitrate Search?

自适应码率搜索是一个智能优化系统，通过以下方式减少编码探测时间：

Adaptive Bitrate Search is an intelligent optimization system that reduces encoding probe time through:

1. **分辨率相关策略** - 不同分辨率使用不同的码率范围
2. **二分搜索算法** - 快速定位最优码率，减少探测次数
3. **片段间参考** - 利用前一片段结果优化后续搜索

4. **Resolution-specific strategy** - Different bitrate ranges for different resolutions
5. **Binary search algorithm** - Quickly locate optimal bitrate with fewer probes
6. **Inter-segment reference** - Use previous segment results to optimize subsequent searches

## 使用方法 / How to Use

### 启用（默认）/ Enable (Default)

配置文件 `configs/experiment_matrix.json` 中已默认启用：

Already enabled by default in `configs/experiment_matrix.json`:

```json
{
  "useAdaptiveBitrateSearch": true
}
```

直接运行实验：

Run experiment directly:

```bash
node scripts/run_experiment.mjs assets/sample.mpeg
```

### 查看效果 / View Results

输出会显示每个片段的探测次数：

Output will show probe count for each segment:

```
片段 1/4 [0.00s-8.00s] -> 3500 kbps (估算VMAF=95.23) (4 次探测 / 4 probes)
Segment 1/4 [0.00s-8.00s] -> 3500 kbps (est. VMAF=95.23) (4 probes)

片段 2/4 [8.00s-16.00s] -> 3200 kbps (估算VMAF=95.10) (3 次探测 / 3 probes)
Segment 2/4 [8.00s-16.00s] -> 3200 kbps (est. VMAF=95.10) (3 probes)
```

### 禁用（使用传统方法）/ Disable (Use Traditional Method)

修改配置文件：

Modify config file:

```json
{
  "useAdaptiveBitrateSearch": false,
  "probeBitratesKbps": [600, 800, 1000, 1500, 2500, 3500, 5000, 7000, 10000]
}
```

## 性能对比测试 / Performance Comparison Test

运行对比测试：

Run comparison test:

```bash
node test_adaptive_bitrate.mjs
```

预期结果示例 / Expected output example:

```
性能对比总结 / Performance Comparison Summary

传统线性探测 / Traditional Linear Probing:
  总探测次数 / Total probes: 21
  总耗时 / Total time: 245.3 秒 / seconds
  平均每片段 / Average per segment: 7.0 次探测 / probes

自适应搜索 / Adaptive Search:
  总探测次数 / Total probes: 10
  总耗时 / Total time: 116.7 秒 / seconds
  平均每片段 / Average per segment: 3.3 次探测 / probes

效率提升 / Efficiency Improvement:
  探测次数减少 / Probe reduction: 52.4%
  时间节省 / Time saved: 52.4%

✓ 自适应搜索成功减少了探测次数！
✓ Adaptive search successfully reduced probe count!
```

## 调整策略参数 / Adjust Strategy Parameters

如需自定义码率范围，编辑 `scripts/bitrate_probe.mjs`:

To customize bitrate ranges, edit `scripts/bitrate_probe.mjs`:

```javascript
function getBitrateStrategyForResolution(height) {
  const strategies = {
    1080: {
      min: 1500, // 最小码率 / Min bitrate
      max: 10000, // 最大码率 / Max bitrate
      maxProbes: 6, // 最大探测次数 / Max probes
    },
    // ... 其他分辨率 / other resolutions
  };
}
```

## 常见问题 / FAQ

**Q: 会影响最终质量吗？**  
**Q: Will it affect final quality?**

A: 不会。自适应搜索使用相同的质量目标（VMAF≈95），只是更高效地找到最优码率。

A: No. Adaptive search uses the same quality target (VMAF≈95), just finds the optimal bitrate more efficiently.

---

**Q: 为什么有时探测次数没有减少？**  
**Q: Why doesn't probe count reduce sometimes?**

A: 视频内容变化大时，片段间相关性低。系统会自动使用二分搜索确保质量。

A: When video content varies significantly, inter-segment correlation is low. System automatically uses binary search to ensure quality.

---

**Q: 如何知道是否有效？**  
**Q: How to know if it's working?**

A: 查看日志中的 "X 次探测 / X probes"。传统方法固定 7-9 次，自适应通常 3-5 次。

A: Check "X probes" in logs. Traditional method fixed at 7-9, adaptive typically 3-5.

## 更多文档 / More Documentation

详细技术文档：`ADAPTIVE_BITRATE_SEARCH.md`

Detailed technical documentation: `ADAPTIVE_BITRATE_SEARCH.md`

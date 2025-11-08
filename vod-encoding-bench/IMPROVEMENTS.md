# 改进总结

本次改进实现了三个主要功能：

## 1. VMAF 目标区间控制（95-95.5）

### 修改内容

- **文件**: `scripts/bitrate_probe.mjs`
- **改进**: 修改自适应二分搜索算法，优先选择 VMAF 在 [95, 95.5] 区间内的最低码率
- **实现细节**:
  - 定义目标区间：`targetMin = targetVmaf`，`targetMax = targetVmaf + 0.5`
  - 在探测过程中，如果 VMAF > 95.5，降低码率；如果 VMAF < 95，提高码率
  - 选择结果时，优先选择在目标区间内的最低码率方案
  - 如果区间内无可用方案，则选择刚好满足最低要求（≥95）的方案

### 效果

- **修改前**: VMAF 可能达到 96-97，码率偏高
- **修改后**: VMAF 保持在 95-95.5 区间，码率更优化
- **示例**: sample-1.mpeg 测试中，per_scene 模式 VMAF = 95.33（符合预期）

## 2. 编码统计信息

### 新增字段

在结果 JSON 中增加以下统计信息：

| 字段名                   | 类型   | 说明                                       |
| ------------------------ | ------ | ------------------------------------------ |
| `probeCount`             | number | 探测编码次数（码率探测阶段）               |
| `finalEncodeCount`       | number | 最终编码次数（输出片段数量）               |
| `totalEncodeCount`       | number | 总编码次数 = probeCount + finalEncodeCount |
| `probeEncodeTimeSeconds` | number | 探测编码总耗时（秒）                       |
| `finalEncodeTimeSeconds` | number | 最终编码总耗时（秒）                       |
| `totalEncodeTimeSeconds` | number | 总编码耗时（秒）                           |
| `videoDurationSeconds`   | number | 视频时长（秒）                             |
| `encodingEfficiency`     | number | 编码效率 = 总编码耗时 / 视频时长           |

### 修改文件

1. **`scripts/encoder_config.mjs`**:

   - 修改 `sh()` 函数返回 `{output, timeSeconds}`
   - 修改 `encodeReference()` 返回 `{file, encodeTime}`
   - 修改 `encodeSegment()` 返回 `{file, encodeTime}`

2. **`scripts/bitrate_probe.mjs`**:

   - 统计 `totalProbeEncodeTime`（包含参考编码和所有探测编码）
   - 返回结果中增加 `probesUsed` 和 `probeEncodeTime`

3. **`scripts/per_scene_encode.mjs`**:

   - 在 `exportFinalSegment()` 中测量编码时间
   - 在 `runPerSceneEncode()` 中累计 `totalFinalEncodeTime`
   - 返回结果中增加 `finalEncodeTime`

4. **`scripts/run_experiment.mjs`**:
   - 收集所有片段的探测和编码统计
   - 计算编码效率
   - 输出详细的统计信息

### 示例输出

```json
{
  "mode": "per_scene",
  "probeCount": 5,
  "finalEncodeCount": 1,
  "totalEncodeCount": 6,
  "probeEncodeTimeSeconds": 8.88,
  "finalEncodeTimeSeconds": 1.09,
  "totalEncodeTimeSeconds": 9.98,
  "videoDurationSeconds": 1.03,
  "encodingEfficiency": 9.69
}
```

控制台输出示例：

```
编码次数=6 (探测=5, 最终=1), 编码效率=9.69x (耗时=10.0s / 视频=1.0s)
```

## 3. Baseline CRF 模式

### 新增文件

- **`scripts/baseline_crf_encode.mjs`**: 实现固定 CRF 编码模式

### 功能特点

- **无场景检测**: 直接对整个视频进行编码
- **无码率探测**: 使用固定 CRF 值（配置文件中的 `baselineCrf`）
- **单次编码**: 最快的编码策略，适合基准对比
- **支持所有编码器**: libx264, libx265, libvpx-vp9, libsvtav1（CPU 和 NVENC）

### 配置

在 `configs/experiment_matrix.json` 中：

```json
{
  "modes": ["baseline_crf", "per_scene"],
  "baselineCrf": 23
}
```

### CRF 值说明

- **libx264/libx265**: CRF 范围 0-51，推荐 18-28
  - CRF 18: 接近视觉无损
  - CRF 23: 默认值，高质量
  - CRF 28: 中等质量
- **libvpx-vp9/libsvtav1**: CRF 范围 0-63
- **NVENC**: 使用 CQ 模式（Constant Quality）

### 结果示例

```json
{
  "mode": "baseline_crf",
  "crf": 23,
  "targetVmaf": null,
  "finalVmaf": 94.76,
  "avgBitrateKbps": 6366.4,
  "probeCount": 0,
  "finalEncodeCount": 1,
  "totalEncodeCount": 1,
  "totalEncodeTimeSeconds": 1.17,
  "encodingEfficiency": 1.13
}
```

## 测试结果对比

使用 `assets/sample-1.mpeg` (1.03 秒视频) 测试：

| 模式                  | VMAF  | 码率 (kbps) | 编码次数 | 编码效率 |
| --------------------- | ----- | ----------- | -------- | -------- |
| baseline_crf (CRF=23) | 94.76 | 6366        | 1        | 1.13x    |
| per_scene             | 95.33 | 7254        | 6        | 9.69x    |

**结论**:

- **baseline_crf**: 最快（1.13x），质量略低于目标（94.76 < 95）
- **per_scene**: 精确控制质量（95.33），但编码时间是视频时长的 9.69 倍
- **VMAF 控制**: 成功将 per_scene 模式的 VMAF 控制在 95.33（之前可能达到 96+）

## 使用方法

### 快速测试

```bash
# 仅测试一个编码器和分辨率
node scripts/run_experiment.mjs assets/sample-1.mpeg
```

### 完整实验

配置文件已恢复为完整设置：

- 4 个分辨率: 1080p, 720p, 480p, 360p
- 4 个编码器: libx264, libx265, libvpx-vp9, libsvtav1
- 2 种实现: CPU, NVENC
- 2 种模式: baseline_crf, per_scene

```bash
node scripts/run_experiment.mjs <your-video.mp4>
```

### 查看结果

```bash
cat results/<video-name>_summary.json
```

## 后续建议

1. **CRF 值优化**: 可以为不同编码器配置不同的 CRF 值
2. **VMAF 区间调整**: 可以在配置文件中设置 `targetVmafRange`（如 0.5）
3. **性能优化**: 可以考虑并行编码多个片段
4. **更多模式**: 可以添加 `per_title` 模式（整片单码率探测）

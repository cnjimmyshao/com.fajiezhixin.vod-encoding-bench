# VOD 编码基准测试 - AI 智能体指南

## 项目概览

视频点播编码基准测试项目，对比多种编码策略（基线 CRF、按标题、按场景、AI 预处理），支持多种编码器（H.264、H.265、VP9、AV1）的 CPU 和 NVENC 实现，目标质量为 VMAF≈95。

## 架构与数据流

- **入口点**：`scripts/run_experiment.mjs` 为每种模式/编码器/分辨率/实现方式编排整个流程
- **核心流程**：场景检测 → 码率探测 → 分段编码 → VMAF 评估
- **工作目录模式**：`workdir/<输入名称>/<模式>_<高度>p_<编码器>_<实现>/` 包含临时文件、片段、报告和最终视频
- **结果输出**：`results/<输入名称>_summary.json` 汇总所有配置的 VMAF 分数和码率

## 关键实现模式

### 双语输出

所有控制台消息使用 `bilingual(chinese, english)` 辅助函数 - 保持此模式以确保一致性。示例：

```javascript
console.log(bilingual("正在编码...", "Encoding..."));
```

### 模块依赖关系

- `scene_detect.mjs`：导出 `detectScenes()`、`buildSegments()`、`getDurationSeconds()`
- `bitrate_probe.mjs`：导出 `decideBitrateForSegment()` - 返回 `{ chosenBitrateKbps, estVmaf, probesUsed }`
  - 依赖于 `resolution_strategy.mjs`、`encoder_config.mjs`、`vmaf_calculator.mjs`
- `resolution_strategy.mjs`：导出 `getBitrateStrategy()`、`adjustSearchRange()` - 管理分辨率策略
- `encoder_config.mjs`：导出 `encodeReference()`、`getEncoderArgs()`、`encodeSegment()` - 管理编码器配置
- `vmaf_calculator.mjs`：导出 `measureVmaf()` - 处理 VMAF 质量评估
- `per_scene_encode.mjs`：导出 `runPerSceneEncode()` - 返回 `{ finalFile, finalVmaf }`

### 编码器实现逻辑

NVENC 支持因编码器而异：

- `libx264` / `libx265`：同时支持 CPU 和 NVENC
- `libvpx-vp9` / `libsvtav1`：仅支持 CPU（不支持 NVENC，自动跳过）
- 在处理前检查 `isImplementationSupported(codec, implementation)`

### 配置驱动执行

`configs/experiment_matrix.json` 驱动所有实验：

- `modes`：控制运行哪些策略（`per_scene`、`ai_preprocess+per_scene`）
- `encoderImplementations`：`["cpu", "nvenc"]` - 处理所有组合
- `useAdaptiveBitrateSearch`：启用自适应搜索时自动决定码率范围（推荐 `true`）
- 所有参数由 `run_experiment.mjs` 主循环消费

**注意：** 自适应搜索启用时，不再需要 `probeBitratesKbps` 配置项，码率范围由分辨率策略自动决定。

### AI 预处理集成

当 `ai_preprocess+per_scene` 模式运行时：

1. 创建 `workdir/<输入>/ai_preprocess/<输入>_enhanced.mp4`
2. 调用 `python3 ./ai_preprocess/preprocess_video.py --input <源> --output <增强> --model <模型名称>`
3. 使用增强视频作为后续按场景编码的输入
4. **当前状态**：`preprocess_video.py` 是复制占位符 - 尚未实际增强

## 开发工作流

### 运行实验

```bash
# 交互模式（提示输入视频或生成测试视频）
node scripts/run_experiment.mjs

# 使用特定视频
node scripts/run_experiment.mjs ./path/to/video.mp4

# 烟雾测试（10 帧测试视频）
npm test
```

### 添加新的编码模式

1. 将模式标识符添加到 `configs/experiment_matrix.json` 的 `modes` 数组
2. 在 `run_experiment.mjs` 主循环的模式调度器中添加新分支
3. 重用现有辅助函数：`fetchSegments()`、`avgBitrateKbps()`、`decideBitrateForSegment()`
4. 确保双语日志记录和摘要行创建

### 修改编码器参数

编辑 `bitrate_probe.mjs` 中的 `resolveVideoArgs()`：

- CPU 编码器：调整预设、GOP 设置、像素格式
- NVENC 编码器：调整速率控制（VBR、maxrate、bufsize）、预设（p5、p7）
- 对不支持的编码器/实现组合返回 `null`

## 关键技术约束

### Shell 命令执行

所有 ffmpeg/ffprobe 调用使用 `sh()` 辅助函数或 `execSync()`，明确指定 `/bin/bash` shell 和 `pipe` stdio 以捕获输出。遵循此模式以确保一致性。

### 片段构建规则

`buildSegments()` 约束：

- `minDurSec`：默认 4.0 秒最小片段时长
- `maxDurSec`：默认 8.0 秒最大片段时长
- 优先选择此范围内的场景切换点，否则回退到 maxDurSec 边界

### 自适应码率搜索（新功能）

`decideBitrateForSegment()` 支持两种模式：

- **自适应搜索**（默认）：使用二分搜索 + 片段间历史参考，减少 40-60% 探测次数
  - 分辨率相关策略：不同分辨率使用不同的码率范围（360p: 300-1500 kbps, 1080p: 1500-10000 kbps）
  - 二分搜索：O(log n) 复杂度，通常 3-5 次探测
  - 历史参考：`previousSegmentResult` 参数优化后续片段搜索范围
- **传统线性探测**：遍历 `probeBitratesKbps` 中所有码率，通常 7-9 次探测
- 配置：`configs/experiment_matrix.json` 中设置 `useAdaptiveBitrateSearch: true/false`
- 详细文档：`ADAPTIVE_BITRATE_SEARCH.md`

### VMAF 分数提取

`compute_vmaf.mjs` 和 `bitrate_probe.mjs` 处理多种 libvmaf JSON 格式以兼容不同 FFmpeg 版本：

- FFmpeg 8.0+：`pooled_metrics.vmaf.mean`（主要）
- 旧版本：`global_metrics.vmaf`、`aggregate.VMAF_score`、`VMAF_score`
  如果都不匹配则回退到 0。

### FFmpeg libvmaf 过滤器版本差异

FFmpeg 8.0 改变了 libvmaf 过滤器的 API：

- 旧版本使用：`libvmaf=model_path='vmaf_v0.6.1.json'`
- FFmpeg 8.0+ 使用：`libvmaf=model=version=vmaf_v0.6.1` 或 `model=path='/full/path'`
  代码自动检测模型参数格式（文件名中包含 `vmaf_v` 提取版本号，包含 `/` 或 `\` 视为路径）。

## 测试与验证

### 烟雾测试覆盖

`test/run_smoke_test.mjs` 验证：

1. 通过 lavfi 生成 10 帧测试视频
2. 使用模拟参数执行 `preprocess_video.py`
3. 使用小输入端到端测试 `per_scene_encode.mjs`
   需要支持 libvmaf 的 ffmpeg - 如果不可用则跳过编码测试。

### 常见调试模式

- 检查 `workdir/<输入>/<模式>/tmp/` 中探测阶段编码的片段
- 查看 `workdir/<输入>/<模式>/report/<模式>_vmaf.json` 获取详细的 VMAF 帧分数
- 验证 `results/<输入>_summary.json` 中的汇总指标
- 检查双语控制台输出中的片段级决策

## 外部依赖

- **Node.js**：需要 v24+ 以支持 ESM
- **FFmpeg**：v8+ 带 libvmaf、编码器库（libx264、libx265、libvpx-vp9、libsvtav1）
- **NVENC**：需要支持 CUDA 的 GPU 和驱动程序进行硬件编码
- **Python**：3.9+ 用于 AI 预处理脚本（目前是占位符，尚无 ML 依赖）

## 未来扩展点

- `baseline_crf` 模式：实现无场景检测的固定 CRF 编码
- `per_title` 模式：为整个视频实现单码率探测
- 真实 AI 模型：在 `preprocess_video.py` 中集成超分辨率/降噪，使用 PyTorch/TensorFlow
- ABR 梯度生成：从多分辨率输出生成 DASH/HLS 清单

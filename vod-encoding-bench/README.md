# vod-encoding-bench

## 项目目标
面向点播场景评估多种离线编码策略的效率。
Benchmark multiple offline encoding strategies for video-on-demand scenarios.

对比 baseline CRF、Per-Title、Per-Scene 以及 AI 预处理增强后的编码模式。
Compare baseline CRF, per-title, per-scene, and AI-preprocessed encoding workflows.

覆盖 H.264、H.265、VP9、AV1 等多种开源编码器。
Support open-source codecs including H.264, H.265, VP9, and AV1.

在目标主观质量 (VMAF≈95) 前提下量化不同策略的平均码率与文件体积差异。
Quantify average bitrate and file size differences while maintaining a target subjective quality (VMAF≈95).

## 依赖环境
Node.js 24+。
Node.js version 24 or newer.

ffmpeg 8+（需启用 libvmaf、libx264、libx265、libvpx-vp9、libaom-av1，并建议安装支持 NVENC 的驱动）。
ffmpeg 8 or newer with libvmaf, libx264, libx265, libvpx-vp9, libaom-av1, and ideally NVENC-capable drivers.

Python 3.9+（可结合 CUDA，用于 AI 预处理脚本）。
Python 3.9 or newer, optionally with CUDA for the AI preprocessing script.

## 目录速览
`scripts/`：场景检测、码率探测、分段编码、VMAF 计算等核心流水线脚本。
`scripts/`: Core pipeline scripts covering scene detection, bitrate probing, segmented encoding, and VMAF evaluation.

`configs/`：实验矩阵、目标质量、预处理模型等参数定义。
`configs/`: Parameter definitions such as experiment matrix, quality targets, and preprocessing models.

`ai_preprocess/`：AI 预处理脚本与后续模型集成位置。
`ai_preprocess/`: AI preprocessing scripts and the integration point for future models.

`results/`：实验摘要输出目录。
`results/`: Output directory for experiment summaries.

`workdir/`：临时产物与分段文件（已在 .gitignore 中忽略）。
`workdir/`: Workspace for temporary artifacts and segments (ignored by .gitignore).

`ARCHITECTURE.md`：整体架构设计与模块边界说明。
`ARCHITECTURE.md`: Architectural overview and module boundaries.

## 配置文件说明
`configs/experiment_matrix.json` 控制实验策略。
The `configs/experiment_matrix.json` file drives the experiment strategy.

`targetVmaf`：目标 VMAF 阈值。
`targetVmaf`: Target VMAF threshold.

`heightList`：需要生成的目标分辨率列表。
`heightList`: List of output resolutions to test.

`codecs`：编码器枚举。
`codecs`: Enumerated codecs to evaluate.

`encoderImplementations`：编码器实现列表，用于比较 CPU 与 NVENC。
`encoderImplementations`: Encoder implementations to compare CPU and NVENC pipelines.

`modes`：计划执行的策略，其中 `per_scene` 与 `ai_preprocess+per_scene` 已实现。
`modes`: Strategy modes to execute; `per_scene` and `ai_preprocess+per_scene` are currently implemented.

`probeBitratesKbps`：探测码率集合，用于寻找满足质量的最小码率。
`probeBitratesKbps`: Candidate bitrates (kbps) for probing acceptable quality levels.

`gopSec`：GOP 长度（秒）。
`gopSec`: GOP duration in seconds.

`sceneThresh`：场景切换阈值。
`sceneThresh`: Scene change detection threshold.

`audioKbps`：音频码率。
`audioKbps`: Audio bitrate in kbps.

`vmafModel`：libvmaf 模型文件路径。
`vmafModel`: libvmaf model file path.

`aiPreprocessModel`：AI 预处理脚本默认使用的模型名称。
`aiPreprocessModel`: Default model identifier for the AI preprocessing script.

## 快速开始
准备测试视频，假设路径为 `./sample_input.mp4`。
Prepare a test video, e.g., `./sample_input.mp4`.

根据实际环境修改 `configs/experiment_matrix.json` 中的编码器、分辨率、模式以及编码器实现。
Adjust codecs, resolutions, modes, and encoder implementations in `configs/experiment_matrix.json` as needed.

执行基础 Per-Scene 流水线：
Run the basic per-scene workflow:

```
node ./scripts/run_experiment.mjs ./sample_input.mp4
```

若启用 `ai_preprocess+per_scene`，脚本会自动调用 `python3 ./ai_preprocess/preprocess_video.py`，生成增强版视频后再运行 Per-Scene 编码。
When `ai_preprocess+per_scene` is enabled, the script automatically calls `python3 ./ai_preprocess/preprocess_video.py` to create an enhanced video before executing the per-scene encode.

启用 NVENC 比较时，请确认硬件与驱动已安装，并在配置中保留 `nvenc` 实现以生成 CPU 与 GPU 的对照结果。
To compare NVENC, ensure hardware and drivers are installed and keep the `nvenc` implementation in the configuration to generate CPU versus GPU results.

目前 NVENC 流程支持 H.264 与 H.265 编码器；VP9 与 AV1 会自动回退到 CPU 实现。
At present the NVENC workflow supports the H.264 and H.265 codecs; VP9 and AV1 automatically fall back to the CPU implementation.

## 输出结果
`workdir/<输入文件名>/`：按模式、编码器、实现方式划分的子目录，包含分段文件、最终拼接文件以及参考视频。
`workdir/<input name>/`: Mode-, codec-, and implementation-specific subdirectories containing segments, final stitched videos, and reference encodes.

`results/<输入文件名>_summary.json`：记录每种模式的最终 VMAF、估算平均码率、输出文件路径以及使用的编码器实现，便于后续分析或可视化。
`results/<input name>_summary.json`: Summary JSON listing final VMAF, estimated average bitrate, output path, and the encoder implementation for later analysis or visualization.

## AI 预处理脚本使用说明
占位脚本 `ai_preprocess/preprocess_video.py` 在实际模型集成前，仍然会把输入视频直接复制到目标路径。

* 基本用法：
  ```bash
  python3 ./ai_preprocess/preprocess_video.py --input ./source.mp4 --output ./enhanced.mp4 --model realesrgan_x4plus
  ```
* 如果输出路径的上级目录不存在，脚本会自动创建。
* 若输入与输出路径相同，脚本会在保持原文件不变的前提下跳过复制，并给出提示。
* 当输入文件缺失时，脚本会以中英文提示信息退出，便于快速定位问题。

## 测试
运行基础烟雾测试以验证核心脚本：
Run basic smoke tests to verify core scripts:

```
npm test
```

烟雾测试包含：
Smoke tests include:
1. 生成 10 帧测试视频。
   Generate a 10-frame test video.
2. 测试 `preprocess_video.py` 脚本（使用模拟参数）。
   Test `preprocess_video.py` script with mock parameters.
3. 测试 `per_scene_encode.mjs` 脚本（10 帧模式）。
   Test `per_scene_encode.mjs` script in 10-frame mode.

注意：测试需要安装 ffmpeg 与 libvmaf 支持。如未安装，编码测试将被跳过。
Note: Tests require ffmpeg with libvmaf support. If not available, encoding tests will be skipped.

## 后续计划
完成 `baseline_crf` 与 `per_title` 模式，实现与现有流程一致的双语输出。
Implement the `baseline_crf` and `per_title` modes while keeping bilingual output consistent with the current workflow.

接入真实的超分、降噪或去块模型，并扩展 `ai_preprocess` 目录以支持更多模型选择。
Integrate real super-resolution, denoising, or deblocking models and extend the `ai_preprocess` directory to support more model choices.

输出 DASH/HLS 清单与多清晰度 ABR 梯形，以便与播放器集成。
Produce DASH/HLS manifests and multi-resolution ABR ladders for player integration.

增强结果可视化与报表导出能力，便于跨团队分享成果。
Enhance visualization and reporting capabilities to share results across teams.

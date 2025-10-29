# vod-encoding-bench

## 项目目标 / Project Goals
- 面向点播场景评估多种离线编码策略的效率 / Benchmark multiple offline encoding strategies for video-on-demand scenarios.
- 对比 baseline CRF、Per-Title、Per-Scene 以及 AI 预处理增强后的编码模式 / Compare baseline CRF, per-title, per-scene, and AI-preprocessed encoding workflows.
- 覆盖 H.264、H.265、VP9、AV1 等多种开源编码器 / Support open-source codecs including H.264, H.265, VP9, and AV1.
- 在目标主观质量 (VMAF≈95) 前提下量化不同策略的平均码率与文件体积差异 / Quantify average bitrate and file size differences while maintaining a target subjective quality (VMAF≈95).

## 依赖环境 / Prerequisites
- Node.js 24+ / Node.js version 24 or newer.
- ffmpeg 8+（需启用 libvmaf、libx264、libx265、libvpx-vp9、libaom-av1）/ ffmpeg 8 or newer with libvmaf, libx264, libx265, libvpx-vp9, and libaom-av1 enabled.
- Python 3.9+（可结合 CUDA，用于 AI 预处理脚本）/ Python 3.9 or newer (optionally with CUDA for AI preprocessing).

## 目录速览 / Directory Overview
- `scripts/`：场景检测、码率探测、分段编码、VMAF 计算等核心流水线脚本 / Core pipeline scripts covering scene detection, bitrate probing, segmented encoding, and VMAF evaluation.
- `configs/`：实验矩阵、目标质量、预处理模型等参数定义 / Parameter definitions such as experiment matrix, quality targets, and preprocessing models.
- `ai_preprocess/`：AI 预处理脚本与后续模型集成位置 / AI preprocessing scripts and integration point for future models.
- `results/`：实验摘要输出目录 / Output directory for experiment summaries.
- `workdir/`：临时产物与分段文件（已在 .gitignore 中忽略）/ Workspace for temporary artifacts and segments (ignored by .gitignore).
- `ARCHITECTURE.md`：整体架构设计与模块边界说明 / Architectural overview and module boundaries.

## 配置文件说明 / Configuration Overview
`configs/experiment_matrix.json` 控制实验策略 / The `configs/experiment_matrix.json` file drives the experiment strategy:
- `targetVmaf`：目标 VMAF 阈值 / Target VMAF threshold.
- `heightList`：需要生成的目标分辨率列表 / List of output resolutions to test.
- `codecs`：编码器枚举 / Enumerated codecs to evaluate.
- `modes`：计划执行的策略，其中 `per_scene` 与 `ai_preprocess+per_scene` 已实现 / Strategy modes to execute; `per_scene` and `ai_preprocess+per_scene` are currently implemented.
- `probeBitratesKbps`：探测码率集合，用于寻找满足质量的最小码率 / Candidate bitrates (kbps) for probing acceptable quality levels.
- `gopSec`：GOP 长度（秒）/ GOP duration in seconds.
- `sceneThresh`：场景切换阈值 / Scene change detection threshold.
- `audioKbps`：音频码率 / Audio bitrate in kbps.
- `vmafModel`：libvmaf 模型文件 / libvmaf model file path.
- `aiPreprocessModel`：AI 预处理脚本默认使用的模型名称 / Default model identifier for the AI preprocessing script.

## 快速开始 / Quick Start
1. 准备测试视频，假设路径为 `./sample_input.mp4`。/ Prepare a test video, e.g., `./sample_input.mp4`.
2. 根据实际环境修改 `configs/experiment_matrix.json` 中的编码器、分辨率或模式。/ Adjust codecs, resolutions, or modes in `configs/experiment_matrix.json` as needed.
3. 执行基础 Per-Scene 流水线：/ Run the basic per-scene workflow:
   ```bash
   node ./scripts/run_experiment.mjs ./sample_input.mp4
   ```
4. 若同时启用 `ai_preprocess+per_scene`，脚本会自动调用 `python3 ./ai_preprocess/preprocess_video.py`，生成增强版视频后再运行 Per-Scene 编码。/ When `ai_preprocess+per_scene` is enabled, the script automatically calls `python3 ./ai_preprocess/preprocess_video.py` to create an enhanced video before executing the per-scene encode.

## 输出结果 / Outputs
- `workdir/<输入文件名>/`：按模式与编码器划分的子目录，包含分段文件、最终拼接文件以及参考视频。/ Mode- and codec-specific subdirectories containing segments, final stitched videos, and reference encodes.
- `results/<输入文件名>_summary.json`：记录每种模式的最终 VMAF、估算平均码率与输出文件路径，方便后续分析或可视化。/ Summary JSON listing final VMAF, estimated average bitrate, and output path for each mode.

## 后续计划 / Planned Enhancements
- 完成 `baseline_crf` 与 `per_title` 模式 / Implement the `baseline_crf` and `per_title` modes.
- 接入真实的超分/降噪模型并扩展 `ai_preprocess` 目录 / Integrate real super-resolution or denoising models within `ai_preprocess`.
- 输出 DASH/HLS 清单与多清晰度 ABR 梯形 / Produce DASH/HLS manifests and multi-resolution ABR ladders.
- 增强结果可视化与报表导出 / Enhance visualization and reporting outputs.

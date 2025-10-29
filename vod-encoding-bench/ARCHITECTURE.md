# 架构概览 / Architecture Overview

## 总体流程 / Overall Workflow
1. `run_experiment.mjs` 读取实验矩阵与目标参数，决定需要执行的编码模式 / `run_experiment.mjs` reads the experiment matrix and target parameters to determine which encoding modes to run.
2. 每种模式根据输入视频触发场景检测、码率探测与分段编码，并收集 VMAF 与平均码率指标 / Each mode performs scene detection, bitrate probing, and segmented encoding on the input video while collecting VMAF and average bitrate metrics.
3. 结果写入 `results/<输入文件名>_summary.json`，供后续比对或可视化 / Results are written to `results/<input_name>_summary.json` for later comparison or visualization.

## 核心模块 / Core Modules
- **场景检测 (`scripts/scene_detect.mjs`) / Scene Detection**：
  - 调用 `ffmpeg` 的 `select` + `showinfo` 过滤器解析场景切换时间点 / Uses `ffmpeg` with `select` and `showinfo` filters to detect scene cut timestamps.
  - 使用 `buildSegments` 根据最小/最大时长约束生成候选片段 / `buildSegments` creates candidate segments under min/max duration constraints.
- **码率探测 (`scripts/bitrate_probe.mjs`) / Bitrate Probing**：
  - 对每个片段按配置中的候选码率与编码器生成测试文件 / Encodes each segment with configured bitrate and codec candidates.
  - 通过 `libvmaf` 计算与参考片段的质量差异，选出满足目标 VMAF 的最低码率 / Computes VMAF against the reference segment to pick the lowest bitrate meeting the target.
- **分段编码 (`scripts/per_scene_encode.mjs`) / Segmented Encoding**：
  - 根据决策结果重新编码所有片段，并使用 `ffmpeg concat` 拼接成完整视频 / Re-encodes all segments per decisions and concatenates them via `ffmpeg concat`.
  - 自动生成高质量参考全片，再次运行 VMAF 评估，输出最终指标 / Produces a high-quality reference encode and evaluates final VMAF.
- **AI 预处理 (`ai_preprocess/preprocess_video.py`) / AI Preprocessing**：
  - 当前实现为拷贝占位，后续可挂载超分、降噪等模型 / Currently a copy placeholder, ready for future super-resolution or denoising models.
  - 通过命令行参数约定输入/输出路径与模型名称 / Defines input/output paths and model name via CLI arguments.

## 工作目录布局 / Working Directory Layout
- `workdir/<输入文件名>/<模式_分辨率_编码器>/`
  - `tmp/`：码率探测阶段的临时文件 / Temporary files produced during bitrate probing.
  - `<模式标签>_segments/`：最终输出用的编码片段 / Encoded segments for final output.
  - `report/`：保存整片 VMAF JSON 报告 / JSON reports containing full-video VMAF scores.
  - `final_<codec>_<模式标签>.mp4`：拼接后的视频 / Final concatenated video.
- `workdir/<输入文件名>/ai_preprocess/`
  - `*_enhanced.mp4`：AI 预处理后的中间文件 / Intermediate AI-enhanced videos.

## 扩展指引 / Extension Guidelines
- 要实现 `baseline_crf` 或 `per_title`，可在 `run_experiment.mjs` 中新增对应分支，重用 `avgBitrateKbps` 与结果汇总逻辑 / Implement `baseline_crf` or `per_title` by adding new branches in `run_experiment.mjs` while reusing `avgBitrateKbps` and summary logic.
- 引入真实 AI 模型时，只需改写 `preprocess_video.py`，保持输入/输出接口一致 / Replace `preprocess_video.py` with real models while preserving the CLI interface.
- 若要并行化探测流程，可以在 `decideBitrateForSegment` 周边引入任务队列或子进程池，但需注意临时目录命名冲突 / To parallelize probing, introduce task queues or worker pools around `decideBitrateForSegment`, ensuring temporary directories remain unique.

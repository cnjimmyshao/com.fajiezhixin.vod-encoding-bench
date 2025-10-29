# 架构概览
Architecture Overview

## 总体流程
`run_experiment.mjs` 读取实验矩阵与目标参数，决定需要执行的编码模式。
`run_experiment.mjs` reads the experiment matrix and target parameters to determine which encoding modes to run.

每种模式根据输入视频触发场景检测、码率探测与分段编码，并收集 VMAF 与平均码率指标。
Each mode performs scene detection, bitrate probing, and segmented encoding on the input video while collecting VMAF and average bitrate metrics.

结果写入 `results/<输入文件名>_summary.json`，供后续比对或可视化。
Results are written to `results/<input name>_summary.json` for later comparison or visualization.

## 核心模块
**场景检测 (`scripts/scene_detect.mjs`)**
Scene Detection (`scripts/scene_detect.mjs`)

- 调用 `ffmpeg` 的 `select` 与 `showinfo` 过滤器解析场景切换时间点。
  Uses `ffmpeg` with `select` and `showinfo` filters to detect scene cut timestamps.
- 使用 `buildSegments` 根据最小与最大时长约束生成候选片段。
  `buildSegments` creates candidate segments under minimum and maximum duration constraints.

**码率探测 (`scripts/bitrate_probe.mjs`)**
Bitrate Probing (`scripts/bitrate_probe.mjs`)

- 对每个片段按配置中的候选码率、编码器与实现方式生成测试文件。
  Encodes each segment with configured bitrate, codec, and implementation candidates.
- 通过 `libvmaf` 计算与参考片段的质量差异，选出满足目标 VMAF 的最低码率。
  Computes VMAF against the reference segment to pick the lowest bitrate meeting the target.

**分段编码 (`scripts/per_scene_encode.mjs`)**
Segmented Encoding (`scripts/per_scene_encode.mjs`)

- 根据决策结果重新编码所有片段，并使用 `ffmpeg concat` 拼接成完整视频。
  Re-encodes all segments per decisions and concatenates them via `ffmpeg concat`.
- 自动生成高质量参考全片，再次运行 VMAF 评估，输出最终指标。
  Produces a high-quality reference encode and evaluates final VMAF scores.

**AI 预处理 (`ai_preprocess/preprocess_video.py`)**
AI Preprocessing (`ai_preprocess/preprocess_video.py`)

- 当前实现为拷贝占位，后续可挂载超分、降噪等模型。
  Currently a copy placeholder, ready for future super-resolution or denoising models.
- 通过命令行参数约定输入、输出路径与模型名称。
  Defines input and output paths plus model name via CLI arguments.

## 工作目录布局
`workdir/<输入文件名>/<模式_分辨率_编码器_实现>/`
`workdir/<input name>/<mode_resolution_codec_impl>/`

- `tmp/`：码率探测阶段的临时文件。
  `tmp/`: Temporary files produced during bitrate probing.
- `<模式标签>_segments/`：最终输出用的编码片段。
  `<mode tag>_segments/`: Encoded segments for final output.
- `report/`：保存整片 VMAF JSON 报告。
  `report/`: JSON reports containing full-video VMAF scores.
- `final_<codec>_<模式标签>.mp4`：拼接后的视频。
  `final_<codec>_<mode tag>.mp4`: Final concatenated video.

`workdir/<输入文件名>/ai_preprocess/`
`workdir/<input name>/ai_preprocess/`

- `*_enhanced.mp4`：AI 预处理后的中间文件。
  `*_enhanced.mp4`: Intermediate AI-enhanced videos.

## 扩展指引
要实现 `baseline_crf` 或 `per_title`，可在 `run_experiment.mjs` 中新增对应分支，重用 `avgBitrateKbps` 与结果汇总逻辑。
To implement `baseline_crf` or `per_title`, add new branches in `run_experiment.mjs` while reusing `avgBitrateKbps` and summary logic.

引入真实 AI 模型时，只需改写 `preprocess_video.py`，保持输入与输出接口一致。
When integrating real AI models, modify `preprocess_video.py` while keeping the input and output interface consistent.

若要并行化探测流程，可以在 `decideBitrateForSegment` 附近引入任务队列或子进程池，并注意临时目录命名冲突。
To parallelize probing, introduce task queues or worker pools around `decideBitrateForSegment` while avoiding naming conflicts in temporary directories.

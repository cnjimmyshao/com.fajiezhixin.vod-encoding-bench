# vod-encoding-bench

## 项目目标
面向点播场景评估多种离线编码策略的效率。

对比 baseline CRF、Per-Title、Per-Scene 以及 AI 预处理增强后的编码模式。

覆盖 H.264、H.265、VP9、AV1 等多种开源编码器。

在目标主观质量 (VMAF≈95) 前提下量化不同策略的平均码率与文件体积差异。

## 依赖环境
Node.js 24+。

ffmpeg 8+（需启用 libvmaf、libx264、libx265、libvpx-vp9、libaom-av1，并建议安装支持 NVENC 的驱动）。

Python 3.9+（可结合 CUDA，用于 AI 预处理脚本）。

## 目录速览
`scripts/`：场景检测、码率探测、分段编码、VMAF 计算等核心流水线脚本。

`configs/`：实验矩阵、目标质量、预处理模型等参数定义。

`ai_preprocess/`：AI 预处理脚本与后续模型集成位置。

`results/`：实验摘要输出目录。

`workdir/`：临时产物与分段文件（已在 .gitignore 中忽略）。

`ARCHITECTURE.md`：整体架构设计与模块边界说明。

## 配置文件说明
`configs/experiment_matrix.json` 控制实验策略。

`targetVmaf`：目标 VMAF 阈值。

`heightList`：需要生成的目标分辨率列表。

`codecs`：编码器枚举。

`encoderImplementations`：编码器实现列表，用于比较 CPU 与 NVENC。

`modes`：计划执行的策略，其中 `per_scene` 与 `ai_preprocess+per_scene` 已实现。

`probeBitratesKbps`：探测码率集合，用于寻找满足质量的最小码率。

`gopSec`：GOP 长度（秒）。

`sceneThresh`：场景切换阈值。

`audioKbps`：音频码率。

`vmafModel`：libvmaf 模型文件路径。

`aiPreprocessModel`：AI 预处理脚本默认使用的模型名称。

## 快速开始
准备测试视频，假设路径为 `./sample_input.mp4`。

根据实际环境修改 `configs/experiment_matrix.json` 中的编码器、分辨率、模式以及编码器实现。

执行基础 Per-Scene 流水线：

```
node ./scripts/run_experiment.mjs ./sample_input.mp4
```

若启用 `ai_preprocess+per_scene`，脚本会自动调用 `python3 ./ai_preprocess/preprocess_video.py`，生成增强版视频后再运行 Per-Scene 编码。

启用 NVENC 比较时，请确认硬件与驱动已安装，并在配置中保留 `nvenc` 实现以生成 CPU 与 GPU 的对照结果。

目前 NVENC 流程支持 H.264 与 H.265 编码器；VP9 与 AV1 会自动回退到 CPU 实现。

## 输出结果
`workdir/<输入文件名>/`：按模式、编码器、实现方式划分的子目录，包含分段文件、最终拼接文件以及参考视频。

`results/<输入文件名>_summary.json`：记录每种模式的最终 VMAF、估算平均码率、输出文件路径以及使用的编码器实现，便于后续分析或可视化。

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

```
npm test
```

烟雾测试包含：
1. 生成 10 帧测试视频。
2. 测试 `preprocess_video.py` 脚本（使用模拟参数）。
3. 测试 `per_scene_encode.mjs` 脚本（10 帧模式）。

注意：测试需要安装 ffmpeg 与 libvmaf 支持。如未安装，编码测试将被跳过。

## 后续计划
完成 `baseline_crf` 与 `per_title` 模式，实现与现有流程一致的双语输出。

接入真实的超分、降噪或去块模型，并扩展 `ai_preprocess` 目录以支持更多模型选择。

输出 DASH/HLS 清单与多清晰度 ABR 梯形，以便与播放器集成。

增强结果可视化与报表导出能力，便于跨团队分享成果。

# vod-encoding-bench

目标：
- 针对 VOD（点播场景）离线编码
- 测试多种编码策略（baseline CRF / per-title / per-scene / AI+per-scene）
- 支持多种编码器 (H.264 / H.265 / VP9 / AV1)
- 在保证目标主观质量 (VMAF≈95) 的情况下，比较最终平均码率、文件大小，量化带宽节省

需要环境：
- Node.js 24+
- ffmpeg 8+ (需包含 libvmaf, libx264, libx265, libvpx-vp9, libaom-av1)
- 可选: CUDA + Python (用于 AI 预处理)

运行一个 per-scene 实验示例：
```bash
node ./scripts/run_experiment.mjs ./sample_input.mp4

运行后会在：
•workdir/<input_basename>/final_<codec>_perScene.mp4 生成最终成片
•results/<input_basename>_summary.json 生成摘要，包含:
•codec
•height
•finalVmaf (整片 VMAF)
•avgBitrateKbps (估算平均码率)
•outputFile

后续扩展：
•baseline_crf 模式
•per_title 模式
•ai_preprocess + per_scene 模式
•输出 DASH/HLS 单文件清单
•汇总多清晰度 ABR ladder
```

---

# AI 预处理模块说明
AI Preprocessing Module Guide

`preprocess_video.py` 当前仅执行文件拷贝，用于占位接口。
`preprocess_video.py` currently performs a simple file copy as a placeholder interface.

通过命令行参数 `--input`、`--output`、`--model` 约定与主流程的对接方式。
The command-line flags `--input`, `--output`, and `--model` define how the script connects with the main pipeline.

后续集成超分、降噪或去块模型时，请保持参数一致，以便 `run_experiment.mjs` 无需改动即可复用。
Maintain the same arguments when integrating super-resolution, denoising, or deblocking models so that `run_experiment.mjs` works without modification.

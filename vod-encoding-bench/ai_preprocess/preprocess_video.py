"""
preprocess_video.py

后续将集成 Real-ESRGAN / 降噪 / 去块 / 超分 等模型
把原视频转成 '更干净、更好压缩' 的版本，然后输出到指定路径。

伪接口约定：
python preprocess_video.py --input in.mp4 --output enhanced.mp4 --model realesrgan_x4plus

当前先不实现推理细节，后续再填。
"""
import argparse
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--model", default="realesrgan_x4plus")
args = parser.parse_args()

# 目前先直接copy，后面再接入真实的超分/降噪推理
shutil.copyfile(args.input, args.output)
print(f"[mock] preprocessed {args.input} -> {args.output} using model={args.model}")

# Visible Surface Mockup

[English](README.md) · [简体中文](README.zh-CN.md)

一个浏览器优先的可见曲面 Mockup 编辑器：把设计放进照片的深度场，保持
贴图可编辑，并使用同一个 Three.js 场景完成预览和 PNG 导出。

仓库地址：[github.com/LaughingZhu/mockup](https://github.com/LaughingZhu/mockup)

这是一个可以直接下载运行的本地 Demo，不依赖 OSS、业务 API 或在线 Provider。
模型服务只监听本机 `127.0.0.1:8080`。

## 功能

- 使用 Depth Anything V2 Small 分析整张图片的相对深度；
- 默认不需要点击物体或选择表面，所有位置都可以拖动；
- 当前 placement 对应的深度连通区域决定贴图的可见范围；
- 支持拖到图片外再拖回、四角缩放、顶部旋转手柄和键盘微调；
- 预览和 PNG 导出复用同一个 Three.js renderer；
- SAM ViT-B 保留给可选 candidate API，默认 Demo 不限制全图拖动；
- 没有启动模型服务时可以使用内置样例。

## 快速开始

环境要求：Node.js 20+、pnpm 9+、Python 3.12（建议）。

### 启动模型服务

```bash
cd services/model-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

第一次请求会从 Hugging Face 下载模型权重，之后使用本地缓存：

- `depth-anything/Depth-Anything-V2-Small-hf`
- `facebook/sam-vit-base`

### 启动前端

另开一个终端：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 <http://localhost:4173/>。Demo 默认显示英文，点击右上角 `中文` 可切换
到中文，再点击 `English` 切回英文。

集成 React 编辑器时，可以传 `locale="zh"` 使用内置中文控制文案；默认值是
`locale="en"`。

如果暂时不启动 Python 服务，可以点击 **使用内置样例** 检查拖动、缩放、旋转
和导出流程。

## 模型作用

- **Depth Anything V2 Small**：提供相对深度，驱动网格位移、弧长 UV、曲面和透视；
- **SAM ViT-B**：在需要语义候选区域时提供可选 mask。默认 Demo 保持全图拖动自由。

模型名称和 localhost 地址固定在 Demo 中，不提供 OSS 或 Provider 选择器。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

完整结构、API 和限制说明见 [docs/api.md](docs/api.md)、
[docs/architecture.md](docs/architecture.md) 和 [docs/limitations.md](docs/limitations.md)。

## 限制

这是单视角的可见曲面近似，不是完整 3D 重建，不推断背面、隐藏几何、物理尺度
或任意视角变化。相对深度是映射信号，不是测量值。

## License

源代码使用 [MIT License](LICENSE)。模型权重遵循各自上游许可证，未随仓库分发。

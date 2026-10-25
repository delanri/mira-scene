# Mira — 雨夜咖啡馆

一个实时交互角色场景体验。暴雨过后的深夜，透过咖啡馆的玻璃窗，遇见一个等着谁的旅行摄影师。

## 预览

打开页面即进入场景 —— 玻璃上缓缓滑落的水珠、窗外的细雨、暖黄的灯光、桌上的咖啡和相机。Mira 坐在窗后，你可以用文字或语音和她对话。

## 功能

- **场景驱动交互**：不是聊天列表，是一个完整的视觉场景，角色的情绪和动作会随对话自然变化
- **文字 + 语音输入**：支持键盘输入和长按语音（Web Speech API）
- **TTS 语音回复 + 字幕**：角色用语音说话，配有逐字打出的字幕，说完后字幕以雨水冲刷效果渐隐
- **语音打断**：角色说话时可以随时输入文字或按麦克风打断
- **情绪与动作系统**：5 种情绪状态（neutral / curious / happy / melancholy / surprised）、6 种动作（lean_forward / look_away / show_photo / sip_coffee / touch_hair_clip）
- **场景事件**：闪电、灯光闪烁、暴雨加强、展示照片（极光 polaroid）
- **多模态**：AI 生成场景图片（通过 DALL-E API，Mock 模式下使用内置极光场景）
- **Mock 演示模式**：无需 API key 即可完整体验，前端所有交互功能均可运行

## 技术栈

- **前端**：Vue 3 Composition API（CDN，无构建步骤）、纯 CSS 动画、内联 SVG 角色
- **后端**：Flask（Python）
- **AI 服务**：OpenAI GPT-4o-mini（对话）、OpenAI TTS（语音合成）
- **语音识别**：Web Speech API（浏览器原生，推荐 Chrome）

## 运行

```bash
# 1. 安装依赖
pip install flask python-dotenv requests

# 2. 配置环境变量（可选，不配置则自动进入 Mock 演示模式）
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY

# 3. 启动
python server.py
```

浏览器打开 `http://localhost:5000`

## 项目结构

```
mira-scene/
├── server.py          # Flask 后端 + OpenAI API 集成
├── mock_data.py       # Mock 模式预设对话数据
├── static/
│   ├── index.html     # 场景页面（Vue 3 模板 + 内联 SVG 角色）
│   ├── css/
│   │   └── style.css  # 全部样式 + 动画
│   └── js/
│       └── app.js     # Vue 应用逻辑（对话、TTS、语音识别、场景控制）
├── README.md
└── AI_USAGE.md
```

## 浏览器兼容

推荐 Chrome（语音识别需要 Chrome 或 Edge）。场景动画和视觉效果在所有现代浏览器中均可正常显示。

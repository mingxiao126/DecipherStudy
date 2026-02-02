# DecipherStudy

Decipher AI is a next-generation, AI-powered academic preparation platform designed to solve the "Knowledge Problem" in complex quantitative disciplines. By leveraging AI-driven decomposition, it transforms dense, multi-layered academic prompts into clear logical signals, bridging the gap between theoretical study and exam-ready mastery.

## 项目目录结构

```
DecipherStudy/
├── README.md              # 项目说明文档
├── index.html             # 主页面（3D 闪卡界面）
├── app.js                 # 闪卡应用核心逻辑
├── decoder.html           # 难题拆解器页面
├── decoder.js             # 拆解器核心逻辑
├── content/               # 学习内容数据目录
│   ├── topics.json        # 主题列表配置
│   ├── decoders.json      # 难题拆解数据
│   ├── economics_w1.json  # 经济学第一周闪卡数据
│   ├── economics_w2.json  # 经济学第二周闪卡数据
│   ├── economics_w3.json  # 经济学第三周闪卡数据
│   └── stat_124.json      # 统计学 124 闪卡数据
└── .git/                  # Git 版本控制目录
```

## 功能特性

### 🎨 视觉设计
- **玻璃拟态（Glassmorphism）风格**：半透明背景、磨砂质感、边框发光
- **3D 翻转动画**：平滑的 180° Y轴翻转，带弹性效果
- **星空背景**：动态闪烁的星空效果
- **暗色调主题**：深邃的背景色（#0f172a），护眼舒适

### 🚀 核心功能
- **主题选择**：从 `topics.json` 加载主题列表，动态加载对应 JSON 数据
- **3D 闪卡翻转**：点击卡片实现平滑的 3D 翻转效果
- **导航控制**：上一题/下一题按钮，带淡入淡出位移动画
- **随机乱序**：Fisher-Yates 洗牌算法，打乱题目顺序
- **计时器模式**：10秒倒计时，适合老师考查模式
- **进度显示**：实时显示当前题目位置（如：3 / 10）

### 📚 学习辅助功能
- **LaTeX 公式支持**：使用 KaTeX 渲染数学公式（支持行内 `$...$` 和块级 `$$...$$`）
- **掌握度标记系统**：🔴 需重练、🟡 模糊、🟢 已掌握，数据保存在 LocalStorage
- **错题本功能**：自动统计需重练题目，支持"仅复习需重练题目"筛选模式
- **关键词高亮（Signal Tags）**：在题目中高亮显示关键考点信号词
- **分步逻辑显示（Step-by-Step）**：点击查看详细的解题步骤和逻辑拆解
- **内嵌词典（Micro-Glossary）**：点击"核心生词"查看专业术语的中文释义
- **题目类型标签**：显示题目类型（概念题、计算题、对比题等）

### ⌨️ 快捷键支持
- **Space（空格）**：翻转卡片
- **←（左箭头）**：上一题
- **→（右箭头）**：下一题
- **S 键**：随机乱序

## 使用方法

1. **启动本地服务器**（由于使用 fetch 加载 JSON，需要服务器环境）：
   ```bash
   # 使用 Python
   python3 -m http.server 8000
   
   # 或使用 Node.js
   npx serve
   ```

2. **打开浏览器**访问：`http://localhost:8000`

3. **选择主题**：从下拉菜单中选择要学习的主题

4. **开始学习**：
   - 点击卡片查看答案
   - 使用按钮或快捷键切换题目
   - 点击"随机乱序"打乱顺序
   - 使用计时器进行限时练习
   - 标记掌握度（🔴 需重练、🟡 模糊、🟢 已掌握）
   - 勾选"仅复习需重练题目"进行针对性练习
   - 点击"核心生词"查看专业术语解释
   - 查看分步逻辑拆解（如果题目包含 steps 字段）

## 数据结构

每个主题的 JSON 文件格式（支持完整功能）：

```json
[
  {
    "question": "英文问题（支持 LaTeX 公式：$Y = C + I + G + NX$）",
    "answer": "中文回答 + **逻辑要点**（支持 Markdown 加粗和 LaTeX）",
    "category": "知识分类",
    "type": "题目类型（概念题/计算题/对比题/公式题）",
    "signals": ["关键词1", "关键词2", "关键词3"],
    "steps": [
      "Step 1: 第一步说明",
      "Step 2: 第二步说明",
      "Step 3: 第三步说明"
    ],
    "glossary": [
      {
        "term": "专业术语",
        "definition": "中文释义"
      }
    ]
  }
]
```

### 字段说明
- `question`（必需）：问题文本，支持 LaTeX 公式（`$...$` 行内，`$$...$$` 块级）
- `answer`（必需）：答案文本，支持 Markdown 加粗和 LaTeX
- `category`（可选）：知识分类
- `type`（可选）：题目类型标签
- `signals`（可选）：关键词数组，会在题目下方高亮显示
- `steps`（可选）：分步逻辑数组，在答案面显示详细步骤
- `glossary`（可选）：生词词典数组，提供专业术语解释

## 技术栈

- **HTML5**：语义化结构
- **Tailwind CSS**：快速样式开发
- **原生 JavaScript**：无框架依赖，极致性能
- **KaTeX**：LaTeX 数学公式渲染（CDN）
- **LocalStorage API**：掌握度数据持久化存储
- **CSS 3D Transforms**：perspective、transform-style: preserve-3d
- **CSS Animations**：弹性动画、淡入淡出效果

## 模块说明

### 📚 闪卡学习模块 (`index.html`)
- 3D 翻转闪卡系统
- LaTeX 公式支持
- 掌握度标记与错题本
- 关键词高亮与分步逻辑
- 内嵌词典功能

### 🔍 难题拆解器模块 (`decoder.html`)
- **2x2 网格布局**：原题、解读、已知条件、陷阱
- **逐步拆解**：点击推进，逐步揭示题目逻辑
- **同步高亮**：自动高亮原题中的关键文本
- **陷阱识别**：红色高亮显示题目陷阱
- **详细解答**：完整的解题步骤和知识点标注

## 当前状态

✅ **项目已完成所有核心功能开发，包括：**
- ✅ 3D 翻转闪卡系统
- ✅ LaTeX 公式支持
- ✅ 掌握度标记与错题本
- ✅ 关键词高亮与分步逻辑
- ✅ 内嵌词典功能
- ✅ 筛选与统计功能
- ✅ 难题拆解器（Logic Decoder）

可以正常使用！🎉

## 难题拆解器使用说明

1. **访问页面**：`http://localhost:8000/decoder.html`
2. **选择题目**：从下拉菜单选择要拆解的题目
3. **逐步拆解**：
   - 点击页面任意位置（或按空格键）推进步骤
   - 每次点击显示一个新的解读步骤
   - 原题中的对应文本会自动高亮
   - 已知条件和知识点自动添加到左下角
4. **查看陷阱**：所有步骤完成后，显示题目陷阱
5. **查看详解**：最后显示完整的解题步骤

## 难题拆解器 JSON 格式

```json
{
  "id": "题目唯一标识",
  "title": "题目标题",
  "original_question": "原始题目文本（支持 LaTeX）",
  "decoding_steps": [
    {
      "trigger_text": "要高亮的文本",
      "explanation": "解读说明",
      "known_condition": "已知条件（支持 LaTeX）",
      "knowledge_point": "知识点",
      "is_trap": false
    }
  ],
  "traps": [
    {
      "text": "陷阱标题",
      "description": "陷阱详细说明"
    }
  ],
  "detailed_solution": {
    "steps": ["步骤1", "步骤2"],
    "knowledge_type": "Explicit (显性) 或 Implicit (隐性)"
  }
}
```

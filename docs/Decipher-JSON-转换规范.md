# 难题拆解器 JSON 格式（Decipher JSON 转换规范）

本文档为**规范主文档**：定义旧版→新版字段对应、新增字段含义与展示规则、解析与 UI 的最小实现要点（点击逐行显示 + 暂停同步逻辑）。

---

## 0. 数据文件整体结构

- **旧版**：可能是单题对象或题目数组。
- **新版**：推荐统一为 `Array<Problem>`（即 `problems[]`）。

每个 **Problem** 顶层键固定为：

- `id`
- `title`
- `original_question`
- `segments`
- `traps`
- `solution`

---

## 1. 顶层字段映射

| 旧版字段 | 新版字段 | 说明 | UI 用途 |
|----------|----------|------|----------|
| id | id | 题目唯一标识 | 调试/定位题目 |
| title | title | 题目标题 | 题目下拉框显示 |
| original_question | original_question | 原题全文（必须保真） | 左上「原题」展示；高亮匹配源文本 |
| decoding_steps | segments | 旧版「信息点列表」升级为「阅读流片段」 | 驱动逐句解读/暂停同步 |
| traps | traps | 结构略调（text→title） | 题干读完后的总结陷阱 |
| detailed_solution | solution | 旧版详解对象升级为「步骤数组」 | 逐步显示详解 + 来源标记 |

---

## 2. decoding_steps → segments 的字段对应

**旧版单步结构**：

- trigger_text
- explanation
- known_condition
- knowledge_point
- is_trap

**新版**对应为一个 **Segment**（当 `has_info=true` 时）：

| 旧 decoding_steps | 新 segments | 说明 |
|-------------------|-------------|------|
| trigger_text | highlight_text | 必须是 original_question 的连续子串，用于原题高亮 |
| explanation | explanation | 用于「已知条件」列表的解释文案 |
| known_condition | condition | 同步到「已知条件」区域的标题/变量 |
| knowledge_point | knowledge | 知识点标签 |
| is_trap | is_trap | 该段是否干扰项（可选字段） |

---

## 3. 新增字段说明（实现必须支持）

### 3.1 Segment 新增：text

- **含义**：解读框逐行显示的「当前阅读句子/短语」。
- **展示**：每次点击按顺序 append 到「解读题目」区域。
- **注意**：text 不要求必须等于原题句子，但建议与原题一致以便学习者对齐。

### 3.2 Segment 新增：has_info

- **含义**：是否包含需要同步的关键信息。
- **交互作用（关键）**：决定「是否暂停等待同步」。
  - **has_info=false**：显示后不暂停，自动进入下一段。
  - **has_info=true**：显示后暂停；**下一次点击**才执行同步（写入已知条件）。

### 3.3 Segment 新增：highlight_color

- **含义**：高亮与语义分类（供 UI 用不同颜色呈现）。
- **允许值**：`green` | `yellow` | `red` | `blue`（扩展可支持 `orange`、`trap`）。
- **展示规则**：
  - 原题高亮：`<mark class="mark-${highlight_color}">highlight_text</mark>`（或等价 class）。
  - 解读框：信息段可用同色边框/底色提示。
- **建议语义**：
  - **green**：结构/样本/总体/框架变量
  - **yellow**：普通已知条件/数值输入
  - **red**：陷阱/误导/干扰信息（常与 is_trap 配合）
  - **blue**：最终目标/推断结论/问题问什么

### 3.4 Segment 可选：is_trap

- **含义**：该段本身是误导信息或干扰项。
- **展示规则**：
  - 解读框该段加「红色警示/脉冲样式」。
  - 同步时额外写入「即时陷阱列表」（syncTrap）。
- **注意**：is_trap 只能用于「信息本身是干扰」，不能把「难点」标为陷阱。

---

## 4. traps 模块结构变化

**旧版 traps**：

```json
{ "text": "...", "description": "..." }
```

**新版 traps**：

```json
{ "title": "...", "description": "..." }
```

**UI 展示**：

- 在 segments 全部读完后**统一展示**（总结式提醒）。
- 与 segment.is_trap 的「即时陷阱」互补：即时陷阱在阅读过程中逐条写入，traps[] 为读完后的一次性总结。

---

## 5. detailed_solution → solution 的结构变化

**旧版**：

```json
"detailed_solution": {
  "steps": ["步骤1", "步骤2"],
  "knowledge_type": "Explicit/Implicit"
}
```

**新版**：

```json
"solution": [
  {
    "step_desc": "...",
    "content": "...",
    "source_type": "prompt_info|external_knowledge",
    "source_label": "..."
  }
]
```

**新增字段说明**：

| 字段 | 含义 | UI |
|------|------|-----|
| step_desc | 步骤标题 | 作为每步的小标题显示 |
| content | 该步说明或公式（支持 LaTeX） | 步骤正文 |
| source_type | 该步来源归因 | 允许值：prompt_info / external_knowledge；用不同 badge/图标区分（如 📍 vs 💡） |
| source_label | 来源说明文案（短） | 显示在 badge 上，如「来自题干提取」「外部核心知识」 |

**可选**：`source_refs` 为字符串数组，对应已知条件条目的 id（如 `["condition-0","condition-2"]`），展示该步时左侧对应条件可联动闪烁。

---

## 6. 新版交互流程（实现要点）

需要两个状态：

- **currentIndex**：当前 segments 下标。
- **isPausedForSync**：是否停在信息段等待同步。

**点击逻辑**：

1. **若 isPausedForSync === false**：
   - 渲染 `segments[currentIndex].text` 到解读区域。
   - 若 **has_info === true**：
     - 在 original_question 中高亮 highlight_text（按 highlight_color）。
     - 设 **isPausedForSync = true**（停住，不增加 currentIndex）。
   - 若 **has_info === false**：
     - currentIndex++，并**继续自动推进**直到遇到 has_info 段或结束（可递归/循环 processNextSegment）。
2. **若 isPausedForSync === true**：
   - 执行**同步**：把该段 condition / knowledge / explanation 加到「已知条件列表」。
   - 若 is_trap === true，同时写入「即时陷阱列表」。
   - 设 isPausedForSync = false；currentIndex++（等待下一次点击继续）。

**结束后**：

- 先展示 **traps[]**（若存在且未展示过）。
- 再逐步展示 **solution[]**（每次点击展示下一步）。

---

## 7. 展示层建议（最小要求）

| 区域 | 内容 |
|------|------|
| 原题区域 | 渲染 original_question + 高亮 highlight_text（按 highlight_color） |
| 解读区域 | 逐段 append segment.text |
| 已知条件区域 | 同步写入 condition / knowledge / explanation（列表项） |
| 陷阱区域 | **即时**：来自 segment.is_trap（syncTrap）；**总结**：来自 traps[]（全部读完后统一展示） |
| 详解区域 | 按 solution[] 逐步展示，用 source_type / source_label 做 badge |

---

## 小结

- **旧字段 → 新字段**：见 §1、§2、§4、§5。
- **新字段含义**：尤其是 **has_info** 的「暂停→同步」机制，见 §3、§6。
- **UI 与状态机**：见 §6、§7。

实现时以本文档为准。类型定义与校验：

- **TypeScript**：`docs/decoder-schema.d.ts`（Problem / Segment / Trap / SolutionStep）
- **运行时**：`decoder-schema.js`（JSDoc + `validateDecoderProblem()`、`normalizeDecoderProblems()`）

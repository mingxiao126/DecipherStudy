# 题拆解器 JSON 文件说明

本文档说明题拆解器（Logic Decoder）使用的 JSON 文件结构、每步这样写的原因，以及系统如何解析和使用它们。

**规范主文档（旧版→新版字段映射、交互流程）**：参见 [Decipher-JSON-转换规范.md](./Decipher-JSON-转换规范.md)。

---

## 一、文件层级与入口

### 1. 配置文件：`content/decoder_topics.json`

**作用**：定义「科目 → 周次/综合 → 具体 JSON 文件」的映射，供页面顶部三级下拉框使用。

**格式**：数组，每项包含：

| 字段 | 含义 | 示例 |
|------|------|------|
| `subject` | 科目名称（一级选择） | `"经济学"`、`"统计学"` |
| `name` | 周次或综合大题名称（二级选择） | `"经济学 - 第一周"`、`"经济学 - 综合大题"` |
| `file` | 对应的题目 JSON 文件名（在 `content/` 下） | `"decoders_econ_w1.json"` |

**示例**：

```json
[
  { "subject": "经济学", "name": "经济学 - 第一周", "file": "decoders_econ_w1.json" },
  { "subject": "经济学", "name": "经济学 - 综合大题", "file": "decoders_econ_comprehensive.json" }
]
```

**系统怎么用**：

- 页面加载时 `loadTopics()` 请求该文件，得到 `topics` 数组。
- `populateSubjectSelector()` 用 `subject` 去重后填充「科目」下拉框。
- 用户选科目后，`populateWeekSelector()` 按 `subject` 筛选，用 `name` 和 `file` 填充「周次/综合」下拉框。
- 用户选周次后，`loadWeekFile(file)` 请求 `content/{file}`，得到该周次的**题目列表**。

---

## 二、题目数据文件：`content/decoders_*.json`

每个周次或综合大题对应一个 JSON 文件。文件内容为**题目数组**（或单个题目对象，系统会转成数组）。

### 2.1 单道题顶层结构

| 字段 | 必填 | 含义 |
|------|------|------|
| `id` | 建议 | 题目唯一标识，便于调试或扩展 |
| `title` | 建议 | 题目名称，显示在「请选择具体题目」下拉框中 |
| `original_question` | ✅ | 完整题干原文，显示在左上「原题」格 |
| `segments` | ✅ | 题干按句/按段的拆分，驱动「逐句解读」交互 |
| `traps` | 可选 | 陷阱汇总列表，在片段读完后统一展示 |
| `solution` | 可选 | 详解：可为字符串（旧版）或步骤数组（新版） |

---

## 三、`segments`：为什么按「片段」写、每个字段干什么

题拆解器的核心是**「像人眼一样逐句扫题 → 发现信息 → 暂停 → 同步到已知条件」**。因此题干必须拆成**顺序片段**，并且标明「这一段有没有可提取的信息」。

### 3.1 每个 segment 的字段

| 字段 | 必填 | 含义 | 系统怎么用 |
|------|------|------|------------|
| `text` | ✅ | 本段在题干中对应的句子/短语（展示在「解读题目」框） | 按顺序追加到「解读题目」区域，支持 KaTeX |
| `has_info` | ✅ | 本段是否包含「条件/知识点」 | `true`：显示后**暂停**，等用户再点一次，把本段信息同步到「已知条件」再继续；`false`：只显示文字，不暂停，自动进下一段 |
| `highlight_text` | 当 has_info 为 true 时建议 | 原题中要被高亮的那句话/短语（需与 `original_question` 中原文一致或可匹配） | 在「原题」区域用 `<mark>` 高亮这段文字；颜色由 `highlight_color` 决定 |
| `highlight_color` | 可选 | 高亮颜色类型 | `yellow` / `green` / `red` / `blue` / `orange` / `trap`，对应不同 CSS 类（如陷阱用红色、当前用亮色、过去用淡色） |
| `condition` | 当 has_info 为 true 时建议 | 提炼出的「已知条件」短句（如 "M = 120"） | 同步时写入「已知条件 & 知识点」列表，作为列表项标题 |
| `knowledge` | 可选 | 对应的知识点名称 | 显示在已知条件列表项下方，说明「考的是哪块知识」 |
| `explanation` | 可选 | 为什么这句话能推出该条件/知识点 | 显示在已知条件列表项中，小字说明 |
| `is_trap` | 可选 | 本段是否为「陷阱/干扰信息」 | 若为 `true`：解读框中该段用红色+脉冲样式；同步时除了进已知条件，还会调用 `syncTrap()` 往「陷阱」框里追加一条 |

### 3.2 为什么这样设计

- **`has_info`**：区分「纯叙述」和「含数据/条件」的句子。纯叙述只读不停；含信息的句子读完后停下来，让用户点一下再「同步」，强化「发现 → 记录」的两步心流。
- **`highlight_text`**：原题和解读一一对应，学生能清楚看到「题目里哪句话」对应「已知条件里哪一条」。
- **`condition` / `knowledge` / `explanation`**：已知条件区是**累积列表**，每条对应一个「条件 + 知识点 + 解释」，方便解题时回顾。
- **`is_trap`**：干扰项单独标出，既在解读里红字提示，又通过 `syncTrap` 汇总到陷阱框，和 `traps` 数组配合（见下）。

### 3.3 系统使用 segments 的流程（三态逻辑）

1. **初始**：`currentIndex = 0`，`isPausedForSync = false`。
2. **用户点击**：
   - **若 `isPausedForSync === true`**（当前段有信息且已显示，在等「同步」）  
     → 执行 `syncInformation(currentSegment)`，把该段的 condition/knowledge/explanation 追加到已知条件列表；若是陷阱再 `syncTrap`；然后 `isPausedForSync = false`，`currentIndex++`，**本次不再自动往后**。
   - **若 `isPausedForSync === false`**  
     → 调用 `processNextSegment()`。
3. **processNextSegment()**：
   - 若 `currentIndex >= segments.length`：先看是否要展示 `traps`，再逐条展示 `solution`（见下），不再读新片段。
   - 否则取 `segments[currentIndex]`：
     - 在「解读题目」里追加显示 `segment.text`（若有 `has_info` 会加高亮样式，若是 `is_trap` 会加红色脉冲）。
     - 若 `segment.has_info === true`：在「原题」上高亮 `highlight_text`，设 `isPausedForSync = true`，**不增加 currentIndex**，等待下次点击同步。
     - 若 `segment.has_info === false`：`currentIndex++`，递归调用 `processNextSegment()` 继续下一段（无信息段落会连续自动滚过）。

这样实现「扫描 → 发现 → 暂停 → 同步 → 再继续」的节奏。

---

## 四、`traps`：陷阱汇总

**作用**：在**所有 segments 读完后**、**详解之前**，一次性展示本题的常见陷阱总结，提醒学生「不要踩的坑」。

**格式**：对象数组，每个对象建议包含：

| 字段 | 含义 |
|------|------|
| `title` | 陷阱名称（如「环境干扰项」） |
| `description` 或 `text` | 陷阱说明（系统会优先用 `title` + 说明渲染） |

**系统怎么用**：当 `currentIndex >= segments.length` 且 `traps` 非空且陷阱列表里还没有渲染过条目时，调用 `showTraps(traps)` 往「陷阱」格子里填充；之后每次点击再逐步展示 `solution`。

**与 segments 的关系**：`segments` 里 `is_trap: true` 的片段会在「解读」时即时写入陷阱框（`syncTrap`）；`traps` 数组则是在片段全部读完后的**总结式**展示，二者可互补（例如 segment 里标出具体干扰句，traps 里写一句总括）。

---

## 五、`solution`：详解步骤

**作用**：在片段和陷阱都展示完后，按步骤展示解题过程；可标注每一步是「来自题干」还是「来自外部知识」，并可关联到已知条件做联动闪烁。

### 5.1 推荐格式：步骤数组（新）

每个元素为一步，建议包含：

| 字段 | 含义 | 系统怎么用 |
|------|------|------------|
| `step_desc` 或 `step` | 步骤标题 | 显示为步骤的小标题 |
| `content` 或 `formula` | 该步的说明或公式（支持 LaTeX） | 渲染在步骤下方，会经过 KaTeX 预处理 |
| `source_type` | 来源类型 | `prompt_info`：来自题干/本题条件（蓝色 📍）；`external_knowledge`：外部知识点（紫色 💡） |
| `source_label` | 来源简短说明 | 显示在 Badge 上，如「来自题干提取」「捕获-再捕获公式」 |
| `source_refs` | 可选，字符串数组 | 已知条件列表项的 `data-condition-id`（如 `["condition-0","condition-2"]`），当本步为 `prompt_info` 时，这些条件项会做一次「闪烁」联动 |

**系统怎么用**：  
当所有片段处理完且陷阱已显示后，每次用户点击会调用 `showSolutionStep(solution[solutionStepIndex], solutionStepIndex)` 追加一步；若该步有 `source_refs`，会调用 `highlightReferencedConditions(source_refs)` 让左侧对应已知条件项闪烁，强化「这一步用到了哪几条条件」。

### 5.2 旧格式：字符串

若 `solution` 是字符串，系统会在第一次需要展示详解时一次性把整段字符串渲染到详解区（无分步、无来源 Badge、无联动）。

---

## 六、整体数据流小结

```
decoder_topics.json
    → 选科目 → 选周次 → loadWeekFile(file) → 得到 problems[]
        → 选题目 → loadProblem(index) → currentProblem = problems[index]

currentProblem 结构：
    original_question  → 显示在「原题」
    segments[]         → 驱动逐句解读 + 高亮 + 已知条件/陷阱同步（三态逻辑）
    traps[]            → 片段读完后统一展示在「陷阱」
    solution[]         → 片段+陷阱后逐条 showSolutionStep，支持 source_refs 联动
```

按上述结构编写 `decoder_topics.json` 和各 `decoders_*.json`，题拆解器即可正确实现「逐句阅读 → 提取条件 → 陷阱提示 → 分步详解」的完整流程。

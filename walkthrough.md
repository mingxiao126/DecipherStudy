# DecipherStudy 项目迁移与整理说明 (2026-02-22)

为了提升项目的可维护性和专业性，我对项目结构进行了整理。以下是变动清单：

## 1. 结构变更映射表

| 原路径 | 新路径 | 说明 |
| :--- | :--- | :--- |
| `app.js` | `js/flashcards.js` | 主应用逻辑，重命名以体现功能 |
| `decoder.js` | `js/decoder.js` | 难题解码器逻辑 |
| `content-upload.js` | `js/uploader.js` | 上传与校验逻辑 |
| `decoder-schema.js` | `js/core/decoder-schema.js` | 核心协议定义（共享） |
| `qa-auditor.js` | `js/core/qa-auditor.js` | QA 审计引擎（共享） |
| `run-*.command` | `tools/*.command` | 快捷导入脚本移入工具包 |

## 2. 新增工程化支持
- **`package.json`**: 
    - `npm start`: 启动 Node.js 服务器。
  - ✅ **高标深度解析**：实现了“解读题目”、“已知条件”、“题目陷阱”与“详细解答”四位一体的专业 UI。
- ✅ **智能质量审计**：在上传端增加了 `practice-auditor.js`，自动识别解题步骤不足、LaTeX 语法风险及逻辑缺失，确保题库的高教学质量。

#### 1. 高标准深度解析演示（Labour Force 案例）
![高标准深度解析演示](file:///Users/ming/.gemini/antigravity/brain/9eccc8c4-6c84-4db7-ac0e-fc3d60ffb8d2/verify_high_fidelity_analysis_1771728997165.webp)

#### 2. 即时审计与质量拦截报告
![审计报告演示](file:///Users/ming/.gemini/antigravity/brain/9eccc8c4-6c84-4db7-ac0e-fc3d60ffb8d2/bad_json_audit_report_view_1771733102691.webp)

整理后的目录结构与新增的功能模块职责清晰，符合长期的维护习惯。
- **`npm run validate`**: 执行全量内容校验。

## 3. 文件引用更新情况
- **HTML**: `index.html`, `decoder.html`, `upload.html` 中的 `<script>` 标签已同步。
- **Server**: `server.js` 中的 `require` 路径已更新。
- **Scripts**: `scripts/` 下的所有维护脚本已同步内部引用。

---
*整理人：Antigravity AI*

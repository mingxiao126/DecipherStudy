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

## 3. 数据库友好型多租户架构 (Database-Ready)
- ✅ **存储抽象层**：引入 `storage/file-store.js`，收口所有 `fs` 操作，为未来迁移数据库提供统一接口。
- ✅ **API 驱动化**：前端全面弃用直接文件路径访问，改由 `/api/workspaces/:userId/...` 接口驱动。
- ✅ **原子化写入**：所有 JSON 落盘均采用“写临时文件+重命名”策略，彻底杜绝数据损坏风险。
- ✅ **Schema 标准化**：升级 `users.json` 并为每个工作区增加 `meta.json` 跟踪生命周期。
- ✅ **安全加固**：移除 `innerHTML` 渲染用户数据，预防潜在的 XSS 风险。

#### 4. 多租户 API 流程验证演示 (V3)
![多租户 API 流程验证](file:///Users/ming/.gemini/antigravity/brain/9eccc8c4-6c84-4db7-ac0e-fc3d60ffb8d2/multi_tenant_api_verification_v3_logging_1771748504034.webp)

## 4. 安全审计与加固 (Security Remediation)
针对多租户架构进行的深度内审及修复：
- ✅ **稳定性修复**：补全了 `server.js` 缺失的 `require` 依赖，修复启动崩溃。
- ✅ **访问控制**：封禁静态服务对 `/content/` 的直接读取，强制必须通过 API 访问。
- ✅ **路径穿越防御**：引入 `resolveWorkspaceContext`，对 `userId` 进行白名单过滤（`[a-z0-9_-]+`）并深度校验工作区元数据及活跃状态。
- ✅ **文件名加固**：API 下载题库时强制校验 `.json` 后缀及安全字符。
- ✅ **XSS 彻底封杀**：首页用户卡片渲染全面重构为 DOM 原生 API（`textContent`），杜绝恶意显示名的脚本注入。
- ✅ **API 校验精细化 (Patch)**：
  - **中文文件名支持**：放宽了 `datasets` 接口的校验正则，现已完美支持包含中文、圆括号及 `-` 的文件名（如 `flashcard_统计学_统计学-第四周.json`）。
  - **严格类型校验**：`topics` 接口增加了 `type` 白名单（`flashcard|decoder|practice`），非法参数将返回 400，提高了接口的鲁棒性。
- ✅ **回归验证通过**：经验证，中文文件名可正常读取，路径穿越（如 `/../users.json`）已被成功拦截。
- ✅ **一键“智能修复” (New)**：
  - 移除了冗余的 “AI 修正指令” 提示。
  - 现已在上传器中集成 **Auto-Fix** 逻辑：检测到常见的 LaTeX 语法错误（如单反斜杠 `\sqrt`）或环境变量符号冲突时，支持一键自动修复。
  - 用户只需点击“立即自动修复”，系统将自动调整 JSON 文本并重新发起校验，极大提升了录题效率。
- ✅ **代码清理**：删除了 `server.js` 中所有遗留的旧版 JSON 读写与索引同步函数，全面切换至 `FileStore` 存储层。

#### 5. 智能修复验证演示 (Updated)
![智能修复验证](file:///Users/ming/.gemini/antigravity/brain/9eccc8c4-6c84-4db7-ac0e-fc3d60ffb8d2/auto_fix_improvement_verification_v1_1771753227082.webp)

---
*整理人：Antigravity AI*

/**
 * 难题拆解器 Decipher JSON 类型定义
 * 规范见：docs/Decipher-JSON-转换规范.md
 */

/** 题目顶层结构 */
export interface Problem {
  id?: string;
  title?: string;
  original_question: string;
  segments: Segment[];
  traps?: Trap[];
  solution?: SolutionStep[] | string;
}

/** 阅读流片段（逐句解读 + 暂停同步） */
export interface Segment {
  /** 解读框逐行显示的句子/短语 */
  text: string;
  /** 是否包含需同步的关键信息；true=显示后暂停，下次点击同步 */
  has_info: boolean;
  /** 原题中要高亮的连续子串（需为 original_question 子串） */
  highlight_text?: string;
  /** 高亮语义颜色：green|yellow|red|blue（扩展：orange|trap） */
  highlight_color?: 'green' | 'yellow' | 'red' | 'blue' | 'orange' | 'trap';
  /** 同步到「已知条件」的标题/变量 */
  condition?: string;
  /** 知识点标签 */
  knowledge?: string;
  /** 已知条件列表中的解释文案 */
  explanation?: string;
  /** 该段是否为干扰项（红色警示 + 写入即时陷阱） */
  is_trap?: boolean;
}

/** 陷阱总结项（题干读完后统一展示） */
export interface Trap {
  title?: string;
  description?: string;
  /** 旧版兼容 */
  text?: string;
}

/** 详解步骤 */
export interface SolutionStep {
  step_desc?: string;
  step?: string;
  content?: string;
  formula?: string;
  source_type?: 'prompt_info' | 'external_knowledge';
  source_label?: string;
  /** 已知条件联动闪烁的 id 列表，如 ["condition-0","condition-2"] */
  source_refs?: string[];
  note?: string;
  external_info?: string;
}

/** 题目文件根：推荐 Array<Problem>，也支持单题对象 */
export type DecoderProblems = Problem[] | Problem;

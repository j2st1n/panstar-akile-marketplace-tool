# Akile & Panstar 交易所暗色模式架构与视觉设计规范 (Dark Mode Design Tokens Spec)

> **版本**：v1.0.0  
> **制定者**：架构与视觉分析师 (`analyst_designer`)  
> **适用项目**：`userscripts/panstar-akile-marketplace-tool` (`panstar-akile-value.user.js`)  
> **目标**：全面适配 Akile 交易所暗色模式（Arco Design 体系），支持 `[arco-theme="dark"]`、`.dark`、`[data-theme="dark"]` 与系统级媒体查询，统一 HUD 控制面板与卡片内嵌元素的明暗双模自适应机制。

---

## 1. 背景与现状问题分析

### 1.1 现状痛点
1. **Akile 暗色模式下视觉严重碎裂**：
   - 现有脚本样式采用硬编码的明色方案（浅白背景 `#ffffff`、深色文字 `#1e293b`、浅色卡片虚线 `#e2e8f0`）。
   - 当用户在 Akile 启用暗色主题时，页面整体为深灰/纯黑背景，但注入的 **HUD 控制面板呈现为刺眼的“白炽灯”状态**，卡片内的“剩余价值”分割虚线与进度底槽过于明亮，严重破坏宿主站点的视觉浸入感。
2. **Panstar 暗色处理方式繁琐冗余**：
   - 当前针对 Panstar 的暗色支持通过硬编码的大量 `html.xrv-panstar .xrv-...` 后代选择器强制覆盖（共 18 处单独重写），缺乏统一的 Token 抽象体系。
   - 更致命的是，**Panstar 的卡片内嵌元素（如 `.xrv-row` 分割线、`.xrv-bar` 进度条轨道、`.xrv-traffic-track`）未做暗色适配**，直接沿用了明色的 `#e2e8f0`，导致在深色卡片（`#1e293b`）上出现高对比度的生硬亮灰线。
3. **折溢价徽章在暗色下严重过曝**：
   - 现有的 5 级折溢价徽章（如 `.xrv-badge-super-discount` 使用 `#dcfce7` 淡绿底、`.xrv-badge-premium` 使用 `#fef3c7` 淡黄底）是专为白色背景设计的明亮马卡龙色。
   - 一旦置于深色卡片容器内，大面积浅色块呈现极度刺目的“高反光贴片”效果，文字辨识度急剧下降，严重违反 WCAG 2.1 AA 级色彩对比度标准。

---

## 2. Akile 与 Arco Design 暗色模式触发标记深度剖析

### 2.1 Arco Design 标准暗色规范
根据 [Arco Design 官方设计体系文档](https://arco.design/docs/en-US/designlab/partial-dark)，Arco 规范的主题切换机制为：
* **DOM 挂载点**：默认由 `document.body` 承载，但在部分 SPA 架构及 SSR 衍生框架中，会直接挂载在根节点 `document.documentElement` (`<html>`) 上。
* **标准标记属性**：
  ```html
  <!-- 官方标准触发形态 -->
  <body arco-theme="dark">
  <!-- 或根节点触发形态 -->
  <html arco-theme="dark">
  ```
* **暗黑模式清除/亮色**：移除该属性，或显式声明：
  ```html
  <body arco-theme="light">
  ```

### 2.2 现代 Web 框架通用暗色衍生标记
在基于 Arco Design 二次封装的商业站点（如 Akile）及现代前端工程（Tailwind / UnoCSS / NaiveUI / Next.js）中，开发者可能混用以下暗色标记：
1. **`.dark` 类名**：
   - 触发形态：`<html class="dark">` 或 `<body class="dark">`。
2. **`data-theme` 属性**：
   - 触发形态：`<html data-theme="dark">` 或 `<body data-theme="dark">`。
3. **系统级深色模式**：
   - 触发形态：`@media (prefers-color-scheme: dark)`。
   - **防御机制（Guard）**：若用户在站点设置中明确指定为亮色（如 `[arco-theme="light"]` 或 `[data-theme="light"]` 或 `.light`），媒体查询**绝不能**强行将其翻转为暗色。

### 2.3 平台标记统一抽象
* **Panstar 平台**：脚本挂载时添加了 `html.xrv-panstar` 类，由于 Panstar 原生仅提供暗色控制台，故 `html.xrv-panstar` 直接等价于暗色上下文。
* **Akile 平台**：脚本挂载 `html.xrv-akile`，默认处于明色上下文；一旦命中上述暗色标记中的任意一项，即刻无缝翻转为暗色上下文。

---

## 3. 架构选择：基于 CSS 变量 (CSS Custom Properties) 的全景双模设计

为了彻底根治选择器爆炸（Specificity Hell）与冗余样式代码，本次重构**严禁**继续使用后代覆盖式写法，全面升级为 **CSS 自定义属性（Design Tokens）驱动架构**。

### 3.1 核心优势
1. **单一样式声明（Single Declaration）**：所有的 HUD 控件、卡片注入元素仅声明一次样式属性（如 `background: var(--xrv-bg-hud)`），完全解耦具体的 DOM 选择器。
2. **零运行时性能开销（Zero JS Overhead）**：利用浏览器原生 CSS 级联特性，无论是用户切换 Akile 主题、还是浏览器随日落自动切换系统暗色，页面均实现 0ms 瞬间自适应重绘，无需 MutationObserver 重新计算或通过 JS 动态修改 inline style。
3. **全组件无缝覆盖**：HUD 与卡片内嵌元素统一消费同一套 Token，Panstar 与 Akile 共享同一套视觉规范。

---

## 4. 复合选择器矩阵规范 (Selector Matrix)

核心工程师 (`core_engineer`) 必须严格按照以下选择器矩阵定义明色与暗色作用域：

### 4.1 明色基础作用域 (Light Baseline)
以 `:root` 作为默认基线，提供稳定的明色默认值：
```css
:root {
  /* 明色 Token 集合 */
}
```

### 4.2 显式暗色触发选择器 (Explicit Dark Selectors)
当且仅当满足下列任意选择器时，变量覆盖为暗色 Token：
```css
/* 1. Arco Design 标准属性 (html 或 body) */
:root[arco-theme="dark"],
body[arco-theme="dark"],
[arco-theme="dark"],

/* 2. Tailwind 与现代通用类名 */
html.dark,
body.dark,
.dark,

/* 3. 通用 data-theme 属性 */
:root[data-theme="dark"],
body[data-theme="dark"],
[data-theme="dark"],

/* 4. Panstar 专属平台类名 */
html.xrv-panstar {
  /* 暗色 Token 集合 */
}
```

### 4.3 系统级偏好媒体查询与明色守卫 (Media Query with Light Guards)
响应操作系统的深色主题，同时增加对显式明色配置的守卫拦截：
```css
@media (prefers-color-scheme: dark) {
  :root:not([arco-theme="light"]):not([data-theme="light"]):not(.light) {
    /* 暗色 Token 集合 */
  }
}
```

---

## 5. Design Tokens 映射清单与色彩规范

### 5.1 HUD 控制面板核心 Tokens

| 变量名称 (CSS Variable) | 明色模式 (Light) | 暗色模式 (Dark) | 用途与视觉含义 |
|---|---|---|---|
| `--xrv-bg-hud` | `#ffffff` | `#1e293b` (Slate-800) | HUD 面板容器主背景 |
| `--xrv-border-hud` | `#e2e8f0` (Slate-200) | `#334155` (Slate-700) | HUD 容器外边框 |
| `--xrv-shadow-hud` | `0 2px 10px rgba(0, 0, 0, 0.04)` | `0 4px 16px rgba(0, 0, 0, 0.35)` | HUD 面板立体投影 |
| `--xrv-divider` | `#e2e8f0` (Slate-200) | `#334155` (Slate-700) | 头部与段落竖向分割线 |
| `--xrv-header-border` | `#f1f5f9` (Slate-100) | `#334155` (Slate-700) | HUD 头部横向底边框 |

### 5.2 文本与排版 Tokens

| 变量名称 (CSS Variable) | 明色模式 (Light) | 暗色模式 (Dark) | 用途与视觉含义 |
|---|---|---|---|
| `--xrv-text-main` | `#1e293b` (Slate-800) | `#f8fafc` (Slate-50) | 核心标题、高亮数值文本 |
| `--xrv-text-sub` | `#64748b` (Slate-500) | `#94a3b8` (Slate-400) | 分组 Label、统计次要文本、卡片标签 |
| `--xrv-text-muted` | `#94a3b8` (Slate-400) | `#64748b` (Slate-500) | 辅助说明小字、到期天数提示 |
| `--xrv-text-green` | `#16a34a` (Green-600) | `#4ade80` (Green-400) | 正常 IP、折价统计正向数值 |
| `--xrv-text-red` | `#dc2626` (Red-600) | `#f87171` (Red-400) | 异常 IP、溢价统计警示数值 |
| `--xrv-text-gold` | `#d97706` (Amber-600) | `#fbbf24` (Amber-400) | 统计中性/警告数值 |

### 5.3 交互控件 Tokens (排序按钮、分段控制器、复选框)

| 变量名称 (CSS Variable) | 明色模式 (Light) | 暗色模式 (Dark) | 用途与视觉含义 |
|---|---|---|---|
| `--xrv-btn-bg` | `#f8fafc` (Slate-50) | `#0f172a` (Slate-900) | 按钮常规未激活底色 |
| `--xrv-btn-border` | `#e2e8f0` (Slate-200) | `#475569` (Slate-600) | 按钮常规未激活边框 |
| `--xrv-btn-text` | `#475569` (Slate-600) | `#cbd5e1` (Slate-300) | 按钮常规未激活文字 |
| `--xrv-btn-bg-hover` | `#f1f5f9` (Slate-100) | `#334155` (Slate-700) | 按钮 Hover 悬浮底色 |
| `--xrv-btn-border-hover` | `#cbd5e1` (Slate-300) | `#64748b` (Slate-500) | 按钮 Hover 悬浮边框 |
| `--xrv-btn-text-hover` | `#1e293b` (Slate-800) | `#ffffff` | 按钮 Hover 悬浮文字 |
| `--xrv-btn-active-bg` | `#2563eb` (Blue-600) | `#3b82f6` (Blue-500) | 排序按钮激活态底色（暗色提亮） |
| `--xrv-btn-active-border` | `#2563eb` (Blue-600) | `#3b82f6` (Blue-500) | 排序按钮激活态边框 |
| `--xrv-btn-active-text` | `#ffffff` | `#ffffff` | 排序按钮激活态文字 |
| `--xrv-btn-active-shadow` | `0 1px 4px rgba(37, 99, 235, 0.35)` | `0 1px 6px rgba(59, 130, 246, 0.45)` | 排序按钮激活态发光投影 |
| `--xrv-cycle-bg` | `#f1f5f9` (Slate-100) | `#0f172a` (Slate-900) | 周期分段器胶囊外壳底色 |
| `--xrv-cycle-border` | `#e2e8f0` (Slate-200) | `#334155` (Slate-700) | 周期分段器外壳边框 |
| `--xrv-cycle-btn-active-bg` | `#ffffff` | `#1e293b` (Slate-800) | 周期选中分段滑块底色 |
| `--xrv-cycle-btn-active-text`| `#2563eb` (Blue-600) | `#60a5fa` (Blue-400) | 周期选中分段滑块文字 |
| `--xrv-cycle-btn-shadow` | `0 1px 3px rgba(0, 0, 0, 0.1)` | `0 1px 3px rgba(0, 0, 0, 0.4)` | 周期选中滑块微阴影 |

### 5.4 版本徽章 Tokens

| 变量名称 (CSS Variable) | 明色模式 (Light) | 暗色模式 (Dark) | 用途与视觉含义 |
|---|---|---|---|
| `--xrv-ver-bg` | `#eff6ff` (Blue-50) | `rgba(30, 58, 138, 0.5)` | 版本号外框背景 |
| `--xrv-ver-border` | `#bfdbfe` (Blue-200) | `#1d4ed8` (Blue-700) | 版本号外框描边 |
| `--xrv-ver-text` | `#2563eb` (Blue-600) | `#93c5fd` (Blue-300) | 版本号标识文本 |

### 5.5 卡片内嵌组件与价值徽章 Tokens (In-Card Elements)

| 变量名称 (CSS Variable) | 明色模式 (Light) | 暗色模式 (Dark) | 说明 |
|---|---|---|---|
| `--xrv-card-border-dashed`| `#e2e8f0` | `#334155` (Slate-700) | 剩余价值行顶部虚线 |
| `--xrv-track-bg` | `#e2e8f0` | `#334155` (Slate-700) | 剩余比例与流量百分比底槽轨道 |
| `--xrv-blocked-border` | `#fca5a5` | `#ef4444` | 被墙机器卡片边框 |
| `--xrv-blocked-shadow` | `0 0 0 1px rgba(239, 68, 68, 0.5), 0 0 16px rgba(239, 68, 68, 0.16)` | `0 0 0 1px rgba(239, 68, 68, 0.65), 0 0 20px rgba(239, 68, 68, 0.3)` | 被墙机器红色发光扩散 |

#### 5 级折溢价徽章（深色调防刺眼优化）
在暗色模式下，放弃明亮的实体浅色，改为 `rgba` 半透明深色衬底 + 柔和高饱和前景色与边框，既保证层级清晰，又杜绝发白过曝：

```css
/* 明色模式定义 (Light Badges) */
:root {
  --xrv-badge-super-bg: #dcfce7;
  --xrv-badge-super-text: #15803d;
  --xrv-badge-super-border: #86efac;

  --xrv-badge-disc-bg: #f0fdf4;
  --xrv-badge-disc-text: #166534;
  --xrv-badge-disc-border: #bbf7d0;

  --xrv-badge-fair-bg: #f1f5f9;
  --xrv-badge-fair-text: #475569;
  --xrv-badge-fair-border: #cbd5e1;

  --xrv-badge-prem-bg: #fef3c7;
  --xrv-badge-prem-text: #92400e;
  --xrv-badge-prem-border: #fde68a;

  --xrv-badge-high-bg: #fee2e2;
  --xrv-badge-high-text: #991b1b;
  --xrv-badge-high-border: #fecaca;

  --xrv-badge-exp-bg: #f3f4f6;
  --xrv-badge-exp-text: #9ca3af;
  --xrv-badge-exp-border: #e5e7eb;
}

/* 暗色模式定义 (Dark Badges) */
:root[arco-theme="dark"],
body[arco-theme="dark"],
[arco-theme="dark"],
html.dark,
body.dark,
.dark,
[data-theme="dark"],
html.xrv-panstar {
  --xrv-badge-super-bg: rgba(22, 101, 52, 0.35);
  --xrv-badge-super-text: #4ade80;
  --xrv-badge-super-border: rgba(74, 222, 128, 0.35);

  --xrv-badge-disc-bg: rgba(20, 83, 45, 0.3);
  --xrv-badge-disc-text: #86efac;
  --xrv-badge-disc-border: rgba(134, 239, 172, 0.3);

  --xrv-badge-fair-bg: rgba(51, 65, 85, 0.5);
  --xrv-badge-fair-text: #cbd5e1;
  --xrv-badge-fair-border: rgba(100, 116, 139, 0.5);

  --xrv-badge-prem-bg: rgba(146, 64, 14, 0.35);
  --xrv-badge-prem-text: #fcd34d;
  --xrv-badge-prem-border: rgba(252, 211, 77, 0.35);

  --xrv-badge-high-bg: rgba(153, 27, 27, 0.35);
  --xrv-badge-high-text: #f87171;
  --xrv-badge-high-border: rgba(248, 113, 113, 0.35);

  --xrv-badge-exp-bg: rgba(75, 85, 99, 0.4);
  --xrv-badge-exp-text: #9ca3af;
  --xrv-badge-exp-border: rgba(107, 114, 128, 0.4);
}
```

---

## 6. CSS 重构工程指南（面向 `core_engineer`）

### 6.1 彻底清理后代覆盖选择器
在 `panstar-akile-value.user.js` 的 `injectStyles()` 中：
1. **删除所有**形如 `html.xrv-panstar .xrv-hud`、`html.xrv-panstar .xrv-sort-btn`、`html.xrv-panstar .xrv-cycle-btn` 等重复声明块。
2. 将组件内部的所有硬编码色彩全部替换为对应的 `var(--xrv-...)` 变量：
   - 例：`.xrv-hud { background: var(--xrv-bg-hud); border: 1px solid var(--xrv-border-hud); color: var(--xrv-text-main); ... }`
   - 例：`.xrv-sort-btn { background: var(--xrv-btn-bg); border-color: var(--xrv-btn-border); color: var(--xrv-btn-text); ... }`
   - 例：`.xrv-row { border-top: 1px dashed var(--xrv-card-border-dashed); ... }`
   - 例：`.xrv-bar { background: var(--xrv-track-bg); ... }`
   - 例：`.xrv-traffic-track { background: var(--xrv-track-bg); ... }`

### 6.2 徽章样式规则改造
改造前：
```css
.xrv-badge-super-discount { background: #dcfce7; color: #15803d; border-color: #86efac; }
```
改造后：
```css
.xrv-badge-super-discount {
  background: var(--xrv-badge-super-bg);
  color: var(--xrv-badge-super-text);
  border-color: var(--xrv-badge-super-border);
}
```
其他等级同理，彻底实现组件样式与色彩定义的解耦。

---

## 7. 本地仿真调试沙盒与测试用例拓展（面向 `mock-marketplace.html` 与 QA）

为了验证本次重构的正确性，本地调试环境与回归测试需做以下配套升级：

### 7.1 `mock-marketplace.html` 增加暗黑模式调试切换器
在页眉调试操作区（`.demo-actions`）新增一个明暗主题切换控制器：
1. **按钮定义**：
   - `切换暗黑主题 (Arco / Dark)`
2. **切换交互逻辑**：
   - 点击时在 `document.body` 上切换 `arco-theme="dark"` 属性。
   - 同步切换 `document.documentElement` 的 `.dark` 类。
   - 动态更新沙盒卡片背景（由明亮白 `#fff` 切换为 Arco 暗黑卡片背景 `#232324`，文字色变为 `#f6f6f6`），使整个页面真实呈现 Arco Design 暗色实景。

### 7.2 质量验收指标 (QA Acceptance Criteria)
`qa_reviewer` 应基于以下维度进行测试核验：
1. **Akile 亮色模式基线**：在无暗黑标记时，HUD 与卡片元素呈现原有高质量明色风格，无对比度缺失。
2. **Akile Arco 暗色模式触发**：
   - 当 `body` 存在 `arco-theme="dark"` 时，HUD 自动转为深石板蓝面板（`#1e293b`），文字为高亮白（`#f8fafc`）。
   - 卡片内虚线转为暗灰（`#334155`），进度底槽变暗，折溢价徽章使用深底透光色，无刺目过曝。
3. **Akile 通用类与属性自适应**：
   - 分别测试 `html.dark` 与 `[data-theme="dark"]`，能够触发完全一致的暗黑视觉。
4. **Panstar 原生暗色回归**：
   - Panstar 平台视图下，HUD 样式无视觉回退，且**卡片内虚线与进度槽底色**成功获得暗色自适应，修复原版遗留暗斑。
5. **动态热切换平滑度**：
   - 多次点击暗黑切换按钮，界面瞬间响应，无白屏闪烁或样式丢失。
6. **自动化回归套件无损**：
   - 保证 `test-regression.js` 25 项业务与排序测试 100% 保持通过，无语法或解析副作用。

---

## 8. 结论与下游交接

本规范已完成对 Akile (Arco Design) 及 Panstar 双平台的暗色触发机制调研与统一 Design Tokens 体系设计。
- **交接核心工程师 (`core_engineer`)**：请严格按照本规范第 4、5、6 节实施 CSS 样式重构与变量替换。
- **交接质量审查员 (`qa_reviewer`)**：请依据第 7 节所列指标对代码实施双模实机验证与回归评审。

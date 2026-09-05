# Panstar & Akile 交易所剩余价值计算器与科学排序助手

[![Version](https://img.shields.io/badge/version-0.4.2-blue.svg)](https://github.com/j2st1n/panstar-akile-marketplace-tool)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey%20%7C%20ScriptCat-orange.svg)]()

一套专为 **Panstar** (`panstar.ai`) 与 **Akile** (`akile.ai`) VPS 二手流转交易市场量身打造的高性能浏览器用户脚本。

自动根据访问域名切换适配层，秒级计算每台机器的**剩余价值、实际倒贴/溢价额、折扣率、接手日均成本与归一化月均续费成本**；提供**6 维科学排序矩阵（正常 IP 优先，被墙机器 1 亿权重沉底）**与**快捷筛选器（隐藏被墙机、只看倒贴机、全部/月付/年付切换）**。

---

## ✨ 核心特性

### 1. 🚀 SPA 单页路由无感即时加载
- **告别手动按 F5**：劫持 HTML5 History API（`pushState` / `replaceState`）并监听 `popstate` / `hashchange`；无论从官网首页、登录页还是控制台概览点击跳转进入市场，脚本秒级自动挂载。
- **全生命周期管理**：离开市场路由时自动断开 `MutationObserver` 并清理注入的 DOM，零内存泄漏。
- **骨架屏数据自愈**：采用卡片规格指纹比对机制（Signature）与动态状态机，彻底解决原有脚本在骨架屏占位时提前标记失效、导致异步数据返回后被永久跳过的严重缺陷。

### 2. 💰 科学的二手 VPS 交易价值模型
- **剩余价值 ($V_{rem}$)**：根据周期价格与剩余到期天数精准分摊；
- **倒贴 / 溢价额 ($\Delta P = P_{sale} - V_{rem}$)**：
  - 卖家让利亏本甩卖时显示：`🎁 倒贴 ¥XX.XX`（或小额折价）；
  - 卖家加价转让时显示：`溢价 ¥XX.XX`；
- **实际折扣率**：清晰直观计算相对打折力度（如 **-80% / 2.0 折**），精准发掘高比例打折神机；
- **接手日均成本 ($C_{daily}$)**：清晰展示买家接手后在机器到期前每日的实际分摊支出；
- **折合月付续费成本 ($C_{monthly\_renew}$)**：年付（年付÷12）与月付统一归一化折算，便于横向比较机器真实持有成本；
- **5 级折溢价视觉徽章**：超值倒贴（深绿）、小额折价（浅绿）、平价出机（中性蓝）、轻度溢价（黄色）、高度溢价（红色）。

### 3. 🎯 6 维真正科学的多维排序矩阵
所有价值排序均注入 **1 亿权重 IP 状态惩罚（`ipPenalty = 100000000`）**，正常 IP 机器绝对优先排在最前，**彻底终结低价被墙机霸屏**的痛点：

| 排序模式 | 标识 | 业务意图与适用场景 |
|---|---|---|
| **默认顺序** | `default` | 恢复原站最新发布流 |
| **🎁 倒贴最多** | `discountDesc` | 按卖家倒贴让利绝对金额降序，**二手捡漏核心首选** |
| **🔥 折扣最大** | `discountRateDesc` | 按实际折扣率降序（如 2 折、4 折优先），发现超值小额神机 |
| **💰 售价最低** | `priceAsc` | 低预算首选，**正常 IP 严格在前**，被墙机自动沉底 |
| **👑 月均续费最低** | `monthlyRenewAsc` | 年付/月付折合月均续费成本升序，**专为挖掘低续费绝版“传家宝”神机设计** |
| **⏱ 日均成本最低** | `costDailyAsc` | 持有期内单日花费最少，适合精打细算的买家 |
| **📶 剩余流量最多** | `trafficDesc` | 智能正则解析全行网络数据，按流量可用存量比例重排 |

> **注**：原“天数最长”排序因业务逻辑失真（年付无脑置顶碾压月付、掩盖高续费负资产机型）已被彻底废除，全面升级为更科学的指标与分类筛选。

### 4. 🎛️ 现代 HUD 控制面板与联动筛选
- **周期三段式快捷切换**：集成 `【全部】`、`【月付】`、`【年付】` 单选胶囊组，买家若想寻找年付或月付机器直接一键筛选；
- **状态过滤器**：
  - `隐藏被墙 IP`：一键过滤所有被墙、被锁机器，只看正常 IP；
  - `只看折价(倒贴)`：一键剔除所有溢价加价机，只保留捡漏机器；
- **纯 CSS 虚拟排序与过滤**：
  - 排序完全基于 CSS `order`，筛选基于纯样式类隐藏，**零 DOM 节点位移**，不破坏 Arco 弹性栅格与 React 状态树；
  - 原站顶部警示条/公告保持置顶，列表底部的“加载更多”与分页按钮固定赋予 `order: 999999` 永不错位。
- **实时统计大盘**：实时呈现“共 N 台 (IP正常 X / 被墙 Y) · 折价捡漏 Z 台”。

---

## 📥 安装使用

### 方式一：直接安装（推荐）

在已安装油猴扩展（Tampermonkey、Violentmonkey 或 ScriptCat）的浏览器中点击下方安装链接即可一键安装：

👉 **[安装脚本 (GitHub Raw)](https://raw.githubusercontent.com/j2st1n/panstar-akile-marketplace-tool/main/panstar-akile-value.user.js)**

### 方式二：本地开发实时热重载 (Dev Mode)

适合修改与调试脚本源码：
1. 克隆本项目并在本地启动服务：
   ```bash
   git clone https://github.com/j2st1n/panstar-akile-marketplace-tool.git
   cd panstar-akile-marketplace-tool
   bash start-dev.sh
   # 服务将启动在 http://127.0.0.1:8788
   ```
2. 安装本地开发加载器：
   👉 **`http://127.0.0.1:8788/dev.loader.user.js`**
3. 之后每次修改 `panstar-akile-value.user.js`，只需刷新页面即可自动执行最新代码，无需反复手动重装。

---

## 🧪 本地仿真调试环境

本项目内置了全真双平台本地仿真调试沙盒，无需原站账号即可本地验证所有逻辑：

- **控制台主页**：`http://127.0.0.1:8788/`
- **全功能调试壳**：`http://127.0.0.1:8788/mock-marketplace.html`
  - 切换 Akile (Arco Design 3列弹性栅格) / Panstar (CSS Grid Dark 模式)；
  - 预设 10 张 Akile 与 7 张 Panstar 代表性真实卡片；
  - 提供“模拟 SPA 异步载入卡片”与“模拟路由切换”测试按钮；
  - 支持一键运行 25 项自动化回归测试套件。

---

## 📋 更新日志

### v0.4.2
- **重构全卡片智能 IP 状态探测流水线（三级降级流水线）**：
  - **Level 1（专属状态节点）**：支持多选择器组合（`.server-detail, .server-status, .server-tag` 与 `.console-marketplace-status-chip, .console-marketplace-status, [data-status]`）；
  - **Level 2（结构化备用回退）**：专属选择器失效时自动扫描 `.arco-tag`、`.badge`、`[class*="status"]` 及规格行（`IP/状态/网络/Status`）；
  - **Level 3（全卡片高精度文本扫描）**：采用 `BLOCKED_PATTERN` 高置信度正则扫描卡片全文，捕获“阻断”、“不可达”、“GFW”、“封禁”、“封锁”、“失联”、“污染”等特征；
  - **防误判清洗矩阵**：引入 `sanitizeIpStatusText`，严格排除“防火墙”、“锁价”、“不锁频”、“未阻断”等良性规格描述；
  - **终态确定性保证（Zero Silent Failure）**：杜绝因节点缺失提前退出，保证卡片 100% 确定性打标 `xrvIpBlocked`。
- **双重级联隐藏防御机制**：
  - 隐藏时对排序单元 `unit` 同时添加 `.xrv-filter-hidden` 并注入行内 `style.setProperty('display', 'none', 'important')`；
  - 取消隐藏时彻底安全清除行内 `display` 样式；
  - 增强 CSS 选择器特异性（`.arco-row .arco-col.xrv-filter-hidden` 与 `article[data-marketplace-listing-card].xrv-filter-hidden`），彻底免疫宿主高优先级与框架 diff 冲刷；
- **强化事件响应与状态防脱节自愈**：
  - 复选框监听升级为 `change` 与 `input` 全覆盖；
  - 为 `<label>` 绑定防冒泡机制，并在事件被外部拦截时提供微任务自愈切换；
  - HUD 复用与重检时自动执行双向同步，保持 DOM `checked` 状态与全局状态绝对一致；
- **全量回归测试升级**：自动化测试套件扩展至 12 阶段全量 56 项断言全数通过。

### v0.4.1
- **全面适配暗色模式**：重构 CSS 样式体系为基于 CSS Custom Properties 的全景 Design Tokens 架构；
- **支持全套暗色选择器与触发机制**：
  - Arco Design 标准暗色属性 `[arco-theme="dark"]`（支持 `body` 与 `html` 挂载）；
  - 现代通用暗色类名 `html.dark`、`body.dark`、`.dark` 与 `[data-theme="dark"]` 属性；
  - Panstar 平台原生暗色 `html.xrv-panstar`；
  - 系统级深色模式 `@media (prefers-color-scheme: dark)`（配合明色守卫 `:not([arco-theme="light"]):not([data-theme="light"]):not(.light)`）；
- **卡片内嵌元素暗色深度优化**：
  - 剩余价值行虚线边框由明色高亮线优化为 Slate-700 暗灰色（`--xrv-card-border-dashed`）；
  - 进度条与流量存量条底槽轨道升级暗灰底（`--xrv-track-bg`）；
  - 5 级折溢价徽章采用半透明深底衬底（`rgba`）+ 高对比度柔和文本与边框，杜绝刺目过曝与白炽灯效果；
- **纯 CSS 响应式即时变色**：用户在宿主站动态切换明暗模式时无需刷新页面，0ms 瞬间自适应；
- **本地调试沙盒升级**：`mock-marketplace.html` 新增 Arco 暗色模式一键切换器与暗色自动化验证用例。

### v0.4.0
- **排序深度重构**：彻底废除业务失真的“天数最长”排序；
- **新增科学维度**：
  - 新增 `🔥 折扣最大`（按实际打折比例降序）；
  - 新增 `👑 月均续费最低`（年付/月付归一化月均续费，挖掘绝版传家宝神机）；
- **新增周期筛选**：HUD 控制栏增加【全部 / 月付 / 年付】三段式周期切换；
- **修复流量提取 Bug**：使用整行智能正则解析网络字段，彻底解决 `xrvTrafficRatio` 恒为 0 导致流量最多排序无变化的缺陷；
- **高精度日均成本**：采用浮点剩余天数计算，并加入微小售价 tie-breaker，解决分数扎堆问题。

### v0.3.0
- **生命周期彻底重构**：扩大 `@match` 为泛匹配，内置路由守卫与 History AOP 代理，解决从其他页面点击进入市场不加载、必须刷新页面的严重痛点；
- **骨架屏数据自愈**：废除单一 `xrvDone` 布尔值，改为规格签名（Signature）与状态机机制，异步数据到达后自动补齐；
- **引入 IP 异常 1 亿权重沉底惩罚**：低价被墙机自动沉底，彻底杜绝被墙机霸屏；
- **现代 HUD 控制面板**：重构视觉风格，新增实时统计大盘与双筛选开关。

---

## 📜 开源许可与致谢

- 本项目基于 [MIT License](./LICENSE) 协议开源；
- **致谢与灵感**：感谢 SI Xiaolong 的《Akile 交易所剩余价值计算器》（Greasy Fork ID: 576546）提供的灵感思路，以及早期版本作者 hj6lago7 的贡献。

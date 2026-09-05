# Panstar & Akile 交易所油猴脚本：SPA 路由生命周期与卡片异步加载容错规范

## 1. 现状痛点与根本原因分析 (Root Cause Analysis)

在用户实际使用中，经常出现“首次从其他页面点击进入交易所不加载、必须手动刷新页面才能显示剩余价值与排序”、“部分卡片不显示计算数值”、“筛选或切换标签后卡片失效”等问题。通过对当前代码与 SPA 运行机制的深入排查，确认根本原因如下：

### 1.1 `@match` 规则过窄导致冷启动注入缺失
* **现状代码**：
  ```javascript
  // @match        *://panstar.ai/console/marketplace*
  // @match        *://akile.ai/console/pushshop*
  ```
* **失效根因**：
  现代 Web 应用为单页应用（SPA）。用户常规操作路径是首先访问主页（`panstar.ai` / `akile.ai`）或控制台根路径（`/console`），此时当前 URL 无法命中 `@match` 正则，Tampermonkey/Violentmonkey 插件引擎**在初始页面生命周期中完全不会加载和执行该用户脚本**。
  当用户随后在 SPA 内部通过前端导航路由（React Router / Vue Router）点击菜单跳转进入 `/console/marketplace` 或 `/console/pushshop` 时，浏览器不会发起硬性页面重载（Hard Reload），扩展无法重新触发注入。因此，脚本未在内存中运行，用户必须手动按 F5 刷新才能强制触发 Tampermonkey 加载。

### 1.2 SPA 无感路由切换监听缺失 (Missing SPA Navigation Hooks)
* **现状代码**：
  脚本入口仅依赖：
  ```javascript
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
  ```
  在单次执行后仅开启了一个针对 `document.body` 的 `MutationObserver`。
* **失效根因**：
  前端路由框架在做无感页面切换时，底层调用的是 HTML5 History API 的 `history.pushState` 和 `history.replaceState`。根据 W3C 标准，**脚本通过 API 调用 `pushState`/`replaceState` 不会触发浏览器的 `popstate` 事件**。
  当前脚本未对 `history.pushState` 与 `replaceState` 进行劫持，也未监听前进后退，导致用户在不同子路由之间跳转（或者离开市场后再次返回）时，脚本无法捕获路由进入/离开时序，既无法动态初始化市场模块，也无法清理已离开页面的残留 DOM。

### 1.3 骨架屏（Skeleton）与异步数据流冲突导致提前标记失效
* **现状代码**：
  ```javascript
  function handleMutations(mutations) {
    const seen = new Set();
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.matches && n.matches(SITE.cardSelector)) seen.add(n);
        else if (n.querySelectorAll) n.querySelectorAll(SITE.cardSelector).forEach((c) => seen.add(c));
      }
    }
    ensureSortBar();
    processCards([...seen]);
    if (seen.size > 0) scheduleSort();
  }

  function injectCard(card) {
    if (card.dataset.xrvDone === '1') return;
    card.dataset.xrvDone = '1'; // 提前打标！

    injectIpStatus(card);
    injectTrafficStock(card);

    const renewalField = SITE.findField(card, 'renewal');
    const expiryField = SITE.findField(card, 'expiry');
    if (!renewalField || !expiryField) return; // 骨架屏未渲染完成时直接返回
    ...
  ```
* **失效根因**：
  1. **MutationObserver 监听范围单一**：仅遍历了 `m.addedNodes`。
  2. **时序竞态（Race Condition）**：React/Arco 渲染列表时通常采用骨架屏优先策略。在数据尚未返回时，带有卡片类名（如 `.server-manage-card`）的占位容器已经被添加到 DOM 树中。`addedNodes` 捕获到了该卡片节点，立即触发 `injectCard`。
  3. **过早持久化处理标记**：在卡片内部尚未渲染任何规格信息（`renewalField` 与 `expiryField` 为 `null`）时，第 418 行已将 `card.dataset.xrvDone` 赋值为 `'1'`。
  4. **无法自愈**：数百毫秒后异步 API 请求成功，React 更新了卡片内部子节点的文本与内容。由于外层卡片容器并不是新插入的节点，`addedNodes` 不会再次捕获；即使偶发被捕获，也因为第一行的 `card.dataset.xrvDone === '1'` 而直接退出！导致这些卡片永久丢失剩余价值计算与状态标记。

### 1.4 数据未建立指纹签名机制，无法应对动态数据重渲染
* **失效根因**：
  单页应用支持宿主自身的下拉筛选、分页切换或动态局部刷新。当卡片由于原站筛选而发生数据变动或复用（DOM 复用机制）时，静态的布尔值 `xrvDone` 导致脚本拒绝重算，引发数据脏读与陈旧显示。

---

## 2. 系统生命周期重构架构设计

为彻底解决上述问题，系统架构划分为三大核心机制：
1. **全局宿主路由劫持引擎 (SPA Router Engine)**
2. **市场生命周期管理器 (Marketplace Lifecycle Manager)**
3. **卡片状态机与自愈解析流水线 (Card Self-Healing Pipeline)**

```
 ┌───────────────────────────────────────────────────────────┐
 │               Global Route Hijack Engine                  │
 │  (pushState / replaceState Hook + popstate / hashchange)  │
 └─────────────────────────────┬─────────────────────────────┘
                               │ Dispatches 'xrv-locationchange'
                               ▼
 ┌───────────────────────────────────────────────────────────┐
 │             Marketplace Lifecycle Manager                 │
 │  - Detects if pathname matches marketplace route          │
 │  - onEnter: mountSortBar() + startObserver() + scanAll()  │
 │  - onLeave: disconnectObserver() + cleanupUI()            │
 └─────────────────────────────┬─────────────────────────────┘
                               │
                               ▼
 ┌───────────────────────────────────────────────────────────┐
 │       MutationObserver (childList + subtree)              │
 │  - Detects new cards & modified card contents             │
 │  - Batched via requestAnimationFrame & Debounce           │
 └─────────────────────────────┬─────────────────────────────┘
                               │
                               ▼
 ┌───────────────────────────────────────────────────────────┐
 │           Card State Machine & Signature Pipeline         │
 │  - Checks if card has complete data (price, renewal, exp) │
 │  - Pending state if skeleton -> retry on content update   │
 │  - Complete state with data-xrv-sig fingerprint           │
 │  - Injects Remaining Value, IP Chip, Traffic Bar          │
 │  - Triggers debounced virtual sort (CSS order)            │
 └───────────────────────────────────────────────────────────┘
```

---

## 3. 详细设计规范与实现指南

### 3.1 元数据头（Metadata）规范
扩大 `@match` 到全站范围，确保冷启动能够加载脚本代码：
```javascript
// ==UserScript==
// @name         Panstar & Akile 交易所剩余价值计算器
// @name:en      Panstar & Akile Marketplace Remaining-Value Calculator
// @namespace    https://github.com/invalid-namespace
// @version      0.3.0
// ...
// @match        *://panstar.ai/*
// @match        *://*.panstar.ai/*
// @match        *://akile.ai/*
// @match        *://*.akile.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
```

### 3.2 SPA 路由劫持引擎 (SPA Router Engine)
为保证轻量且对宿主无副作用，采用标准 AOP 包装方法：
```javascript
function initRouterEngine(onRouteChange) {
  const fire = () => {
    try {
      onRouteChange();
    } catch (e) {
      console.error('[xrv] Route change handler error:', e);
    }
  };

  const wrapHistory = (type) => {
    const orig = history[type];
    return function (...args) {
      const res = orig.apply(this, args);
      window.dispatchEvent(new Event('xrv-locationchange'));
      return res;
    };
  };

  history.pushState = wrapHistory('pushState');
  history.replaceState = wrapHistory('replaceState');

  window.addEventListener('popstate', () => window.dispatchEvent(new Event('xrv-locationchange')));
  window.addEventListener('hashchange', () => window.dispatchEvent(new Event('xrv-locationchange')));
  window.addEventListener('xrv-locationchange', fire);
}
```

### 3.3 路由匹配与激活判断
定义精准的路径与域名探测器：
```javascript
function isMarketplaceRoute() {
  const path = location.pathname || '';
  if (SITE.name === 'panstar') {
    return path.startsWith('/console/marketplace');
  }
  if (SITE.name === 'akile') {
    return path.startsWith('/console/pushshop');
  }
  return false;
}
```

### 3.4 市场生命周期管理器 (Marketplace Lifecycle Manager)
维护运行态上下文 `state`：
* `active`: 当前是否处于交易所活动视图。
* `observer`: 全局或局部 `MutationObserver` 实例。
* `sortBar`: 控制面板 DOM 引用。

生命周期流转规则：
1. **进入市场 (`onEnterMarketplace`)**：
   - 如果已处于 `active` 状态，执行 `rescan(true)`，适应可能发生的页内过滤。
   - 如果初次进入，置 `active = true`。
   - 挂载全局样式（如尚未注入）。
   - 启动动态容器挂载监听（若宿主网格容器尚未就绪，通过 observer 持续等待）。
   - 启动核心 `MutationObserver` 监听卡片挂载与内容变化。
   - 执行初始全量卡片扫描 `scanAndProcessCards()`。
2. **离开市场 (`onLeaveMarketplace`)**：
   - 若 `active === true`：
   - 断开 `MutationObserver` 监听（降低 CPU 消耗，零额外开销）。
   - 将现有排序面板移除或隐藏。
   - 置 `active = false`。

### 3.5 卡片状态机与数据指纹机制 (Card State Machine)
彻底摒弃单一布尔变量 `xrvDone`，使用具备容错与自愈能力的状态机：

#### 状态定义：
* `unprocessed`（无标记）：未被脚本探测。
* `pending`（`data-xrv-status="pending"`）：探测到卡片节点，但内部关键数据（如续费价、到期时间、售价）尚未就绪（骨架屏状态）。允许后续变动继续触发解析。
* `ready`（`data-xrv-status="ready"`）：核心字段成功解析，注入挂载完成，附带 `data-xrv-sig` 指纹。

#### 数据指纹（Signature）计算：
```javascript
function computeCardSignature(rawRenewal, rawExpiry, rawPrice, rawIp, rawTraffic) {
  return `${rawRenewal || ''}#${rawExpiry || ''}#${rawPrice || ''}#${rawIp || ''}#${rawTraffic || ''}`;
}
```

#### 注入处理流程：
1. 提取当前卡片的字段原始字符串（`rawRenewal`, `rawExpiry`, `rawPrice`, `rawIp`, `rawTraffic`）。
2. **骨架屏判定**：如果关键数据缺失（`!rawRenewal || !rawExpiry`），标记 `card.dataset.xrvStatus = 'pending'`，直接返回，等待下一次 DOM 更新事件。
3. **指纹比对**：计算当前指纹 `sig`。如果 `card.dataset.xrvSig === sig` 且注入元素仍正常挂载在 DOM 中，直接跳过，保证幂等。
4. **计算与注入**：
   - 解析剩余价值、剩余天数、日均成本、折价/溢价额。
   - 高亮 IP 状态（正常绿标，被墙/被锁红标 + 卡片红框）。
   - 注入流量存量条。
   - 挂载/更新剩余价值行。
5. **打标完成**：设置 `card.dataset.xrvStatus = 'ready'`，并将最新指纹存入 `card.dataset.xrvSig = sig`。同步把关键排序属性（如溢价额、售价、剩余天数、流量比例）写入 `card.dataset.*`。
6. **触发重排调度**：调用 `scheduleSort()`。

### 3.6 优化 MutationObserver 触发机制
为兼顾性能与骨架屏数据填充感知：
1. 观察配置：
   ```javascript
   observer.observe(document.body, {
     childList: true,
     subtree: true,
     characterData: true, // 允许捕捉骨架屏占位文本替换为真实数字
   });
   ```
2. 防抖批量处理：
   不每次 mutation 都立即全量扫描，而是使用微任务或 50ms 防抖计时器聚合：
   ```javascript
   let scanTimeout = null;
   function scheduleScan() {
     if (scanTimeout) return;
     scanTimeout = setTimeout(() => {
       scanTimeout = null;
       scanAndProcessCards();
     }, 50);
   }
   ```
3. `scanAndProcessCards()` 实现：
   - 选取所有未完成或处于 pending 状态的卡片：
     `document.querySelectorAll(SITE.cardSelector)`
   - 优先处理 `[data-xrv-status="pending"]` 及未标记状态的卡片。
   - 若发现有卡片成功由 `pending` 转为 `ready`，调度一次视觉排序。

---

## 4. 架构交付标准与后续任务集成要点

1. **核心开发（Task t3）交付物标准**：
   - 严格落实 `@match` 扩大与无副作用保护。
   - 落实 `history.pushState` / `replaceState` / `popstate` / `hashchange` 监听。
   - 落实骨架屏 `pending` 延迟重试与指纹机制。
   - 保持所有修改聚焦在 `userscripts/panstar-akile-marketplace-tool/panstar-akile-value.user.js`。
2. **算法与面板（Task t4）集成要点**：
   - 排序计算必须使用卡片 `dataset` 缓存的数值进行，排序仅操作 `style.order`。
   - 排序面板挂载需具备宿主容器等待自愈逻辑。
3. **QA 审查（Task t5）验证项**：
   - 在控制台首页切换到市场路由，无需刷新，检查能否 100% 自动装载。
   - 模拟慢速网络或骨架屏卡片，检查是否存在提前打标导致的漏算问题。
   - 检查在市场与非市场页面来回切换时，内存与事件监听器是否正常管理。

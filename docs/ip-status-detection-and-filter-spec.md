# IP 状态探测算法加固与筛选显隐防守技术规范

> 适用版本：Panstar & Akile 交易所助手 v0.4.2+  
> 责任团队：fix-hide-blocked-ip-filter  
> 角色输出：架构与业务分析师 (`analyst_designer`)

---

## 1. 背景与问题诊断

在生产环境与高并发交互场景下，用户反馈“隐藏被墙 IP”筛选功能在部分情况下失效或无法彻底隐藏被墙机器。经深入排查，确认由以下四个核心缺陷组合导致：

### 1.1 根因一：专用选择器单一导致的静默跳过（Silent Failure）
- **现象**：脚本针对 Panstar 仅依赖 `.console-marketplace-status-chip`，针对 Akile 仅依赖 `.server-detail`。
- **机制缺陷**：
  ```javascript
  const el = card.querySelector(SITE.statusSelector);
  if (!el) return; // 致命缺陷：直接退出，未设置任何 dataset！
  ```
  在宿主前端改版、异步延迟渲染、或状态信息位于标题/标签/规格行时，`el` 判定为 `null`，导致函数过早退出。
- **后果**：`card.dataset.xrvIpBlocked` 保持为 `undefined`。后续筛选逻辑 `card.dataset.xrvIpBlocked === '1'` 判断必然为 `false`，导致被墙机器完全逃逸过滤。

### 1.2 根因二：文本特征匹配正则覆盖不全与误判风险
- **现象**：
  - Akile 原逻辑仅匹配 `/被墙|被锁|墙|锁|blocked|\bno\s*data\b|暂无|异常|失败/i`，遗漏了“阻断”、“不可达”（例如真实 mock 中的“端口不可达”）、“GFW”、“封禁”、“封锁”、“污染”等形态。
  - Panstar 原逻辑使用 `!/normal|正常|ok/i.test(text)`，在状态元素未渲染或包含非状态信息时容易误伤。
  - 缺乏全卡片层级的回退检测机制；若盲目使用单字“墙”扫描全卡片，会误伤“防火墙”等正常规格描述。

### 1.3 根因三：CSS 特异性与宿主响应式重绘的层叠冲突
- **现象**：
  原实现仅通过单一样式类 `.xrv-filter-hidden { display: none !important; }` 进行隐藏。
- **机制冲突**：
  1. **特异性压制**：Arco 栅格 `.arco-col` 与 Panstar `article` 容器若在宿主样式表中声明了带更高特异性的 `!important` 规则（如 `.arco-row .arco-col`），单一类名会被覆盖。
  2. **框架 Virtual DOM 抹除**：Akile (Vue) 与 Panstar (React) 在列表重新 diff 或数据轮询时，直接覆盖 DOM 节点的 `class` 属性，导致注入的 `xrv-filter-hidden` 类被静默清除，从而导致已隐藏的被墙机器“复活”。

### 1.4 根因四：事件监听单一与事件冒泡拦截
- **现象**：
  HUD 仅在 `<input type="checkbox">` 上监听单一的 `'change'` 事件。在某些浏览器渲染机制或宿主框架的全局事件捕获下，点击 `<label>` 或其文本子项未能可靠触发 `'change'`，或触发时状态不同步。

---

## 2. 架构与算法技术规范

### 2.1 三级多层级 IP 状态探测流水线（IP Detection Pipeline）

为确保 100% 打标，建立以下有序流水线：

```
[Card DOM]
   │
   ├─► Level 1: 专用状态选择器匹配 (Dedicated Selector)
   │     ├─ Panstar: .console-marketplace-status-chip, .console-marketplace-status, [data-status]
   │     └─ Akile:   .server-detail, .server-status, .server-tag
   │     └─► 找到元素且有文本 ──► 结合上下文精确判定 ──► 完成打标
   │
   ├─► Level 2: 结构化备用选择器回退 (Structured Candidates)
   │     ├─ 扫描 .arco-tag, .ant-tag, .badge, [class*="status"]
   │     ├─ 扫描规格行中 label 包含 "IP" / "状态" / "网络" / "Network" 的对应值
   │     └─► 匹配到状态项 ──► 精确判定 ──► 完成打标
   │
   ├─► Level 3: 全卡片高置信度智能文本扫描 (Full-Card Fallback Scan)
   │     ├─ 提取 card.textContent
   │     ├─ 阻断正向高精度正则：
   │     │  /(?:ip|IP|网络|连接|端口)?\s*(?:被墙|被封|封禁|封锁|被锁|阻断|不可达|失联|不可用|污染)|GFW|\b(?:blocked|banned|unreachable|gfw)\b/i
   │     ├─ 排除上下文安全过滤（防止“防火墙”、“锁价”误伤）
   │     └─► 命中阻断特征 ──► 标记为被墙
   │
   └─► 终态确定性保证 (Zero Silent Failure Guarantee)
         └─ 无论是否找到专属节点，card.dataset.xrvIpBlocked 必被确定性赋值为 '1' 或 '0'
         └─ 若卡片处于纯骨架屏状态，标记 pending 等待后续异步回填
```

### 2.2 正则表达式匹配矩阵规范

| 分类 | 匹配正则 / 特征 | 判定结论 | 防误判设计 |
|---|---|---|---|
| **明确阻断/被墙** | `/(?:ip|IP|网络|连接|端口)?\s*(?:被墙|被封|封禁|封锁|被锁|阻断|不可达|失联|不可用|污染)|GFW|\b(?:blocked|banned|unreachable|gfw)\b/i` | `blocked = true` | 严格排除“防火墙”、“锁价”、“不锁频”等上下文 |
| **检测异常/失败** | `/\bno\s*data\b|暂无(?:数据|检测)?|检测失败|异常|超时|timeout/i` | `blocked = true` (根据严格模式) | 提示用户不可用机器 |
| **明确正常** | `/正常|normal|\bok\b|good|healthy|有效/i` | `blocked = false` | 需先排除阻断词，避免“正常 (历史被墙)”等误判 |

### 2.3 双重级联隐藏机制（Dual Cascade Hiding）

为抵御宿主更高 CSS 特异性及 Virtual DOM 冲刷，实行“**行内样式 + 复合 CSS 类**”双重机制：

1. **执行隐藏 (`hidden = true`)**：
   ```javascript
   unit.classList.add('xrv-filter-hidden');
   unit.style.setProperty('display', 'none', 'important');
   ```
2. **解除隐藏 (`hidden = false`)**：
   ```javascript
   unit.classList.remove('xrv-filter-hidden');
   unit.style.removeProperty('display');
   ```
3. **CSS 全局补强**：
   ```css
   .xrv-filter-hidden,
   .arco-row .arco-col.xrv-filter-hidden,
   article[data-marketplace-listing-card].xrv-filter-hidden {
     display: none !important;
   }
   ```

### 2.4 事件交互与双向状态同步规范

1. **全事件覆盖绑定**：
   ```javascript
   const input = hud.querySelector('#xrv-filter-hide-blocked');
   if (input) {
     const onToggle = (checked) => {
       filterState.hideBlocked = checked;
       if (input.checked !== checked) input.checked = checked;
       applySortAndFilters();
     };
     input.addEventListener('change', (e) => onToggle(e.target.checked));
     input.addEventListener('input', (e) => onToggle(e.target.checked));
   }
   ```
2. **Label 点击体验保障**：
   对 `.xrv-filter-checkbox` 阻止冒泡至宿主可能存在的卡片或模态框全局劫持器，同时保持浏览器对 input 原生切换的支持。
3. **自愈与重新挂载同步**：
   在 `ensureSortBar()` 中，每次复用或重建 HUD 时，确保 DOM 上的 `input.checked` 与当前的 `filterState.hideBlocked` 绝对一致。

### 2.5 数据统计与联动规范

在 `applySortAndFilters()` 遍历中：
- 统计所有未被过滤隐藏的卡片：
  - `totalCount`：当前可见卡片总数；
  - `normalCount`：当前可见卡片中 `xrvIpBlocked === '0'` 的数量；
  - `blockedCount`：当前可见卡片中 `xrvIpBlocked === '1'` 的数量；
  - `discountCount`：当前可见卡片中满足倒贴条件的数量。
- 当“隐藏被墙 IP”处于勾选状态时，`blockedCount` 必须准确显示为 `0`；
- 当取消勾选时，`blockedCount` 与被隐藏机器同步复原，准确呈现所有机器真实状态。

---

## 3. 研发实施指引（面向 `core_engineer`）

1. **修改点 1：`SITES` 配置与探测辅助函数**
   - 增加多选择器回退列表；
   - 编写 `extractCardIpStatus(card)` 统一执行三级探测。
2. **修改点 2：`injectIpStatus(card)`**
   - 保证确定性设置 `dataset.xrvIpBlocked` 与 `dataset.xrvBlocked`；
   - 消除 `el === null` 时直接退出的缺陷。
3. **修改点 3：`applySortAndFilters()`**
   - 采用 `unit.style.setProperty('display', 'none', 'important')` 与 `unit.style.removeProperty('display')`；
   - 强化统计指标联动。
4. **修改点 4：HUD 事件监听与同步**
   - 完善 input `change` / `input` 监听与状态防脱节。
5. **修改点 5：版本号升级**
   - 升级至 `v0.4.2`，同步 `dev.loader.user.js`。

---

## 4. 质量验收标准（面向 `qa_reviewer`）

1. **选择器缺失鲁棒性**：模拟故意抹除 `statusSelector` 节点，仅在卡片文本中包含“端口不可达”或“被墙”，卡片依然能被 100% 识别并隐藏。
2. **双重隐藏防渗透**：在宿主 DOM 上人工注入高特异性 `display: block !important` 规则，勾选“隐藏被墙IP”后，被墙卡片依然彻底不可见。
3. **交互即时响应**：无论鼠标精准点击 checkbox 小方框，还是点击“隐藏被墙 IP”文字 label，均能 100% 瞬时触发隐藏与恢复。
4. **组合场景无退化**：与“月付/年付”、“只看折价”叠加测试，交集结果完全符合数学集合定义。

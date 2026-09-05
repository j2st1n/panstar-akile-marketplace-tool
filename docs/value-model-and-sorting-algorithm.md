# Panstar & Akile 二手 VPS 交易市场：科学排序算法与价值模型技术规范 (v2.0 架构重构版)

> **版本**：v2.0.0 (架构重构版)  
> **责任阶段**：架构与业务分析 (t1)  
> **适用模块**：`userscripts/panstar-akile-marketplace-tool/panstar-akile-value.user.js` 及本地调试仿真环境

---

## 0. 排序选项点击无变化 Bug 深度根因诊断与修复指导

在前期版本中，用户反馈“流量最多、日均最低、天数最长”点击后界面没有任何排序变化，经深入排查数据流与执行链路，确定根本原因如下：

### 0.1 「剩余流量最多」(trafficDesc) 排序无变化根因
* **代码缺陷位置**：`SITE.networkUsage(valueEl)` 与 `calcTrafficStock(usageText)`。
* **数据流断裂链**：
  1. 页面中网络信息的原始 DOM 结构形如：`1000Mbps | <u>120GB</u> / 1000GB`（Akile）或 `1 Gbps | <span class="underline">200GB</span> / 1000GB`（Panstar）。
  2. 原实现 `SITE.networkUsage` 仅通过 `valueEl.querySelector('u')` 或 `valueEl.querySelector('span.underline, u')` 提取内容，导致提取结果仅为 `<u>` 内部的文字 `"120GB"` 或 `"200GB"`，完全遗漏了标签外面的分母与总流量 `/ 1000GB`。
  3. `calcTrafficStock(usageText)` 内部执行 `usageText.split('/')`，期望得到 `[已用, 总量]` 两项。由于传入的字符串只有 `"120GB"`，不包含 `'/'`，分割后数组长度为 1，直接触发 `if (pieces.length !== 2) return null;` 退出。
  4. `calcTrafficStock` 恒定返回 `null`，导致 `injectTrafficStock` 提前退出，所有卡片的 `card.dataset.xrvTrafficRatio` 均未被赋值（或保持空字符串/undefined）。
  5. 在排序打分 `getCardSortScore(card, 'trafficDesc')` 时，`dataNum(card, 'xrvTrafficRatio') ?? 0` 恒为 `0`。对所有正常 IP 卡片，其排序得分为 `0 - (0 * 100) = 0`。
  6. 每一个卡片的排序得分完全相同，比较器 `scoreA - scoreB` 恒为 `0`，CSS `order` 顺序与原列表完全一致，因此用户点击后**没有任何视觉重排变化**。
* **重构修复要求 (t2)**：
  - 不再死板截取局部标签，改为获取整个网络字段的 `textContent`。
  - 使用健壮的正则智能解析：`/([\d.]+\s*(?:TB|GB|MB|KB|B))\s*[\/|／]\s*([\d.]+\s*(?:TB|GB|MB|KB|B))/i`，同时提取分子（已用）与分母（总量）。
  - 支持 `不限/unlimited` 流量情况的防御性赋值（剩余比例计为 1.0）。
  - 确保每张卡片生成高区分度的 `data-xrv-traffic-ratio`（范围 0.0 ~ 1.0）。

### 0.2 「日均最低」(costDailyAsc) 排序无变化根因
* **代码缺陷位置**：`parseExpiry(expiryText)`、`calcRemainingValue` 与 `getCardSortScore`。
* **数据流断裂链**：
  1. 到期时间字符串在不同站点或格式下（如 `2026-05-15 20:00:00`、`2026/05/15` 或含其他时间标记）若被 `new Date()` 判定为无效日期（`Invalid Date`），`parseExpiry` 立即返回 `null`。
  2. `calcRemainingValue` 返回 `null` 后，卡片 `card.dataset.xrvDays` 被赋为 `'0'`，`card.dataset.xrvDailyCost` 为 `''`（空字符串）。
  3. 在排序打分时，`dataNum(card, 'xrvDailyCost')` 返回 `null`，默认回退为 `Infinity`。且由于 `days <= 0`，触发 `if (days <= 0) return ipPenalty + 5000000;`。
  4. 遇到多张卡片因日期解析失败或过期导致退化为相同的 5000000 惩罚分时，卡片之间无区分度。若列表内多数卡片落入此分支，排序后无法形成预期排列。
  5. 原日均成本 `dailyCost` 存储前使用了 `Math.round(dailyCost * 1000) / 1000`，对于售价相同、天数差不多的卡片区分度不足，且缺乏对 `salePrice === 0` 或 `days` 浮点精度的平滑处理。
* **重构修复要求 (t2)**：
  - 增强 `parseExpiry`：统一将 `/` 替换为 `-`，去除首尾空白，兼容 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm:ss`，并做时间戳有效性校验。
  - 改进 `dailyCost` 计算：使用浮点剩余天数计算高精度日均持有成本，避免大面积分数扎堆。
  - 增加二级排序键：日均相同时按售价升序排，保证绝对有明确排序顺序。

### 0.3 「天数最长」(daysDesc) 排序失灵根因
* 同样由于日期解析在边界异常时 `days` 归零，导致打分一致；
* 更致命的是，该指标存在极其严重的**业务逻辑缺陷**，下文进行专题论证。

---

## 1. 专题分析：“天数最长”在二手 VPS 交易场景下的严重不合理性

为什么必须**彻底废除并移除“天数最长”**排序维度？

1. **周期维度混淆失真（年付无脑降维打击月付）**：
   - 二手 VPS 最常见的是**月付**（周期 30 天）与**年付**（周期 365 天）。
   - 一台月付机器，哪怕卖家刚续费完 1 天，剩余天数最多也只有 **29 天**；
   - 一台年付机器，哪怕已经用掉大半年，剩余天数依然有 **120 天**。
   - 粗暴按绝对天数降序排序，**所有年付机器将永远霸占顶部，所有月付机器无论性价比多高、折扣多诱人，都被无情踩在最底端**，彻底失去了公平比较的基准。
2. **完全违背买家核心诉求（天数越长，接盘成本往往越高）**：
   - 机器剩余价值公式为 $V_{rem} = P_{renew} \times \frac{D_{rem}}{D_{cycle}}$。剩余天数越多，机器的剩余价值越高，买家接手需要付出的**绝对总价（现金支出）通常也越高**。
   - 二手买家上交易市场通常是为了“低成本试玩”、“短期捡漏”或“收绝版特价机”，绝非为了花好几百元去接盘一台普通年付机。
3. **容易掩盖高续费负资产机器**：
   - 一台高续费机器（如 500 元/年），卖家用剩下 250 天想割肉变现，挂 300 元出售；虽然天数长，但对于买家而言是个沉重负担；
   - 一台绝版神机（如 10 元/年 续费的传家宝），虽然只剩 3 天到期，买家买下后花 10 元续费即可获得一整年的超低成本使用权；
   - 在“天数最长”排序下，绝版神机被彻底埋没在尾部，而高额负资产机却高高置顶。
4. **科学解决途径**：
   - 区分买家对周期的偏好应通过**分类筛选（全部 / 月付 / 年付）**实现；
   - 衡量长期持有价值应通过**折合月付续费成本**（挖掘传家宝）实现；
   - 衡量接手实惠程度应通过**打折力度/折扣率**与**倒贴额**实现。

**结论**：在本次重构中，**彻底废除“天数最长”排序按钮**，用更科学的业务维度取而代之。

---

## 2. 科学重构价值模型与指标体系

### 2.1 核心指标与计算公式定义

#### (1) 折扣率与打折力度 (Discount Rate & Discount Level, $R_{discount}$)
- **业务诉求**：解决小额超高折扣神机被绝对金额淹没的问题。例如：剩余价值 10 元售价 2 元（相当于 **2.0 折**，折扣率 80%），比剩余价值 100 元售价 90 元（9.0 折，倒贴 10 元）具有高得多的相对打折力度。
- **公式**：
  当 $V_{rem} > 0$ 时：
  $$\Delta P = P_{sale} - V_{rem}$$
  $$\text{Discount Rate} = \max\left(0, \frac{V_{rem} - P_{sale}}{V_{rem}}\right) \times 100\%$$
  $$\text{Discount Level (折数)} = \frac{P_{sale}}{V_{rem}} \times 10$$
  - 当 $P_{sale} < V_{rem}$ 时，为折价/倒贴机器，打折力度即为折扣率（例如让利 80%，即 2 折）；
  - 当 $P_{sale} \ge V_{rem}$ 时，为平价或溢价机器，折扣率为 0。

#### (2) 折合月付续费成本 (Effective Monthly Renewal Cost, $C_{monthly\_renew}$)
- **业务诉求**：在二手圈中，“传家宝”特指年付或月付续费成本极低的绝版神机。将年付与月付统一折算为**每月持有续费成本**，便于跨周期横向直观对比。
- **公式**：
  $$C_{monthly\_renew} = \begin{cases} P_{renew}, & \text{月付 (周期约为 30 天)} \\ \frac{P_{renew}}{12}, & \text{年付 (周期约为 365 天)} \end{cases}$$
  - 示例 1：年付 120 元的机器，折合月付续费成本为 10.00 元/月；
  - 示例 2：月付 15 元的机器，折合月付续费成本为 15.00 元/月；
  - 示例 3：年付 24 元的绝版神机，折合月付续费仅 2.00 元/月，属于极品传家宝。

#### (3) 周期类型划分 (Cycle Type)
- 枚举值：`month`（月付）与 `year`（年付）。
- 判定规则：依据续费字段中的单位标识（包含“年”、“year”、“yr”、“y”判为 `year`，其余判为 `month`）。
- 挂载属性：`card.dataset.xrvCycle = 'month' | 'year'`。

#### (4) 健壮日均持有成本 (Effective Daily Cost, $C_{daily}$)
- 公式：
  $$C_{daily} = \begin{cases} \frac{P_{sale}}{D_{rem}}, & D_{rem} \ge 1 \\ P_{sale}, & D_{rem} < 1 \end{cases}$$
- 防守：$D_{rem} = \max(0, \frac{T_{expiry} - T_{now}}{86400000})$。若机器已过期（$D_{rem} \le 0$），日均成本判定为无效/沉底，避免除零异常。

#### (5) 剩余流量比例 (Traffic Remaining Ratio, $R_{traffic}$)
- 正则提取 $Traffic_{used}$ 与 $Traffic_{total}$ 并换算为同一单位（Byte）：
  $$R_{traffic} = \min\left(1.0, \max\left(0.0, \frac{Traffic_{total} - Traffic_{used}}{Traffic_{total}}\right)\right)$$

---

## 3. 全新多维科学排序矩阵 (Sorting Matrix 2.0)

所有排序统一保持**正常 IP 优先**（被墙机器增加 $10^8$ 惩罚权重置底）。

| 排序模式键 (mode) | UI 按钮名称 (中 / 英) | 排序键 (Sort Score) 算法公式 | 目标业务场景 |
|---|---|---|---|
| `default` | 默认顺序 / Default | 清空卡片 `style.order` | 恢复原站官方默认流 |
| `discountDesc` | 🎁 倒贴最多 / Top Bonus | `ipPenalty - (V_rem - P_sale)`<br>倒贴金额越大越靠前 | **大额捡漏**：寻找卖家净亏损贴钱最多的机器 |
| `discountRateDesc` | 🔥 折扣最大 / Deepest Discount | `ipPenalty - discountRate`<br>折扣率越大约靠前（折数越小越靠前） | **打折力度**：寻找 2折、3折、5折等大比例打折神机 |
| `priceAsc` | 💰 售价最低 / Lowest Price | `ipPenalty + P_sale`<br>标价越低越靠前 | **超低预算**：总价门槛最低，彻底排除被墙机器霸屏 |
| `monthlyRenewAsc` | 👑 月均续费最低 / Lowest Monthly | `ipPenalty + C_monthly_renew`<br>折合月付续费越低越靠前 | **传家宝神机**：寻找绝版低续费、长期续费无压力的神机 |
| `costDailyAsc` | ⏱ 日均成本最低 / Daily Cost ↑ | `ipPenalty + C_daily`<br>日均成本越低越靠前（过期沉底） | **精明买家**：持有期内单日花费分摊最少 |
| `trafficDesc` | 📶 剩余流量最多 / Traffic Left ↓ | `ipPenalty - (R_traffic * 100)`<br>剩余比例越高越靠前 | **流量大户**：寻找前任剩余流量最充足的机器 |

---

## 4. 交互与控制面板 HUD 重构规范

### 4.1 控制面板整体结构

```
+---------------------------------------------------------------------------------------------------------+
| [⚡ XRV 交易所助手 v0.4.0]                                                   共 24 台 (正常 21 / 异常 3) · 折价 6 台 |
+---------------------------------------------------------------------------------------------------------+
| 排序: [默认] [🎁 倒贴最多] [🔥 折扣最大] [💰 售价最低] [👑 月均续费最低] [⏱ 日均成本最低] [📶 剩余流量最多]         |
| 周期: [全部 (All)] [月付 (Monthly)] [年付 (Yearly)]                                                      |
| 筛选: [☑ 隐藏被墙 IP] [☑ 只看折价(倒贴)]                                                                  |
+---------------------------------------------------------------------------------------------------------+
```

### 4.2 周期分类筛选器规范
- 状态：`filterState.cycle` 枚举为 `'all' | 'month' | 'year'`，默认 `'all'`。
- 交互呈现：单选按钮组（Radio group 或 Segmented Buttons），高亮当前激活项。
- 过滤行为：
  - 当选择 `'month'` 时：若 `card.dataset.xrvCycle !== 'month'`，添加 `xrv-filter-hidden`。
  - 当选择 `'year'` 时：若 `card.dataset.xrvCycle !== 'year'`，添加 `xrv-filter-hidden`。
  - 当选择 `'all'` 时：不对周期类型进行隐藏。
- 联动统计：统计栏更新时，计算当前可见/全部机器的正常与折价分布。

---

## 5. 数据集属性 (Dataset) 挂载规范

为支撑高效 CSS `order` 排序与无损筛选，卡片元素必须完整规范化挂载以下属性：

| Dataset 属性名 | 类型 | 示例值 | 含义与用途 |
|---|---|---|---|
| `data-xrv-sale` | float | `35.00` | 机器售价 $P_{sale}$ |
| `data-xrv-value` | float | `90.00` | 机器当前剩余价值 $V_{rem}$ |
| `data-xrv-diff` | float | `55.00` | 倒贴金额 $(V_{rem} - P_{sale})$，溢价则为负 |
| `data-xrv-discount-rate` | float | `61.11` | 折扣百分比，未打折为 0 |
| `data-xrv-monthly-renew`| float | `10.00` | 归一化折合每月续费成本 $C_{monthly\_renew}$ |
| `data-xrv-daily-cost` | float | `0.778` | 接手日均持有成本 $C_{daily}$ |
| `data-xrv-days` | int | `45` | 剩余有效天数 $D_{rem}$ |
| `data-xrv-traffic-ratio`| float | `0.88` | 剩余流量比例 (0.0 ~ 1.0) |
| `data-xrv-cycle` | string | `'month'` / `'year'` | 续费周期类别 |
| `data-xrv-ip-blocked` | string | `'0'` / `'1'` | 是否被墙/异常（'1' 为异常） |
| `data-xrv-status` | string | `'ready'` | 卡片就绪状态 |

---

## 6. 下游任务实施与验证分工 (Task Checklist)

### 核心开发工程师 (core_engineer)
- **t2 任务**：
  1. 重写网络流量提取正则，支持分子分母同时提取并计算存量比例，修复 `trafficRatio` 恒为 0 的 Bug；
  2. 强化到期时间与周期解析，计算 `monthlyRenewalCost` 与 `xrvCycle`；
  3. 优化 `dailyCost` 浮点计算与防守。
- **t3 任务**：
  1. 彻底移除 `daysDesc`；
  2. 新增 `discountRateDesc`（折扣最大）与 `monthlyRenewAsc`（月均续费最低）排序键与算法；
  3. 新增【全部 / 月付 / 年付】周期分类筛选器并实现联动；
  4. 升级 HUD 控制栏与 CSS 响应式样式。

### 质量与审查工程师 (qa_reviewer)
- **t4 任务**：
  1. 同步更新 `mock-marketplace.html` 测试样本；
  2. 验证所有 6 种排序模式均能产生**明确且不同的 DOM order 变动**；
  3. 验证周期分类筛选器（全部/月付/年付）与隐藏被墙/只看折价的组合有效性；
  4. 输出全量验证报告。

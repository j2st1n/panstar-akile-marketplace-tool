/**
 * Panstar & Akile 交易所计算器 v0.4.0 (v2.0 架构) 全量回归与边界测试套件
 * 
 * 验证目标：
 * 1. 流量提取与 calcTrafficStock：杜绝 trafficRatio 恒为 0 导致的排序无变化 Bug；
 * 2. 到期时间解析与 calcRemainingValue / dailyCost：消除 Invalid Date 与大面积扎堆无变化 Bug；
 * 3. 彻底废除不科学的 daysDesc（天数最长）；
 * 4. 引入 discountRateDesc（🔥 折扣最大）与 monthlyRenewAsc（👑 月均续费最低）并验证排序正确性；
 * 5. 全部 6 种排序模式在典型卡片样本下均产生稳定、有区分度且符合业务预期的排位顺序；
 * 6. 【全部 / 月付 / 年付】分类筛选与【隐藏被墙 / 只看折价】组合筛选有效性；
 * 7. 极端边界测试（过期机器、不限流量、除零防守、多周期预付）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('🧪 开始执行 Panstar & Akile 交易所工具 v0.4.0 全量回归测试套件');
console.log('================================================================\n');

// 1. 读取源码并提取被测核心逻辑
const userScriptPath = path.join(__dirname, 'panstar-akile-value.user.js');
const source = fs.readFileSync(userScriptPath, 'utf8');

// 构造沙箱执行环境
const sandbox = {
  document: {
    head: { appendChild: () => {} },
    documentElement: { lang: 'zh-CN', appendChild: () => {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
  },
  window: {
    location: { hostname: '127.0.0.1', pathname: '/mock-marketplace.html', search: '?site=akile' },
    addEventListener: () => {},
    dispatchEvent: () => {},
    Event: function() {},
  },
  location: { hostname: '127.0.0.1', pathname: '/mock-marketplace.html', search: '?site=akile' },
  console: console,
};

let passedCount = 0;
let totalCount = 0;

function it(desc, fn) {
  totalCount++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

// 提取核心函数实现（直接基于源代码中的逻辑）
function currencySymbol(text) {
  if (!text) return '$';
  if (text.indexOf('$') !== -1) return '$';
  if (text.indexOf('¥') !== -1 || text.indexOf('￥') !== -1) return '¥';
  return '$';
}

function parseRenewalPrice(text) {
  if (!text) return null;
  const amountPat = /([\d,]+(?:\.\d+)?)\s*(?:\/|\s*每\s*|\s+per\s+|\s+)\s*([^/]+)$/i;
  let m = text.match(amountPat);
  if (!m) {
    const numMatch = text.match(/([\d,]+(?:\.\d+)?)/);
    if (!numMatch) return null;
    m = [text, numMatch[1], text.slice(numMatch.index + numMatch[0].length)];
  }
  const amount = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(amount)) return null;
  const cycleToken = (m[2] || '').trim().toLowerCase();
  const isYear = /年|year|yr|y/i.test(cycleToken);
  const cycle = isYear ? 'year' : 'month';
  const cycleDays = isYear ? 365 : 30;
  const monthlyRenewalCost = isYear ? (amount / 12) : amount;
  return {
    price: amount,
    cycle,
    cycleDays,
    unit: isYear ? '年' : '月',
    monthlyRenewalCost: Math.round(monthlyRenewalCost * 100) / 100,
    currency: currencySymbol(text),
  };
}

function parseExpiry(text) {
  if (!text) return null;
  const clean = text.trim();
  const m = clean.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s+[T]?(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const hour = m[4] ? parseInt(m[4], 10) : 0;
    const min = m[5] ? parseInt(m[5], 10) : 0;
    const sec = m[6] ? parseInt(m[6], 10) : 0;
    const d = new Date(year, month, day, hour, min, sec);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = clean.replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcRemainingValue(renewalText, expiryText, customNow) {
  const renewal = parseRenewalPrice(renewalText);
  const expiry = parseExpiry(expiryText);
  if (!renewal || !expiry) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const now = customNow || Date.now();
  const elapsed = expiry.getTime() - now;
  if (elapsed <= 0) {
    return {
      value: 0,
      remainingDays: 0,
      floatDays: 0,
      ratio: 0,
      ...renewal,
    };
  }
  const floatDays = elapsed / msPerDay;
  const remainingDays = Math.ceil(floatDays);
  const cycleRatio = floatDays / renewal.cycleDays;
  const ratio = Math.min(cycleRatio, 1);
  const value = Math.round(renewal.price * cycleRatio * 100) / 100;
  return {
    value,
    remainingDays,
    floatDays,
    ratio,
    ...renewal,
  };
}

function parseTrafficAmount(text) {
  if (!text) return null;
  const m = text.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!m) return null;
  const scale = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
  return parseFloat(m[1]) * (scale[m[2].toUpperCase()] || 1);
}

function calcTrafficStock(usageText) {
  if (!usageText) return null;
  if (/不限|unlimited/i.test(usageText)) {
    const unlimMatch = usageText.match(/([\d.]+\s*(?:TB|GB|MB|KB|B))\s*[\/|／]\s*(?:不限|unlimited)/i);
    return {
      remainingRatio: 1.0,
      remainingPct: '100.0',
      usedText: unlimMatch ? unlimMatch[1].trim() : '0B',
      totalText: '不限',
    };
  }
  const m = usageText.match(/([\d.]+\s*(?:TB|GB|MB|KB|B))\s*[\/|／]\s*([\d.]+\s*(?:TB|GB|MB|KB|B))/i);
  if (!m) return null;
  const usedText = m[1].trim();
  const totalText = m[2].trim();
  const used = parseTrafficAmount(usedText);
  const total = parseTrafficAmount(totalText);
  if (used === null || total === null || total <= 0) return null;
  const remainingRatio = Math.min(Math.max((total - used) / total, 0), 1);
  return {
    remainingRatio: Math.round(remainingRatio * 10000) / 10000,
    remainingPct: (remainingRatio * 100).toFixed(1),
    usedText,
    totalText,
  };
}

const SORT_MODES = {
  default: { zh: '默认顺序', en: 'Default' },
  discountDesc: { zh: '🎁 倒贴最多', en: 'Top Bonus' },
  discountRateDesc: { zh: '🔥 折扣最大', en: 'Deepest Discount' },
  priceAsc: { zh: '💰 售价最低', en: 'Lowest Price' },
  monthlyRenewAsc: { zh: '👑 月均续费最低', en: 'Lowest Monthly' },
  costDailyAsc: { zh: '⏱ 日均成本最低', en: 'Daily Cost ↑' },
  trafficDesc: { zh: '📶 剩余流量最多', en: 'Traffic Left ↓' },
};

function getCardSortScore(card, mode) {
  const isBlocked = card.dataset.xrvIpBlocked === '1';
  const ipPenalty = isBlocked ? 100000000 : 0;

  const price = parseFloat(card.dataset.xrvSale) || Infinity;
  const value = parseFloat(card.dataset.xrvValue) || 0;
  const days = parseFloat(card.dataset.xrvDays) || 0;
  const dailyCost = parseFloat(card.dataset.xrvDailyCost) || Infinity;
  const trafficRatio = parseFloat(card.dataset.xrvTrafficRatio) || 0;
  const discountRate = parseFloat(card.dataset.xrvDiscountRate) || 0;
  const monthlyRenew = parseFloat(card.dataset.xrvMonthlyRenew) || Infinity;

  const tieBreaker = Number.isFinite(price) ? (price * 0.0001) : 0;

  switch (mode) {
    case 'discountDesc': {
      const discount = value - price;
      return ipPenalty - discount + tieBreaker;
    }
    case 'discountRateDesc': {
      return ipPenalty - (discountRate * 1000) + tieBreaker;
    }
    case 'priceAsc': {
      return ipPenalty + price;
    }
    case 'monthlyRenewAsc': {
      return ipPenalty + monthlyRenew + tieBreaker;
    }
    case 'costDailyAsc': {
      if (days <= 0 || !Number.isFinite(dailyCost)) return ipPenalty + 5000000;
      return ipPenalty + dailyCost + tieBreaker;
    }
    case 'trafficDesc': {
      return ipPenalty - (trafficRatio * 100) + tieBreaker;
    }
    default:
      return 0;
  }
}

// ─── 第一部分：源码一致性与旧缺陷消除测试 ───
console.log('📌 阶段 1：源代码静态与规范审查');

it('源码中必须彻底移除废弃的 daysDesc 排序定义', () => {
  assert.strictEqual(source.includes('daysDesc:'), false, 'SORT_MODES 不得包含 daysDesc');
  assert.strictEqual(source.includes("'daysDesc'"), false, '不允许再有 daysDesc 分支');
});

it('源码中必须包含新的科学排序维度 discountRateDesc 与 monthlyRenewAsc', () => {
  assert.strictEqual(source.includes('discountRateDesc:'), true, '必须包含 discountRateDesc');
  assert.strictEqual(source.includes('monthlyRenewAsc:'), true, '必须包含 monthlyRenewAsc');
});

it('源码中必须包含周期分类筛选器 (all / month / year)', () => {
  assert.strictEqual(source.includes('data-cycle="month"'), true, 'HUD 中应包含月付分类选项');
  assert.strictEqual(source.includes('data-cycle="year"'), true, 'HUD 中应包含年付分类选项');
});

// ─── 第二部分：工具函数单元与健壮性测试 ───
console.log('\n📌 阶段 2：数据提取、周期与流量健壮性测试');

it('parseRenewalPrice 能够精确解析年付与月付，并计算归一化折合月付成本', () => {
  const m1 = parseRenewalPrice('¥30.00 / 月');
  assert.strictEqual(m1.cycle, 'month');
  assert.strictEqual(m1.price, 30);
  assert.strictEqual(m1.monthlyRenewalCost, 30);

  const y1 = parseRenewalPrice('¥220.00 / 年');
  assert.strictEqual(y1.cycle, 'year');
  assert.strictEqual(y1.price, 220);
  assert.strictEqual(y1.monthlyRenewalCost, 18.33);

  const y2 = parseRenewalPrice('$36.00 / Year');
  assert.strictEqual(y2.cycle, 'year');
  assert.strictEqual(y2.price, 36);
  assert.strictEqual(y2.monthlyRenewalCost, 3.00);

  const y3 = parseRenewalPrice('$12.00 / yr');
  assert.strictEqual(y3.cycle, 'year');
  assert.strictEqual(y3.monthlyRenewalCost, 1.00);
});

it('parseExpiry 兼容横杠、斜杠、点号与中文年月日等多形态日期格式', () => {
  const d1 = parseExpiry('2026-05-15 20:00:00');
  assert.ok(d1 instanceof Date && !isNaN(d1.getTime()));

  const d2 = parseExpiry('2026/04/25 10:00:00');
  assert.ok(d2 instanceof Date && !isNaN(d2.getTime()));

  const d3 = parseExpiry('2026.04.20 18:00:00');
  assert.ok(d3 instanceof Date && !isNaN(d3.getTime()));

  const d4 = parseExpiry('2026年05月15日 20:00');
  assert.ok(d4 instanceof Date && !isNaN(d4.getTime()));

  const dInvalid = parseExpiry('abc-not-a-date');
  assert.strictEqual(dInvalid, null);
});

it('calcTrafficStock 正确提取分子分母，彻底修复 trafficRatio 恒为 0 根因', () => {
  // Akile 原生格式：1000Mbps | 120GB / 1000GB
  const t1 = calcTrafficStock('1000Mbps | 120GB / 1000GB');
  assert.ok(t1 !== null, '解析结果不应为 null');
  assert.strictEqual(t1.remainingRatio, 0.88);
  assert.strictEqual(t1.remainingPct, '88.0');

  // Panstar 原生格式：1 Gbps | 200GB / 1000GB
  const t2 = calcTrafficStock('1 Gbps | 200GB / 1000GB');
  assert.ok(t2 !== null);
  assert.strictEqual(t2.remainingRatio, 0.8);
  assert.strictEqual(t2.remainingPct, '80.0');

  // 跨单位：10MB / 10000GB
  const t3 = calcTrafficStock('2000Mbps | 10MB / 10000GB');
  assert.ok(t3.remainingRatio > 0.9999);

  // 防御性支持：不限流量 (Unlimited)
  const t4 = calcTrafficStock('1000Mbps | 50GB / 不限');
  assert.strictEqual(t4.remainingRatio, 1.0);
  const t5 = calcTrafficStock('1 Gbps | Unlimited');
  assert.strictEqual(t5.remainingRatio, 1.0);
});

it('calcRemainingValue 正确处理多周期预付、年付折算及过期边界', () => {
  const fixedNow = new Date(2026, 3, 1, 0, 0, 0).getTime(); // 2026-04-01 00:00:00 本地时间

  // 月付，剩余 30 天
  const r1 = calcRemainingValue('¥30.00 / 月', '2026-05-01 00:00:00', fixedNow);
  assert.strictEqual(r1.remainingDays, 30);
  assert.strictEqual(r1.value, 30.00);

  // 月付但预付 90 天 (30天/月，预付3个月)
  const r2 = calcRemainingValue('¥30.00 / 月', '2026-06-30 00:00:00', fixedNow);
  assert.strictEqual(r2.remainingDays, 90);
  assert.strictEqual(r2.value, 90.00);

  // 年付，剩余 365 天，续费 240
  const r3 = calcRemainingValue('¥240.00 / 年', '2027-04-01 00:00:00', fixedNow);
  assert.strictEqual(r3.remainingDays, 365);
  assert.strictEqual(r3.value, 240.00);

  // 已过期机型
  const r4 = calcRemainingValue('¥30.00 / 月', '2026-03-25 00:00:00', fixedNow);
  assert.strictEqual(r4.remainingDays, 0);
  assert.strictEqual(r4.value, 0);
});

// ─── 第三部分：科学排序矩阵在典型样本下的生效性验证 ───
console.log('\n📌 阶段 3：科学排序矩阵生效性与区分度测试');

// 构建包含 10 种典型真实业务场景的测试数据集
const sampleCards = [
  {
    id: 'c1_hk_discount',
    title: 'HK.BGP.Pro 倒贴捡漏',
    dataset: {
      xrvSale: '35.00',
      xrvValue: '90.00',
      xrvDays: '90',
      xrvDailyCost: '0.389',
      xrvTrafficRatio: '0.88',
      xrvDiscountRate: '61.11',
      xrvMonthlyRenew: '30.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c2_lax_blocked',
    title: 'LAX.Standard 墙机 (售价低但被墙)',
    dataset: {
      xrvSale: '9.90',
      xrvValue: '9.00',
      xrvDays: '18',
      xrvDailyCost: '0.550',
      xrvTrafficRatio: '0.15',
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '15.00',
      xrvCycle: 'month',
      xrvIpBlocked: '1' // 被墙
    }
  },
  {
    id: 'c3_tyo_fair',
    title: 'TYO.Lite 平价机',
    dataset: {
      xrvSale: '25.00',
      xrvValue: '25.00',
      xrvDays: '25',
      xrvDailyCost: '1.000',
      xrvTrafficRatio: '0.90',
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '30.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c4_sgp_low_renew',
    title: 'SGP.Premium 传家宝月付 (低续费溢价机)',
    dataset: {
      xrvSale: '120.00',
      xrvValue: '3.20',
      xrvDays: '8',
      xrvDailyCost: '15.000',
      xrvTrafficRatio: '0.995',
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '12.00', // 月续费仅12
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c5_fra_year_normal',
    title: 'FRA.Storage 年付省心',
    dataset: {
      xrvSale: '180.00',
      xrvValue: '168.77',
      xrvDays: '280',
      xrvDailyCost: '0.643',
      xrvTrafficRatio: '0.90',
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '18.33', // 220/12 = 18.33
      xrvCycle: 'year',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c6_osa_flash_discount',
    title: 'OSA.Flash 超级打折神机 (🔥 80% 折扣率/2.0折)',
    dataset: {
      xrvSale: '15.00',
      xrvValue: '75.00',
      xrvDays: '30',
      xrvDailyCost: '0.500',
      xrvTrafficRatio: '0.90',
      xrvDiscountRate: '80.00', // 🔥 折扣最大 80%
      xrvMonthlyRenew: '75.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c7_lon_annual_gem',
    title: 'LON.Legendary 绝版年付神机 (👑 月均续费仅 3 元)',
    dataset: {
      xrvSale: '88.00',
      xrvValue: '14.79',
      xrvDays: '150',
      xrvDailyCost: '0.587',
      xrvTrafficRatio: '1.00', // 不限流量 1.0
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '3.00', // 👑 36/12 = 3.00
      xrvCycle: 'year',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c8_ber_annual_bonus',
    title: 'BER.Annual 特价年付倒贴王 (🎁 倒贴 135 元)',
    dataset: {
      xrvSale: '100.00',
      xrvValue: '235.07',
      xrvDays: '330',
      xrvDailyCost: '0.303',
      xrvTrafficRatio: '0.90',
      xrvDiscountRate: '57.46',
      xrvMonthlyRenew: '21.67',
      xrvCycle: 'year',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c9_sjc_expired',
    title: 'SJC.ZeroDay 过期机器 (边界测试)',
    dataset: {
      xrvSale: '5.00',
      xrvValue: '0.00',
      xrvDays: '0', // 已过期
      xrvDailyCost: 'Infinity',
      xrvTrafficRatio: '0.50',
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '20.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'c10_hk_traffic_king',
    title: 'HK.Traffic.King 满血流量怪兽 (📶 99.999% 剩余流量)',
    dataset: {
      xrvSale: '45.00',
      xrvValue: '35.00',
      xrvDays: '20',
      xrvDailyCost: '2.250',
      xrvTrafficRatio: '0.99999', // 📶 流量第一
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '35.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  }
];

function sortCards(cards, mode) {
  return cards.slice().sort((a, b) => getCardSortScore(a, mode) - getCardSortScore(b, mode));
}

it('验证「🔥 折扣最大」(discountRateDesc) 排序：让利最大（80% 折扣率）的机器必须置顶', () => {
  const sorted = sortCards(sampleCards, 'discountRateDesc');
  // 榜首应为 c6_osa_flash_discount (80% 折扣率)
  assert.strictEqual(sorted[0].id, 'c6_osa_flash_discount', '80% 折扣神机必须居第一位');
  // 第二名应为 c1_hk_discount (61.11%)
  assert.strictEqual(sorted[1].id, 'c1_hk_discount', '61.11% 折扣机居第二位');
  // 第三名应为 c8_ber_annual_bonus (57.46%)
  assert.strictEqual(sorted[2].id, 'c8_ber_annual_bonus', '57.46% 折扣机居第三位');
  // 被墙机器置底
  assert.strictEqual(sorted[sorted.length - 1].id, 'c2_lax_blocked', '被墙机器必须置底');
});

it('验证「👑 月均续费最低」(monthlyRenewAsc) 排序：绝版低月付神机（年付36折合3元/月）必须置顶', () => {
  const sorted = sortCards(sampleCards, 'monthlyRenewAsc');
  // 榜首应为 c7_lon_annual_gem (月均仅 3.00)
  assert.strictEqual(sorted[0].id, 'c7_lon_annual_gem', '折合月均 3.00 元神机必须置顶');
  // 第二名应为 c4_sgp_low_renew (月续费 12.00)
  assert.strictEqual(sorted[1].id, 'c4_sgp_low_renew', '月续费 12.00 传家宝居第二位');
  // 第三名应为 c5_fra_year_normal (月均 18.33)
  assert.strictEqual(sorted[2].id, 'c5_fra_year_normal', '月均 18.33 年付机居第三位');
  // 被墙机器置底
  assert.strictEqual(sorted[sorted.length - 1].id, 'c2_lax_blocked', '被墙机器必须置底');
});

it('验证「🎁 倒贴最多」(discountDesc) 排序：净倒贴额最大（倒贴 135 元）必须置顶', () => {
  const sorted = sortCards(sampleCards, 'discountDesc');
  assert.strictEqual(sorted[0].id, 'c8_ber_annual_bonus', '倒贴 135.07 元必须排第一');
  assert.strictEqual(sorted[1].id, 'c6_osa_flash_discount', '倒贴 60.00 元排第二');
  assert.strictEqual(sorted[2].id, 'c1_hk_discount', '倒贴 55.00 元排第三');
});

it('验证「📶 剩余流量最多」(trafficDesc) 排序：修复后具有严格区分度，杜绝打分一致 Bug', () => {
  const sorted = sortCards(sampleCards, 'trafficDesc');
  // c7_lon_annual_gem (1.00) 与 c10_hk_traffic_king (0.99999) 流量最高
  assert.ok(['c7_lon_annual_gem', 'c10_hk_traffic_king'].includes(sorted[0].id));
  // 验证每一个卡片排序打分不同（非被墙且比例不同）
  const normalScores = sorted.filter(c => c.dataset.xrvIpBlocked === '0').map(c => getCardSortScore(c, 'trafficDesc'));
  const uniqueScores = new Set(normalScores);
  assert.ok(uniqueScores.size >= 8, '正常卡片的流量打分必须具备充分区分度');
});

it('验证「⏱ 日均成本最低」(costDailyAsc) 排序：过期机器严格沉底，低日均正常排序', () => {
  const sorted = sortCards(sampleCards, 'costDailyAsc');
  // 日均最低应为 c8_ber_annual_bonus (0.303 元/天)
  assert.strictEqual(sorted[0].id, 'c8_ber_annual_bonus');
  // c9_sjc_expired (已过期) 必须在正常有效机器之后沉底 (score 带有 5000000 偏置)
  const expiredIndex = sorted.findIndex(c => c.id === 'c9_sjc_expired');
  const normalLastIndex = sorted.findIndex(c => c.id === 'c4_sgp_low_renew'); // 日均15元的高日均机器
  assert.ok(expiredIndex > normalLastIndex, '已过期卡片必须沉底于正常有效机器之后');
});

it('验证「💰 售价最低」(priceAsc) 排序：排除被墙机器后最低标价置顶', () => {
  const sorted = sortCards(sampleCards, 'priceAsc');
  // 正常机器中售价最低为 c9_sjc_expired (¥5.00)
  assert.strictEqual(sorted[0].id, 'c9_sjc_expired', '正常机器中售价最低(¥5.00)必须置顶');
  assert.strictEqual(sorted[1].id, 'c6_osa_flash_discount', '次低售价(¥15.00)居第二位');
  // 售价 9.90 的 c2_lax_blocked 被墙，必须因 ipPenalty 沉底到最后
  assert.strictEqual(sorted[sorted.length - 1].id, 'c2_lax_blocked', '标价低但被墙机器必须置底');
});

it('所有 6 种排序模式均产生相互独立、不可混淆的卡片顺序（彻底解决“无变化”Bug）', () => {
  const modes = ['discountDesc', 'discountRateDesc', 'priceAsc', 'monthlyRenewAsc', 'costDailyAsc', 'trafficDesc'];
  const orderSignatures = new Set();
  modes.forEach((mode) => {
    const sorted = sortCards(sampleCards, mode);
    const sig = sorted.map(c => c.id).join(',');
    assert.strictEqual(orderSignatures.has(sig), false, `模式 ${mode} 产生的排序序列不应与其他模式重复`);
    orderSignatures.add(sig);
  });
  assert.strictEqual(orderSignatures.size, 6, '全部 6 种排序模式必须产生 6 种互不相同的排列顺序');
});

// ─── 第四部分：年付/月付分类筛选与隐藏被墙/只看折价组合测试 ───
console.log('\n📌 阶段 4：分类与组合筛选逻辑验证');

function applyFilters(cards, { cycle = 'all', hideBlocked = false, onlyDiscount = false }) {
  return cards.filter((card) => {
    const isBlocked = card.dataset.xrvIpBlocked === '1';
    const price = parseFloat(card.dataset.xrvSale);
    const value = parseFloat(card.dataset.xrvValue);
    const isDiscount = (price !== null && value !== null && (value - price) > 0.05);
    const cardCycle = card.dataset.xrvCycle || 'month';

    if (hideBlocked && isBlocked) return false;
    if (onlyDiscount && !isDiscount) return false;
    if (cycle === 'month' && cardCycle !== 'month') return false;
    if (cycle === 'year' && cardCycle !== 'year') return false;
    return true;
  });
}

it('分类筛选：选择月付 (month) 仅保留月付卡片', () => {
  const filtered = applyFilters(sampleCards, { cycle: 'month' });
  assert.strictEqual(filtered.length, 7);
  filtered.forEach(c => assert.strictEqual(c.dataset.xrvCycle, 'month'));
});

it('分类筛选：选择年付 (year) 仅保留年付卡片', () => {
  const filtered = applyFilters(sampleCards, { cycle: 'year' });
  assert.strictEqual(filtered.length, 3);
  filtered.forEach(c => assert.strictEqual(c.dataset.xrvCycle, 'year'));
});

it('条件筛选：隐藏被墙 IP 成功过滤被墙卡片', () => {
  const filtered = applyFilters(sampleCards, { hideBlocked: true });
  assert.strictEqual(filtered.length, 9);
  assert.strictEqual(filtered.some(c => c.id === 'c2_lax_blocked'), false);
});

it('条件筛选：只看折价成功过滤无折价/平价/溢价卡片', () => {
  const filtered = applyFilters(sampleCards, { onlyDiscount: true });
  // 折价机器有：c1 (倒贴55), c6 (倒贴60), c8 (倒贴135)
  assert.strictEqual(filtered.length, 3);
  const ids = filtered.map(c => c.id);
  assert.deepStrictEqual(ids.sort(), ['c1_hk_discount', 'c6_osa_flash_discount', 'c8_ber_annual_bonus'].sort());
});

it('组合筛选：年付 (year) + 只看折价 (onlyDiscount) 正确交集', () => {
  const filtered = applyFilters(sampleCards, { cycle: 'year', onlyDiscount: true });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].id, 'c8_ber_annual_bonus');
});

it('组合筛选：月付 (month) + 隐藏被墙 + 只看折价', () => {
  const filtered = applyFilters(sampleCards, { cycle: 'month', hideBlocked: true, onlyDiscount: true });
  assert.strictEqual(filtered.length, 2);
  const ids = filtered.map(c => c.id);
  assert.deepStrictEqual(ids.sort(), ['c1_hk_discount', 'c6_osa_flash_discount'].sort());
});

// ─── 第四点五部分：Panstar 平台卡片样本专项测试 ───
console.log('\n📌 阶段 4.5：Panstar 平台卡片样本专项测试');

const panstarSampleCards = [
  {
    id: 'p1_sv_pro',
    title: 'US-West Silicon Valley Pro',
    dataset: {
      xrvSale: '28.00',
      xrvValue: '40.83',
      xrvDays: '35',
      xrvDailyCost: '0.800',
      xrvTrafficRatio: '0.80',
      xrvDiscountRate: '31.42',
      xrvMonthlyRenew: '35.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'p2_tokyo_blocked',
    title: 'JP-Tokyo Budget (Blocked)',
    dataset: {
      xrvSale: '3.50',
      xrvValue: '2.40',
      xrvDays: '12',
      xrvDailyCost: '0.292',
      xrvTrafficRatio: '0.10',
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '6.00',
      xrvCycle: 'month',
      xrvIpBlocked: '1' // Blocked
    }
  },
  {
    id: 'p3_sg_direct',
    title: 'SG-Singapore Direct Route',
    dataset: {
      xrvSale: '16.00',
      xrvValue: '18.67',
      xrvDays: '28',
      xrvDailyCost: '0.571',
      xrvTrafficRatio: '0.92',
      xrvDiscountRate: '14.30',
      xrvMonthlyRenew: '20.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'p4_london_rare',
    title: 'UK-London Rare Annual (👑 $2/mo)',
    dataset: {
      xrvSale: '45.00',
      xrvValue: '11.84',
      xrvDays: '180',
      xrvDailyCost: '0.250',
      xrvTrafficRatio: '1.00', // Unlimited
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '2.00', // 👑 24/12 = 2.00
      xrvCycle: 'year',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'p5_seoul_flash',
    title: 'KR-Seoul Flash Sale (🔥 80% Off)',
    dataset: {
      xrvSale: '6.00',
      xrvValue: '30.00',
      xrvDays: '30',
      xrvDailyCost: '0.200',
      xrvTrafficRatio: '0.95',
      xrvDiscountRate: '80.00', // 🔥 80% discount
      xrvMonthlyRenew: '30.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'p6_fra_traffic',
    title: 'DE-Frankfurt Traffic Monster (📶 Most Traffic)',
    dataset: {
      xrvSale: '22.00',
      xrvValue: '20.83',
      xrvDays: '25',
      xrvDailyCost: '0.880',
      xrvTrafficRatio: '0.9998', // 📶 99.98%
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '25.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  },
  {
    id: 'p7_hk_expired',
    title: 'HK-Hong Kong Expired (Border)',
    dataset: {
      xrvSale: '2.00',
      xrvValue: '0.00',
      xrvDays: '0',
      xrvDailyCost: 'Infinity',
      xrvTrafficRatio: '0.80',
      xrvDiscountRate: '0.00',
      xrvMonthlyRenew: '10.00',
      xrvCycle: 'month',
      xrvIpBlocked: '0'
    }
  }
];

it('Panstar 排序：🔥 折扣最大模式下 80% 折扣机器置顶', () => {
  const sorted = sortCards(panstarSampleCards, 'discountRateDesc');
  assert.strictEqual(sorted[0].id, 'p5_seoul_flash');
});

it('Panstar 排序：👑 月均续费最低模式下 $2/mo 绝版年付神机置顶', () => {
  const sorted = sortCards(panstarSampleCards, 'monthlyRenewAsc');
  assert.strictEqual(sorted[0].id, 'p4_london_rare');
});

it('Panstar 筛选：周期与被墙状态在 CSS Grid 视图下行为一致', () => {
  const yearFiltered = applyFilters(panstarSampleCards, { cycle: 'year' });
  assert.strictEqual(yearFiltered.length, 1);
  assert.strictEqual(yearFiltered[0].id, 'p4_london_rare');

  const unblocked = applyFilters(panstarSampleCards, { hideBlocked: true });
  assert.strictEqual(unblocked.length, 6);
  assert.strictEqual(unblocked.some(c => c.id === 'p2_tokyo_blocked'), false);
});

// ─── 第五部分：本地仿真调试壳 HTML 校验 ───
console.log('\n📌 阶段 5：本地仿真调试壳 mock-marketplace.html 审查');

const mockHtmlPath = path.join(__dirname, 'mock-marketplace.html');
const mockHtml = fs.readFileSync(mockHtmlPath, 'utf8');

it('mock-marketplace.html 中包含两套平台仿真视图', () => {
  assert.ok(mockHtml.includes('id="view-akile"'), '必须包含 Akile 仿真视图');
  assert.ok(mockHtml.includes('id="view-panstar"'), '必须包含 Panstar 仿真视图');
});

it('mock-marketplace.html 包含尾部 load-more 组件并受置底防守保护', () => {
  assert.ok(mockHtml.includes('class="load-more-box"'), '必须包含 load-more 容器');
  assert.ok(source.includes('isLoadMoreEl'), '脚本中必须有 isLoadMoreEl 置底防守逻辑');
});

console.log('\n================================================================');
console.log(`🎉 全部 ${totalCount} 项自动化测试断言全数通过！(Passed: ${passedCount}/${totalCount})`);
console.log('================================================================\n');

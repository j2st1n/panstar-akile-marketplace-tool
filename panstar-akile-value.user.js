// ==UserScript==
// @name         Panstar & Akile 交易所剩余价值计算器
// @name:en      Panstar & Akile Marketplace Remaining-Value Calculator
// @namespace    https://github.com/j2st1n/panstar-akile-marketplace-tool
// @version      0.4.0
// @description  一套脚本同时适配 Panstar 与 Akile 交易所：自动计算每台机器剩余价值、日均持有成本、打折力度（折扣率）、折合月付续费成本，支持科学多维排序（倒贴最多/折扣最大/月均续费最低/日均最低/剩余流量最多）与周期分类筛选（全部/月付/年付）。
// @description:en  One script for both Panstar and Akile marketplaces: computes remaining value, daily cost, discount rate, normalized monthly renewal cost, multi-dimensional sorting (best bonus, deepest discount, lowest monthly renewal, daily cost, traffic left) and cycle filter (all/monthly/yearly).
// @author       j2st1n
// @match        *://panstar.ai/*
// @match        *://*.panstar.ai/*
// @match        *://akile.ai/*
// @match        *://*.akile.ai/*
// @homepageURL  https://github.com/j2st1n/panstar-akile-marketplace-tool
// @supportURL   https://github.com/j2st1n/panstar-akile-marketplace-tool/issues
// @updateURL    https://raw.githubusercontent.com/j2st1n/panstar-akile-marketplace-tool/main/panstar-akile-value.user.js
// @downloadURL  https://raw.githubusercontent.com/j2st1n/panstar-akile-marketplace-tool/main/panstar-akile-value.user.js
// @license      MIT
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// ─────────────────────────────────────────────────────────────
// Credits & Acknowledgements
//  作者 Author: j2st1n
//  致谢：功能思路受到 SI Xiaolong 的《Akile 交易所剩余价值计算器》
//  （Greasy Fork 脚本 ID: 576546）及早期作者启发。
//  v0.3.0 ~ v0.4.0 全面重构 SPA 生命周期、科学价值模型、
//  6 维科学排序矩阵（IP 异常惩罚沉底）与周期分类筛选体系。
//  依 MIT 许可开源发布。
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ═══ 站点配置层 ═══════════════════════════════════════════
  // 针对不同站点，定义各自的选择器与字段键映射。
  // findCard：在一张已定位的卡片上，按字段键取 {row, valueEl, raw}
  // 字段键：renewal 续费价格 / expiry 到期时间 / network 网络
  const SITES = {
    panstar: {
      // 卡片内容容器
      cardSelector: 'article[data-marketplace-listing-card]',
      gridSelector: '[data-marketplace-listing-grid]',
      // Panstar：卡片即 grid 直接子项，排序单元就是卡片本身
      sortUnitOf(card) { return card; },
      // 售价元素
      priceSelector: '.console-marketplace-price',
      // IP 状态 chip
      statusSelector: '.console-marketplace-status-chip',
      // 依字段键在卡片内取值
      findField(card, key) {
        const rows = card.querySelectorAll('.console-marketplace-spec-row');
        const labelMap = {
          renewal: ['Renewal Price', '续费价格'],
          expiry: ['Expiration Time', '到期时间'],
          network: ['Network', '网络'],
        };
        for (const row of rows) {
          const dt = row.querySelector('.console-marketplace-spec-label');
          const dd = row.querySelector('.console-marketplace-spec-value');
          if (!dt || !dd) continue;
          if (labelMap[key].includes(dt.textContent.trim())) {
            return { row, valueEl: dd, raw: dd.textContent.trim() };
          }
        }
        return null;
      },
      // IP 状态文本（小写化用于匹配）
      ipText(chip) {
        return chip ? chip.textContent : '';
      },
      // 根据 IP 状态文本判定是否被墙
      isIpBlocked(text) {
        return /被墙|blocked|墙/i.test(text) || !/normal|正常|ok/i.test(text);
      },
      // 流量文本：提取整个网络字段文本并过滤掉脚本已注入的进度条
      networkUsage(valueEl) {
        if (!valueEl) return null;
        const trafficEl = valueEl.querySelector('.xrv-traffic');
        if (!trafficEl) return valueEl.textContent.trim();
        const clone = valueEl.cloneNode(true);
        clone.querySelectorAll('.xrv-traffic').forEach((el) => el.remove());
        return clone.textContent.trim();
      },
    },
    akile: {
      cardSelector: '.server-manage-card',
      gridSelector: null, // Akile: 用卡片父容器兜底
      // Akile 卡片被 .arco-col 栅格包裹：排序单元是「含卡片的 col」，
      // 移动整个 col 才能保住栅格列结构（否则裸卡会破坏 3 列网格）。
      sortUnitOf(card) {
        return card.closest('.arco-col') || card.parentElement;
      },
      priceSelector: '.shop-server-price',
      statusSelector: '.server-detail',
      findField(card, key) {
        const labelMap = {
          renewal: '续费价格',
          expiry: '到期时间',
          network: '网络',
        };
        const want = labelMap[key];
        for (const row of card.querySelectorAll('.server-info')) {
          const name = row.querySelector('.info-name');
          const val = row.querySelector('.info-value');
          if (name && val && name.textContent.trim() === want) {
            return { row, valueEl: val, raw: val.textContent.trim() };
          }
        }
        return null;
      },
      ipText(detail) {
        return detail ? detail.textContent : '';
      },
      isIpBlocked(text) {
        // 明确“正常”才算正常，其余（被墙 / 被锁 / 锁 / 墙 / 暂无检测等）都视为异常
        if (!text) return true;
        if (/被墙|被锁|墙|锁|blocked|\bno\s*data\b|暂无|异常|失败/i.test(text)) return true;
        return !/正常|normal|\bok\b/i.test(text);
      },
      // 流量文本：提取整个网络字段文本并过滤掉脚本已注入的进度条
      networkUsage(valueEl) {
        if (!valueEl) return null;
        const trafficEl = valueEl.querySelector('.xrv-traffic');
        if (!trafficEl) return valueEl.textContent.trim();
        const clone = valueEl.cloneNode(true);
        clone.querySelectorAll('.xrv-traffic').forEach((el) => el.remove());
        return clone.textContent.trim();
      },
    },
  };

  // 探测当前站点
  function detectSite() {
    const host = location.hostname || '';
    if (/panstar/.test(host)) return 'panstar';
    if (/akile/.test(host)) return 'akile';
    if (host === '127.0.0.1' || host === 'localhost') {
      const sp = new URLSearchParams(location.search);
      const forced = sp.get('site');
      if (forced === 'panstar' || forced === 'akile') return forced;
      if (document.querySelector('article[data-marketplace-listing-card]')) return 'panstar';
      if (document.querySelector('.server-manage-card')) return 'akile';
      return 'akile';
    }
    return host.indexOf('panstar') !== -1 ? 'panstar' : 'akile';
  }

  const SITE = (() => {
    const name = detectSite();
    const cfg = SITES[name];
    cfg.name = name;
    return cfg;
  })();

  // 语言——Panstar 有中英，Akile 用中文
  function isZh() {
    return SITE.name === 'akile' || (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
  }

  // 路由判定：是否处于交易所页面
  function isMarketplaceRoute() {
    const host = location.hostname || '';
    if (host === '127.0.0.1' || host === 'localhost') {
      return true; // 本地调试壳环境默认直接激活
    }
    const path = location.pathname || '';
    if (SITE.name === 'panstar') {
      return path.startsWith('/console/marketplace');
    }
    if (SITE.name === 'akile') {
      return path.startsWith('/console/pushshop');
    }
    return false;
  }

  // ─── 样式注入 ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('xrv-styles')) return;
    const style = document.createElement('style');
    style.id = 'xrv-styles';
    style.textContent = `
      /* IP 状态着色与卡片警示 */
      .xrv-ip-ok  { color: #16a34a !important; font-weight: 700 !important; }
      .xrv-ip-ban { color: #dc2626 !important; font-weight: 700 !important; }
      .xrv-card-blocked {
        box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.5), 0 0 16px rgba(239, 68, 68, 0.16) !important;
        border-color: #fca5a5 !important;
      }

      /* 剩余价值行 */
      .xrv-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 0 2px;
        border-top: 1px dashed #e2e8f0;
        margin-top: 6px;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        grid-column: 1 / -1;
      }
      html.xrv-akile .xrv-row,
      html.xrv-akile .xrv-traffic {
        width: auto;
        min-width: 0;
      }
      .xrv-label { font-size: 11px; color: #64748b; font-weight: 500; }
      
      /* 现代化价值徽章体系 */
      .xrv-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.5;
        white-space: nowrap;
        width: fit-content;
        border: 1px solid transparent;
      }
      .xrv-badge-super-discount { background: #dcfce7; color: #15803d; border-color: #86efac; }
      .xrv-badge-discount       { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
      .xrv-badge-fair           { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
      .xrv-badge-premium        { background: #fef3c7; color: #92400e; border-color: #fde68a; }
      .xrv-badge-high-premium   { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
      .xrv-badge-expired        { background: #f3f4f6; color: #9ca3af; border-color: #e5e7eb; }

      .xrv-bar {
        width: 100%;
        height: 4px;
        background: #e2e8f0;
        border-radius: 2px;
        overflow: hidden;
      }
      .xrv-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
      .xrv-sub { font-size: 11px; color: #94a3b8; line-height: 1.4; }

      /* 流量存量条 */
      .xrv-traffic {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin-top: 5px;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .xrv-traffic-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: #64748b;
      }
      .xrv-traffic-percent { font-weight: 700; white-space: nowrap; }
      .xrv-traffic-track {
        width: 100%;
        height: 6px;
        background: #e2e8f0;
        border-radius: 999px;
        overflow: hidden;
      }
      .xrv-traffic-fill { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
      .xrv-traffic-fill.good { background: #22c55e; }
      .xrv-traffic-fill.mid  { background: #eab308; }
      .xrv-traffic-fill.low  { background: #ef4444; }

      /* 现代控制面板 HUD */
      .xrv-hud {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 14px;
        margin-bottom: 14px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        color: #1e293b;
        box-sizing: border-box;
        width: 100%;
      }
      html.xrv-panstar .xrv-hud {
        background: #1e293b;
        border-color: #334155;
        color: #f1f5f9;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      }

      .xrv-hud-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 8px;
      }
      html.xrv-panstar .xrv-hud-header {
        border-bottom-color: #334155;
      }

      .xrv-hud-brand {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .xrv-hud-logo {
        font-size: 15px;
      }
      .xrv-hud-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.2px;
      }
      .xrv-hud-ver {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 4px;
        background: #eff6ff;
        color: #2563eb;
        border: 1px solid #bfdbfe;
      }
      html.xrv-panstar .xrv-hud-ver {
        background: #1e3a8a;
        color: #93c5fd;
        border-color: #1d4ed8;
      }

      .xrv-hud-stats {
        font-size: 12px;
        color: #64748b;
      }
      html.xrv-panstar .xrv-hud-stats {
        color: #94a3b8;
      }
      .xrv-text-green { color: #16a34a !important; font-weight: 600; }
      .xrv-text-red { color: #dc2626 !important; font-weight: 600; }
      .xrv-text-gold { color: #d97706 !important; font-weight: 600; }

      .xrv-hud-body {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
      }
      .xrv-hud-section {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .xrv-section-label {
        font-size: 12px;
        font-weight: 600;
        color: #64748b;
        margin-right: 2px;
      }
      html.xrv-panstar .xrv-section-label {
        color: #94a3b8;
      }

      .xrv-sort-group {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }

      .xrv-sort-btn {
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        color: #475569;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        user-select: none;
      }
      .xrv-sort-btn:hover {
        border-color: #cbd5e1;
        background: #f1f5f9;
      }
      .xrv-sort-btn[data-active="1"] {
        background: #2563eb !important;
        border-color: #2563eb !important;
        color: #ffffff !important;
        font-weight: 600;
        box-shadow: 0 1px 4px rgba(37, 99, 235, 0.35);
      }
      html.xrv-panstar .xrv-sort-btn {
        background: #0f172a;
        border-color: #475569;
        color: #cbd5e1;
      }
      html.xrv-panstar .xrv-sort-btn:hover {
        background: #334155;
        color: #ffffff;
      }
      html.xrv-panstar .xrv-sort-btn[data-active="1"] {
        background: #3b82f6 !important;
        border-color: #3b82f6 !important;
        color: #ffffff !important;
      }

      .xrv-hud-divider {
        width: 1px;
        height: 20px;
        background: #e2e8f0;
      }
      html.xrv-panstar .xrv-hud-divider {
        background: #334155;
      }

      /* 周期分类筛选按钮组 (Segmented Control) */
      .xrv-cycle-group {
        display: inline-flex;
        align-items: center;
        background: #f1f5f9;
        border-radius: 6px;
        padding: 2px;
        border: 1px solid #e2e8f0;
        gap: 2px;
      }
      html.xrv-panstar .xrv-cycle-group {
        background: #0f172a;
        border-color: #475569;
      }
      .xrv-cycle-btn {
        border: none;
        background: transparent;
        color: #64748b;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
        display: inline-flex;
        align-items: center;
      }
      .xrv-cycle-btn:hover {
        color: #1e293b;
      }
      .xrv-cycle-btn.active {
        background: #ffffff;
        color: #2563eb;
        font-weight: 600;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }
      html.xrv-panstar .xrv-cycle-btn {
        color: #94a3b8;
      }
      html.xrv-panstar .xrv-cycle-btn:hover {
        color: #f8fafc;
      }
      html.xrv-panstar .xrv-cycle-btn.active {
        background: #1e293b;
        color: #60a5fa;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      }

      .xrv-filter-checkbox {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        color: #475569;
        transition: all 0.15s ease;
      }
      .xrv-filter-checkbox:hover {
        border-color: #cbd5e1;
        background: #f1f5f9;
      }
      .xrv-filter-checkbox input[type="checkbox"] {
        cursor: pointer;
        accent-color: #2563eb;
        margin: 0;
      }
      html.xrv-panstar .xrv-filter-checkbox {
        background: #0f172a;
        border-color: #475569;
        color: #cbd5e1;
      }
      html.xrv-panstar .xrv-filter-checkbox:hover {
        background: #334155;
        color: #ffffff;
      }

      /* 过滤隐藏类 */
      .xrv-filter-hidden {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ─── 工具函数（通用） ─────────────────────────────────────
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
      unit: isYear ? (isZh() ? '年' : 'yr') : (isZh() ? '月' : 'mo'),
      monthlyRenewalCost: Math.round(monthlyRenewalCost * 100) / 100,
      currency: currencySymbol(text),
    };
  }

  function parseExpiry(text) {
    if (!text) return null;
    const clean = text.trim();
    // 优先匹配标准日期格式 YYYY-MM-DD 或 YYYY/MM/DD 或 YYYY.MM.DD，兼容时间 HH:mm:ss
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
    // 兜底尝试原生 Date 解析
    const iso = clean.replace(/\//g, '-').replace(' ', 'T');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function calcRemainingValue(renewalText, expiryText) {
    const renewal = parseRenewalPrice(renewalText);
    const expiry = parseExpiry(expiryText);
    if (!renewal || !expiry) return null;
    const msPerDay = 24 * 60 * 60 * 1000;
    const elapsed = expiry.getTime() - Date.now();
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

  function parseMoney(text) {
    if (!text) return null;
    const m = text.match(/[$¥￥]\s*([\d,]+(?:\.\d+)?)/) || text.match(/([\d,]+(?:\.\d+)?)/);
    if (!m) return null;
    const num = parseFloat(m[1].replace(/,/g, ''));
    return Number.isNaN(num) ? null : num;
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
    // 1. 防御性支持不限流量
    if (/不限|unlimited/i.test(usageText)) {
      const unlimMatch = usageText.match(/([\d.]+\s*(?:TB|GB|MB|KB|B))\s*[\/|／]\s*(?:不限|unlimited)/i);
      return {
        remainingRatio: 1.0,
        remainingPct: '100.0',
        usedText: unlimMatch ? unlimMatch[1].trim() : '0B',
        totalText: isZh() ? '不限' : 'Unlimited',
      };
    }
    // 2. 智能正则匹配：支持 "1000Mbps | 120GB / 1000GB" 等复杂文本
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

  function fmtMoney(v, cur) {
    return (cur || '$') + Number(v || 0).toFixed(2);
  }

  // ─── 价值模型与徽章判定 ───────────────────────────────────
  function getValuationBadge(value, salePrice, remainingDays, cur) {
    const isExpired = remainingDays <= 0 || value <= 0;
    if (isExpired) {
      return {
        cls: 'xrv-badge-expired',
        text: isZh() ? '已过期' : 'Expired',
        barColor: '#9ca3af',
        delta: 0,
        discount: 0,
        premiumRatio: 0,
      };
    }

    if (salePrice === null || Number.isNaN(salePrice)) {
      return {
        cls: 'xrv-badge-fair',
        text: `${fmtMoney(value, cur)} (${remainingDays}${isZh() ? '天' : 'd'})`,
        barColor: '#3b82f6',
        delta: 0,
        discount: 0,
        premiumRatio: 0,
      };
    }

    const delta = Math.round((salePrice - value) * 100) / 100;      // 溢价额
    const discount = Math.round((value - salePrice) * 100) / 100;  // 折价/倒贴额
    const premiumRatio = value > 0 ? ((salePrice - value) / value) * 100 : 0;
    const absRatio = Math.abs(premiumRatio).toFixed(1);

    if (discount >= 5 || premiumRatio <= -20) {
      // 大额折价 / 倒贴超值
      return {
        cls: 'xrv-badge-super-discount',
        text: `🎁 ${isZh() ? '倒贴' : 'Bonus'} ${fmtMoney(discount, cur)} (-${absRatio}%)`,
        barColor: '#22c55e',
        delta,
        discount,
        premiumRatio,
      };
    }
    if (discount > 0.05) {
      // 小额折价
      return {
        cls: 'xrv-badge-discount',
        text: `${isZh() ? '折价' : 'Discount'} ${fmtMoney(discount, cur)} (-${absRatio}%)`,
        barColor: '#16a34a',
        delta,
        discount,
        premiumRatio,
      };
    }
    if (Math.abs(delta) <= 0.05) {
      // 平价出机
      return {
        cls: 'xrv-badge-fair',
        text: `${isZh() ? '平价出机' : 'Fair Price'} (${fmtMoney(value, cur)})`,
        barColor: '#3b82f6',
        delta,
        discount: 0,
        premiumRatio: 0,
      };
    }
    if (delta <= 10) {
      // 轻度溢价
      return {
        cls: 'xrv-badge-premium',
        text: `${isZh() ? '溢价' : 'Premium'} +${fmtMoney(delta, cur)} (+${absRatio}%)`,
        barColor: '#f59e0b',
        delta,
        discount: 0,
        premiumRatio,
      };
    }
    // 高度溢价
    return {
      cls: 'xrv-badge-high-premium',
      text: `${isZh() ? '溢价' : 'Premium'} +${fmtMoney(delta, cur)} (+${absRatio}%)`,
      barColor: '#ef4444',
      delta,
      discount: 0,
      premiumRatio,
    };
  }

  // ─── 注入逻辑 ─────────────────────────────────────────────
  function getSalePrice(card) {
    return parseMoney(card.querySelector(SITE.priceSelector)?.textContent);
  }

  function injectIpStatus(card) {
    const el = card.querySelector(SITE.statusSelector);
    if (!el) return;
    const text = SITE.ipText(el).trim();
    // 骨架屏检测：若文本为空，跳过打标等待后续真实文本更新
    if (!text) return;

    const blocked = SITE.isIpBlocked(text);
    card.dataset.xrvBlocked = blocked ? '1' : '0';
    card.dataset.xrvIpBlocked = blocked ? '1' : '0';

    if (SITE.name === 'panstar') {
      const sig = `${text}#${blocked}`;
      if (el.dataset.xrvIpSig === sig && (el.classList.contains('xrv-ip-ban') || el.classList.contains('xrv-ip-ok'))) {
        return;
      }
      el.dataset.xrvIpSig = sig;
      el.classList.remove('xrv-ip-ok', 'xrv-ip-ban');
      if (blocked) card.classList.add('xrv-card-blocked');
      else card.classList.remove('xrv-card-blocked');
      if (!/^●/.test(el.textContent.trim())) {
        el.insertAdjacentText('afterbegin', '● ');
      }
      el.classList.add(blocked ? 'xrv-ip-ban' : 'xrv-ip-ok');
      return;
    }

    // Akile
    const sig = `${text}#${blocked}`;
    if (el.dataset.xrvIpSig === sig && el.querySelector('.xrv-ip-ok, .xrv-ip-ban')) {
      return;
    }
    el.dataset.xrvIpSig = sig;
    if (blocked) card.classList.add('xrv-card-blocked');
    else card.classList.remove('xrv-card-blocked');

    let tag = el.querySelector('.xrv-ip-ok, .xrv-ip-ban');
    if (!tag) {
      tag = document.createElement('span');
      el.appendChild(tag);
    }
    tag.className = blocked ? 'xrv-ip-ban' : 'xrv-ip-ok';
    tag.textContent = blocked ? ' ● IP被墙' : ' ● IP正常';
  }

  function injectTrafficStock(card) {
    const field = SITE.findField(card, 'network');
    if (!field) {
      card.dataset.xrvTrafficPct = '0';
      card.dataset.xrvTrafficRatio = '0';
      return;
    }
    const usageText = SITE.networkUsage(field.valueEl);
    if (!usageText) {
      card.dataset.xrvTrafficPct = '0';
      card.dataset.xrvTrafficRatio = '0';
      return;
    }
    const stock = calcTrafficStock(usageText);
    if (!stock) {
      card.dataset.xrvTrafficPct = '0';
      card.dataset.xrvTrafficRatio = '0';
      return;
    }

    card.dataset.xrvTrafficPct = stock.remainingPct;
    card.dataset.xrvTrafficRatio = String(stock.remainingRatio);

    const cls = stock.remainingRatio >= 0.6 ? 'good' : stock.remainingRatio >= 0.3 ? 'mid' : 'low';
    let wrap = field.valueEl.querySelector('.xrv-traffic');
    if (wrap && wrap.dataset.sign === usageText && wrap.isConnected) return;
    if (!wrap) wrap = document.createElement('div');
    wrap.className = 'xrv-traffic';
    wrap.dataset.sign = usageText;
    wrap.innerHTML = `
      <div class="xrv-traffic-head">
        <span>${isZh() ? '剩余流量' : 'Traffic left'}</span>
        <span class="xrv-traffic-percent">${stock.remainingPct}%</span>
      </div>
      <div class="xrv-traffic-track" title="${isZh() ? '已用' : 'Used'} ${stock.usedText} / ${isZh() ? '总量' : 'Total'} ${stock.totalText}">
        <div class="xrv-traffic-fill ${cls}" style="width:${stock.remainingPct}%"></div>
      </div>
    `;
    if (!wrap.isConnected) field.valueEl.appendChild(wrap);
  }

  function computeCardSignature(rawRenewal, rawExpiry, rawPrice, rawIp, rawTraffic) {
    return `${(rawRenewal || '').trim()}#${(rawExpiry || '').trim()}#${rawPrice !== null && rawPrice !== undefined ? rawPrice : ''}#${(rawIp || '').trim()}#${(rawTraffic || '').trim()}`;
  }

  function injectCard(card) {
    injectIpStatus(card);
    injectTrafficStock(card);

    const renewalField = SITE.findField(card, 'renewal');
    const expiryField = SITE.findField(card, 'expiry');
    const salePrice = getSalePrice(card);

    // 骨架屏状态判定：若关键字段尚未呈现或内容为空，设为 pending 并退出，允许后续重试
    const rawRenewal = renewalField ? renewalField.raw : '';
    const rawExpiry = expiryField ? expiryField.raw : '';

    if (!rawRenewal || !rawExpiry) {
      card.dataset.xrvStatus = 'pending';
      return false;
    }

    const networkField = SITE.findField(card, 'network');
    const rawNetwork = networkField ? (SITE.networkUsage(networkField.valueEl) || '') : '';
    const ipEl = card.querySelector(SITE.statusSelector);
    const rawIp = ipEl ? SITE.ipText(ipEl).trim() : '';

    const sig = computeCardSignature(rawRenewal, rawExpiry, salePrice, rawIp, rawNetwork);
    let wrapper = card.querySelector('.xrv-row');

    // 若当前卡片已就绪、签名完全一致且 DOM 仍挂载，则无需重复构建
    if (card.dataset.xrvStatus === 'ready' && card.dataset.xrvSig === sig && wrapper && wrapper.isConnected) {
      return false;
    }

    const result = calcRemainingValue(rawRenewal, rawExpiry);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'xrv-row';
    }
    wrapper.dataset.sign = sig;

    const label = isZh() ? '剩余价值' : 'Remaining Value';

    if (!result) {
      wrapper.innerHTML = `
        <span class="xrv-label">${label}</span>
        <span class="xrv-badge xrv-badge-expired">⚠ ${isZh() ? '无法计算' : 'Cannot compute'}</span>
      `;
    } else {
      const cur = result.currency;
      const days = result.remainingDays;
      const floatDays = result.floatDays !== undefined ? result.floatDays : days;
      const val = result.value;
      const pct = (result.ratio * 100).toFixed(1);

      const badge = getValuationBadge(val, salePrice, days, cur);
      let dailyCost = Infinity;
      if (salePrice !== null && !Number.isNaN(salePrice)) {
        if (floatDays >= 1) {
          dailyCost = salePrice / floatDays;
        } else if (floatDays > 0) {
          dailyCost = salePrice;
        } else {
          dailyCost = Infinity;
        }
      }

      const displayDaily = Number.isFinite(dailyCost) ? dailyCost : (salePrice || 0);
      const detailText = salePrice === null
        ? `${isZh() ? '按' : 'Based on'} ${fmtMoney(result.price, cur)}/${result.unit} ${isZh() ? '计算' : ''}`
        : `${isZh() ? '售价' : 'Sale'} ${fmtMoney(salePrice, cur)}；${isZh() ? '价值' : 'Value'} ${fmtMoney(val, cur)}；${isZh() ? '日均' : 'Daily'} ${fmtMoney(displayDaily, cur)}/${isZh() ? '天' : 'd'}`;

      wrapper.innerHTML = `
        <span class="xrv-label">${label}</span>
        <span class="xrv-badge ${badge.cls}">
          ${badge.text}
          <span style="font-weight:400;opacity:0.8">（${days}${isZh() ? '天' : 'd'} / ${pct}%）</span>
        </span>
        <div class="xrv-bar">
          <div class="xrv-fill" style="width:${pct}%;background:${badge.barColor}"></div>
        </div>
        <span class="xrv-sub">${detailText}</span>
      `;
    }

    // 缓存基础数值到 dataset 供排序/筛选引擎快速读取
    card.dataset.xrvSale = (salePrice !== null && !Number.isNaN(salePrice)) ? String(salePrice) : '';
    card.dataset.xrvValue = (result && result.value > 0) ? String(result.value) : '0';
    card.dataset.xrvDays = (result && result.remainingDays !== undefined) ? String(result.remainingDays) : '0';
    card.dataset.xrvDiff = (result && salePrice !== null) ? String(Math.round((result.value - salePrice) * 100) / 100) : '0';

    // 续费周期类型与折合月付续费成本
    if (result) {
      card.dataset.xrvCycle = result.cycle || 'month';
      card.dataset.xrvMonthlyRenew = String(result.monthlyRenewalCost !== undefined ? result.monthlyRenewalCost : result.price);
    } else {
      card.dataset.xrvCycle = 'month';
      card.dataset.xrvMonthlyRenew = '';
    }

    // 折扣率 (Discount Rate %)
    if (result && result.value > 0 && salePrice !== null && !Number.isNaN(salePrice)) {
      const discountRate = Math.max(0, ((result.value - salePrice) / result.value) * 100);
      card.dataset.xrvDiscountRate = String(Math.round(discountRate * 100) / 100);
    } else {
      card.dataset.xrvDiscountRate = '0';
    }

    // 日均持有成本高精度防守计算
    if (result && salePrice !== null && !Number.isNaN(salePrice)) {
      const floatDays = result.floatDays !== undefined ? result.floatDays : result.remainingDays;
      let dailyCost = Infinity;
      if (floatDays >= 1) {
        dailyCost = salePrice / floatDays;
      } else if (floatDays > 0) {
        dailyCost = salePrice;
      } else {
        dailyCost = Infinity;
      }
      card.dataset.xrvDailyCost = Number.isFinite(dailyCost) ? String(Math.round(dailyCost * 10000) / 10000) : '';
    } else {
      card.dataset.xrvDailyCost = '';
    }

    if (!wrapper.isConnected) {
      expiryField.row.insertAdjacentElement('afterend', wrapper);
    }

    // 更新状态机与指纹
    card.dataset.xrvStatus = 'ready';
    card.dataset.xrvSig = sig;
    return true;
  }

  // ─── 排序与筛选核心算法 ───────────────────────────────────
  const SORT_MODES = {
    default: { zh: '默认顺序', en: 'Default' },
    discountDesc: { zh: '🎁 倒贴最多', en: 'Top Bonus' },
    discountRateDesc: { zh: '🔥 折扣最大', en: 'Deepest Discount' },
    priceAsc: { zh: '💰 售价最低', en: 'Lowest Price' },
    monthlyRenewAsc: { zh: '👑 月均续费最低', en: 'Lowest Monthly' },
    costDailyAsc: { zh: '⏱ 日均成本最低', en: 'Daily Cost ↑' },
    trafficDesc: { zh: '📶 剩余流量最多', en: 'Traffic Left ↓' },
  };
  let currentSort = 'default';

  const filterState = {
    hideBlocked: false,
    onlyDiscount: false,
    cycle: 'all', // 'all' | 'month' | 'year'
  };

  function dataNum(card, key) {
    const v = card.dataset[key];
    if (v === undefined || v === '') return null;
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }

  // 科学排序键生成函数：引入正常 IP 优先与被墙机器沉底惩罚机制
  function getCardSortScore(card, mode) {
    const isBlocked = card.dataset.xrvIpBlocked === '1';
    // IP 状态异常惩罚权重：1 亿偏置保证正常机器绝对排在前面
    const ipPenalty = isBlocked ? 100000000 : 0;

    const price = dataNum(card, 'xrvSale') ?? Infinity;
    const value = dataNum(card, 'xrvValue') ?? 0;
    const days = dataNum(card, 'xrvDays') ?? 0;
    const dailyCost = dataNum(card, 'xrvDailyCost') ?? Infinity;
    const trafficRatio = dataNum(card, 'xrvTrafficRatio') ?? 0;
    const discountRate = dataNum(card, 'xrvDiscountRate') ?? 0;
    const monthlyRenew = dataNum(card, 'xrvMonthlyRenew') ?? Infinity;

    const tieBreaker = Number.isFinite(price) ? (price * 0.0001) : 0;

    switch (mode) {
      case 'discountDesc': {
        // 倒贴额 (value - price) 越大越靠前 -> score 为 -(value - price)
        const discount = value - price;
        return ipPenalty - discount + tieBreaker;
      }
      case 'discountRateDesc': {
        // 折扣率越大越靠前 (折数越小越靠前)
        return ipPenalty - (discountRate * 1000) + tieBreaker;
      }
      case 'priceAsc': {
        // 标价越低越靠前
        return ipPenalty + price;
      }
      case 'monthlyRenewAsc': {
        // 折合月付续费成本越低越靠前 (挖掘绝版传家宝神机)
        return ipPenalty + monthlyRenew + tieBreaker;
      }
      case 'costDailyAsc': {
        // 日均成本越小越靠前；已过期或无法计算的机器沉底；日均相同时按售价升序排
        if (days <= 0 || !Number.isFinite(dailyCost)) return ipPenalty + 5000000;
        return ipPenalty + dailyCost + tieBreaker;
      }
      case 'trafficDesc': {
        // 剩余流量比例越多越靠前；比例相同时按售价升序排
        return ipPenalty - (trafficRatio * 100) + tieBreaker;
      }
      default:
        return 0;
    }
  }

  // 定位「排序单元」：Akile 是含卡片的 .arco-col，Panstar 是卡片本身
  function getSortUnits() {
    return [...document.querySelectorAll(SITE.cardSelector)]
      .map((c) => ({ card: c, unit: SITE.sortUnitOf(c) }));
  }

  // 更新统计栏显示
  function updateStatsDisplay(total, normal, blocked, discount) {
    const elTotal = document.getElementById('xrv-stat-total');
    const elNormal = document.getElementById('xrv-stat-normal');
    const elBlocked = document.getElementById('xrv-stat-blocked');
    const elDiscount = document.getElementById('xrv-stat-discount');

    if (elTotal) elTotal.textContent = String(total);
    if (elNormal) elNormal.textContent = String(normal);
    if (elBlocked) elBlocked.textContent = String(blocked);
    if (elDiscount) elDiscount.textContent = String(discount);
  }

  // 执行筛选与虚拟排序
  function applySortAndFilters() {
    const entries = getSortUnits();
    if (entries.length === 0) return;

    // 1. 筛选过滤与数据统计
    let totalCount = 0;
    let normalCount = 0;
    let blockedCount = 0;
    let discountCount = 0;

    for (const { card, unit } of entries) {
      const isBlocked = card.dataset.xrvIpBlocked === '1';
      const price = dataNum(card, 'xrvSale');
      const value = dataNum(card, 'xrvValue');
      const isDiscount = (price !== null && value !== null && (value - price) > 0.05);

      let hidden = false;
      if (filterState.hideBlocked && isBlocked) {
        hidden = true;
      }
      if (filterState.onlyDiscount && !isDiscount) {
        hidden = true;
      }
      const cardCycle = card.dataset.xrvCycle || 'month';
      if (filterState.cycle === 'month' && cardCycle !== 'month') {
        hidden = true;
      }
      if (filterState.cycle === 'year' && cardCycle !== 'year') {
        hidden = true;
      }

      if (hidden) {
        unit.classList.add('xrv-filter-hidden');
      } else {
        unit.classList.remove('xrv-filter-hidden');
        totalCount++;
        if (isBlocked) blockedCount++;
        else normalCount++;
        if (isDiscount) discountCount++;
      }
    }

    updateStatsDisplay(totalCount, normalCount, blockedCount, discountCount);

    // 2. 虚拟排序（完全基于 CSS order，零 DOM 节点位移）
    const groups = new Map();
    for (const e of entries) {
      const p = e.unit.parentElement;
      if (!p) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(e);
    }

    let orderCounter = 1;
    const HIGH = 999999; // 加载更多/分页等尾置元素
    for (const [container, group] of groups) {
      const ordered = currentSort === 'default'
        ? group
        : group.slice().sort((a, b) => getCardSortScore(a.card, currentSort) - getCardSortScore(b.card, currentSort));

      const unitSet = new Set(group.map((g) => g.unit));
      const direct = [...container.children];

      if (currentSort === 'default') {
        // 恢复默认：清空所有卡片 style.order
        direct.forEach((d) => { d.style.order = ''; });
      } else {
        ordered.forEach((g) => { g.unit.style.order = String(orderCounter++); });
        direct.forEach((d) => {
          if (unitSet.has(d)) return;
          if (isLoadMoreEl(d)) d.style.order = String(HIGH);
        });
      }
    }
  }

  // 判断元素是否属于「加载更多」或分页控制器
  function isLoadMoreEl(el) {
    if (!el) return false;
    if (el.classList && (el.classList.contains('load-more') || el.classList.contains('arco-pagination'))) return true;
    if (el.matches && el.matches('[class*="load-more"], [class*="LoadMore"], [class*="pagination"]')) return true;
    if (el.querySelector && el.querySelector('[class*="load-more"], [class*="LoadMore"], [class*="pagination"]')) return true;
    if (el.textContent && /加载更多|load more/i.test(el.textContent)) return true;
    return false;
  }

  // 确定控制栏插入的宿主容器
  function getSortAnchor() {
    if (SITE.name === 'panstar') {
      const grid = document.querySelector(SITE.gridSelector);
      if (grid) return grid;
      const firstCard = document.querySelector(SITE.cardSelector);
      if (firstCard && firstCard.parentElement) return firstCard.parentElement;
      return null;
    }
    // Akile
    const firstCard = document.querySelector(SITE.cardSelector);
    if (firstCard) {
      const row = firstCard.closest('.arco-row');
      if (row) return row;
    }
    const rows = document.querySelectorAll('.arco-row');
    for (const r of rows) {
      if (r.querySelector('.arco-col') || r.querySelector('.server-manage-card')) {
        return r;
      }
    }
    return rows[0] || null;
  }

  // 现代控制面板 HUD 构建与自愈
  function ensureSortBar() {
    if (!isMarketplaceRoute()) return null;
    const anchorHost = getSortAnchor();
    if (!anchorHost || !anchorHost.parentNode) return null;

    let hud = document.querySelector('.xrv-hud');
    if (!hud) {
      const zh = isZh();
      hud = document.createElement('div');
      hud.className = 'xrv-hud';
      hud.innerHTML = `
        <div class="xrv-hud-header">
          <div class="xrv-hud-brand">
            <span class="xrv-hud-logo">⚡</span>
            <span class="xrv-hud-title">${zh ? 'XRV 交易所助手' : 'XRV Market Assistant'}</span>
            <span class="xrv-hud-ver">v0.4.0</span>
          </div>
          <div class="xrv-hud-stats" id="xrv-stats-container">
            ${zh ? '共' : 'Total'} <b id="xrv-stat-total">0</b> ${zh ? '台' : ''} (<span class="xrv-text-green">${zh ? '正常' : 'Normal'} <b id="xrv-stat-normal">0</b></span> / <span class="xrv-text-red">${zh ? '异常' : 'Blocked'} <b id="xrv-stat-blocked">0</b></span>) · <span class="xrv-text-gold">${zh ? '折价捡漏' : 'Deals'} <b id="xrv-stat-discount">0</b> ${zh ? '台' : ''}</span>
          </div>
        </div>
        <div class="xrv-hud-body">
          <div class="xrv-hud-section">
            <span class="xrv-section-label">${zh ? '排序:' : 'Sort:'}</span>
            <div class="xrv-sort-group">
              ${Object.keys(SORT_MODES).map((k) => {
                const active = k === currentSort ? ' data-active="1"' : '';
                return `<button type="button" class="xrv-sort-btn" data-mode="${k}"${active}>${zh ? SORT_MODES[k].zh : SORT_MODES[k].en}</button>`;
              }).join('')}
            </div>
          </div>
          <div class="xrv-hud-divider"></div>
          <div class="xrv-hud-section">
            <span class="xrv-section-label">${zh ? '周期:' : 'Cycle:'}</span>
            <div class="xrv-cycle-group">
              <button type="button" class="xrv-cycle-btn${filterState.cycle === 'all' ? ' active' : ''}" data-cycle="all">${zh ? '全部' : 'All'}</button>
              <button type="button" class="xrv-cycle-btn${filterState.cycle === 'month' ? ' active' : ''}" data-cycle="month">${zh ? '月付' : 'Monthly'}</button>
              <button type="button" class="xrv-cycle-btn${filterState.cycle === 'year' ? ' active' : ''}" data-cycle="year">${zh ? '年付' : 'Yearly'}</button>
            </div>
          </div>
          <div class="xrv-hud-divider"></div>
          <div class="xrv-hud-section">
            <span class="xrv-section-label">${zh ? '筛选:' : 'Filter:'}</span>
            <label class="xrv-filter-checkbox" title="${zh ? '隐藏被墙、被锁等 IP 异常机器' : 'Hide blocked / locked IP listings'}">
              <input type="checkbox" id="xrv-filter-hide-blocked"${filterState.hideBlocked ? ' checked' : ''}>
              <span>${zh ? '隐藏被墙 IP' : 'Hide Blocked IP'}</span>
            </label>
            <label class="xrv-filter-checkbox" title="${zh ? '只显示售价低于剩余价值的倒贴/折价机器' : 'Only show listings priced below remaining value'}">
              <input type="checkbox" id="xrv-filter-only-discount"${filterState.onlyDiscount ? ' checked' : ''}>
              <span>${zh ? '只看折价(倒贴)' : 'Only Discounts'}</span>
            </label>
          </div>
        </div>
      `;

      // 绑定排序与周期分类点击事件
      hud.addEventListener('click', (e) => {
        const sortBtn = e.target.closest('.xrv-sort-btn');
        if (sortBtn) {
          currentSort = sortBtn.dataset.mode;
          hud.querySelectorAll('.xrv-sort-btn').forEach((b) => { b.dataset.active = b === sortBtn ? '1' : ''; });
          applySortAndFilters();
          return;
        }

        const cycleBtn = e.target.closest('.xrv-cycle-btn');
        if (cycleBtn) {
          const chosen = cycleBtn.dataset.cycle;
          if (!chosen || filterState.cycle === chosen) return;
          filterState.cycle = chosen;
          hud.querySelectorAll('.xrv-cycle-btn').forEach((b) => {
            if (b.dataset.cycle === chosen) b.classList.add('active');
            else b.classList.remove('active');
          });
          applySortAndFilters();
          return;
        }
      });

      // 绑定筛选开关事件
      const hideBlockedInput = hud.querySelector('#xrv-filter-hide-blocked');
      if (hideBlockedInput) {
        hideBlockedInput.addEventListener('change', (e) => {
          filterState.hideBlocked = e.target.checked;
          applySortAndFilters();
        });
      }

      const onlyDiscountInput = hud.querySelector('#xrv-filter-only-discount');
      if (onlyDiscountInput) {
        onlyDiscountInput.addEventListener('change', (e) => {
          filterState.onlyDiscount = e.target.checked;
          applySortAndFilters();
        });
      }
    }

    // 自愈校验：确保 hud 是 anchorHost 的正前方兄弟节点，绝不落入列表网格内部
    if (hud.parentNode !== anchorHost.parentNode || anchorHost.previousElementSibling !== hud) {
      anchorHost.parentNode.insertBefore(hud, anchorHost);
    }
    return hud;
  }

  // ─── 生命周期与 SPA 监听引擎 ───────────────────────────────
  const lifecycle = {
    active: false,
    observer: null,
    scanTimer: null,
    retryTimer: null,
    sortScheduled: false,
  };

  function scheduleSort() {
    if (lifecycle.sortScheduled) return;
    lifecycle.sortScheduled = true;
    requestAnimationFrame(() => {
      lifecycle.sortScheduled = false;
      if (!lifecycle.active || !isMarketplaceRoute()) return;
      applySortAndFilters();
    });
  }

  function isOurNode(node) {
    if (!node) return false;
    const el = node instanceof Element ? node : node.parentElement;
    return el ? !!el.closest('.xrv-hud, .xrv-row, .xrv-traffic, .xrv-ip-ok, .xrv-ip-ban') : false;
  }

  function isOurMutation(m) {
    if (isOurNode(m.target)) return true;
    if (m.type === 'childList') {
      const added = [...m.addedNodes];
      const removed = [...m.removedNodes];
      if (added.length > 0 || removed.length > 0) {
        return [...added, ...removed].every((n) => isOurNode(n));
      }
    }
    return false;
  }

  function handleMutations(mutations) {
    if (!lifecycle.active || !isMarketplaceRoute()) return;
    // 过滤由本脚本注入/更新 DOM 引起的局部变动，避免反复自循环
    let hasForeignMutation = false;
    for (const m of mutations) {
      if (!isOurMutation(m)) {
        hasForeignMutation = true;
        break;
      }
    }
    if (hasForeignMutation) {
      scheduleScan();
    }
  }

  function scheduleScan() {
    if (lifecycle.scanTimer) return;
    lifecycle.scanTimer = setTimeout(() => {
      lifecycle.scanTimer = null;
      if (!lifecycle.active || !isMarketplaceRoute()) return;
      ensureSortBar();
      const updatedCount = scanAndProcessCards();
      // 无论是否有新增，只要在市场中，均刷新一次筛选与统计
      applySortAndFilters();
    }, 50);
  }

  function scanAndProcessCards() {
    const cards = document.querySelectorAll(SITE.cardSelector);
    let changedCount = 0;
    for (const card of cards) {
      if (injectCard(card)) {
        changedCount++;
      }
    }
    return changedCount;
  }

  function enterMarketplace() {
    if (lifecycle.active) return;
    lifecycle.active = true;

    injectStyles();
    document.documentElement.classList.add(SITE.name === 'akile' ? 'xrv-akile' : 'xrv-panstar');

    if (!lifecycle.observer) {
      lifecycle.observer = new MutationObserver(handleMutations);
    }
    lifecycle.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // 初始立即尝试构建
    ensureSortBar();
    scanAndProcessCards();
    scheduleSort();

    // 渐进式动态自愈轮询（应对极端慢网络或骨架屏异步延迟）
    let retryCount = 0;
    const poll = () => {
      if (!lifecycle.active || !isMarketplaceRoute()) return;
      ensureSortBar();
      const updated = scanAndProcessCards();
      applySortAndFilters();
      retryCount++;
      if (retryCount < 8) {
        lifecycle.retryTimer = setTimeout(poll, 300 * Math.min(retryCount, 3));
      }
    };
    lifecycle.retryTimer = setTimeout(poll, 200);
  }

  function leaveMarketplace() {
    lifecycle.active = false;
    if (lifecycle.observer) {
      lifecycle.observer.disconnect();
    }
    if (lifecycle.scanTimer) {
      clearTimeout(lifecycle.scanTimer);
      lifecycle.scanTimer = null;
    }
    if (lifecycle.retryTimer) {
      clearTimeout(lifecycle.retryTimer);
      lifecycle.retryTimer = null;
    }
    const hud = document.querySelector('.xrv-hud');
    if (hud) {
      hud.remove();
    }
    document.documentElement.classList.remove('xrv-akile', 'xrv-panstar');
  }

  function handleRouteChange() {
    const isMarket = isMarketplaceRoute();
    if (isMarket) {
      if (!lifecycle.active) {
        enterMarketplace();
      } else {
        scheduleScan();
      }
    } else {
      if (lifecycle.active) {
        leaveMarketplace();
      }
    }
  }

  // ─── SPA 路由引擎（全局 History AOP 与事件总线） ───────────
  function initRouterEngine(onRouteChange) {
    if (window.__xrv_router_initialized) return;
    window.__xrv_router_initialized = true;

    const fire = () => {
      try {
        onRouteChange();
      } catch (e) {
        console.error('[xrv] Route change handler error:', e);
      }
    };

    const wrapHistory = (type) => {
      const orig = history[type];
      if (typeof orig !== 'function') return;
      history[type] = function (...args) {
        const res = orig.apply(this, args);
        try {
          window.dispatchEvent(new Event('xrv-locationchange'));
        } catch (_) {}
        return res;
      };
    };

    wrapHistory('pushState');
    wrapHistory('replaceState');

    window.addEventListener('popstate', () => {
      try { window.dispatchEvent(new Event('xrv-locationchange')); } catch (_) {}
    });
    window.addEventListener('hashchange', () => {
      try { window.dispatchEvent(new Event('xrv-locationchange')); } catch (_) {}
    });
    window.addEventListener('xrv-locationchange', fire);
  }

  // ─── 启动 ─────────────────────────────────────────────────
  function boot() {
    initRouterEngine(handleRouteChange);
    handleRouteChange();
  }

  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

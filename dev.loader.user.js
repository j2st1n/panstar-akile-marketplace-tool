// ==UserScript==
// @name         [DEV] Panstar & Akile 交易所计算器 (本地实时热加载)
// @namespace    https://github.com/j2st1n/panstar-akile-marketplace-tool
// @version      0.4.0-dev
// @description  本地开发调试加载器：页面加载时自动从本地 127.0.0.1:8788 拉取最新源码并执行，无需手动反复更新安装
// @author       j2st1n
// @match        *://panstar.ai/*
// @match        *://*.panstar.ai/*
// @match        *://akile.ai/*
// @match        *://*.akile.ai/*
// @match        *://127.0.0.1:*/*
// @match        *://localhost:*/*
// @homepageURL  https://github.com/j2st1n/panstar-akile-marketplace-tool
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    const timestamp = Date.now();
    const scriptUrl = `http://127.0.0.1:8788/panstar-akile-value.user.js?_t=${timestamp}`;

    console.log(`[XRV-Dev-Loader] 正在从本地拉取最新源码: ${scriptUrl}`);

    if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
            method: 'GET',
            url: scriptUrl,
            headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    try {
                        const scriptEl = document.createElement('script');
                        scriptEl.textContent = res.responseText;
                        (document.head || document.documentElement).appendChild(scriptEl);
                        console.log('%c[XRV-Dev-Loader] ✅ 本地最新源码热加载成功！', 'color:#10b981;font-weight:bold;');
                    } catch (e) {
                        console.error('[XRV-Dev-Loader] 源码注入报错:', e);
                    }
                } else {
                    console.error(`[XRV-Dev-Loader] 无法从本地加载源码，HTTP 状态: ${res.status}`);
                }
            },
            onerror: function(err) {
                console.error('[XRV-Dev-Loader] 连接本地 8788 调试服务失败，请确认本地服务是否启动。', err);
            }
        });
    } else {
        // 原生 fetch 降级（用于本地非油猴沙箱页面）
        fetch(scriptUrl)
            .then(res => res.text())
            .then(code => {
                const s = document.createElement('script');
                s.textContent = code;
                (document.head || document.documentElement).appendChild(s);
                console.log('%c[XRV-Dev-Loader] ✅ 本地源码原生注入成功！', 'color:#10b981;font-weight:bold;');
            })
            .catch(err => console.error('[XRV-Dev-Loader] 原生拉取失败:', err));
    }
})();

// Runs in the page's MAIN world at document_start.
// Spoofs window.matchMedia('(prefers-color-scheme: ...)') so Slack's
// "Sync with OS" appearance follows the omarchy theme instead of the OS.

(function () {
  if (window.__omarchyPCSInstalled) return;
  window.__omarchyPCSInstalled = true;

  const orig = window.matchMedia.bind(window);
  let isDark = orig("(prefers-color-scheme: dark)").matches;
  const listeners = new Set();

  function makeProxy(query) {
    const wantsDark = /dark/i.test(query);
    const wantsLight = /light/i.test(query);
    const target = orig(query);

    return new Proxy(target, {
      get(_t, prop) {
        if (prop === "matches") {
          if (wantsDark) return isDark;
          if (wantsLight) return !isDark;
          return target.matches;
        }
        if (prop === "media") return query;
        if (prop === "addEventListener") {
          return (evt, cb) => {
            if (evt === "change") listeners.add({ cb, wantsDark, wantsLight, useEvent: true });
          };
        }
        if (prop === "removeEventListener") {
          return (evt, cb) => {
            if (evt === "change")
              for (const e of listeners) if (e.cb === cb) listeners.delete(e);
          };
        }
        if (prop === "addListener") {
          // deprecated API — single callback arg
          return (cb) => listeners.add({ cb, wantsDark, wantsLight, useEvent: false });
        }
        if (prop === "removeListener") {
          return (cb) => {
            for (const e of listeners) if (e.cb === cb) listeners.delete(e);
          };
        }
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }

  window.matchMedia = function (query) {
    if (typeof query === "string" && /prefers-color-scheme/i.test(query)) {
      return makeProxy(query);
    }
    return orig(query);
  };

  // Bridge: content script asks us (main world) to invoke React's onClick
  // directly. Tries multiple strategies because Slack attaches handlers
  // inconsistently (sometimes on a wrapper div, sometimes on a hidden input,
  // sometimes on a parent radiogroup).
  function findReactProps(el) {
    for (const k of Object.keys(el)) {
      if (k.startsWith("__reactProps$")) return el[k];
    }
    return null;
  }

  function fakeEvt(target, currentTarget) {
    return {
      target,
      currentTarget: currentTarget || target,
      preventDefault() {},
      stopPropagation() {},
      nativeEvent: new MouseEvent("click", { bubbles: true }),
      bubbles: true,
      cancelable: true,
      type: "click",
    };
  }

  function tryReactHandler(el, eventType) {
    const props = findReactProps(el);
    if (!props) return false;
    const handlerName = eventType === "click" ? "onClick" : "onChange";
    if (typeof props[handlerName] !== "function") return false;
    try {
      props[handlerName](fakeEvt(el, el));
      console.log(`[omarchy bridge] called ${handlerName} on`, el.tagName, el.className.toString().slice(0, 80));
      return true;
    } catch (e) {
      console.warn("[omarchy bridge] handler threw:", e);
      return false;
    }
  }

  document.addEventListener("omarchy:react-click", (ev) => {
    const marker = ev.detail && ev.detail.marker;
    if (!marker) return;
    const el = document.querySelector(`[data-omarchy-target="${marker}"]`);
    if (!el) {
      console.warn("[omarchy bridge] target element not found");
      return;
    }

    // 0. If the target is (or wraps) a native radio/checkbox, drive it with a
    //    real click. That sets .checked AND fires the event Slack's delegated
    //    React listener responds to (target.checked correct). This beats
    //    calling onChange with a fabricated event, which leaves .checked false
    //    — Slack's current handler reads target.checked and ignores it.
    const nativeInput = el.matches('input[type="radio"], input[type="checkbox"]')
      ? el
      : el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (nativeInput) {
      console.log("[omarchy bridge] native click on radio/checkbox input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "checked"
      ).set;
      try { setter.call(nativeInput, true); } catch (_) {}
      nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
      try { nativeInput.click(); } catch (_) {}
      return;
    }

    // 1. Try element itself + walk up to the radiogroup / dialog boundary
    let cur = el;
    for (let i = 0; i < 6 && cur; i++) {
      if (tryReactHandler(cur, "click")) return;
      if (tryReactHandler(cur, "change")) return;
      if (cur.getAttribute && (cur.getAttribute("role") === "dialog")) break;
      cur = cur.parentElement;
    }

    // 2. Walk down to find a descendant with a handler (e.g. hidden <input>)
    const descendants = el.querySelectorAll("*");
    for (const d of descendants) {
      if (tryReactHandler(d, "click")) return;
      if (tryReactHandler(d, "change")) return;
    }

    // 3. If there's a real radio/checkbox input inside, set it directly
    const input = el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (input) {
      console.log("[omarchy bridge] using native radio input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
      setter.call(input, true);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return;
    }

    console.warn("[omarchy bridge] no React handler found on element or its tree");
    // Diagnostic dump of all expando keys so we know what React names to look for
    console.warn("[omarchy bridge] expando keys on target:", Object.keys(el).filter(k => k.startsWith("__")));
  });

  document.addEventListener("omarchy:set-color-scheme", (ev) => {
    const next = !!(ev.detail && ev.detail.dark);
    if (next === isDark) return;
    isDark = next;
    for (const { cb, wantsDark, wantsLight, useEvent } of listeners) {
      const matches = wantsDark ? isDark : wantsLight ? !isDark : false;
      const media = wantsDark
        ? "(prefers-color-scheme: dark)"
        : wantsLight
        ? "(prefers-color-scheme: light)"
        : "";
      try {
        if (useEvent) cb({ matches, media });
        else cb({ matches, media });
      } catch (_) {}
    }
  });
})();

// Measurement builds only (VITE_GO_PERF=1, injected into index.html by
// vite.config.ts before any module runs): a minimal React DevTools hook that,
// while window.__goPerfTrace is true, lists the components each commit
// re-rendered, with their own render time, in window.__goCommits.
(function () {
  var COMPONENT_TAGS = { 0: 1, 1: 1, 11: 1, 14: 1, 15: 1 };
  function nameOf(fiber) {
    var type = fiber.type;
    if (!type) return '?';
    if (typeof type === 'string') return type;
    return (
      type.displayName ||
      type.name ||
      (type.render && (type.render.displayName || type.render.name)) ||
      (type.type && (type.type.displayName || type.type.name)) ||
      'Anonymous'
    );
  }
  window.__goCommits = [];
  window.__goTypes = {};
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: function () {
      return 1;
    },
    checkDCE: function () {},
    onScheduleFiberRoot: function () {},
    onCommitFiberUnmount: function () {},
    onPostCommitFiberRoot: function () {},
    onCommitFiberRoot: function (_id, root) {
      if (!window.__goPerfTrace) return;
      var host = root.current;
      var start = host.actualStartTime || 0;
      var byName = new Map();
      var rendered = 0;
      var stack = [host];
      while (stack.length) {
        var fiber = stack.pop();
        if (
          COMPONENT_TAGS[fiber.tag] &&
          (fiber.actualStartTime || -1) >= start
        ) {
          rendered += 1;
          var name = nameOf(fiber);
          byName.set(
            name,
            (byName.get(name) || 0) + (fiber.selfBaseDuration || 0)
          );
          if (
            !window.__goTypes[name] &&
            fiber.type &&
            typeof fiber.type !== 'string'
          ) {
            var fn = fiber.type;
            if (typeof fn !== 'function')
              fn = fn.render || (fn.type && (fn.type.render || fn.type)) || fn;
            window.__goTypes[name] = fn;
          }
        }
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
      var top = Array.from(byName.entries())
        .sort(function (a, b) {
          return b[1] - a[1];
        })
        .slice(0, 14)
        .map(function (entry) {
          return entry[0] + ' ' + Math.round(entry[1] * 10) / 10;
        });
      window.__goCommits.push({
        t: Math.round(performance.now()),
        rendered: rendered,
        top: top,
      });
      if (window.__goCommits.length > 300) window.__goCommits.shift();
    },
  };
})();

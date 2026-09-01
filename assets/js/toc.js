// 側欄導覽：
//   1. 手機版把長長的章節清單收合成一顆「目錄」按鈕（漸進增強，沒 JS 就是全展開）
//   2. 捲動時高亮目前所在的章內段落
//   3. 點章內錨點時平滑捲動
(function () {
  // UI 字串：其他語系的頁面由 generator 內嵌 <script id="ui-strings">；沒有就用 zh-TW 預設。
  let ui = { tocToggle: '目錄', tocExpand: '展開章節與本章目錄', tocCollapse: '收合章節與本章目錄' };
  const uiEl = document.getElementById('ui-strings');
  if (uiEl) {
    try { ui = Object.assign(ui, JSON.parse(uiEl.textContent)); } catch (e) { /* 保持預設 */ }
  }
  /* ---------------------------------------------- 1. 手機版收合 --- */
  const sidebar = document.querySelector('.sidebar');
  const mq = window.matchMedia('(max-width: 960px)');

  if (sidebar) {
    const panels = sidebar.querySelectorAll('ol, .toc-in-chapter');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', ui.tocExpand);
    toggle.innerHTML = '<span class="nav-toggle-label">' + ui.tocToggle + '</span><span class="nav-toggle-caret" aria-hidden="true"></span>';

    const firstHeading = sidebar.querySelector('h2');
    if (firstHeading) sidebar.insertBefore(toggle, firstHeading);

    const setCollapsed = (collapsed) => {
      sidebar.classList.toggle('is-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? ui.tocExpand : ui.tocCollapse);
    };

    const applyMode = () => {
      sidebar.classList.toggle('is-collapsible', mq.matches);
      setCollapsed(mq.matches);
    };

    toggle.addEventListener('click', () => setCollapsed(!sidebar.classList.contains('is-collapsed')));

    // 手機上點任何導覽連結（含跳到本頁錨點）就把選單收起來
    panels.forEach((p) =>
      p.addEventListener('click', (e) => {
        if (mq.matches && e.target.closest('a')) setCollapsed(true);
      })
    );

    applyMode();
    mq.addEventListener('change', applyMode);
  }

  /* --------------------------------------- 2 & 3. 章內錨點行為 --- */
  const sections = document.querySelectorAll('section[id]');
  const links = document.querySelectorAll('.toc-in-chapter a[href^="#"]');
  if (!sections.length || !links.length) return;

  const linkMap = new Map();
  links.forEach((a) => {
    const id = a.getAttribute('href').slice(1);
    linkMap.set(id, a);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = linkMap.get(entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach((l) => l.classList.remove('active'));
          link.classList.add('active');
        }
      });
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
  );

  sections.forEach((s) => observer.observe(s));

  links.forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
    });
  });
})();

let data = null;

async function loadData() {
  try {
    const res = await fetch('/data.json');
    data = await res.json();
    render();
    return true;
  } catch (err) {
    document.getElementById('content').innerHTML = `
      <div class="empty" role="alert">
        <div class="empty-icon">⚠</div>
        <p>Failed to load data.json</p>
        <p style="font-size: 0.8rem; margin-top: 0.5rem;">Run: bun scan.ts</p>
      </div>
    `;
    return false;
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len = 200) {
  if (str.length <= len) return str;
  return str.slice(0, len) + '…';
}

// Hash routing
let currentSection = 'commands';
let currentCard = null;

function parseHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return { section: 'readme', card: null };
  const [section, ...cardParts] = hash.split('/');
  const card = cardParts.length ? decodeURIComponent(cardParts.join('/')) : null;
  return { section: section || 'readme', card };
}

function updateHash(section, card = null) {
  const hash = card ? `${section}/${encodeURIComponent(card)}` : section;
  if (window.location.hash !== `#${hash}`) {
    history.pushState(null, '', `#${hash}`);
  }
}

function navigateToHash() {
  const { section, card } = parseHash();
  const validSections = ['claude', 'readme', 'commands', 'agents', 'skills', 'marketplaces', 'plugins', 'mcp', 'scripts', 'blog'];
  const targetSection = validSections.includes(section) ? section : 'readme';

  // Update UI
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  const activeTab = document.querySelector(`.tab[data-section="${targetSection}"]`);
  activeTab?.classList.add('active');
  activeTab?.setAttribute('aria-selected', 'true');
  activeTab?.scrollIntoView({ block: 'nearest', inline: 'center' });
  document.querySelectorAll('.stat').forEach(s => s.classList.remove('active'));
  document.querySelector(`.stat[data-section="${targetSection}"]`)?.classList.add('active');

  currentSection = targetSection;
  currentCard = card;
  renderSection(targetSection);

  // Expand card if specified
  if (card) {
    setTimeout(() => {
      // Blog posts use .blog-card, everything else uses .card
      if (targetSection === 'blog') {
        const blogEl = document.querySelector(`.blog-card[data-name="${CSS.escape(card)}"]`);
        if (blogEl) {
          blogEl.classList.add('open');
          blogEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        const cardEl = document.querySelector(`.card[data-name="${CSS.escape(card)}"]`);
        if (cardEl) {
          cardEl.classList.add('expanded');
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 50);
  }
}

function toggleCard(cardEl) {
  const wasExpanded = cardEl.classList.contains('expanded');
  const cardName = cardEl.dataset.name;

  // Collapse all other cards
  document.querySelectorAll('.card.expanded').forEach(c => {
    c.classList.remove('expanded');
    c.querySelector('.card-header')?.setAttribute('aria-expanded', 'false');
  });

  if (!wasExpanded) {
    cardEl.classList.add('expanded');
    cardEl.querySelector('.card-header')?.setAttribute('aria-expanded', 'true');
    updateHash(currentSection, cardName);
  } else {
    updateHash(currentSection);
  }
}

function handleCardKeydown(e, header) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleCard(header.parentElement);
  }
}

async function copyToClipboard(text, btn) {
  await navigator.clipboard.writeText(text);
  const orig = btn.textContent;
  btn.textContent = '\u2713';
  btn.classList.add('success');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('success');
  }, 1000);
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadSkillZip(skill) {
  const zip = new JSZip();
  zip.file('SKILL.md', `---
name: ${skill.name}
description: ${skill.description}
${skill.model ? `model: ${skill.model}\n` : ''}${skill.color ? `color: ${skill.color}\n` : ''}${skill.license ? `license: ${skill.license}\n` : ''}${skill.author ? `author: ${skill.author}\n` : ''}${skill.source ? `source: ${skill.source}\n` : ''}---

${skill.content}`);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${skill.dirname}.skill`;
  a.click();
  URL.revokeObjectURL(url);
}

function getPluginUrl(pluginName, marketplaceName) {
  const mp = data.marketplaces.find(m => m.name === marketplaceName);
  if (!mp) return null;

  // Look up plugin source info from marketplace.json data
  const sourceInfo = mp.pluginSources?.find(ps => ps.name === pluginName);
  if (sourceInfo) {
    switch (sourceInfo.sourceType) {
      case 'url':
        return sourceInfo.sourceUrl;
      case 'root':
        return `https://github.com/${mp.repo}`;
      case 'path':
        return `https://github.com/${mp.repo}/tree/main/${sourceInfo.sourcePath}`;
    }
  }

  // Fallback to default path
  return `https://github.com/${mp.repo}/tree/main/plugins/${pluginName}`;
}

function render() {
  document.getElementById('scanTime').textContent = formatDate(data.scannedAt);
  document.getElementById('count-commands').textContent = data.commands.length;
  document.getElementById('count-agents').textContent = data.agents.length;
  document.getElementById('count-skills').textContent = data.skills.filter(s => s.status !== 'wip').length;
  document.getElementById('count-scripts').textContent = data.scripts.length;
  document.getElementById('count-marketplaces').textContent = data.marketplaces.length;
  document.getElementById('count-plugins').textContent = data.installedPlugins.length;
  document.getElementById('count-mcp').textContent = data.mcpServers.length;
}

const CARD_SECTIONS = new Set(['commands', 'agents', 'skills', 'scripts', 'marketplaces', 'plugins', 'mcp']);

function renderSection(section) {
  const content = document.getElementById('content');
  let html = '';

  switch (section) {
    case 'claude':
      html = renderClaude();
      break;
    case 'readme':
      html = renderReadme();
      break;
    case 'commands':
      html = renderCommands();
      break;
    case 'agents':
      html = renderAgents();
      break;
    case 'skills':
      html = renderSkills();
      break;
    case 'marketplaces':
      html = renderMarketplaces();
      break;
    case 'plugins':
      html = renderPlugins();
      break;
    case 'mcp':
      html = renderMcp();
      break;
    case 'scripts':
      html = renderScripts();
      break;
    case 'blog':
      html = renderBlog();
      break;
  }

  if (CARD_SECTIONS.has(section)) {
    html = `<input class="filter-input" type="search" name="filter" autocomplete="off" placeholder="filter…" aria-label="Filter cards">` + html;
  }

  const intro = data.sectionIntros?.[section];
  if (intro) {
    html = `<p class="section-intro">${escapeHtml(intro)}</p>` + html;
  }

  content.innerHTML = `<section id="${section}" class="section active" role="tabpanel" aria-labelledby="tab-${section}">${html}</section>`;

  // Stagger card animations (capped at 500ms total)
  const cards = content.querySelectorAll('.card, .blog-card');
  const maxDelay = 0.5; // 500ms total
  const delayPerCard = cards.length > 0 ? Math.min(0.05, maxDelay / cards.length) : 0.05;
  cards.forEach((card, i) => {
    card.style.animationDelay = `${i * delayPerCard}s`;
  });

  // Wire up filter input
  const filter = content.querySelector('.filter-input');
  if (filter) {
    filter.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      content.querySelectorAll('.card').forEach(c => {
        const name = c.querySelector('.card-name')?.textContent.toLowerCase() || '';
        const desc = c.querySelector('.card-desc')?.textContent.toLowerCase() || '';
        c.style.display = (!q || name.includes(q) || desc.includes(q)) ? '' : 'none';
      });
    });
  }
}

function renderClaude() {
  const content = data.claudeMd || '';
  if (!content) {
    return '<div class="empty"><div class="empty-icon">📋</div><p>No CLAUDE.md found</p><p style="color:var(--text-muted)">Create ~/.claude/CLAUDE.md to add personal instructions</p></div>';
  }
  return `<div class="readme-container"><div class="readme-content">${renderMarkdown(content)}</div></div>`;
}

function renderReadme() {
  const readmeContent = data.readme || '';
  if (!readmeContent) {
    return `<div class="readme-container">
      <div class="readme-content">
        <h2>~/.claude Configuration</h2>
        <p>This is Michael's Claude Code configuration directory.</p>
        <p>Use the tabs above to explore:</p>
        <ul>
          <li><strong>/commands</strong> - Slash commands available in sessions</li>
          <li><strong>/agents</strong> - Background agent definitions</li>
          <li><strong>/skills</strong> - Specialized capabilities and workflows</li>
          <li><strong>/marketplaces</strong> - Plugin sources</li>
          <li><strong>/plugins</strong> - Installed plugins</li>
          <li><strong>/mcp</strong> - MCP server configurations</li>
          <li><strong>$scripts</strong> - Custom utility scripts</li>
        </ul>
        <p><a href="https://github.com/anthropics/claude-code/blob/main/README.md" target="_blank" rel="noopener">Claude Code Documentation ↗</a></p>
      </div>
    </div>`;
  }
  return `<div class="readme-container"><div class="readme-content">${renderMarkdown(readmeContent)}</div></div>`;
}

marked.setOptions({ gfm: true, breaks: false });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener');
  }
});

function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md));
}

function renderCommands() {
  if (!data.commands.length) {
    return '<div class="empty"><div class="empty-icon">/</div><p>No commands found</p></div>';
  }

  return `<div class="cards">${data.commands.map((cmd, i) => `
    <article class="card" data-idx="${i}" data-name="${escapeHtml(cmd.name)}">
      <div class="card-header" tabindex="0" role="button" aria-expanded="false" onclick="toggleCard(this.parentElement)" onkeydown="handleCardKeydown(event, this)">
        <span class="card-icon">/</span>
        <div class="card-info">
          <div class="card-name">${escapeHtml(cmd.name)}</div>
          <div class="card-desc">${escapeHtml(cmd.description)}</div>
        </div>
        <button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(data.commands[${i}].content, this)" aria-label="Copy content" title="Copy content">\u29C9</button>
        <span class="card-toggle" aria-hidden="true">▶</span>
      </div>
      <div class="card-body">
        <div class="card-content">${escapeHtml(truncate(cmd.content, 1000))}</div>
      </div>
    </article>
  `).join('')}</div>`;
}

function renderAgents() {
  if (!data.agents.length) {
    return '<div class="empty"><div class="empty-icon">◎</div><p>No agents found</p></div>';
  }

  return `<div class="cards">${data.agents.map((agent, i) => `
    <article class="card" data-idx="${i}" data-name="${escapeHtml(agent.name)}">
      <div class="card-header" tabindex="0" role="button" aria-expanded="false" onclick="toggleCard(this.parentElement)" onkeydown="handleCardKeydown(event, this)">
        <span class="card-icon">◎</span>
        <div class="card-info">
          <div class="card-name">${escapeHtml(agent.name)}</div>
          <div class="card-desc">${escapeHtml(agent.description)}</div>
          <div class="card-meta">
            ${agent.model ? `<span class="tag model">${agent.model}</span>` : ''}
            ${agent.color ? `<span class="tag color" style="color: ${agent.color}">${agent.color}</span>` : ''}
            ${(agent.tools || []).slice(0, 4).map(t => `<span class="tag">${t}</span>`).join('')}
            ${(agent.tools || []).length > 4 ? `<span class="tag">+${agent.tools.length - 4}</span>` : ''}
          </div>
        </div>
        <button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(data.agents[${i}].content, this)" aria-label="Copy content" title="Copy content">\u29C9</button>
        <span class="card-toggle" aria-hidden="true">▶</span>
      </div>
      <div class="card-body">
        <div class="card-content">${escapeHtml(truncate(agent.content, 1000))}</div>
      </div>
    </article>
  `).join('')}</div>`;
}

function renderSkills() {
  const skills = data.skills.filter(s => s.status !== 'wip');
  if (!skills.length) {
    return '<div class="empty"><div class="empty-icon">★</div><p>No skills found</p></div>';
  }

  return `<div class="cards">${skills.map((skill) => {
    const origIdx = data.skills.findIndex(s => s.dirname === skill.dirname);
    return `
    <article class="card" data-idx="${origIdx}" data-name="${escapeHtml(skill.name)}">
      <div class="card-header" tabindex="0" role="button" aria-expanded="false" onclick="toggleCard(this.parentElement)" onkeydown="handleCardKeydown(event, this)">
        <span class="card-icon">${skill.status === 'experimental' ? '\u{1F9EA}' : '\u2605'}</span>
        <div class="card-info">
          <div class="card-name">${escapeHtml(skill.name)}</div>
          <div class="card-desc">${escapeHtml(skill.description)}</div>
          <div class="card-meta">
            ${skill.status === 'experimental' ? '<span class="tag experimental">experimental</span>' : ''}
            ${skill.model ? `<span class="tag model">${skill.model}</span>` : ''}
            ${skill.isExternal ? '<span class="tag external">external</span>' : ''}
            ${skill.hasScripts ? '<span class="tag has-scripts">scripts</span>' : ''}
            ${skill.hasReferences ? '<span class="tag has-refs">refs</span>' : ''}
            ${skill.hasAssets ? '<span class="tag has-assets">assets</span>' : ''}
          </div>
          ${skill.isExternal ? `
          <div class="attribution">
            ${skill.author ? `<span>by ${escapeHtml(skill.author)}</span>` : ''}
            ${skill.source ? `<a href="${escapeHtml(skill.source)}" target="_blank" rel="noopener">\u2197 source</a>` : ''}
            ${skill.license ? `<span class="tag">${escapeHtml(skill.license)}</span>` : ''}
          </div>` : ''}
        </div>
${skill.isExternal && skill.source
          ? `<a class="action-btn" href="${escapeHtml(skill.source)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" aria-label="View source" title="View source">\u2197</a>`
          : `<button class="action-btn" onclick="event.stopPropagation(); downloadSkillZip(data.skills[${origIdx}])" aria-label="Download skill" title="Download .skill">\u2B73</button>`}
        <span class="card-toggle" aria-hidden="true">▶</span>
      </div>
      <div class="card-body">
        <div class="card-content">${escapeHtml(truncate(skill.content, 1000))}</div>
      </div>
    </article>
  `}).join('')}</div>`;
}

function renderScripts() {
  if (!data.scripts.length) {
    return '<div class="empty"><div class="empty-icon">$</div><p>No scripts found</p></div>';
  }

  return `<div class="cards">${data.scripts.map((script, i) => `
    <article class="card script-card" data-idx="${i}" data-name="${escapeHtml(script.name)}">
      <div class="card-header" tabindex="0" role="button" aria-expanded="false" onclick="toggleCard(this.parentElement)" onkeydown="handleCardKeydown(event, this)">
        <span class="card-icon">$</span>
        <div class="card-info">
          <div class="card-name">${escapeHtml(script.name)}<span class="custom-badge">(custom)</span></div>
          <div class="card-desc">${escapeHtml(script.description)}</div>
          <div class="card-meta">
            <span class="tag type-${script.type}">${script.type}</span>
          </div>
        </div>
        <div class="action-btns">
          <button class="action-btn" onclick="event.stopPropagation(); copyToClipboard(data.scripts[${i}].content, this)" aria-label="Copy script" title="Copy">\u29C9</button>
          <button class="action-btn" onclick="event.stopPropagation(); downloadFile(data.scripts[${i}].filename, data.scripts[${i}].content)" aria-label="Download script" title="Download">\u2B73</button>
        </div>
        <span class="card-toggle" aria-hidden="true">▶</span>
      </div>
      <div class="card-body">
        <div class="card-content">${escapeHtml(truncate(script.content, 2000))}</div>
      </div>
    </article>
  `).join('')}</div>`;
}

function renderMarketplaces() {
  if (!data.marketplaces.length) {
    return '<div class="empty"><div class="empty-icon">⬡</div><p>No marketplaces configured</p></div>';
  }

  return `<div class="cards">${data.marketplaces.map(mp => `
    <article class="card">
      <div class="card-header">
        <span class="card-icon">⬡</span>
        <div class="card-info">
          <div class="card-name">${escapeHtml(mp.name)}</div>
          <a href="https://github.com/${escapeHtml(mp.repo)}" target="_blank" rel="noopener" class="marketplace-repo">${escapeHtml(mp.repo)}</a>
          <div class="card-meta">
            <span class="tag">updated ${formatDate(mp.lastUpdated)}</span>
          </div>
        </div>
      </div>
    </article>
  `).join('')}</div>`;
}

function renderPlugins() {
  if (!data.installedPlugins.length) {
    return '<div class="empty"><div class="empty-icon">◈</div><p>No plugins installed</p></div>';
  }

  return `<div class="cards">${data.installedPlugins.map(plugin => {
    const url = getPluginUrl(plugin.name, plugin.marketplace);
    const nameHtml = url
      ? `<a href="${url}" target="_blank" rel="noopener" class="plugin-name-link">${escapeHtml(plugin.name)}</a>`
      : escapeHtml(plugin.name);
    return `
    <article class="card">
      <div class="card-header">
        <span class="card-icon">◈</span>
        <div class="card-info">
          <div class="card-name">${nameHtml}</div>
          <div class="card-desc">from ${escapeHtml(plugin.marketplace)}</div>
          <div class="card-meta">
            <span class="tag scope-${plugin.scope}">${plugin.scope}</span>
            <span class="tag">v${escapeHtml(plugin.version)}</span>
          </div>
        </div>
      </div>
    </article>
  `}).join('')}</div>`;
}

function renderMcp() {
  if (!data.mcpServers.length) {
    return '<div class="empty"><div class="empty-icon">⚡</div><p>No MCP servers configured</p></div>';
  }

  return `<div class="cards">${data.mcpServers.map((srv, i) => `
    <article class="card" data-idx="${i}" data-name="${escapeHtml(srv.name)}">
      <div class="card-header" tabindex="0" role="button" aria-expanded="false" onclick="toggleCard(this.parentElement)" onkeydown="handleCardKeydown(event, this)">
        <span class="card-icon">⚡</span>
        <div class="card-info">
          <div class="card-name">
            ${escapeHtml(srv.name)}
            ${srv.url ? `<a href="${escapeHtml(srv.url)}" target="_blank" rel="noopener" class="source-link" onclick="event.stopPropagation()">\u2197</a>` : ''}
          </div>
          <div class="mcp-command">${escapeHtml(srv.command)} ${srv.args.map(a => escapeHtml(a)).join(' ')}</div>
          <div class="card-meta">
            <span class="tag">${srv.type}</span>
            ${srv.envKeys.map(k => `<span class="tag">${escapeHtml(k)}</span>`).join('')}
          </div>
        </div>
        <button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(JSON.stringify(data.mcpServers[${i}].rawConfig, null, 2), this)" aria-label="Copy config" title="Copy config">\u29C9</button>
        <span class="card-toggle" aria-hidden="true">▶</span>
      </div>
      <div class="card-body">
        <div class="card-content">${escapeHtml(JSON.stringify(srv.rawConfig, null, 2))}</div>
      </div>
    </article>
  `).join('')}</div>`;
}

function renderBlog() {
  const posts = data.blog || [];
  if (!posts.length) {
    return '<div class="empty"><div class="empty-icon">&#9998;</div><p>No blog posts yet</p><p style="color:var(--text-muted)">Add .md files to ~/.claude/blog/</p></div>';
  }

  return `<div class="blog-list">${posts.map((post, i) => {
    // Replace local image paths with inlined base64
    let content = post.content;
    for (const [path, dataUri] of Object.entries(post.images || {})) {
      content = content.split(path).join(dataUri);
    }
    const rendered = renderMarkdown(content);
    const dateStr = new Date(post.date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    return `
    <article class="blog-card" data-idx="${i}" data-name="${escapeHtml(post.name)}">
      <div class="blog-card-header" onclick="toggleBlogPost(this.parentElement)">
        <div class="blog-card-meta">
          <time>${dateStr}</time>
          ${post.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        </div>
        <h2 class="blog-card-title">${escapeHtml(post.title)}</h2>
        ${post.description ? `<p class="blog-card-desc">${escapeHtml(post.description)}</p>` : ''}
      </div>
      <div class="blog-card-body">
        <div class="blog-content">${rendered}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function toggleBlogPost(article) {
  const wasOpen = article.classList.contains('open');
  // Close all
  document.querySelectorAll('.blog-card.open').forEach(c => c.classList.remove('open'));
  if (!wasOpen) {
    article.classList.add('open');
    updateHash('blog', article.dataset.name);
    setTimeout(() => article.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  } else {
    updateHash('blog');
  }
}

// Tab navigation
document.getElementById('tabs').addEventListener('click', (e) => {
  if (e.target.classList.contains('tab')) {
    posthog.capture('tab_switched', { tab: e.target.dataset.section });
    updateHash(e.target.dataset.section);
    navigateToHash();
  }
});

// Stat click navigation
document.getElementById('stats').addEventListener('click', (e) => {
  const stat = e.target.closest('.stat');
  if (stat) {
    posthog.capture('tab_switched', { tab: stat.dataset.section, via: 'stat' });
    updateHash(stat.dataset.section);
    navigateToHash();
  }
});

// Stat keyboard navigation
document.getElementById('stats').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const stat = e.target.closest('.stat');
    if (stat) {
      e.preventDefault();
      updateHash(stat.dataset.section);
      navigateToHash();
    }
  }
});

// '/' hotkey focuses the filter input
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    const f = document.querySelector('.filter-input');
    if (f) { e.preventDefault(); f.focus(); }
  }
});

// Handle browser back/forward
window.addEventListener('popstate', navigateToHash);

// Load data on init, then navigate to hash
loadData().then((loaded) => {
  if (loaded) navigateToHash();
});

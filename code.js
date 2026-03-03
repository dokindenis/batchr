// ─── Constants ────────────────────────────────────────────────────────────────
const SIZE_SETS = [
  { sizes: [20, 25, 30, 35], label: 'small' },
  { sizes: [24, 30, 36, 42], label: 'small' },
  { sizes: [28, 35, 42, 49], label: 'big' },
  { sizes: [40, 50, 60, 70], label: 'huge' },
];

const SCALES = ['1x', '1.25x', '1.5x', '1.75x'];
const GAP = 24;
const STATUS_SEARCH_MAX_DIST = 300;
const ROW_Y_MATCH_MULTIPLIER = 1.5;
const VALIDATE_DEBOUNCE_MS = 120;

// ─── Caches ───────────────────────────────────────────────────────────────────
let cachedSelectionSignature = '';
let cachedSelectionAnalysis = null;
let lastUiMessageKey = '';
let validateTimer = null;
let validateWorkTimer = null;
let validateRunId = 0;
let cachedInstanceSnapshot = null;
let cachedInstanceSnapshotPageId = '';
const statusNameTextCache = new Map();

function buildSelectionSignature(selection) {
  return selection.map(node => node.id).sort().join('|');
}

function postUiMessageDedup(payload) {
  const key = JSON.stringify(payload);
  if (key === lastUiMessageKey) return;
  lastUiMessageKey = key;
  figma.ui.postMessage(payload);
}

function resetSelectionCache(selection) {
  cachedSelectionSignature = buildSelectionSignature(selection);
  cachedSelectionAnalysis = null;
}

function clearDerivedCaches() {
  if (validateWorkTimer) {
    clearTimeout(validateWorkTimer);
    validateWorkTimer = null;
  }
  validateRunId += 1;
  statusNameTextCache.clear();
  cachedSelectionSignature = '';
  cachedSelectionAnalysis = null;
  cachedInstanceSnapshot = null;
  cachedInstanceSnapshotPageId = '';
}

// ─── Geometry / search helpers ────────────────────────────────────────────────
function getAbsBB(node) {
  return node.absoluteBoundingBox || null;
}

function getNodeGeometry(node) {
  const bb = getAbsBB(node);
  const x = bb ? bb.x : node.x;
  const y = bb ? bb.y : node.y;
  const width = bb ? bb.width : node.width;
  const height = bb ? bb.height : node.height;
  return {
    node,
    x,
    y,
    width,
    height,
    right: x + width,
    centerY: y + height / 2,
  };
}

function lowerBoundByCenterY(items, target) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (items[mid].centerY < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function getRowMetrics(rowIcons) {
  const groupLeft = Math.min(...rowIcons.map(icon => icon.x));
  const groupTop = Math.min(...rowIcons.map(icon => icon.y));
  const groupBottom = Math.max(...rowIcons.map(icon => icon.y + icon.height));
  const groupCenterY = (groupTop + groupBottom) / 2;
  const rowHeight = Math.max(1, groupBottom - groupTop);
  const yTolerance = rowHeight * ROW_Y_MATCH_MULTIPLIER;

  return {
    groupLeft,
    groupCenterY,
    minCenterY: groupCenterY - yTolerance,
    maxCenterY: groupCenterY + yTolerance,
  };
}

function getInstanceSnapshot() {
  const pageId = figma.currentPage.id;
  if (cachedInstanceSnapshot && cachedInstanceSnapshotPageId === pageId) {
    return cachedInstanceSnapshot;
  }

  const instances = figma.currentPage.findAllWithCriteria({ types: ['INSTANCE'] });
  const snapshot = [];

  for (const node of instances) {
    const bb = getAbsBB(node);
    if (!bb) continue;
    snapshot.push({
      node,
      right: bb.x + bb.width,
      centerY: bb.y + bb.height / 2,
    });
  }

  snapshot.sort((a, b) => a.centerY - b.centerY);
  cachedInstanceSnapshot = snapshot;
  cachedInstanceSnapshotPageId = pageId;
  return snapshot;
}

function findStatusForRow(rowMetrics, candidates) {
  const { groupLeft, minCenterY, maxCenterY } = rowMetrics;

  let best = null;
  let bestDist = Infinity;
  const startIdx = lowerBoundByCenterY(candidates, minCenterY);

  for (let i = startIdx; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.centerY > maxCenterY) break;

    const dist = groupLeft - candidate.right;
    if (dist >= 0 && dist <= STATUS_SEARCH_MAX_DIST && dist < bestDist) {
      best = candidate.node;
      bestDist = dist;
    }
  }

  return best;
}

// Группируем иконки по рядам: сортируем по Y, затем сортируем ряд по X.
function groupIntoRows(iconGeometries) {
  const sorted = [...iconGeometries].sort((a, b) => a.y - b.y);
  const rows = [];

  let start = 0;
  while (start < sorted.length) {
    const first = sorted[start];
    const rowHeight = first.height || 100;
    const maxY = first.y + rowHeight * ROW_Y_MATCH_MULTIPLIER;

    let end = start + 1;
    while (end < sorted.length && sorted[end].y <= maxY) end++;

    const row = sorted.slice(start, end).sort((a, b) => a.x - b.x);
    rows.push(row);
    start = end;
  }

  return rows;
}

function getTextFromStatus(statusNode) {
  if (statusNameTextCache.has(statusNode.id)) {
    return statusNameTextCache.get(statusNode.id);
  }

  const stack = [statusNode];
  let result = null;
  while (stack.length) {
    const node = stack.pop();
    if (node.type === 'TEXT' && node.name === 'name') {
      result = node.characters;
      break;
    }
    if ('children' in node) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }

  statusNameTextCache.set(statusNode.id, result);
  return result;
}

// ─── Selection analysis ───────────────────────────────────────────────────────
function matchSizeSet(widths) {
  const sorted = [...widths].sort((a, b) => a - b);
  for (const set of SIZE_SETS) {
    if (set.sizes.every((s, i) => Math.abs(s - sorted[i]) < 1)) {
      return set.label;
    }
  }
  return null;
}

function analyzeSelection(selection) {
  const allComponents = selection.every(node => node.type === 'COMPONENT');
  if (!allComponents) {
    return {
      ok: false,
      message: 'Все выбранные элементы должны быть мейн-компонентами.',
    };
  }

  const iconGeometries = selection.map(getNodeGeometry);
  const rows = groupIntoRows(iconGeometries);

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== 4) {
      return {
        ok: false,
        message: `Ряд ${i + 1} содержит ${rows[i].length} иконок, ожидается 4.\nПроверьте выделение.`,
      };
    }
  }

  const widths = rows[0].map(icon => Math.round(icon.node.width));
  const sizeLabel = matchSizeSet(widths);
  if (!sizeLabel) {
    return {
      ok: false,
      message: 'Размеры [' + widths.join(', ') + 'px] не совпадают ни с одним набором.\n\nДопустимые наборы:\n• Small: 20/25/30/35 или 24/30/36/42\n• Big: 28/35/42/49\n• Huge: 40/50/60/70',
    };
  }

  const rowMetricsList = rows.map(getRowMetrics);
  const candidates = getInstanceSnapshot();
  const rowInfos = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const statusNode = findStatusForRow(rowMetricsList[i], candidates);
    if (!statusNode) {
      return {
        ok: false,
        message: `Ряд ${i + 1}: не найден инстанс .status в радиусе 300px левее.`,
      };
    }

    const iconName = getTextFromStatus(statusNode);
    if (!iconName) {
      return {
        ok: false,
        message: `Ряд ${i + 1}: в компоненте .status нет текстового слоя «name».`,
      };
    }

    rowInfos.push({
      row: row.map(icon => icon.node),
      iconName: iconName.trim(),
    });
  }

  return {
    ok: true,
    widths,
    sizeLabel,
    rowInfos,
    rowCount: rows.length,
  };
}

// ─── Plugin entry ─────────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 380, height: 300, title: 'Batch Icon Components' });

function validate() {
  const runId = ++validateRunId;
  if (validateWorkTimer) {
    clearTimeout(validateWorkTimer);
    validateWorkTimer = null;
  }

  const selection = figma.currentPage.selection;

  if (selection.length === 0 || selection.length % 4 !== 0) {
    resetSelectionCache(selection);
    postUiMessageDedup({
      type: 'awaiting',
      message: selection.length === 0
        ? 'Выберите компоненты иконок\n(кратно 4)'
        : `Выбрано ${selection.length} — число должно быть кратно 4`,
    });
    return;
  }

  if (!selection.every(node => node.type === 'COMPONENT')) {
    resetSelectionCache(selection);
    postUiMessageDedup({
      type: 'error',
      message: 'Все выбранные элементы должны быть мейн-компонентами.',
    });
    return;
  }

  const signature = buildSelectionSignature(selection);
  if (signature === cachedSelectionSignature && cachedSelectionAnalysis) {
    const analysis = cachedSelectionAnalysis;
    if (!analysis.ok) {
      postUiMessageDedup({
        type: 'error',
        message: analysis.message,
      });
      return;
    }

    postUiMessageDedup({
      type: 'ready',
      sizeLabel: analysis.sizeLabel,
      rowCount: analysis.rowCount,
      rowPreviews: analysis.rowInfos.map(item => item.iconName),
      widths: analysis.widths,
    });
    return;
  }

  postUiMessageDedup({
    type: 'loading',
    message: `Считаю ${selection.length} компонентов и ищу .status...`,
  });

  validateWorkTimer = setTimeout(() => {
    validateWorkTimer = null;
    if (runId !== validateRunId) return;

    const currentSelection = figma.currentPage.selection;
    if (buildSelectionSignature(currentSelection) !== signature) return;

    const analysis = analyzeSelection(currentSelection);
    cachedSelectionSignature = signature;
    cachedSelectionAnalysis = analysis;
    if (runId !== validateRunId) return;

    if (!analysis.ok) {
      postUiMessageDedup({
        type: 'error',
        message: analysis.message,
      });
      return;
    }

    postUiMessageDedup({
      type: 'ready',
      sizeLabel: analysis.sizeLabel,
      rowCount: analysis.rowCount,
      rowPreviews: analysis.rowInfos.map(item => item.iconName),
      widths: analysis.widths,
    });
  }, 0);
}

function scheduleValidate() {
  if (validateTimer) clearTimeout(validateTimer);
  validateTimer = setTimeout(() => {
    validateTimer = null;
    validate();
  }, VALIDATE_DEBOUNCE_MS);
}

figma.on('selectionchange', scheduleValidate);
figma.on('documentchange', () => {
  clearDerivedCaches();
});
figma.on('currentpagechange', () => {
  clearDerivedCaches();
  scheduleValidate();
});
validate();

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'apply') {
    const { prefix, role, create2xSvg } = msg;
    const selection = figma.currentPage.selection;

    if (selection.length === 0 || selection.length % 4 !== 0) {
      figma.notify('Выберите компоненты кратно 4', { error: true });
      return;
    }

    const signature = buildSelectionSignature(selection);
    let analysis = null;
    if (signature === cachedSelectionSignature && cachedSelectionAnalysis) {
      analysis = cachedSelectionAnalysis;
    } else {
      analysis = analyzeSelection(selection);
      cachedSelectionSignature = signature;
      cachedSelectionAnalysis = analysis;
    }
    if (!analysis.ok) {
      figma.notify(analysis.message, { error: true });
      return;
    }

    for (const rowInfo of analysis.rowInfos) {
      const row = rowInfo.row;
      const name = rowInfo.iconName;

      // Строим имена 1x…1.75x
      const names = SCALES.map(scale => {
        let n = '';
        if (prefix) n += '_';
        n += role + '/';
        n += scale + '/';
        if (analysis.sizeLabel !== 'small') n += analysis.sizeLabel + '/';
        n += 'btn-' + name;
        return n;
      });

      for (let i = 0; i < 4; i++) {
        row[i].name = names[i];
      }

      if (create2xSvg) {
        const icon1x = row[0];
        const icon175 = row[3];
        const bb175 = getAbsBB(icon175);
        const anchorX = bb175 ? bb175.x + bb175.width : icon175.x + icon175.width;
        const anchorY = bb175 ? bb175.y : icon175.y;

        // ── 2x ──
        const inst2x = icon1x.createInstance();
        figma.currentPage.appendChild(inst2x);
        inst2x.x = anchorX + GAP;
        inst2x.y = anchorY;
        inst2x.rescale(2);

        const comp2x = figma.createComponent();
        comp2x.resizeWithoutConstraints(inst2x.width, inst2x.height);
        comp2x.x = inst2x.x;
        comp2x.y = inst2x.y;
        figma.currentPage.appendChild(comp2x);
        comp2x.appendChild(inst2x);
        inst2x.x = 0;
        inst2x.y = 0;
        comp2x.name = names[0].replace('/1x/', '/2x/');

        // ── SVG ──
        const instSvg = icon1x.createInstance();
        figma.currentPage.appendChild(instSvg);
        const bb2x = comp2x.absoluteBoundingBox || { x: comp2x.x, width: comp2x.width };
        instSvg.x = bb2x.x + bb2x.width + GAP;
        instSvg.y = anchorY;

        const detached = instSvg.detachInstance();
        const compSvg = figma.createComponentFromNode(detached);
        const btnIndex = names[0].lastIndexOf('btn-');
        compSvg.name = btnIndex !== -1 ? names[0].slice(btnIndex) : 'btn-' + name;
      }
    }

    const rowsCount = analysis.rowCount;
    figma.notify('✓ Готово! ' + rowsCount + (rowsCount === 1 ? ' ряд' : rowsCount < 5 ? ' ряда' : ' рядов'));
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

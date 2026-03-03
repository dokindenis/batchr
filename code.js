// ─── Size sets ───────────────────────────────────────────────────────────────
const SIZE_SETS = [
  { sizes: [20, 25, 30, 35],  label: 'small' },
  { sizes: [24, 30, 36, 42],  label: 'small' },
  { sizes: [28, 35, 42, 49],  label: 'big'   },
  { sizes: [40, 50, 60, 70],  label: 'huge'  },
];

const SCALES = ['1x', '1.25x', '1.5x', '1.75x'];
const GAP = 24;

function matchSizeSet(widths) {
  const sorted = [...widths].sort((a, b) => a - b);
  for (const set of SIZE_SETS) {
    if (set.sizes.every((s, i) => Math.abs(s - sorted[i]) < 1)) {
      return set.label;
    }
  }
  return null;
}

function getTextFromStatus(statusNode) {
  function findNameLayer(node) {
    if (node.type === 'TEXT' && node.name === 'name') return node;
    if ('children' in node) {
      for (const child of node.children) {
        const found = findNameLayer(child);
        if (found) return found;
      }
    }
    return null;
  }
  const layer = findNameLayer(statusNode);
  return layer ? layer.characters : null;
}

function getAbsBB(node) {
  return node.absoluteBoundingBox || null;
}

function getAbsX(node) {
  const bb = getAbsBB(node);
  return bb ? bb.x : 0;
}

function getAbsY(node) {
  const bb = getAbsBB(node);
  return bb ? bb.y : 0;
}

function findStatusForRow(rowIcons, allIcons) {
  const iconBBs = rowIcons.map(n => getAbsBB(n)).filter(Boolean);
  const groupLeft   = Math.min(...iconBBs.map(b => b.x));
  const groupTop    = Math.min(...iconBBs.map(b => b.y));
  const groupBottom = Math.max(...iconBBs.map(b => b.y + b.height));
  const groupCenterY = (groupTop + groupBottom) / 2;

  let best = null;
  let bestDist = Infinity;

  function walk(node) {
    if (allIcons.includes(node)) return;
    if (node.type === 'INSTANCE') {
      const bb = getAbsBB(node);
      if (bb) {
        const nodeRight   = bb.x + bb.width;
        const nodeCenterY = bb.y + bb.height / 2;
        const dist = groupLeft - nodeRight;
        const rowHeight = groupBottom - groupTop;
        const yMatch = Math.abs(nodeCenterY - groupCenterY) <= rowHeight * 1.5;
        if (dist >= 0 && dist <= 300 && yMatch && dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) walk(child);
    }
  }

  walk(figma.currentPage);
  return best;
}

// Группируем иконки по рядам: сортируем по Y, затем бьём на группы по 4 (по X внутри)
function groupIntoRows(components) {
  // Сортируем по абсолютному Y
  const sorted = [...components].sort((a, b) => getAbsY(a) - getAbsY(b));

  const rows = [];
  while (sorted.length > 0) {
    // Берём первый элемент, находим все с похожим Y (в пределах его высоты)
    const first = sorted[0];
    const firstBB = getAbsBB(first);
    const rowHeight = firstBB ? firstBB.height : 100;
    const firstY = getAbsY(first);

    const rowItems = [];
    const rest = [];
    for (const node of sorted) {
      const dy = Math.abs(getAbsY(node) - firstY);
      if (dy <= rowHeight * 1.5) {
        rowItems.push(node);
      } else {
        rest.push(node);
      }
    }

    // Внутри ряда сортируем по X
    rowItems.sort((a, b) => getAbsX(a) - getAbsX(b));
    rows.push(rowItems);
    sorted.splice(0, sorted.length, ...rest);
  }

  return rows;
}

// ─── Plugin entry ─────────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 380, height: 300, title: 'Batch Icon Components' });

function validate() {
  const sel = figma.currentPage.selection;

  if (sel.length === 0 || sel.length % 4 !== 0) {
    figma.ui.postMessage({
      type: 'awaiting',
      message: sel.length === 0
        ? 'Выберите компоненты иконок\n(кратно 4)'
        : `Выбрано ${sel.length} — число должно быть кратно 4`
    });
    return;
  }

  const allComponents = sel.every(n => n.type === 'COMPONENT');
  if (!allComponents) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Все выбранные элементы должны быть мейн-компонентами.'
    });
    return;
  }

  // Группируем по рядам
  const rows = groupIntoRows([...sel]);

  // Проверяем что каждый ряд ровно 4
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== 4) {
      figma.ui.postMessage({
        type: 'error',
        message: `Ряд ${i + 1} содержит ${rows[i].length} иконок, ожидается 4.\nПроверьте выделение.`
      });
      return;
    }
  }

  // Проверяем размеры первого ряда (все ряды должны быть одного набора)
  const firstRow = rows[0];
  const widths = firstRow.map(n => Math.round(n.width));
  const sizeLabel = matchSizeSet(widths);
  if (!sizeLabel) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Размеры [' + widths.join(', ') + 'px] не совпадают ни с одним набором.\n\nДопустимые наборы:\n• Small: 20/25/30/35 или 24/30/36/42\n• Big: 28/35/42/49\n• Huge: 40/50/60/70'
    });
    return;
  }

  // Проверяем наличие .status для каждого ряда
  const allIcons = [...sel];
  const rowPreviews = [];
  for (let i = 0; i < rows.length; i++) {
    const statusNode = findStatusForRow(rows[i], allIcons);
    if (!statusNode) {
      figma.ui.postMessage({
        type: 'error',
        message: `Ряд ${i + 1}: не найден инстанс .status в радиусе 300px левее.`
      });
      return;
    }
    const iconName = getTextFromStatus(statusNode);
    if (!iconName) {
      figma.ui.postMessage({
        type: 'error',
        message: `Ряд ${i + 1}: в компоненте .status нет текстового слоя «name».`
      });
      return;
    }
    rowPreviews.push(iconName.trim());
  }

  figma.ui.postMessage({
    type: 'ready',
    sizeLabel,
    rowCount: rows.length,
    rowPreviews,   // имена иконок по рядам
    widths,
  });
}

figma.on('selectionchange', validate);
validate();

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'apply') {
    const { prefix, role, sizeLabel, create2xSvg } = msg;

    const sel = figma.currentPage.selection;
    if (sel.length === 0 || sel.length % 4 !== 0) {
      figma.notify('Выберите компоненты кратно 4', { error: true });
      return;
    }

    const allIcons = [...sel];
    const rows = groupIntoRows(allIcons);

    for (const row of rows) {
      const statusNode = findStatusForRow(row, allIcons);
      if (!statusNode) continue;
      const iconName = getTextFromStatus(statusNode);
      if (!iconName) continue;

      const name = iconName.trim();

      // Строим имена 1x…1.75x
      const names = SCALES.map(scale => {
        let n = '';
        if (prefix) n += '_';
        n += role + '/';
        n += scale + '/';
        if (sizeLabel !== 'small') n += sizeLabel + '/';
        n += 'btn-' + name;
        return n;
      });

      for (let i = 0; i < 4; i++) {
        row[i].name = names[i];
      }

      if (create2xSvg) {
        const icon1x  = row[0];
        const icon175 = row[3];
        const bb175   = getAbsBB(icon175);
        const rightEdge175 = bb175.x + bb175.width;

        // ── 2x ──
        const inst2x = icon1x.createInstance();
        figma.currentPage.appendChild(inst2x);
        inst2x.x = rightEdge175 + GAP;
        inst2x.y = bb175.y;
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
        instSvg.y = bb175.y;

        const detached = instSvg.detachInstance();
        const compSvg = figma.createComponentFromNode(detached);
        const btnIndex = names[0].lastIndexOf('btn-');
        compSvg.name = btnIndex !== -1 ? names[0].slice(btnIndex) : 'btn-' + name;
      }
    }

    figma.notify('✓ Готово! ' + rows.length + (rows.length === 1 ? ' ряд' : rows.length < 5 ? ' ряда' : ' рядов'));
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

import { jsPDF } from 'jspdf';
import type { FrameModel, Project } from '../domain/types';

const KIND_RU: Record<string, string> = {
  sill: 'лежень',
  bottom_plate: 'нижняя обвязка',
  top_plate: 'верхняя обвязка',
  stud: 'стойка',
  king_stud: 'королевская стойка',
  jack_stud: 'джек',
  header: 'перемычка',
  cripple: 'коротыш',
  joist: 'балка',
  rim_joist: 'обвязочная балка',
  rafter: 'стропило',
  ridge: 'конёк',
  blocking: 'блокировка',
};

function money(n: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(n);
}

async function svgToPngDataUrl(svg: string, maxW = 1600): Promise<string | null> {
  if (!svg || typeof document === 'undefined') return null;
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('svg load failed'));
    });
    img.src = url;
    const image = await loaded;
    const scale = Math.min(1, maxW / Math.max(image.width, 1));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return null;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function addFooter(doc: jsPDF, page: number, totalHint: string) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(
    `FramePlan · инженерная модель по СП 31-105-2002, не замена рабочей документации · ${totalHint} · стр. ${page}`,
    w / 2,
    h - 8,
    { align: 'center' },
  );
  doc.setTextColor(0);
}

function ensureSpace(doc: jsPDF, y: number, need: number, pageRef: { n: number }): number {
  const h = doc.internal.pageSize.getHeight();
  if (y + need < h - 16) return y;
  addFooter(doc, pageRef.n, 'отчёт');
  doc.addPage();
  pageRef.n += 1;
  return 16;
}

async function addSvgBlock(
  doc: jsPDF,
  title: string,
  svg: string,
  y: number,
  pageRef: { n: number },
): Promise<number> {
  const pageW = doc.internal.pageSize.getWidth();
  y = ensureSpace(doc, y, 20, pageRef);
  doc.setFontSize(12);
  doc.text(title, 14, y);
  y += 4;
  const png = await svgToPngDataUrl(svg);
  if (!png) {
    doc.setFontSize(9);
    doc.text('(чертеж недоступен для экспорта)', 14, y + 6);
    return y + 14;
  }
  const maxW = pageW - 28;
  const maxH = 90;
  // Assume landscape-ish; fit
  const imgW = maxW;
  const imgH = maxH;
  y = ensureSpace(doc, y, imgH + 8, pageRef);
  doc.addImage(png, 'PNG', 14, y, imgW, imgH);
  return y + imgH + 8;
}

export type PdfSection = 'all' | 'frame' | 'cutting' | 'estimate' | 'thermal';

export async function downloadProjectPdf(
  project: Project,
  model: FrameModel,
  section: PdfSection = 'all',
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageRef = { n: 1 };
  const pageW = doc.internal.pageSize.getWidth();
  let y = 16;

  doc.setFontSize(18);
  doc.text(`FramePlan — ${project.name || 'Проект'}`, 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(
    `Площадь ${model.summary.footprintM2.toFixed(1)} м² · периметр ${model.summary.perimeterM.toFixed(1)} м · стойки ${model.summary.studCount} · пиломатериал ${model.summary.lumberVolumeM3.toFixed(2)} м³`,
    14,
    y,
  );
  y += 6;
  if (model.rooms.length) {
    const roomLine = model.rooms
      .map((r) => `${r.label} (${r.floor + 1} эт.): ${r.areaM2.toFixed(1)} м²`)
      .join(' · ');
    doc.text(`Помещения: ${roomLine}`, 14, y, { maxWidth: pageW - 28 });
    y += 10;
  } else {
    y += 4;
  }

  const wantFrame = section === 'all' || section === 'frame';
  const wantCut = section === 'all' || section === 'cutting';
  const wantBom = section === 'all' || section === 'estimate';
  const wantHeat = section === 'all' || section === 'thermal';

  if (wantFrame) {
    y = await addSvgBlock(doc, 'План каркаса', model.projections.planSvg, y, pageRef);
    y = await addSvgBlock(doc, 'Фасад', model.projections.elevationFrontSvg, y, pageRef);
    y = await addSvgBlock(doc, 'Торец', model.projections.elevationSideSvg, y, pageRef);
    y = await addSvgBlock(doc, 'План стропил', model.projections.roofSvg, y, pageRef);
    for (const elev of model.projections.wallElevations.slice(0, 8)) {
      y = await addSvgBlock(doc, elev.title, elev.svg, y, pageRef);
    }

    y = ensureSpace(doc, y, 40, pageRef);
    doc.setFontSize(12);
    doc.text('Ведомость элементов (фрагмент)', 14, y);
    y += 6;
    doc.setFontSize(8);
    for (const p of model.lumber.slice(0, 40)) {
      y = ensureSpace(doc, y, 5, pageRef);
      doc.text(
        `${KIND_RU[p.category] ?? p.category} · ${p.label} · ${p.sectionMm.width}×${p.sectionMm.depth} · ${p.lengthMm} мм × ${p.qty}`,
        14,
        y,
      );
      y += 4;
    }
  }

  if (wantCut) {
    y = ensureSpace(doc, y, 20, pageRef);
    doc.setFontSize(14);
    doc.text('Раскрой', 14, y);
    y += 8;
    doc.setFontSize(9);
    for (const c of model.cutting) {
      y = ensureSpace(doc, y, 10, pageRef);
      doc.text(
        `${c.sectionMm.width}×${c.sectionMm.depth} → хлысты ${c.stockLengthMm} мм · к покупке ${c.boardsNeeded} · утилизация ${(c.utilization * 100).toFixed(0)}%`,
        14,
        y,
      );
      y += 5;
      for (const b of c.boards.slice(0, 12)) {
        y = ensureSpace(doc, y, 5, pageRef);
        const cuts = b.cuts.map((x) => `${x.label} ${x.lengthMm}`).join('; ');
        doc.text(`Хлыст №${b.index}: ${cuts} · отход ${b.wasteMm}`, 18, y, {
          maxWidth: pageW - 36,
        });
        y += 5;
      }
      y += 3;
    }
  }

  if (wantBom) {
    y = ensureSpace(doc, y, 20, pageRef);
    doc.setFontSize(14);
    doc.text('Смета', 14, y);
    y += 8;
    doc.setFontSize(9);
    let total = 0;
    for (const l of model.bom) {
      total += l.total;
      y = ensureSpace(doc, y, 5, pageRef);
      doc.text(
        `${l.group} · ${l.name} · ${l.qty} ${l.unit} · ${money(l.total)}`,
        14,
        y,
        { maxWidth: pageW - 28 },
      );
      y += 5;
    }
    y = ensureSpace(doc, y, 8, pageRef);
    doc.setFontSize(11);
    doc.text(`Итого: ${money(total)}`, 14, y);
    y += 8;
  }

  if (wantHeat) {
    y = ensureSpace(doc, y, 30, pageRef);
    doc.setFontSize(14);
    doc.text('Теплопотери', 14, y);
    y += 8;
    doc.setFontSize(10);
    doc.text(
      `Объём ${model.heatLoss.volumeM3.toFixed(1)} м³ · ${(model.heatLoss.totalW / 1000).toFixed(2)} кВт · ${model.heatLoss.specificWm2.toFixed(0)} Вт/м²`,
      14,
      y,
    );
    y += 6;
    doc.setFontSize(9);
    for (const s of model.heatLoss.surfaces) {
      y = ensureSpace(doc, y, 5, pageRef);
      doc.text(
        `${s.name}: ${s.areaM2.toFixed(2)} м² · U=${s.uValue.toFixed(3)} · ${s.lossW.toFixed(0)} Вт`,
        14,
        y,
      );
      y += 5;
    }
  }

  addFooter(doc, pageRef.n, project.name || 'проект');
  const safeName = (project.name || 'frameplan').replace(/[^\wа-яА-ЯёЁ-]+/g, '_');
  doc.save(`${safeName}.pdf`);
}

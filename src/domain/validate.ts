import type { Project } from './types';
import { wallLength, wallSegmentCollides } from './geometry';
import { exteriorLoopClosed } from './rooms';

export type ValidationIssue = {
  level: 'error' | 'warning';
  message: string;
};

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const floors = project.settings.floors === 2 ? ([0, 1] as const) : ([0] as const);

  for (const floor of floors) {
    const walls = project.walls.filter((w) => w.floor === floor);
    const exterior = walls.filter((w) => w.kind === 'exterior');

    if (floor === 0 && exterior.length === 0) {
      issues.push({ level: 'error', message: 'Нет наружных стен на 1 этаже.' });
    }
    if (floor === 1 && project.settings.floors === 2 && walls.length === 0) {
      issues.push({
        level: 'warning',
        message: '2 этаж включён, но план 2 этажа пуст. Скопируйте 1 эт. → 2 эт.',
      });
    }
    if (exterior.length > 0 && !exteriorLoopClosed(walls)) {
      issues.push({
        level: 'error',
        message: `Наружный контур ${floor + 1} этажа не замкнут.`,
      });
    }

    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i];
        const b = walls[j];
        if (wallSegmentCollides(a.a, a.b, [b])) {
          issues.push({
            level: 'error',
            message: `Стены пересекаются крест-накрест на ${floor + 1} этаже.`,
          });
        }
      }
    }
  }

  for (const o of project.openings) {
    const wall = project.walls.find((w) => w.id === o.wallId);
    if (!wall) {
      issues.push({
        level: 'error',
        message: `Проём «${o.label ?? o.type}» без стены.`,
      });
      continue;
    }
    const L = wallLength(wall);
    if (o.width > L + 1) {
      issues.push({
        level: 'error',
        message: `Проём ${Math.round(o.width)} мм шире стены ${Math.round(L)} мм.`,
      });
    } else if (o.offset < -1 || o.offset + o.width > L + 1) {
      issues.push({
        level: 'warning',
        message: `Проём «${o.label ?? o.type}» выходит за границы стены.`,
      });
    }
    if (o.width < 400) {
      issues.push({
        level: 'warning',
        message: `Слишком узкий проём (${o.width} мм).`,
      });
    }
  }

  if (project.settings.floors === 2) {
    const hasFloor0 = project.walls.some((w) => w.floor === 0);
    if (!hasFloor0) {
      issues.push({ level: 'error', message: '2 этажа заданы, но нет стен 1 этажа.' });
    }
  }

  return issues;
}

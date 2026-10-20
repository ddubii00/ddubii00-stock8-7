import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createDashboard, applyChanges, cleanSlotPatch, cleanLine, validSymbol, SLOT_COUNT } from '../public/dashboard-model.js';

export async function createDashboardStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'dashboard.json');
  let document;
  try {
    document = JSON.parse(await readFile(path, 'utf8'));
    if (document.state?.version !== 1 || ![20, SLOT_COUNT].includes(document.state.slots?.length) || !Number.isInteger(document.state.revision) || !document.state.lines || !Array.isArray(document.applied)) throw new Error('Invalid saved dashboard');
    document.state.slots.forEach(cleanSlotPatch);
    for (const [symbol, lines] of Object.entries(document.state.lines)) {
      if (!validSymbol(symbol) || !Array.isArray(lines) || lines.length > 100) throw new Error('Invalid saved lines');
      lines.forEach(cleanLine);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`저장 파일을 읽을 수 없습니다. 원본을 보존합니다: ${error.message}`);
    document = { state: createDashboard(), applied: [] };
  }
  if (document.state.slots.length === 20) {
    // Preserve every existing slot, shared line, revision and operation ID.
    const migrated = structuredClone(document);
    migrated.state.slots.push(...createDashboard().slots.slice(20));
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(migrated), { mode: 0o600 });
    await rename(temporary, path);
    document = migrated;
  }
  let queue = Promise.resolve();
  return {
    get: () => structuredClone(document.state),
    update(operation) {
      const task = queue.then(async () => {
        if (!operation || !/^[\w-]{1,100}$/.test(operation.id || '')) throw new Error('Invalid operation ID');
        if (document.applied.includes(operation.id)) return structuredClone(document.state);
        const state = applyChanges(document.state, operation.changes);
        state.revision = document.state.revision + 1;
        const next = { state, applied: [...document.applied, operation.id].slice(-1000) };
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, path);
        document = next;
        return structuredClone(state);
      });
      queue = task.catch(() => {});
      return task;
    }
  };
}

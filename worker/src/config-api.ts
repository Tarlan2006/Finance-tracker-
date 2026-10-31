import { categoryLabel, changeItem, configEmoji, configName, importCategories, importItems, limitAmount, uniqueCategory } from '../../shared/config';
import { AppError, parseAmount, today, validMonth } from '../../shared/logic';
import type { Config, ConfigCategory, ConfigItem, Snapshot } from '../../shared/types';
import type { SheetsAdapter } from './sheets';
import { CATEGORY_SHEET, ITEM_SHEET, MemoryOperations, moveIdentity, categoryRow, configConflict, decodeConfig, headers, itemRow, planRows, type ConfigPlan, type OperationStorage } from './config-store';
const stamp = () => `${today('Asia/Almaty')}T${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date())}+05:00`;
interface Receipt { signature: string; chunks: number; done: boolean; count: number }
export class ConfigApi {
  private cache?: { until: number; value: Config };
  constructor(private adapter: SheetsAdapter, private operations: OperationStorage = new MemoryOperations()) {}
  async read(fresh = false, loadLegacy: () => Promise<Snapshot> = () => this.adapter.read()): Promise<Config> {
    if (!fresh && this.cache && this.cache.until > Date.now()) return this.cache.value;
    const value = decodeConfig(await this.adapter.readConfigTables());
    if (!value.configured) { const legacy = await loadLegacy(), articles = await this.adapter.readLegacyItems(); value.categories = importCategories(legacy.categories, ''); value.items = importItems(articles.income, articles.fixed, ''); }
    this.cache = { until: Date.now() + 300000, value }; return value;
  }
  async setup() {
    this.cache = undefined;
    let tables = await this.adapter.readConfigTables(); const existing = decodeConfig(tables);
    if (existing.configured) return this.read(true);
    // Prepare and validate import before any structural mutation.
    const legacy = await this.adapter.read(), source = await this.adapter.readLegacyItems(), time = stamp();
    const cats = importCategories(legacy.categories, time), items = importItems(source.income, source.fixed, time);
    await this.adapter.createConfigSheets(); tables = await this.adapter.readConfigTables();
    const plan: ConfigPlan = { writes: [], moves: [] };
    planRows(tables, CATEGORY_SHEET, [headers[CATEGORY_SHEET], ...cats.filter(c => !tables.categories?.some(r => r[0] === c.id)).map(categoryRow)], plan);
    planRows(tables, ITEM_SHEET, [headers[ITEM_SHEET], ...items.filter(i => !tables.items?.some(r => r[0] === i.id)).map(itemRow)], plan);
    await this.adapter.applyConfig(plan); return this.read(true);
  }
  async mutate(path: string, b: Record<string, unknown>, dry: boolean) {
    const operationId = String(b.operationId || '');
    if (!dry && !/^[a-zA-Z0-9-]{8,100}$/.test(operationId)) throw new AppError(422, 'operation', 'Для изменения нужен уникальный ID операции');
    const signature = JSON.stringify([path, Object.entries(b).filter(([k]) => k !== 'operationId').sort(([a], [c]) => a.localeCompare(c))]);
    const key = `config-operation:${operationId}`;
    const saved = dry ? undefined : await this.operations.get<Receipt>(key);
    this.cache = undefined;
    if (saved) {
      if (saved.signature !== signature) throw configConflict();
      if (!saved.done) { const plan: ConfigPlan = { writes: [], moves: [] }; for (let i = 0; i < saved.chunks; i++) { const chunk = await this.operations.get<ConfigPlan>(`${key}:${i}`); if (!chunk) throw new AppError(503, 'operation', 'Повторите операцию позже'); plan.writes.push(...chunk.writes); plan.moves.push(...chunk.moves); } await this.adapter.applyConfig(plan); await this.operations.put(key, { ...saved, done: true }); }
      return { config: await this.read(true), count: saved.count };
    }
    const tables = await this.adapter.readConfigTables(), config = decodeConfig(tables), time = stamp();
    if (!config.configured) throw new AppError(422, 'setup', 'Сначала создайте настройки');
    const plan: ConfigPlan = { writes: [], moves: [] };
    const match = path.match(/^\/api\/config\/(categories|items)(?:\/([a-zA-Z0-9@-]+))?$/);
    if (!match) throw new AppError(404, 'route', 'Маршрут не найден');
    const [, group, id] = match;
    if (group === 'categories') {
      if ('move' in b && Object.keys(b).some(k => !['operationId', 'rev', 'move'].includes(k))) throw new AppError(422, 'sort', 'Меняйте порядок отдельно от названия и архива');
      const old = id ? config.categories.find(c => c.id === id) : undefined;
      if (id && (!old || old.rev !== b.rev)) throw configConflict();
      const category: ConfigCategory = old ? { ...old, rev: old.rev + 1, updated_at: time } : { id: crypto.randomUUID(), name: '', emoji: '', limit: 0, archived: false, sort: Math.max(-1, ...config.categories.map(c => c.sort)) + 1, rev: 1, updated_at: time };
      if ('name' in b || !old) category.name = configName(b.name);
      if ('emoji' in b || !old) category.emoji = configEmoji(b.emoji);
      if ('limit' in b) category.limit = limitAmount(b.limit);
      if ('archived' in b) { if (typeof b.archived !== 'boolean') throw new AppError(422, 'archive', 'Неверный признак архива'); category.archived = b.archived; }
      if ('sort' in b) { if (!Number.isSafeInteger(b.sort) || Math.abs(Number(b.sort)) > 1000000) throw new AppError(422, 'sort', 'Неверный порядок'); category.sort = Number(b.sort); }
      uniqueCategory(category.name, config.categories, category.id);
      let target = categoryLabel(category);
      if (b.targetId) { const destination = config.categories.find(c => c.id === b.targetId && !c.archived && c.id !== id); if (!old || !destination || !category.archived) throw new AppError(422, 'target', 'Выберите активную категорию для переноса'); target = categoryLabel(destination); }
      if (old && (target !== categoryLabel(old) || dry)) {
        const snapshot = await this.adapter.read(false);
        plan.moves = snapshot.rows.flatMap((row, i) => i > 0 && row[2] === categoryLabel(old) ? [{ row: i + 1, from: categoryLabel(old), to: target, identity: moveIdentity(row) }] : []);
      }
      if ('move' in b) {
        if (!old || old.archived || ![-1, 1].includes(Number(b.move))) throw new AppError(422, 'sort', 'Нельзя переместить категорию');
        const ordered = config.categories.filter(c => !c.archived).sort((a, c) => a.sort - c.sort || a.id.localeCompare(c.id)), index = ordered.findIndex(c => c.id === old.id), next = index + Number(b.move);
        if (!ordered[next]) throw new AppError(422, 'sort', 'Категория уже на краю списка');
        [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
        planRows(tables, CATEGORY_SHEET, ordered.flatMap((c, sort) => c.sort === sort ? [] : [categoryRow({ ...c, sort, rev: c.rev + 1, updated_at: time })]), plan);
      } else planRows(tables, CATEGORY_SHEET, [categoryRow(category)], plan);
    } else {
      if (dry) throw new AppError(422, 'dry', 'Предпросмотр доступен для категорий');
      const month = validMonth(String(b.month || ''));
      let changes: ConfigItem[];
      if (id) {
        const current = config.items.find(i => i.id === id);
        if (!current || current.rev !== b.rev) throw configConflict();
        if (b.scope !== undefined && !['forward', 'month'].includes(String(b.scope))) throw new AppError(422, 'scope', 'Выберите период изменения');
        changes = changeItem(config.items, current, month, b.remove === true ? null : parseAmount(b.amount), b.remove === true ? 'forward' : b.scope === 'month' ? 'month' : 'forward', time);
      } else {
        if (!['income', 'fixed'].includes(String(b.kind))) throw new AppError(422, 'kind', 'Выберите тип статьи');
        changes = [{ id: `${crypto.randomUUID()}@${month}`, kind: b.kind as ConfigItem['kind'], name: configName(b.name, 80), amount: parseAmount(b.amount), from_month: month, to_month: '', rev: 1, updated_at: time }];
      }
      planRows(tables, ITEM_SHEET, changes.map(itemRow), plan);
    }
    if (dry) return { count: plan.moves.length };
    // Durable Object values are limited to 128 KiB. A full journal rename needs chunks.
    const chunks = Math.max(1, Math.ceil(Math.max(plan.writes.length, plan.moves.length) / 50));
    for (let i = 0; i < chunks; i++) await this.operations.put(`${key}:${i}`, { writes: plan.writes.slice(i * 50, (i + 1) * 50), moves: plan.moves.slice(i * 50, (i + 1) * 50) });
    const receipt: Receipt = { signature, chunks, done: false, count: plan.moves.length };
    await this.operations.put(key, receipt);
    try { await this.adapter.applyConfig(plan); await this.operations.put(key, { ...receipt, done: true }); } finally { this.cache = undefined; }
    return { config: await this.read(true), count: plan.moves.length };
  }
}

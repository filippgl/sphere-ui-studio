const identity = (item) => `${item.scope || 'effects'}:${item.name}`;
function checkedManifest(manifest, valid) {
  if (!Array.isArray(manifest) || new Set(manifest.map(identity)).size !== manifest.length)
    throw Error('Повреждён манифест резервной копии');
  for (const item of manifest)
    if (
      !valid(item) ||
      !(item.before === null || /^[a-f0-9]{64}$/.test(item.before)) ||
      !(item.after === null || /^[a-f0-9]{64}$/.test(item.after))
    )
      throw Error('Неизвестный файл или повреждённый манифест резервной копии');
  return manifest;
}
export function backupId(ids, uuid) {
  const last = ids[0]?.slice(0, 24).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/, 'T$1:$2:$3.$4Z');
  const timestamp = Math.max(Date.now(), (Date.parse(last) || 0) + 1);
  return new Date(timestamp).toISOString().replace(/[:.]/g, '-') + '-' + uuid.slice(0, 6);
}
export async function historyEntries(ids, readRecord, valid) {
  const files = new Map(),
    result = [];
  for (const [index, id] of ids.entries()) {
    try {
      const { manifest, transaction } = await readRecord(id);
      for (const item of checkedManifest(manifest, valid))
        files.set(identity(item), {
          name: item.name,
          ...(item.scope ? { scope: item.scope } : {}),
        });
      result.push({
        id,
        revisions: index + 1,
        files: [...files.values()],
        kind: transaction?.kind || 'save',
      });
    } catch (error) {
      result.push({ id, error: error.message });
    }
  }
  return result;
}
export async function restorePlan(id, ids, readManifest, readBefore, digest, valid) {
  const index = ids.indexOf(id);
  if (index < 0) throw Error('Резервная копия не найдена');
  const revisions = ids.slice(0, index + 1),
    targets = new Map();
  // The earliest pre-change snapshot in the selected suffix wins for each file.
  // Rollback checkpoints participate in the same timeline, so a rollback can be undone.
  for (const revision of [...revisions].reverse()) {
    for (const item of checkedManifest(await readManifest(revision), valid)) {
      const key = identity(item);
      if (targets.has(key)) continue;
      const bytes = item.before === null ? null : await readBefore(revision, item);
      if ((await digest(bytes)) !== item.before) throw Error('Резервная копия повреждена');
      targets.set(key, { ...item, bytes });
    }
  }
  return { revisions, files: [...targets.values()] };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute real repository code against an isolated optimistic-transaction double.
// No production Firebase reads/writes are performed by these tests.
function loadTS(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const validation = loadTS('src/lib/inventory-validation.ts', {});
const staff = { name: 'Tester', uid: 'test-only' };
const draft = { id: 'lot', barcode: '12345', product_name: 'Milk', quantity: 3,
  expiry_date: '2028-02-29', photo_key: 'photos/test.jpg' };

function fixture() {
  const docs = new Map();
  const snapshot = (key) => {
    const value = structuredClone(docs.get(key));
    return { exists: () => value !== undefined, data: () => value };
  };
  const sdk = {
    doc: (_, ...parts) => parts.join('/'),
    collection: (_, ...parts) => parts.join('/'),
    where: (field, _, value) => ({ field, value }),
    query: (path, ...filters) => ({ path, filters }),
    getDocs: async ({ path, filters }) => {
      const matches = [...docs].filter(([key, value]) =>
        key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 &&
        filters.every((f) => value[f.field] === f.value));
      return { forEach: (fn) => matches.forEach(([key, value]) => fn({ id: key.split('/').at(-1), data: () => structuredClone(value) })) };
    },
    setDoc: async (key, value, options) => docs.set(key, options?.merge ? { ...docs.get(key), ...value } : value),
    runTransaction: async (_, callback) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map();
        const writes = [];
        const result = await callback({
          get: async (key) => {
            assert.equal(writes.length, 0, 'Firestore reads must precede writes');
            reads.set(key, JSON.stringify(docs.get(key)));
            return snapshot(key);
          },
          set: (key, value, options) => writes.push([key, value, options?.merge]),
          update: (key, value) => writes.push([key, value, true]),
        });
        if ([...reads].some(([key, value]) => JSON.stringify(docs.get(key)) !== value)) continue;
        for (const [key, value, merge] of writes) {
          docs.set(key, structuredClone(merge ? { ...docs.get(key), ...value } : value));
        }
        return result;
      }
      throw new Error('Transaction retries exhausted');
    },
  };
  const { firebaseRepo } = loadTS('src/lib/firebase-repository.ts', {
    'firebase/firestore': sdk, './firebase': { getDb: () => ({}) },
    './inventory-validation': validation,
  });
  return { repo: firebaseRepo, docs };
}

test('rejects invalid quantities and impossible dates', () => {
  for (const value of [-1, 0, 1.5, NaN, Infinity, true, '2']) {
    assert.throws(() => validation.validateEntryValues(value, '2026-09-21'), validation.ValidationError);
  }
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', 'not-a-date']) {
    assert.throws(() => validation.validateEntryValues(1, date), validation.ValidationError);
  }
  assert.doesNotThrow(() => validation.validateEntryValues(1, '2028-02-29'));
});

test('creating a lot preserves product unit and records one history entry', async () => {
  const { repo, docs } = fixture();
  await repo.upsertProduct(draft.barcode, draft.product_name, 'Box');
  await repo.createEntry(draft, staff);
  assert.equal(docs.get('products/12345').unit, 'Box');
  assert.equal([...docs.keys()].filter((key) => key.includes('/history/')).length, 1);
});

test('duplicate lot ID cannot overwrite quantity or reset history', async () => {
  const { repo, docs } = fixture();
  await repo.createEntry(draft, staff);
  await assert.rejects(repo.createEntry({ ...draft, quantity: 99 }, staff), /Xung đột/);
  assert.equal(docs.get('inventoryEntries/lot').quantity, 3);
});

test('two concurrent edits with the same revision only commit once', async () => {
  const { repo, docs } = fixture();
  await repo.createEntry(draft, staff);
  const results = await Promise.allSettled([8, 12].map((quantity) =>
    repo.updateEntry('lot', 1, { quantity, expiry_date: draft.expiry_date }, staff)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /Xung đột/);
  assert.equal(docs.get('inventoryEntries/lot').rev, 2);
  assert.equal([...docs.keys()].filter((key) => key.includes('/history/')).length, 2);
});

test('delete retains audit history and rejects later edits', async () => {
  const { repo, docs } = fixture();
  await repo.createEntry(draft, staff);
  await repo.deleteEntry('lot', 1, staff);
  assert.equal(docs.get('inventoryEntries/lot').status, 'deleted');
  assert.equal([...docs.values()].filter((value) => value.change_type === 'delete').length, 1);
  await assert.rejects(repo.updateEntry('lot', 2, { quantity: 8, expiry_date: draft.expiry_date }, staff), /Xung đột/);
  assert.deepEqual(await repo.listRecentEntries(), []);
});

test('concurrent edit and delete cannot both commit', async () => {
  const { repo } = fixture();
  await repo.createEntry(draft, staff);
  const result = await Promise.allSettled([
    repo.updateEntry('lot', 1, { quantity: 8, expiry_date: draft.expiry_date }, staff),
    repo.deleteEntry('lot', 1, staff),
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
});

test('deleted recent lots do not hide older active lots; full export exceeds 500', async () => {
  const { repo, docs } = fixture();
  for (let i = 0; i < 520; i++) {
    docs.set(`inventoryEntries/${i}`, { ...draft, created_at: i, status: i < 510 ? 'active' : 'deleted' });
  }
  assert.equal((await repo.listRecentEntries(100)).length, 100);
  assert.equal((await repo.listRecentEntries(null)).length, 510);
});

test('Firebase module import does not initialize app or Auth at build time', () => {
  let calls = 0;
  loadTS('src/lib/firebase.ts', {
    'firebase/app': { initializeApp: () => calls++, getApps: () => [] },
    'firebase/firestore': { getFirestore: () => calls++ },
  });
  assert.equal(calls, 0);
});

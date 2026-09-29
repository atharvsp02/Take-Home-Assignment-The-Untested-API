/**
 * Unit tests for src/services/taskService.js
 *
 * These call the service functions directly (no HTTP) to pin down the
 * business logic in isolation. Route-level behaviour (status codes,
 * validation, JSON handling) is covered in tests/tasks.api.test.js.
 *
 * Tests written with `test.failing` describe the CORRECT behaviour for a
 * known bug. Jest reports them as passing while the bug exists, and flags
 * them as soon as the bug is fixed, which is the cue to switch them to
 * `test`. Bug numbers refer to BUG_REPORT.md.
 */
const taskService = require('../src/services/taskService');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

const createMany = (count) =>
  Array.from({ length: count }, (_, i) => taskService.create({ title: `Task ${i + 1}` }));

// The store is module-level state shared by every test, so wipe it before
// each one to keep tests independent of execution order.
beforeEach(() => {
  taskService._reset();
});

describe('create', () => {
  test('creates a task with defaults for every optional field', () => {
    const task = taskService.create({ title: 'Write tests' });

    expect(task).toEqual({
      id: expect.stringMatching(UUID_V4),
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      createdAt: expect.any(String),
    });
    expect(new Date(task.createdAt).toISOString()).toBe(task.createdAt);
  });

  test('uses the values provided instead of the defaults', () => {
    const task = taskService.create({
      title: 'Ship it',
      description: 'Before Friday',
      status: 'in_progress',
      priority: 'high',
      dueDate: FUTURE,
    });

    expect(task).toMatchObject({
      title: 'Ship it',
      description: 'Before Friday',
      status: 'in_progress',
      priority: 'high',
      dueDate: FUTURE,
    });
  });

  test('gives every task a unique id', () => {
    const [a, b] = createMany(2);

    expect(a.id).not.toBe(b.id);
  });

  test('ignores server-managed fields sent by the caller', () => {
    const task = taskService.create({
      title: 'Sneaky',
      id: 'my-own-id',
      completedAt: PAST,
      createdAt: PAST,
    });

    expect(task.id).not.toBe('my-own-id');
    expect(task.completedAt).toBeNull();
    expect(task.createdAt).not.toBe(PAST);
  });

  test('adds the task to the store', () => {
    const task = taskService.create({ title: 'Stored' });

    expect(taskService.findById(task.id)).toEqual(task);
  });
});

describe('getAll', () => {
  test('returns an empty array when there are no tasks', () => {
    expect(taskService.getAll()).toEqual([]);
  });

  test('returns every task in creation order', () => {
    createMany(3);

    expect(taskService.getAll().map((t) => t.title)).toEqual(['Task 1', 'Task 2', 'Task 3']);
  });

  test('returns a new array, so changing it does not change the store', () => {
    createMany(2);

    taskService.getAll().pop();

    expect(taskService.getAll()).toHaveLength(2);
  });
});

describe('findById', () => {
  test('returns the matching task', () => {
    const [, second] = createMany(3);

    expect(taskService.findById(second.id)).toEqual(second);
  });

  test('returns undefined for an unknown id', () => {
    createMany(1);

    expect(taskService.findById('does-not-exist')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  beforeEach(() => {
    taskService.create({ title: 'A', status: 'todo' });
    taskService.create({ title: 'B', status: 'in_progress' });
    taskService.create({ title: 'C', status: 'done' });
    taskService.create({ title: 'D', status: 'todo' });
  });

  test('returns only tasks with the given status', () => {
    expect(taskService.getByStatus('todo').map((t) => t.title)).toEqual(['A', 'D']);
    expect(taskService.getByStatus('done').map((t) => t.title)).toEqual(['C']);
  });

  test('returns an empty array for a status nobody has', () => {
    expect(taskService.getByStatus('archived')).toEqual([]);
  });

  // BUG #2: the filter uses String.includes(), so a partial value matches
  // several statuses: "do" hits both "todo" and "done", "in" hits "in_progress".
  test.failing('matches the status exactly, not as a substring', () => {
    expect(taskService.getByStatus('do')).toEqual([]);
    expect(taskService.getByStatus('in')).toEqual([]);
  });
});

describe('getPaginated', () => {
  // Pages are 1-based: the route defaults a missing ?page to 1.

  // BUG #1: offset is computed as page * limit instead of (page - 1) * limit,
  // so page 1 skips the first `limit` tasks and they can never be fetched.
  test.failing('page 1 returns the first `limit` tasks', () => {
    createMany(12);

    const titles = taskService.getPaginated(1, 10).map((t) => t.title);

    expect(titles).toEqual(Array.from({ length: 10 }, (_, i) => `Task ${i + 1}`));
  });

  test.failing('page 2 returns the remaining tasks', () => {
    createMany(12);

    expect(taskService.getPaginated(2, 10).map((t) => t.title)).toEqual(['Task 11', 'Task 12']);
  });

  test('returns an empty array for a page past the end', () => {
    createMany(12);

    expect(taskService.getPaginated(5, 10)).toEqual([]);
  });

  test('returns an empty array when there are no tasks', () => {
    expect(taskService.getPaginated(1, 10)).toEqual([]);
  });
});

describe('getStats', () => {
  test('returns zero for everything when there are no tasks', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts tasks by status', () => {
    taskService.create({ title: 'A', status: 'todo' });
    taskService.create({ title: 'B', status: 'todo' });
    taskService.create({ title: 'C', status: 'in_progress' });
    taskService.create({ title: 'D', status: 'done' });

    expect(taskService.getStats()).toMatchObject({ todo: 2, in_progress: 1, done: 1 });
  });

  test('skips tasks with an unrecognised status instead of adding a new key', () => {
    // The service trusts its input (validation lives in the routes), so an
    // unexpected status can reach the store. Stats should stay well-formed.
    taskService.create({ title: 'Odd', status: 'archived' });

    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts unfinished tasks whose due date has passed as overdue', () => {
    taskService.create({ title: 'Late todo', status: 'todo', dueDate: PAST });
    taskService.create({ title: 'Late in progress', status: 'in_progress', dueDate: PAST });

    expect(taskService.getStats().overdue).toBe(2);
  });

  test('does not count finished, future or undated tasks as overdue', () => {
    taskService.create({ title: 'Done late', status: 'done', dueDate: PAST });
    taskService.create({ title: 'Not due yet', dueDate: FUTURE });
    taskService.create({ title: 'No due date' });

    expect(taskService.getStats().overdue).toBe(0);
  });
});

describe('update', () => {
  test('changes the given fields and keeps the rest', () => {
    const task = taskService.create({ title: 'Old title', priority: 'low' });

    const updated = taskService.update(task.id, { title: 'New title' });

    expect(updated).toEqual({ ...task, title: 'New title' });
  });

  test('saves the change to the store', () => {
    const task = taskService.create({ title: 'Old title' });

    taskService.update(task.id, { status: 'in_progress' });

    expect(taskService.findById(task.id).status).toBe('in_progress');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.update('does-not-exist', { title: 'x' })).toBeNull();
  });

  // BUG #5: the update spreads the request body straight onto the task, so a
  // caller can overwrite server-managed fields like id and createdAt.
  test.failing('does not let the caller overwrite id or createdAt', () => {
    const task = taskService.create({ title: 'Protected' });

    const updated = taskService.update(task.id, { id: 'hacked', createdAt: PAST });

    expect(updated.id).toBe(task.id);
    expect(updated.createdAt).toBe(task.createdAt);
  });

  // BUG #10: completeTask() sets completedAt, but moving a task to "done"
  // through update() does not, leaving a finished task with no finish time.
  test.failing('sets completedAt when the status changes to done', () => {
    const task = taskService.create({ title: 'Finish me' });

    const updated = taskService.update(task.id, { status: 'done' });

    expect(updated.completedAt).not.toBeNull();
  });
});

describe('remove', () => {
  test('deletes the task and returns true', () => {
    const [first, second] = createMany(2);

    expect(taskService.remove(first.id)).toBe(true);
    expect(taskService.findById(first.id)).toBeUndefined();
    expect(taskService.getAll()).toEqual([second]);
  });

  test('returns false and changes nothing for an unknown id', () => {
    createMany(2);

    expect(taskService.remove('does-not-exist')).toBe(false);
    expect(taskService.getAll()).toHaveLength(2);
  });
});

describe('completeTask', () => {
  test('marks the task as done and records when', () => {
    const task = taskService.create({ title: 'Finish me' });

    const completed = taskService.completeTask(task.id);

    expect(completed.status).toBe('done');
    expect(new Date(completed.completedAt).toISOString()).toBe(completed.completedAt);
    expect(taskService.findById(task.id)).toEqual(completed);
  });

  test('returns null for an unknown id', () => {
    expect(taskService.completeTask('does-not-exist')).toBeNull();
  });

  // BUG #3: completeTask() hard-codes priority: 'medium', silently
  // downgrading (or upgrading) the task's priority.
  test.failing('keeps the original priority', () => {
    const task = taskService.create({ title: 'Urgent', priority: 'high' });

    expect(taskService.completeTask(task.id).priority).toBe('high');
  });
});

import { describe, expect, it } from 'vitest';
import { deleteSelection } from './delete-selection';

/** A runner whose `element.delete` answers like the lifecycle: the ids it deleted. */
function runner(confirm: boolean) {
  const runs: [string, unknown][] = [];
  const run = async (name: string, args?: object) => {
    runs.push([name, args]);
    if (name === 'element.delete') return { ids: confirm ? (args as { ids: string[] }).ids : [] };
    return undefined;
  };
  return { runs, run };
}

describe('Delete key on the selection (spec 1.1 §E.4)', () => {
  it('Connections only: deletes them at once, no element delete flow', async () => {
    const { runs, run } = runner(true);
    await deleteSelection(run, { elements: [], connections: ['c1', 'c2'] });
    expect(runs).toEqual([['connection.delete', { ids: ['c1', 'c2'] }]]);
  });

  it('Nodes and Connections: the Node delete flow runs, then the Connections go too', async () => {
    const { runs, run } = runner(true);
    await deleteSelection(run, { elements: ['a'], connections: ['c1'] });
    expect(runs).toEqual([
      ['element.delete', { ids: ['a'] }],
      ['connection.delete', { ids: ['c1'] }],
    ]);
  });

  it('a declined confirmation keeps the selected Connections', async () => {
    const { runs, run } = runner(false);
    await deleteSelection(run, { elements: ['a'], connections: ['c1'] });
    expect(runs).toEqual([['element.delete', { ids: ['a'] }]]);
  });

  it('Nodes only: just the Node delete flow', async () => {
    const { runs, run } = runner(true);
    await deleteSelection(run, { elements: ['a', 'b'], connections: [] });
    expect(runs).toEqual([['element.delete', { ids: ['a', 'b'] }]]);
  });
});

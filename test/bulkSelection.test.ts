import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextTick, ref } from 'vue';
import { useBulkSelection } from '../src/renderer/src/composables/useBulkSelection.ts';

interface Item {
  id: string;
  official: boolean;
}

function setup() {
  const items = ref<Item[]>([
    { id: 'a', official: false },
    { id: 'b', official: false },
    { id: 'c', official: true },
  ]);
  const selection = useBulkSelection({ items: () => items.value, key: (item) => item.id, selectable: (item) => !item.official });
  return { items, selection };
}

describe('bulk selection', () => {
  it('ticks only what can be acted on and reports the state of all', () => {
    const { items, selection } = setup();
    const [a, b, c] = items.value as [Item, Item, Item];
    assert.equal(selection.allState.value, false);

    selection.toggle(a, true);
    selection.toggle(c, true);
    assert.equal(selection.count.value, 1);
    assert.equal(selection.isSelected(c), false);
    assert.equal(selection.allState.value, 'indeterminate');

    selection.setAll(true);
    assert.deepEqual(
      selection.selectedItems.value.map((item) => item.id),
      ['a', 'b'],
    );
    assert.equal(selection.allState.value, true);
    assert.equal(selection.selectableCount.value, 2);

    selection.toggle(b, false);
    assert.equal(selection.count.value, 1);
    selection.clear();
    assert.equal(selection.count.value, 0);
  });

  it('drops items that left the list', async () => {
    const { items, selection } = setup();
    selection.setAll(true);
    items.value = items.value.filter((item) => item.id !== 'a');
    await nextTick();
    assert.deepEqual(
      selection.selectedItems.value.map((item) => item.id),
      ['b'],
    );
    // A deleted item that comes back, such as a reinstalled map, is not ticked again by itself.
    items.value = [...items.value, { id: 'a', official: false }];
    await nextTick();
    assert.equal(selection.count.value, 1);
  });
});

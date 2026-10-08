import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FreezeWhenHidden } from './FreezeWhenHidden';

let renders = 0;
const Child = ({ label }: { label: string }) => {
  renders += 1;
  return <p>{label}</p>;
};

describe('FreezeWhenHidden', () => {
  it('skips re-rendering its children while hidden, catches up when shown', () => {
    renders = 0;
    const view = (hidden: boolean, label: string) => (
      <FreezeWhenHidden hidden={hidden}>
        <Child label={label} />
      </FreezeWhenHidden>
    );
    const { container, rerender } = render(view(false, 'one'));
    expect(renders).toBe(1);

    rerender(view(true, 'two'));
    rerender(view(true, 'three'));
    expect(renders).toBe(1);
    expect(container.textContent).toBe('one');

    rerender(view(false, 'four'));
    expect(renders).toBe(2);
    expect(container.textContent).toBe('four');
  });
});

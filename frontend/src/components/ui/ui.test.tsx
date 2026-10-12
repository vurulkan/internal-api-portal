import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AlertDialog,
  Button,
  DataTable,
  Field,
  Input,
  MultiSelect,
  ChipInput,
  Switch,
  TooltipProvider,
  type Column,
} from '.';
import { expectNoA11yViolations } from '@/test/a11y';

describe('Button', () => {
  it('is busy and disabled while loading, keeping its label', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Field', () => {
  it('connects label, helper and error to the control', async () => {
    render(
      <Field label="Slug" helper="Lower case." error="Required." required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Slug/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Lower case. Required.');
    expect(input).toHaveAttribute('aria-required', 'true');
    await expectNoA11yViolations();
  });
});

describe('MultiSelect', () => {
  function Harness({ onChange = vi.fn() }) {
    const [value, setValue] = useState<number[]>([]);
    return (
      <TooltipProvider>
        <Field label="Groups">
          <MultiSelect
            options={[
              { value: 1, label: 'payments' },
              { value: 2, label: 'identity' },
              { value: 3, label: 'auditors' },
            ]}
            value={value}
            onChange={(v) => {
              setValue(v);
              onChange(v);
            }}
          />
        </Field>
      </TooltipProvider>
    );
  }

  it('works with the keyboard alone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combo = screen.getByRole('combobox', { name: 'Groups' });
    await user.tab();
    expect(combo).toHaveFocus();
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([2]);
    await user.type(combo, 'aud');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([2, 3]);
    expect(screen.getByRole('option', { name: 'auditors' })).toHaveAttribute('aria-selected', 'true');
    await user.clear(combo);
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith([2]);
    await user.keyboard('{Escape}');
    expect(combo).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Remove identity' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('ChipInput adds a typed value with Enter', async () => {
    const user = userEvent.setup();
    function Chips() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <TooltipProvider>
          <Field label="Methods">
            <ChipInput
              suggestions={['GET', 'POST']}
              normalize={(v) => v.toUpperCase()}
              value={value}
              onChange={setValue}
            />
          </Field>
          <output>{value.join(',')}</output>
        </TooltipProvider>
      );
    }
    render(<Chips />);
    await user.type(screen.getByRole('combobox', { name: 'Methods' }), 'patch{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('PATCH');
  });
});

describe('AlertDialog', () => {
  it('enables the destructive action only after the name is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <AlertDialog
        open
        onOpenChange={() => undefined}
        title="Delete payments?"
        description="Gone for good."
        confirmLabel="Delete"
        confirmText="payments"
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete payments?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'payment');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 's');
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('Switch', () => {
  it('writes its state out, not only as color', async () => {
    const user = userEvent.setup();
    function S() {
      const [on, setOn] = useState(false);
      return <Switch label="Try it" checked={on} onCheckedChange={setOn} />;
    }
    render(<S />);
    const toggle = screen.getByRole('switch', { name: 'Try it' });
    expect(screen.getByText('Off')).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('On')).toBeInTheDocument();
  });
});

describe('DataTable', () => {
  type Row = { id: number; name: string; calls: number };
  const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    name: `api-${String(i).padStart(2, '0')}`,
    calls: 100 - i,
  }));
  const columns: Column<Row>[] = [
    { id: 'name', header: 'Name', sortValue: (r) => r.name, cell: (r) => r.name },
    { id: 'calls', header: 'Calls', sortValue: (r) => r.calls, cell: (r) => r.calls },
  ];

  it('sorts with aria-sort, pages and selects', async () => {
    const user = userEvent.setup();
    const onSelected = vi.fn();
    render(
      <TooltipProvider>
        <DataTable
          caption="APIs"
          rows={rows}
          columns={columns}
          rowKey={(r) => String(r.id)}
          rowLabel={(r) => r.name}
          selectable
          selected={[]}
          onSelectedChange={onSelected}
        />
      </TooltipProvider>,
    );
    const table = screen.getByRole('table', { name: 'APIs' });
    const callsHeader = within(table).getByRole('columnheader', { name: /Calls/ });
    expect(callsHeader).toHaveAttribute('aria-sort', 'none');
    await user.click(within(callsHeader).getByRole('button'));
    expect(callsHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('api-29');
    await user.click(within(callsHeader).getByRole('button'));
    expect(callsHeader).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select api-25' }));
    expect(onSelected).toHaveBeenLastCalledWith(['25']);
    await expectNoA11yViolations();
  });
});
